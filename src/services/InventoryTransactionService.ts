/**
 * Inventory Transaction module service layer (stock movement ledger).
 *
 * Talks to Supabase directly via helper.ts's shared primitives, mirroring
 * MaterialService.ts / ProductService.ts: no db.ts full-list localStorage
 * cache, no server.ts REST hop, no useTableData hook. Insert-only — no
 * update/delete export, since stock is trigger-maintained on INSERT only.
 */
import { supabase } from "./supabase";
import { upsertRecord, generateId } from "../helper";
import { InventoryListItem, InventoryTransaction, InventoryTransactionType } from "../types";
import { getMaterials } from "./MaterialService";
import { getProducts } from "./ProductService";

export { generateId };

const mapTransactionRow = (row: any): InventoryTransaction => {
  const purchaseHeader = row.purchase_detail?.purchase_header;
  // Two routes to the sales header now: the old one via a production material usage row (material
  // consumed against an order), and the direct one via sales_detail (finished goods produced,
  // shipped, or returned). A row only ever has one of them set.
  const salesHeader = row.production_material_usage?.sales_detail?.sales_header
    || row.sales_detail?.sales_header;
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
    salesDetailId: row.sales_detail_id || undefined,
    refNo: purchaseHeader?.purchase_no || salesHeader?.sales_no,
    counterpartyName: purchaseHeader?.vendors?.company_name || salesHeader?.clients?.company_name,
    status: purchaseHeader?.status || salesHeader?.status,
    purchaseHeaderId: purchaseHeader?.id,
    salesHeaderId: salesHeader?.id,
    transactionDate: row.transaction_date,
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

// status isn't a column on inventory_transaction — it's whatever the linked purchase/sales header's
// status is, reached through three different FKs (purchase_detail_id direct; sales_detail_id direct
// for finished-goods rows; production_material_usage_id -> its own sales_detail_id for material
// consumption rows). No single PostgREST filter reaches all three, so this resolves each path to a
// set of inventory_transaction-level ids first (embedded !inner filter, one query per path), then
// ORs them together — same "resolve ids, then filter" shape the search/client-name lookups above use.
const resolveStatusFilterIds = async (statuses: string[]) => {
  const [pd, sd, pmu] = await Promise.all([
    supabase.from('purchase_detail').select('detail_id, purchase_header!inner(status)').in('purchase_header.status', statuses),
    supabase.from('sales_detail').select('detail_id, sales_header!inner(status)').in('sales_header.status', statuses),
    supabase.from('production_material_usage').select('id, sales_detail!inner(sales_header!inner(status))').in('sales_detail.sales_header.status', statuses),
  ]);
  return {
    purchaseDetailIds: (pd.data || []).map((r: any) => r.detail_id),
    salesDetailIds: (sd.data || []).map((r: any) => r.detail_id),
    productionMaterialUsageIds: (pmu.data || []).map((r: any) => r.id),
  };
};

export const getInventoryTransactions = async (params: {
  search?: string;
  typeFilters?: InventoryTransactionType[]; // empty/undefined = all types
  materialIds?: string[]; // FilterDialog's ticked-record picker, OR'd with productIds, AND'd with search
  productIds?: string[];
  statuses?: string[]; // linked purchase/sales header status — see resolveStatusFilterIds
  dateFrom?: string; // inclusive, yyyy-mm-dd, against transaction_date
  dateTo?: string; // inclusive
  sortField?: InventoryLedgerSortField;
  sortDir?: SortDir;
  offset: number;
  limit: number;
}): Promise<{ rows: InventoryTransaction[]; hasMore: boolean; totalCount: number }> => {
  const { search = '', typeFilters, materialIds, productIds, statuses, dateFrom, dateTo, sortField = 'date', sortDir = 'desc', offset, limit } = params;

  let query = supabase
    .from('inventory_transaction')
    .select(`
      *, material(name), product(name),
      purchase_detail(purchase_header(id, purchase_no, status, vendors(company_name))),
      production_material_usage(sales_detail(sales_header(id, sales_no, status, clients(company_name)))),
      sales_detail(sales_header(id, sales_no, status, clients(company_name)))
    `, { count: 'exact' })
    .order(SORT_COLUMN[sortField], { ascending: sortDir === 'asc' })
    .order('created_at', { ascending: false });

  if (typeFilters && typeFilters.length > 0) {
    query = query.in('transaction_type', typeFilters);
  }
  if (dateFrom) query = query.gte('transaction_date', dateFrom);
  // transaction_date is timestamptz — bump a date-only "to" bound to
  // end-of-day so same-day afternoon rows aren't excluded.
  if (dateTo) query = query.lte('transaction_date', dateTo.length <= 10 ? `${dateTo}T23:59:59.999` : dateTo);

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
      return { rows: [], hasMore: false, totalCount: 0 };
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

  if (statuses && statuses.length > 0) {
    const { purchaseDetailIds, salesDetailIds, productionMaterialUsageIds } = await resolveStatusFilterIds(statuses);
    if (purchaseDetailIds.length === 0 && salesDetailIds.length === 0 && productionMaterialUsageIds.length === 0) {
      return { rows: [], hasMore: false, totalCount: 0 };
    }
    const orParts: string[] = [];
    if (purchaseDetailIds.length > 0) orParts.push(`purchase_detail_id.in.(${purchaseDetailIds.join(',')})`);
    if (salesDetailIds.length > 0) orParts.push(`sales_detail_id.in.(${salesDetailIds.join(',')})`);
    if (productionMaterialUsageIds.length > 0) orParts.push(`production_material_usage_id.in.(${productionMaterialUsageIds.join(',')})`);
    query = query.or(orParts.join(','));
  }

  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) {
    console.error('getInventoryTransactions', error);
    return { rows: [], hasMore: false, totalCount: 0 };
  }

  const rows = (data || []).map(mapTransactionRow);
  const totalCount = count ?? rows.length;
  const hasMore = offset + rows.length < totalCount;
  return { rows, hasMore, totalCount };
};

export const saveInventoryTransaction = (tx: InventoryTransaction): Promise<void> =>
  upsertRecord('erp_inventory_transaction', tx);

// Manual Stock Adjustment drawer, DECREASE direction only — an INCREASE can never drive stock
// negative, so it stays on saveInventoryTransaction. apply_manual_stock_decrease()
// (function_trigger.sql) checks current stock and writes the ledger row atomically (row-locked), so
// a decrease can never take material/product quantity below zero, even under concurrent adjustments
// on the same item. Throws (RAISE EXCEPTION in Postgres) rather than clamping — a single deliberate
// form field, not a multi-line operation, so refusing outright is clearer than silently applying less.
export const applyManualStockDecrease = async (input: {
  materialId?: string;
  productId?: string;
  quantity: number;
  unitCost?: number;
  remark?: string;
  transactionDate: string;
}): Promise<void> => {
  const { error } = await supabase.rpc('apply_manual_stock_decrease', {
    p_material_id: input.materialId || null,
    p_product_id: input.productId || null,
    p_qty: input.quantity,
    p_unit_cost: input.unitCost ?? null,
    p_remark: input.remark ?? null,
    p_transaction_date: input.transactionDate,
  });
  if (error) {
    console.error('applyManualStockDecrease', error);
    throw error;
  }
};

const mapMovementRow = (row: any): InventoryListItem => {
  const purchaseHeader = row.purchase_detail?.purchase_header;
  const usageSalesDetail = row.production_material_usage?.sales_detail;
  const salesHeader = usageSalesDetail?.sales_header || row.sales_detail?.sales_header;
  const task = usageSalesDetail?.workflow_tasks?.[0];
  const quantity = Number(row.quantity) || 0;
  const unitCost = row.unit_cost != null ? Number(row.unit_cost) : undefined;

  return {
    id: row.id,
    transactionType: row.transaction_type,
    refNo: purchaseHeader?.purchase_no || salesHeader?.sales_no,
    counterpartyName: purchaseHeader?.vendors?.company_name || salesHeader?.clients?.company_name,
    orderDate: row.transaction_date,
    quantity,
    unitCost,
    totalPrice: unitCost != null ? Math.abs(quantity) * unitCost : undefined,
    status: purchaseHeader?.status || salesHeader?.status,
    purchaseHeaderId: purchaseHeader?.id,
    salesHeaderId: salesHeader?.id,
    employeeId: task?.employee_id || undefined,
    employeeName: task?.employees?.full_name || undefined,
    productionMaterialUsageId: row.production_material_usage?.id || undefined,
  };
};

// Read-only side of the ledger for MaterialView's/ProductView's "Inventory
// List": movements against one material/product, joined out to
// whichever order header generated them (purchase_detail -> purchase_header
// for PURCHASE/PURCHASE_RETURN; production_material_usage -> sales_detail ->
// sales_header for material rows consumed/returned against production; and
// sales_detail -> sales_header directly for product rows — SALES/SALES_RETURN/
// PRODUCTION against a finished good). ADJUSTMENT rows with no
// production_material_usage or sales_detail link (standalone stock corrections)
// have no order header to join, so refNo/counterpartyName/status/*HeaderId stay
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
      production_material_usage(id, sales_detail(sales_header(id, sales_no, status, clients(company_name)), workflow_tasks(employee_id, employees(full_name)))),
      sales_detail(sales_header(id, sales_no, status, clients(company_name)))
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

export interface InventoryStatsSummary {
  totalIn: number;
  totalOut: number;
  transactionCount: number;
  monthlyInOut: { month: string; stockIn: number; stockOut: number }[];
  topConsumed: { materialId: string; materialName: string; quantity: number }[];
}

/**
 * Statistics dialog data — aggregated client-side over the last 6 months of
 * transactions (no dedicated analytics RPC exists yet). Bounded by date range
 * rather than a full-table fetch, so this stays cheap for a single-site shop.
 * "Top Consumed" stays materials-only on purpose: products now DO have ledger rows for ordinary
 * sales (markDelivered writes SALES −qty), but mixing finished goods into a "top consumed
 * materials" list would compare two different things. A separate top-selling-products stat is a
 * different feature.
 */
export const getInventoryStatsSummary = async (months = 6): Promise<InventoryStatsSummary> => {
  const since = new Date();
  since.setMonth(since.getMonth() - (months - 1));
  since.setDate(1);
  const sinceStr = since.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('inventory_transaction')
    .select('transaction_type, quantity, transaction_date, material_id, material(name)')
    .gte('transaction_date', sinceStr);

  if (error) {
    console.error('getInventoryStatsSummary', error);
    return { totalIn: 0, totalOut: 0, transactionCount: 0, monthlyInOut: [], topConsumed: [] };
  }

  const monthBuckets = new Map<string, { stockIn: number; stockOut: number }>();
  const consumedByMaterial = new Map<string, { materialName: string; quantity: number }>();
  let totalIn = 0;
  let totalOut = 0;

  for (const row of data || []) {
    const qty = Number(row.quantity) || 0;
    const monthKey = (row.transaction_date || '').slice(0, 7); // yyyy-mm
    const bucket = monthBuckets.get(monthKey) || { stockIn: 0, stockOut: 0 };
    if (qty >= 0) { bucket.stockIn += qty; totalIn += qty; }
    else { bucket.stockOut += Math.abs(qty); totalOut += Math.abs(qty); }
    monthBuckets.set(monthKey, bucket);

    if (qty < 0 && row.material_id) {
      const entry = consumedByMaterial.get(row.material_id) || { materialName: (row as any).material?.name || 'Unknown', quantity: 0 };
      entry.quantity += Math.abs(qty);
      consumedByMaterial.set(row.material_id, entry);
    }
  }

  const monthlyInOut = Array.from(monthBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v }));

  const topConsumed = Array.from(consumedByMaterial.entries())
    .map(([materialId, v]) => ({ materialId, ...v }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 8);

  return { totalIn, totalOut, transactionCount: (data || []).length, monthlyInOut, topConsumed };
};
