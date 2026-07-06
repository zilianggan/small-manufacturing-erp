/**
 * Product module service layer.
 *
 * Talks to Supabase directly via helper.ts's shared primitives, mirroring
 * MaterialService.ts / ContactsService.ts: no db.ts full-list localStorage
 * cache, no server.ts REST hop, no useTableData hook.
 */
import { supabase } from "./supabase";
import { upsertRecord, deleteRecord } from "../helper";
import { Product, ProductSalesHistoryItem } from "../types";
import { getProductCategories } from "./SystemAdminService";

export { getProductCategories };

export const generateId = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const mapProductRow = (row: any): Product => ({
  id: row.id,
  name: row.name,
  code: row.code || '',
  dimension: row.dimension || '',
  description: row.description || '',
  attachments: row.attachments || [],
  status: row.status || 'ACTIVE',
  sellingPrice: Number(row.selling_price) || 0,
  productCategoryId: row.product_category_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export const getProducts = async (search = ''): Promise<Product[]> => {
  let query = supabase.from('product').select('*').order('created_at', { ascending: true });
  const q = search.trim();
  if (q) query = query.or(`name.ilike.%${q}%,code.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) {
    console.error('getProducts', error);
    return [];
  }
  return (data || []).map(mapProductRow);
};

export const saveProduct = (product: Product): Promise<void> => upsertRecord('erp_product', product);
export const deleteProduct = (id: string): Promise<void> => deleteRecord('erp_product', id);

const mapSalesHistoryRow = (row: any): ProductSalesHistoryItem => ({
  detailId: row.detail_id,
  headerId: row.header_id,
  productId: row.product_id,
  quantity: Number(row.quantity) || 0,
  unitPrice: Number(row.unit_price) || 0,
  totalPrice: Number(row.total_price) || 0,
  remark: row.remark,
  salesNo: row.sales_header?.sales_no,
  orderDate: row.sales_header?.order_date,
  deliveryDate: row.sales_header?.delivery_date,
  status: row.sales_header?.status,
  clientId: row.sales_header?.client_id,
  createdAt: row.created_at
});

// Read-only join for ProductDetailView's order history section, ordered by
// sales_header.order_date desc (newest first). sales_detail/sales_header
// aren't used anywhere else in the app yet.
export const getProductSalesHistory = async (productId: string): Promise<ProductSalesHistoryItem[]> => {
  const { data, error } = await supabase
    .from('sales_detail')
    .select('*, sales_header(*)')
    .eq('product_id', productId)
    .order('order_date', { foreignTable: 'sales_header', ascending: false });

  if (error) {
    console.error('getProductSalesHistory', error);
    return [];
  }
  return (data || []).map(mapSalesHistoryRow);
};
