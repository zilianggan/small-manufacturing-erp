/**
 * Product module service layer.
 *
 * Talks to Supabase directly via helper.ts's shared primitives, mirroring
 * MaterialService.ts / ContactsService.ts: no db.ts full-list localStorage
 * cache, no server.ts REST hop, no useTableData hook.
 */
import { supabase } from "./supabase";
import { upsertRecord, deleteRecord, generateId } from "../helper";
import { InventoryListItem, Product } from "../types";
import { getProductCategories } from "./SystemAdminService";
import { getInventoryMovements } from "./InventoryTransactionService";

export { getProductCategories, generateId };

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

export type ProductSortField = 'name' | 'code' | 'stock' | 'latestSale' | 'oldestSale';
export type SortDir = 'asc' | 'desc';

const SORT_FIELD_TO_RPC: Record<ProductSortField, string> = {
  name: 'name',
  code: 'code',
  stock: 'stock',
  latestSale: 'latest_sale',
  oldestSale: 'oldest_sale',
};

// Paginated, filterable, sortable product catalog for ProductView.tsx — via
// the get_products_page() RPC (supabase/function_trigger.sql), mirroring
// MaterialService.getMaterialsPage(). getProducts() above stays as-is for
// unpaginated lookups elsewhere (e.g. OrdersView's product ComboBox).
export const getProductsPage = async (params: {
  search?: string;
  productIds?: string[]; // FilterDialog's ticked-record picker, AND'd with search
  sortField?: ProductSortField;
  sortDir?: SortDir;
  offset: number;
  limit: number;
}): Promise<{ rows: Product[]; hasMore: boolean }> => {
  const { search = '', productIds, sortField = 'name', sortDir = 'asc', offset, limit } = params;

  const { data, error } = await supabase.rpc('get_products_page', {
    p_search: search.trim() || null,
    p_ids: productIds && productIds.length > 0 ? productIds : null,
    p_sort_field: SORT_FIELD_TO_RPC[sortField],
    p_sort_dir: sortDir,
    p_offset: offset,
    p_limit: limit,
  });

  if (error) {
    console.error('getProductsPage', error);
    return { rows: [], hasMore: false };
  }

  const rows = (data || []).map((row: any) => ({
    ...mapProductRow(row),
    quantity: Number(row.quantity) || 0,
    latestSaleDate: row.latest_sale_date || undefined,
    oldestSaleDate: row.oldest_sale_date || undefined,
  }));
  const total = data?.[0]?.total_count ?? 0;
  const hasMore = offset + rows.length < total;
  return { rows, hasMore };
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
  // Negated: this is an outflow (goods leaving on a sale), not a credit. unitCost/totalPrice stay
  // positive — they're read straight off unit_price/total_price, not derived from quantity — a
  // magnitude is wanted there, same as the ledger mappers (mapMovementRow/mapConsumableUsageRow).
  quantity: -(Number(row.quantity) || 0),
  unitCost: Number(row.unit_price) || 0,
  totalPrice: Number(row.total_price) || 0,
  status: row.sales_header?.status,
  salesHeaderId: row.header_id,
});

// ProductDetailView's "Inventory List": every sales order line for this product
// (sales_detail/sales_header) merged with any other ledger movement against it — now PRODUCTION
// (credited on production completion) and ADJUSTMENT (extra yield / corrections) as well as
// SALES_RETURN. SALES itself is excluded from the ledger side via excludeTypes below: the
// sales_detail rows fetched here already represent the sale, so including the ledger's own SALES
// row too would list the same sale twice.
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
