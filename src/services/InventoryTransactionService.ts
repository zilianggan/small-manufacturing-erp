/**
 * Inventory Transaction module service layer (stock movement ledger).
 *
 * Talks to Supabase directly via helper.ts's shared primitives, mirroring
 * MaterialService.ts / ProductService.ts: no db.ts full-list localStorage
 * cache, no server.ts REST hop, no useTableData hook. Insert-only — no
 * update/delete export, since stock is trigger-maintained on INSERT only.
 */
import { supabase } from "./supabase";
import { upsertRecord } from "../helper";
import { InventoryListItem, InventoryTransaction, InventoryTransactionType } from "../types";
import { getMaterials } from "./MaterialService";
import { getProducts } from "./ProductService";

export const generateId = (): string => crypto.randomUUID();

const mapTransactionRow = (row: any): InventoryTransaction => {
  const purchaseHeader = row.purchase_detail?.purchase_header;
  const salesHeader = row.production_material_usage?.sales_detail?.sales_header;
  return {
    id: row.id,
    transactionType: row.transaction_type,
    quantity: Number(row.quantity) || 0,
    unitCost: row.unit_cost != null ? Number(row.unit_cost) : undefined,
    remark: row.remark || undefined,
    materialId: row.material_id || undefined,
    materialName: row.material?.name,
    productId: row.product_id || undefined,
    productName: row.product?.name,
    refNo: purchaseHeader?.purchase_no || salesHeader?.sales_no,
    purchaseHeaderId: purchaseHeader?.id,
    salesHeaderId: salesHeader?.id,
    transactionDate: row.transaction_date?.slice(0, 10),
    createdAt: row.created_at,
  };
};

export type InventoryLedgerSortField = 'date' | 'type' | 'quantity' | 'unitCost';
export type SortDir = 'asc' | 'desc';

const SORT_COLUMN: Record<InventoryLedgerSortField, string> = {
  date: 'transaction_date',
  type: 'transaction_type',
  quantity: 'quantity',
  unitCost: 'unit_cost',
};

export const getInventoryTransactions = async (params: {
  search?: string;
  typeFilters?: InventoryTransactionType[]; // empty/undefined = all types
  materialIds?: string[]; // FilterDialog's ticked-record picker, OR'd with productIds, AND'd with search
  productIds?: string[];
  sortField?: InventoryLedgerSortField;
  sortDir?: SortDir;
  offset: number;
  limit: number;
}): Promise<{ rows: InventoryTransaction[]; hasMore: boolean }> => {
  const { search = '', typeFilters, materialIds, productIds, sortField = 'date', sortDir = 'desc', offset, limit } = params;

  let query = supabase
    .from('inventory_transaction')
    .select(`
      *, material(name), product(name),
      purchase_detail(purchase_header(id, purchase_no)),
      production_material_usage(sales_detail(sales_header(id, sales_no)))
    `, { count: 'exact' })
    .order(SORT_COLUMN[sortField], { ascending: sortDir === 'asc' })
    .order('created_at', { ascending: false });

  if (typeFilters && typeFilters.length > 0) {
    query = query.in('transaction_type', typeFilters);
  }

  const q = search.trim();
  if (q) {
    // inventory_transaction has no denormalized name column, so search is
    // done by first resolving matching material/product ids via their own
    // services, then filtering the ledger by those ids.
    const [matchedMaterials, matchedProducts] = await Promise.all([
      getMaterials(q),
      getProducts(q),
    ]);
    const searchMaterialIds = matchedMaterials.map(m => m.id);
    const searchProductIds = matchedProducts.map(p => p.id);

    if (searchMaterialIds.length === 0 && searchProductIds.length === 0) {
      return { rows: [], hasMore: false };
    }

    const orParts: string[] = [];
    if (searchMaterialIds.length > 0) orParts.push(`material_id.in.(${searchMaterialIds.join(',')})`);
    if (searchProductIds.length > 0) orParts.push(`product_id.in.(${searchProductIds.join(',')})`);
    query = query.or(orParts.join(','));
  }

  // A row only ever has one of material_id/product_id set, so the item
  // filter is an OR of the two id sets (a second, separately AND'd .or()
  // group — chained postgrest filters combine with AND, matching the search
  // .or() above).
  if ((materialIds && materialIds.length > 0) || (productIds && productIds.length > 0)) {
    const orParts: string[] = [];
    if (materialIds && materialIds.length > 0) orParts.push(`material_id.in.(${materialIds.join(',')})`);
    if (productIds && productIds.length > 0) orParts.push(`product_id.in.(${productIds.join(',')})`);
    query = query.or(orParts.join(','));
  }

  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) {
    console.error('getInventoryTransactions', error);
    return { rows: [], hasMore: false };
  }

  const rows = (data || []).map(mapTransactionRow);
  const hasMore = count != null ? offset + rows.length < count : rows.length === limit;
  return { rows, hasMore };
};

export const saveInventoryTransaction = (tx: InventoryTransaction): Promise<void> =>
  upsertRecord('erp_inventory_transaction', tx);

const mapMovementRow = (row: any): InventoryListItem => {
  const purchaseHeader = row.purchase_detail?.purchase_header;
  const salesHeader = row.production_material_usage?.sales_detail?.sales_header;
  const quantity = Number(row.quantity) || 0;
  const unitCost = row.unit_cost != null ? Number(row.unit_cost) : undefined;

  return {
    id: row.id,
    transactionType: row.transaction_type,
    refNo: purchaseHeader?.purchase_no || salesHeader?.sales_no,
    counterpartyName: purchaseHeader?.vendors?.company_name || salesHeader?.clients?.company_name,
    orderDate: row.transaction_date?.slice(0, 10),
    quantity,
    unitCost,
    totalPrice: unitCost != null ? Math.abs(quantity) * unitCost : undefined,
    status: purchaseHeader?.status || salesHeader?.status,
    purchaseHeaderId: purchaseHeader?.id,
    salesHeaderId: salesHeader?.id,
  };
};

// Read-only side of the ledger for MaterialDetailView's/ProductDetailView's
// "Inventory List": movements against one material/product, joined out to
// whichever order header generated them (purchase_detail -> purchase_header
// for PURCHASE/PURCHASE_RETURN, production_material_usage -> sales_detail ->
// sales_header for SALES/SALES_RETURN/ADJUSTMENT). ADJUSTMENT rows with no
// production_material_usage link (standalone stock corrections) have no
// order header to join, so refNo/counterpartyName/status/*HeaderId stay
// unset for those. excludeTypes lets callers drop the type they already source from the
// order-detail tables directly (richer/earlier data than the ledger alone).
export const getInventoryMovements = async (
  filter: { materialId?: string; productId?: string },
  excludeTypes: InventoryTransactionType[] = []
): Promise<InventoryListItem[]> => {
  let query = supabase
    .from('inventory_transaction')
    .select(`
      id, transaction_type, quantity, unit_cost, transaction_date,
      purchase_detail(purchase_header(id, purchase_no, status, vendors(company_name))),
      production_material_usage(sales_detail(sales_header(id, sales_no, status, clients(company_name))))
    `)
    .order('transaction_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (filter.materialId) query = query.eq('material_id', filter.materialId);
  if (filter.productId) query = query.eq('product_id', filter.productId);
  if (excludeTypes.length > 0) query = query.not('transaction_type', 'in', `(${excludeTypes.join(',')})`);

  const { data, error } = await query;
  if (error) {
    console.error('getInventoryMovements', error);
    return [];
  }
  return (data || []).map(mapMovementRow);
};
