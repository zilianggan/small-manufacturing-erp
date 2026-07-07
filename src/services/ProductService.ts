/**
 * Product module service layer.
 *
 * Talks to Supabase directly via helper.ts's shared primitives, mirroring
 * MaterialService.ts / ContactsService.ts: no db.ts full-list localStorage
 * cache, no server.ts REST hop, no useTableData hook.
 */
import { supabase } from "./supabase";
import { upsertRecord, deleteRecord } from "../helper";
import { InventoryListItem, Product } from "../types";
import { getProductCategories } from "./SystemAdminService";
import { getInventoryMovements } from "./InventoryTransactionService";

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

// Fetches a single product by id — used by ProductView.tsx to restore the
// drill-down detail page after a cross-tab round trip (e.g. Orders ->
// SalesOrderDetailView's back button returning to this product's page).
export const getProductById = async (id: string): Promise<Product | null> => {
  const { data, error } = await supabase.from('product').select('*').eq('id', id).maybeSingle();
  if (error) {
    console.error('getProductById', error);
    return null;
  }
  return data ? mapProductRow(data) : null;
};

const mapSalesHistoryRow = (row: any): InventoryListItem => ({
  id: row.detail_id,
  transactionType: 'SALES',
  refNo: row.sales_header?.sales_no,
  counterpartyName: row.sales_header?.clients?.company_name || '',
  orderDate: row.sales_header?.order_date,
  quantity: Number(row.quantity) || 0,
  unitCost: Number(row.unit_price) || 0,
  totalPrice: Number(row.total_price) || 0,
  status: row.sales_header?.status,
  salesHeaderId: row.header_id,
});

// ProductDetailView's "Inventory List": every sales order line for this
// product (sales_detail/sales_header) merged with any other ledger movement
// against it — chiefly extra-produced stock ADJUSTMENTs. SALES is excluded
// from the ledger side since sales_detail above already covers it (products
// have no dedicated stock ledger entry for the ordered/ordinary quantity).
export const getProductInventoryList = async (productId: string): Promise<InventoryListItem[]> => {
  const [salesRows, movementRows] = await Promise.all([
    (async () => {
      const { data, error } = await supabase
        .from('sales_detail')
        .select('*, sales_header(*, clients(company_name))')
        .eq('product_id', productId);
      if (error) {
        console.error('getProductInventoryList(sales)', error);
        return [];
      }
      return (data || []).map(mapSalesHistoryRow);
    })(),
    getInventoryMovements({ productId }, ['SALES']),
  ]);

  return [...salesRows, ...movementRows].sort((a, b) => (b.orderDate || '').localeCompare(a.orderDate || ''));
};
