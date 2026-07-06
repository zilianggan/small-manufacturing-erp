import { supabase } from "./services/supabase";

const LS_TO_TABLE: Record<string, string> = {
    erp_inventory: 'inventory_items',
    erp_vendors: 'vendors',
    erp_clients: 'clients',
    erp_sales_orders: 'sales_orders',
    erp_purchase_orders: 'purchase_orders',
    erp_workflow_tasks: 'workflow_tasks',
    erp_employees: 'employees',
    erp_job_positions: 'job_positions',
    erp_material_categories: 'material_categories',
    erp_product_categories: 'product_categories',
    erp_contacts: 'contacts',
    erp_material: 'material',
    erp_product: 'product',
    erp_inventory_transaction: 'inventory_transaction',
};

const ROW_MAPPERS: Record<string, (row: any) => any> = {
    erp_inventory: (i) => ({
        id: i.id, name: i.name, sku: i.sku, type: i.type,
        materialCategoryId: i.material_category_id,
        productCategoryId: i.product_category_id,
        quantity: Number(i.quantity), unit: i.unit, unitCost: Number(i.unit_cost),
        reorderPoint: Number(i.reorder_point), supplierId: i.supplier_id,
        description: i.description, attachments: i.attachments || [],
        createdAt: i.created_at, updatedAt: i.updated_at
    }),
    // NOTE: unlike the other entries in this map (which deserialize DB rows
    // for the now-unused loadTableProgressively path), these three serialize
    // JS (camelCase) records -> DB (snake_case) rows, since upsertRecord()
    // is their only live caller.
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
        description: m.description || '', attachments: m.attachments || [],
        status: m.status || null, minimum_stock: m.minimumStock ?? 0,
        reorder_quantity: m.reorderQuantity ?? 0, material_category_id: m.materialCategoryId || null
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
        transaction_date: t.transactionDate
    }),
    erp_sales_orders: (o) => ({
        id: o.id, clientId: o.client_id, clientName: o.client_name, itemId: o.item_id,
        itemName: o.item_name, quantity: Number(o.quantity), unitPrice: Number(o.unit_price),
        totalPrice: Number(o.total_price), orderDate: o.order_date, deliveryDate: o.delivery_date,
        status: o.status, workflowTaskId: o.workflow_task_id,
        attachments: o.attachments || [], items: o.items || [],
        createdAt: o.created_at, updatedAt: o.updated_at
    }),
    erp_purchase_orders: (o) => ({
        id: o.id, vendorId: o.vendor_id, vendorName: o.vendor_name, itemId: o.item_id,
        itemName: o.item_name, quantity: Number(o.quantity), unitCost: Number(o.unit_cost),
        totalCost: Number(o.total_cost), orderDate: o.order_date, status: o.status,
        receivedDate: o.received_date, attachments: o.attachments || [], items: o.items || [],
        createdAt: o.created_at, updatedAt: o.updated_at
    }),
    erp_workflow_tasks: (t) => ({
        id: t.id, orderId: t.order_id, productName: t.product_name, quantity: Number(t.quantity),
        currentStep: t.current_step, assignedTo: t.assigned_to, startDate: t.start_date,
        endDate: t.end_date, notes: t.notes,
        createdAt: t.created_at, updatedAt: t.updated_at
    }),
    erp_employees: (e) => ({
        id: e.id, name: e.name, role: e.role, status: e.status,
        email: e.email, phone: e.phone,
        createdAt: e.created_at, updatedAt: e.updated_at
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

export const removeStorageItem = <T>(key: string): void => {
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

/**
 * Delete a SINGLE record from Supabase by id.
 */
export const deleteRecord = async (lsKey: string, id: string): Promise<void> => {
    const tableName = LS_TO_TABLE[lsKey];
    if (!tableName) return;
    const { error } = await supabase.from(tableName).delete().eq('id', id);
    if (error) console.error(`deleteRecord(${tableName}) error:`, error);
};

const isTabLoaded = (key: string): boolean => !!localStorage.getItem(key);

const fetchAllRows = async (table: string): Promise<any> => {
    const res = await fetch(`/api/data/${table}`);
    if (!res.ok) throw new Error(`Failed to fetch ${table}: ${res.status}`);
    return res.json();
};

// Loads a table's full contents into localStorage in one shot.
const loadTableProgressively = async (key: string, tableName: string) => {
    const mapper = ROW_MAPPERS[key] || ((r: any) => r);
    const result = await fetchAllRows(tableName);
    const rows = (result.data || []).map(mapper);
    if (rows.length > 0) {
        localStorage.setItem(key, JSON.stringify(rows));
    }
};

export const loadTable = async (lsKey: string, tableName: string) => {
    if (isTabLoaded(lsKey)) return; // already cached, skip
    await loadTableProgressively(lsKey, tableName);
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