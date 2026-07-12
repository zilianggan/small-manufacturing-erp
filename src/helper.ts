import { create } from 'zustand';
import { supabase } from "./services/supabase";

interface SyncStore {
    isSyncing: boolean;
    setSyncing: (val: boolean) => void;
}
export const useSyncStore = create<SyncStore>((set) => ({ isSyncing: false, setSyncing: (val) => set({ isSyncing: val }) }));

// Generates a real UUID v4 client-side so every new record's `id` matches
// the `uuid` column type used across all Supabase tables.
export const generateId = (): string => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    // Fallback (older environments without crypto.randomUUID)
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
};

const LS_TO_TABLE: Record<string, string> = {
    erp_vendors: 'vendors',
    erp_clients: 'clients',
    erp_employees: 'employees',
    erp_job_positions: 'job_positions',
    erp_material_categories: 'material_categories',
    erp_product_categories: 'product_categories',
    erp_contacts: 'contacts',
    erp_material: 'material',
    erp_product: 'product',
    erp_inventory_transaction: 'inventory_transaction',
};

// Serializes JS (camelCase) records -> DB (snake_case) rows for upsertRecord()/upsertRecords().
const ROW_MAPPERS: Record<string, (row: any) => any> = {
    erp_vendors: (v) => ({
        id: v.id, company_name: v.companyName, email: v.email, office_no: v.officeNo,
        address: v.address, description: v.description || '',
        attachments: v.attachments || []
    }),
    erp_clients: (c) => ({
        id: c.id, company_name: c.companyName, email: c.email, office_no: c.officeNo,
        address: c.address, description: c.description || '',
        attachments: c.attachments || []
    }),
    erp_contacts: (p) => ({
        id: p.id, full_name: p.fullName, contact_no: p.contactNo || null, email: p.email || null,
        job_position: p.jobPositionId || null, vendor_id: p.vendorId || null, client_id: p.clientId || null,
        attachments: p.attachments || []
    }),
    erp_material: (m) => ({
        id: m.id, name: m.name, code: m.code || null,
        material_type: m.materialType || null, dimension: m.dimension || null,
        consumption_mode: m.materialType === 'CONSUMABLE_MATERIAL' ? (m.consumptionMode || null) : null,
        description: m.description || '', attachments: m.attachments || [],
        status: m.status || null, minimum_stock: m.minimumStock ?? 0,
        material_category_id: m.materialCategoryId || null
        // NOTE: quantity deliberately omitted — owned by the update_material_stock() DB
        // trigger (fires on inventory_transaction inserts); including it here would let
        // every material edit stomp the trigger-maintained stock value.
    }),
    erp_product: (p) => ({
        id: p.id, name: p.name, code: p.code || null, dimension: p.dimension || null,
        description: p.description || '', attachments: p.attachments || [],
        status: p.status || null, selling_price: p.sellingPrice ?? 0,
        product_category_id: p.productCategoryId || null
    }),
    erp_inventory_transaction: (t) => ({
        id: t.id,
        transaction_type: t.transactionType,
        quantity: t.quantity,
        unit_cost: t.unitCost ?? null,
        remark: t.remark || null,
        material_id: t.materialId || null,
        product_id: t.productId || null,
        purchase_detail_id: t.purchaseDetailId || null,
        production_material_usage_id: t.productionMaterialUsageId || null,
        transaction_date: t.transactionDate
    }),
    erp_employees: (e) => ({
        id: e.id, full_name: e.fullName, contact_no: e.contactNo || null, email: e.email || null,
        job_position: e.jobPositionId || null, status: e.status || null
    }),
    erp_job_positions: (p) => ({
        id: p.id,
        name: p.name,
        is_active: p.is_active ?? true,
        created_at: p.created_at,
        updated_at: p.updated_at
    }),
    erp_material_categories: (c) => ({
        id: c.id,
        name: c.name,
        is_active: c.is_active ?? true,
        created_at: c.created_at,
        updated_at: c.updated_at
    }),
    erp_product_categories: (c) => ({
        id: c.id, name: c.name,
        is_active: c.is_active ?? true,
        created_at: c.created_at,
        updated_at: c.updated_at
    }),
};

export const setStorageItem = <T>(key: string, value: T): void => {
    localStorage.setItem(key, JSON.stringify(value));
    // NOTE: Supabase writes are now done per-record via upsertRecord / deleteRecord
    // called directly from each mutation function. setStorageItem no longer does
    // bulk upserts so unrelated rows never get their updated_at touched.
};

export const getStorageItem = <T>(key: string, defaultValue: T): T => {
    const data = localStorage.getItem(key);
    if (!data) return defaultValue;
    return JSON.parse(data);
};

export const removeStorageItem = (key: string): void => {
    localStorage.removeItem(key);
};

export const upsertRecord = async (lsKey: string, item: any): Promise<void> => {
    const tableName = LS_TO_TABLE[lsKey];
    if (!tableName) return;
    const serialiser = ROW_MAPPERS[lsKey];
    if (!serialiser) return;
    const row = serialiser(item);
    const { error } = await supabase.from(tableName).upsert(row);
    if (error) console.error(`upsertRecord(${tableName}) error:`, error);
};

const BATCH_SIZE = 500;

// ponytail: fixed batch size, bump if a single import file regularly exceeds a few thousand rows
export const upsertRecords = async (lsKey: string, items: any[]): Promise<void> => {
    const tableName = LS_TO_TABLE[lsKey];
    if (!tableName) return;
    const serialiser = ROW_MAPPERS[lsKey];
    if (!serialiser) return;
    const rows = items.map(serialiser);
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const { error } = await supabase.from(tableName).upsert(batch);
        if (error) console.error(`upsertRecords(${tableName}) error:`, error);
    }
};

/**
 * Delete a SINGLE record from Supabase by id.
 */
export const deleteRecord = async (lsKey: string, id: string): Promise<void> => {
    const tableName = LS_TO_TABLE[lsKey];
    if (!tableName) return;
    const { error } = await supabase.from(tableName).delete().eq('id', id);
    if (error) console.error(`deleteRecord(${tableName}) error:`, error);
};

export const getRecords = async <T>(
    table: string,
    options?: {
        orderBy?: string;
        ascending?: boolean;
    }
): Promise<T[]> => {
    let query = supabase.from(table).select("*");

    if (options?.orderBy) {
        query = query.order(options.orderBy, {
            ascending: options.ascending ?? true,
        });
    }

    const { data, error } = await query;

    if (error) {
        console.error(`getRecords(${table})`, error);
        return [];
    }

    return (data as T[]) ?? [];
};