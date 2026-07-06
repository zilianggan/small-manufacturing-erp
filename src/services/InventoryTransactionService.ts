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
import { InventoryTransaction } from "../types";
import { getMaterials } from "./MaterialService";
import { getProducts } from "./ProductService";

export const generateId = (): string => crypto.randomUUID();

const mapTransactionRow = (row: any): InventoryTransaction => ({
  id: row.id,
  transactionType: row.transaction_type,
  quantity: Number(row.quantity) || 0,
  unitCost: row.unit_cost != null ? Number(row.unit_cost) : undefined,
  remark: row.remark || undefined,
  materialId: row.material_id || undefined,
  materialName: row.material?.name,
  productId: row.product_id || undefined,
  productName: row.product?.name,
  transactionDate: row.transaction_date,
  createdAt: row.created_at,
});

export const getInventoryTransactions = async (params: {
  search?: string;
  typeFilter?: string; // 'ALL' or one of InventoryTransactionType
  offset: number;
  limit: number;
}): Promise<{ rows: InventoryTransaction[]; hasMore: boolean }> => {
  const { search = '', typeFilter = 'ALL', offset, limit } = params;

  let query = supabase
    .from('inventory_transaction')
    .select('*, material(name), product(name)', { count: 'exact' })
    .order('transaction_date', { ascending: false });

  if (typeFilter !== 'ALL') {
    query = query.eq('transaction_type', typeFilter);
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
    const materialIds = matchedMaterials.map(m => m.id);
    const productIds = matchedProducts.map(p => p.id);

    if (materialIds.length === 0 && productIds.length === 0) {
      return { rows: [], hasMore: false };
    }

    const orParts: string[] = [];
    if (materialIds.length > 0) orParts.push(`material_id.in.(${materialIds.join(',')})`);
    if (productIds.length > 0) orParts.push(`product_id.in.(${productIds.join(',')})`);
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
