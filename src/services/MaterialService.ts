/**
 * Material module service layer.
 *
 * Talks to Supabase directly via helper.ts's shared primitives, mirroring
 * ContactsService.ts: no db.ts full-list localStorage cache, no server.ts
 * REST hop, no useTableData hook.
 */
import { supabase } from "./supabase";
import { upsertRecord, deleteRecord } from "../helper";
import { InventoryListItem, Material } from "../types";
import { getMaterialCategories } from "./SystemAdminService";
import { getInventoryMovements } from "./InventoryTransactionService";

export { getMaterialCategories };

export const generateId = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const mapMaterialRow = (row: any): Material => ({
  id: row.id,
  name: row.name,
  code: row.code || '',
  materialType: row.material_type,
  dimension: row.dimension || '',
  quantity: Number(row.quantity) || 0,
  description: row.description || '',
  attachments: row.attachments || [],
  status: row.status || 'ACTIVE',
  minimumStock: Number(row.minimum_stock) || 0,
  reorderQuantity: Number(row.reorder_quantity) || 0,
  materialCategoryId: row.material_category_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export const getMaterials = async (search = ''): Promise<Material[]> => {
  let query = supabase.from('material').select('*').order('created_at', { ascending: true });
  const q = search.trim();
  if (q) query = query.or(`name.ilike.%${q}%,code.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) {
    console.error('getMaterials', error);
    return [];
  }
  return (data || []).map(mapMaterialRow);
};

export type MaterialSortField = 'name' | 'code' | 'stock' | 'restock' | 'latestPurchase' | 'oldestPurchase';
export type SortDir = 'asc' | 'desc';

const SORT_FIELD_TO_RPC: Record<MaterialSortField, string> = {
  name: 'name',
  code: 'code',
  stock: 'stock',
  restock: 'restock',
  latestPurchase: 'latest_purchase',
  oldestPurchase: 'oldest_purchase',
};

// Paginated, filterable, sortable material catalog for MaterialView.tsx — via
// the get_materials_page() RPC (supabase/function_trigger.sql), since sorting
// by aggregated purchase history dates needs a DB-side join that plain
// PostgREST .order() can't express. getMaterials() above stays as-is for the
// unpaginated ComboBox/lookup callers (InventoryView, InventoryTransactionService).
export const getMaterialsPage = async (params: {
  search?: string;
  materialIds?: string[]; // FilterDialog's ticked-record picker, AND'd with search
  sortField?: MaterialSortField;
  sortDir?: SortDir;
  offset: number;
  limit: number;
}): Promise<{ rows: Material[]; hasMore: boolean }> => {
  const { search = '', materialIds, sortField = 'name', sortDir = 'asc', offset, limit } = params;

  const { data, error } = await supabase.rpc('get_materials_page', {
    p_search: search.trim() || null,
    p_ids: materialIds && materialIds.length > 0 ? materialIds : null,
    p_sort_field: SORT_FIELD_TO_RPC[sortField],
    p_sort_dir: sortDir,
    p_offset: offset,
    p_limit: limit,
  });

  if (error) {
    console.error('getMaterialsPage', error);
    return { rows: [], hasMore: false };
  }

  const rows = (data || []).map((row: any) => ({
    ...mapMaterialRow(row),
    latestPurchaseDate: row.latest_purchase_date || undefined,
    oldestPurchaseDate: row.oldest_purchase_date || undefined,
  }));
  const total = data?.[0]?.total_count ?? 0;
  const hasMore = offset + rows.length < total;
  return { rows, hasMore };
};

export const saveMaterial = (material: Material): Promise<void> => upsertRecord('erp_material', material);
export const deleteMaterial = (id: string): Promise<void> => deleteRecord('erp_material', id);

// Fetches a single material by id — used by MaterialView.tsx to restore the
// drill-down detail page after a cross-tab round trip (e.g. Purchases ->
// PurchaseOrderDetailView's back button returning to this material's page).
export const getMaterialById = async (id: string): Promise<Material | null> => {
  const { data, error } = await supabase.from('material').select('*').eq('id', id).maybeSingle();
  if (error) {
    console.error('getMaterialById', error);
    return null;
  }
  return data ? mapMaterialRow(data) : null;
};

const mapPurchaseHistoryRow = (row: any): InventoryListItem => ({
  id: row.detail_id,
  transactionType: 'PURCHASE',
  refNo: row.purchase_header?.purchase_no,
  counterpartyName: row.purchase_header?.vendors?.company_name || '',
  orderDate: row.purchase_header?.order_date || row.purchase_header?.quotation_date,
  quantity: Number(row.quantity) || 0,
  unitCost: Number(row.unit_cost) || 0,
  totalPrice: Number(row.total_price) || 0,
  status: row.purchase_header?.status,
  purchaseHeaderId: row.header_id,
});

// MaterialDetailView's "Inventory List": every purchase order line for this
// material (purchase_detail/purchase_header, including not-yet-received
// lines) merged with any other ledger movement against it — chiefly
// production consumption (SALES/SALES_RETURN, tied back to the sales order
// that consumed it) and stock ADJUSTMENTs. PURCHASE is excluded from the
// ledger side since purchase_detail above already covers it with richer,
// pre-receipt data.
export const getMaterialInventoryList = async (materialId: string): Promise<InventoryListItem[]> => {
  const [purchaseRows, movementRows] = await Promise.all([
    (async () => {
      const { data, error } = await supabase
        .from('purchase_detail')
        .select('*, purchase_header(*, vendors(company_name))')
        .eq('material_id', materialId);
      if (error) {
        console.error('getMaterialInventoryList(purchase)', error);
        return [];
      }
      return (data || []).map(mapPurchaseHistoryRow);
    })(),
    getInventoryMovements({ materialId }, ['PURCHASE']),
  ]);

  return [...purchaseRows, ...movementRows].sort((a, b) => (b.orderDate || '').localeCompare(a.orderDate || ''));
};
