/**
 * Material module service layer.
 *
 * Talks to Supabase directly via helper.ts's shared primitives, mirroring
 * ContactsService.ts: no db.ts full-list localStorage cache, no server.ts
 * REST hop, no useTableData hook.
 */
import { supabase } from "./supabase";
import { upsertRecord, deleteRecord } from "../helper";
import { Material, MaterialPurchaseHistoryItem } from "../types";
import { getMaterialCategories } from "./SystemAdminService";

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

const mapPurchaseHistoryRow = (row: any): MaterialPurchaseHistoryItem => ({
  detailId: row.detail_id,
  headerId: row.header_id,
  materialId: row.material_id,
  quantity: Number(row.quantity) || 0,
  unitCost: Number(row.unit_cost) || 0,
  totalPrice: Number(row.total_price) || 0,
  receivedQuantity: Number(row.received_quantity) || 0,
  purchaseNo: row.purchase_header?.purchase_no,
  quotationDate: row.purchase_header?.quotation_date,
  orderDate: row.purchase_header?.order_date,
  receivedDate: row.purchase_header?.received_date,
  status: row.purchase_header?.status,
  vendorId: row.purchase_header?.vendor_id,
  createdAt: row.created_at
});

// Read-only join for MaterialDetailView's purchase history section, ordered
// by purchase_header.order_date desc (newest first). purchase_detail/
// purchase_header aren't used anywhere else in the app yet.
export const getMaterialPurchaseHistory = async (materialId: string): Promise<MaterialPurchaseHistoryItem[]> => {
  const { data, error } = await supabase
    .from('purchase_detail')
    .select('*, purchase_header(*)')
    .eq('material_id', materialId)
    .order('order_date', { foreignTable: 'purchase_header', ascending: false });

  if (error) {
    console.error('getMaterialPurchaseHistory', error);
    return [];
  }
  return (data || []).map(mapPurchaseHistoryRow);
};
