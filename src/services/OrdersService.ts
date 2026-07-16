/**
 * Orders module service layer (sales_header/sales_detail/production_material_usage).
 *
 * Pattern A: talks to Supabase directly, mirroring PurchasesService.ts /
 * MaterialService.ts. No db.ts, no server.ts REST hop, no useTableData. The
 * legacy sales_orders table and SalesOrder type are untouched —
 * DashboardView/ReportsView/ImportExportModal still read them directly and
 * are out of scope for this rewrite.
 */
import { supabase } from "./supabase";
import { getClients } from "./ContactsService";
import { saveInventoryTransaction } from "./InventoryTransactionService";
import { generateId } from "../helper";
import { Attachment, SalesHeader, SalesDetail, ProductionMaterialUsage, Product, SalesPriority } from "../types";
import { nowIso } from "../utils/date";

// Filter date-range "to" bounds arrive as date-only strings, but order_date
// and delivery_date are timestamptz now — a bare `<= 2026-07-11` excludes
// same-day afternoon rows, so bump a date-only bound to end-of-day.
const endOfDay = (value: string): string => (value.length <= 10 ? `${value}T23:59:59.999` : value);

export interface MaterialUsageInput {
  materialId: string;
  materialName: string;
  materialCode?: string;
  plannedQuantity: number;
}

export interface SalesDetailInput {
  productId: string;
  productName: string;
  productCode?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  product?: Product;
  materials: MaterialUsageInput[];
}

export interface SalesFormInput {
  clientId: string;
  remark?: string;
  attachments?: Attachment[];
  details: SalesDetailInput[];
  productionDueDate?: string;
  priority?: SalesPriority;
}

const mapMaterialUsageRow = (row: any): ProductionMaterialUsage => ({
  id: row.id,
  salesDetailId: row.sales_detail_id,
  materialId: row.material_id,
  materialName: row.material?.name || '',
  materialCode: row.material?.code || undefined,
  materialType: row.material?.material_type || undefined,
  // The material master owns the mode — production_material_usage has no consumption_mode column.
  consumptionMode: row.material?.consumption_mode || undefined,
  plannedQuantity: Number(row.planned_quantity) || 0,
  actualQuantity: Number(row.actual_quantity) || 0,
  returnedQuantity: Number(row.returned_quantity) || 0,
});

const mapSalesDetailRow = (row: any): SalesDetail => ({
  detailId: row.detail_id,
  headerId: row.header_id,
  productId: row.product_id,
  productName: row.product_name,
  productCode: row.product_code || undefined,
  quantity: Number(row.quantity) || 0,
  deliveredQuantity: Number(row.delivered_quantity) || 0,
  returnedQuantity: Number(row.returned_quantity) || 0,
  produceQuantity: Number(row.produce_quantity) || 0,
  producedQuantity: Number(row.produced_quantity) || 0,
  unitPrice: Number(row.unit_price) || 0,
  totalPrice: Number(row.total_price) || 0,
  remark: row.remark || undefined,
  product: row.product,
  materials: (row.production_material_usage || []).map(mapMaterialUsageRow),
});

const mapSalesHeaderRow = (row: any): SalesHeader => ({
  id: row.id,
  salesNo: row.sales_no,
  orderDate: row.order_date,
  deliveryDate: row.delivery_date || undefined,
  productionDueDate: row.production_due_date || undefined,
  priority: row.priority || 'MEDIUM',
  status: row.status,
  clientId: row.client_id,
  clientName: row.clients?.company_name || '',
  totalAmount: Number(row.total_amount) || 0,
  remark: row.remark || undefined,
  attachments: row.attachments || [],
  details: (row.sales_detail || []).map(mapSalesDetailRow),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export type SalesSortField = 'reference' | 'client' | 'date' | 'totalAmount' | 'productionDue' | 'status';
export type SortDir = 'asc' | 'desc';

export interface SalesFilters {
  clientIds?: string[];
  productIds?: string[];
  statuses?: SalesHeader['status'][];
  // Applied against order_date (QUOTATION tab) or delivery_date (SO tab) —
  // whichever column the list's own "Date" column shows for that tab.
  dateFrom?: string;
  dateTo?: string;
}

export const getSalesOrders = async (
  tab: 'QUOTATION' | 'SO',
  search = '',
  options: { filters?: SalesFilters; sortField?: SalesSortField; sortDir?: SortDir } = {}
): Promise<SalesHeader[]> => {
  const { filters = {}, sortField = 'date', sortDir = 'desc' } = options;
  const dateColumn = tab === 'QUOTATION' ? 'order_date' : 'delivery_date';
  // A parent row must only come back when it has a matching detail line, so
  // the product filter uses the !inner embed modifier (PostgREST's "parent
  // requires matching child" pattern) instead of the plain left-join embed.
  const useProductFilter = !!(filters.productIds && filters.productIds.length > 0);

  let query = supabase
    .from('sales_header')
    .select(useProductFilter
      ? '*, clients(company_name), sales_detail!inner(*, product(name, code, dimension), production_material_usage(*, material(name, code, material_type, consumption_mode)))'
      : '*, clients(company_name), sales_detail(*, product(name, code, dimension), production_material_usage(*, material(name, code, material_type, consumption_mode)))');

  query = tab === 'QUOTATION'
    ? query.eq('status', 'QUOTATION')
    : query.in('status', ['ORDERED', 'IN_PRODUCTION', 'DONE_IN_PRODUCTION', 'PARTIALLY_DELIVERED', 'DELIVERED', 'PARTIALLY_RETURNED', 'RETURNED', 'CANCELLED']);

  const q = search.trim();
  if (q) {
    // sales_header has no denormalized client name column, so client-name
    // search resolves matching client ids first (mirrors
    // PurchasesService's search-by-joined-name pattern).
    const matchedClients = await getClients(q);
    const clientIds = matchedClients.map(c => c.id);
    const orParts = [`sales_no.ilike.%${q}%`];
    if (clientIds.length > 0) orParts.push(`client_id.in.(${clientIds.join(',')})`);
    query = query.or(orParts.join(','));
  }

  if (filters.clientIds && filters.clientIds.length > 0) {
    query = query.in('client_id', filters.clientIds);
  }
  if (useProductFilter) {
    query = query.in('sales_detail.product_id', filters.productIds!);
  }
  if (filters.statuses && filters.statuses.length > 0) {
    query = query.in('status', filters.statuses);
  }
  if (filters.dateFrom) query = query.gte(dateColumn, filters.dateFrom);
  if (filters.dateTo) query = query.lte(dateColumn, endOfDay(filters.dateTo));

  switch (sortField) {
    case 'reference':
      query = query.order('sales_no', { ascending: sortDir === 'asc' });
      break;
    case 'client':
      query = query.order('company_name', { ascending: sortDir === 'asc', foreignTable: 'clients' });
      break;
    case 'status':
      query = query.order('status', { ascending: sortDir === 'asc' });
      break;
    case 'totalAmount':
      query = query.order('total_amount', { ascending: sortDir === 'asc' });
      break;
    case 'productionDue':
      query = query.order('production_due_date', { ascending: sortDir === 'asc', nullsFirst: false });
      break;
    case 'date':
    default:
      query = query.order(dateColumn, { ascending: sortDir === 'asc' });
      break;
  }
  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) {
    console.error('getSalesOrders', error);
    return [];
  }
  return (data || []).map(mapSalesHeaderRow);
};

// Fetches a single sales order regardless of its status/tab or the list's
// current search filter — used by SalesOrderDetailView.tsx's cross-tab
// drill-in from ProductView.tsx's order history link.
export const getSalesOrderById = async (id: string): Promise<SalesHeader | null> => {
  const { data, error } = await supabase
    .from('sales_header')
    .select('*, clients(company_name), sales_detail(*, product(name, code, dimension), production_material_usage(*, material(name, code, material_type, consumption_mode)))')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('getSalesOrderById', error);
    return null;
  }
  return data ? mapSalesHeaderRow(data) : null;
};

const insertDetailsWithMaterials = async (headerId: string, details: SalesDetailInput[]): Promise<void> => {
  for (const detail of details) {
    const { data: insertedDetail, error: detailError } = await supabase
      .from('sales_detail')
      .insert({
        header_id: headerId,
        product_id: detail.productId,
        product_name: detail.productName,
        product_code: detail.productCode || null,
        quantity: detail.quantity,
        unit_price: detail.unitPrice,
        total_price: detail.totalPrice,
      })
      .select('detail_id')
      .single();
    if (detailError) {
      console.error('insertDetailsWithMaterials(detail)', detailError);
      throw detailError;
    }

    if (detail.materials.length > 0) {
      const { error: materialError } = await supabase.from('production_material_usage').insert(
        detail.materials.map(m => ({
          sales_detail_id: insertedDetail.detail_id,
          material_id: m.materialId,
          planned_quantity: m.plannedQuantity,
        }))
      );
      if (materialError) {
        console.error('insertDetailsWithMaterials(material)', materialError);
        throw materialError;
      }
    }
  }
};

const replaceDetails = async (headerId: string, details: SalesDetailInput[]): Promise<void> => {
  // production_material_usage cascades via ON DELETE CASCADE on sales_detail.
  const { error: deleteError } = await supabase.from('sales_detail').delete().eq('header_id', headerId);
  if (deleteError) {
    console.error('replaceDetails(delete)', deleteError);
    throw deleteError;
  }

  await insertDetailsWithMaterials(headerId, details);
};

export const createSalesQuotation = async (input: SalesFormInput): Promise<void> => {
  const id = generateId();
  const totalAmount = input.details.reduce((sum, d) => sum + d.totalPrice, 0);

  const { data: salesNo, error: numberError } = await supabase.rpc('next_document_number', { p_kind: 'SO' });
  if (numberError) {
    console.error('createSalesQuotation(number)', numberError);
    throw numberError;
  }

  const { error: headerError } = await supabase.from('sales_header').insert({
    id,
    sales_no: salesNo,
    order_date: nowIso(),
    status: 'QUOTATION',
    client_id: input.clientId,
    total_amount: totalAmount,
    remark: input.remark || null,
    attachments: input.attachments || [],
    production_due_date: input.productionDueDate || null,
    priority: input.priority || 'MEDIUM',
  });
  if (headerError) {
    console.error('createSalesQuotation(header)', headerError);
    throw headerError;
  }

  await insertDetailsWithMaterials(id, input.details);
};

export const updateSalesOrder = async (headerId: string, input: SalesFormInput): Promise<void> => {
  const totalAmount = input.details.reduce((sum, d) => sum + d.totalPrice, 0);

  const { error } = await supabase
    .from('sales_header')
    .update({
      client_id: input.clientId,
      total_amount: totalAmount,
      remark: input.remark || null,
      attachments: input.attachments || [],
      production_due_date: input.productionDueDate || null,
      priority: input.priority || 'MEDIUM',
    })
    .eq('id', headerId);
  if (error) {
    console.error('updateSalesOrder(header)', error);
    throw error;
  }

  await replaceDetails(headerId, input.details);
};

export const convertToSalesOrder = async (headerId: string, input: SalesFormInput, deliveryDate: string): Promise<void> => {
  const totalAmount = input.details.reduce((sum, d) => sum + d.totalPrice, 0);

  const { error } = await supabase
    .from('sales_header')
    .update({
      client_id: input.clientId,
      total_amount: totalAmount,
      remark: input.remark || null,
      attachments: input.attachments || [],
      production_due_date: input.productionDueDate || null,
      priority: input.priority || 'MEDIUM',
      delivery_date: deliveryDate,
      status: 'ORDERED',
    })
    .eq('id', headerId);
  if (error) {
    console.error('convertToSalesOrder(header)', error);
    throw error;
  }

  await replaceDetails(headerId, input.details);
};

export interface MaterialShortfall {
  materialId: string;
  materialName: string;
  required: number;
  available: number;
}

// How much of each product this production run will actually make. Defaults to
// `ordered − finished goods already in stock` (see suggestedProduceQuantity) but the user edits it,
// so every material figure below is derived from it rather than from the ordered quantity.
export interface ProduceLine {
  detailId: string;
  quantity: number;
}

// What Start Production will suggest for a line: only make what stock doesn't already cover.
export const suggestedProduceQuantity = (ordered: number, inStock: number): number =>
  Math.max(0, ordered - inStock);

// The two lifecycle gates, shared by OrdersView's row menu and SalesOrderDetailView's button bar —
// they used to be two copies of the same status lists and had already drifted apart.
//
// Production needs a bill of materials to run against: with no production materials on any line there
// is nothing to scale, nothing to deduct and nothing to check stock for, so the run would be a bare
// status flip into IN_PRODUCTION that nothing can complete meaningfully. Set the materials first.
export const canStartProduction = (header: SalesHeader): boolean =>
  ['ORDERED', 'PARTIALLY_DELIVERED'].includes(header.status)
  && header.details.some(d => d.materials.length > 0);

// How a line gets its first material row when it was missed at order-entry time. ORDERED is excluded
// on purpose — that status is still Edit-able, and the Edit dialog's own material table already covers
// adding a row, so this button would just be a second path to the same thing. Not routed through
// updateSalesOrder()/replaceDetails(): that deletes and reinserts every sales_detail row, which would
// wipe deliveredQuantity/producedQuantity progress and orphan the ledger's sales_detail_id on any line
// that already shipped. This only ever inserts new production_material_usage rows.
export const canAddMaterial = (header: SalesHeader): boolean =>
  header.status === 'PARTIALLY_DELIVERED';

export interface NewMaterialUsage {
  detailId: string;
  materialId: string;
  plannedQuantity: number;
}

export const addMaterialUsage = async (rows: NewMaterialUsage[]): Promise<void> => {
  const payload = rows.filter(r => r.plannedQuantity > 0);
  if (payload.length === 0) return;

  const { error } = await supabase.from('production_material_usage').insert(
    payload.map(r => ({ sales_detail_id: r.detailId, material_id: r.materialId, planned_quantity: r.plannedQuantity }))
  );
  if (error) {
    console.error('addMaterialUsage', error);
    throw error;
  }
};

// Delivery is allowed straight from ORDERED — production is optional when finished goods already
// cover the order. markDelivered still refuses to ship more than the shelf holds.
export const canDeliver = (header: SalesHeader): boolean =>
  ['ORDERED', 'DONE_IN_PRODUCTION', 'PARTIALLY_DELIVERED'].includes(header.status);

// A Sales Order is a business document from the moment it's ORDERED — audit trail requires it stay
// on record forever, so Delete is QUOTATION-only. Cancel is the only exit past that point.
export const canDeleteSalesOrder = (header: SalesHeader): boolean =>
  header.status === 'QUOTATION';

// The BOM on a usage row is sized for the ORDERED quantity. Producing fewer units consumes
// proportionally less material, so every reservation scales by produceQty/orderedQty. Rounded to 2dp
// because the quantity columns are NUMERIC and a raw float would otherwise reconcile to noise.
const scaledPlan = (plannedForOrdered: number, produceQty: number, orderedQty: number): number => {
  if (orderedQty <= 0 || produceQty <= 0) return 0;
  return Math.round(plannedForOrdered * (produceQty / orderedQty) * 100) / 100;
};

// Rolls the order's BOM up to a per-material total, scaled to what's actually being produced.
const requiredMaterials = (header: SalesHeader, produce: ProduceLine[]): Map<string, number> => {
  const produceByDetailId = new Map(produce.map(p => [p.detailId, p.quantity]));
  const required = new Map<string, number>();
  for (const detail of header.details) {
    const produceQty = produceByDetailId.get(detail.detailId) ?? 0;
    for (const m of detail.materials) {
      const qty = scaledPlan(m.plannedQuantity, produceQty, detail.quantity);
      if (qty <= 0) continue;
      required.set(m.materialId, (required.get(m.materialId) || 0) + qty);
    }
  }
  return required;
};

// Hard gate for Start Production: the scaled BOM against live stock. startProduction's
// -plannedQuantity inventory_transaction has no DB constraint stopping material.quantity from going
// negative, so this is the only thing standing between a start and an oversold material.
//
// This is deliberately strict, unlike getOutstandingDemand below which only warns: accepting a
// future order you can't fill yet is a business decision, but starting a production run you don't
// have the metal for is just a wrong number in the ledger.
export const checkProductionStock = async (header: SalesHeader, produce: ProduceLine[]): Promise<MaterialShortfall[]> => {
  const required = requiredMaterials(header, produce);
  const materialIds = Array.from(required.keys());
  if (materialIds.length === 0) return [];

  const { data, error } = await supabase.from('material').select('id, name, quantity').in('id', materialIds);
  if (error) {
    console.error('checkProductionStock', error);
    throw error;
  }

  const shortfalls: MaterialShortfall[] = [];
  required.forEach((requiredQty, materialId) => {
    const row = (data || []).find((m: any) => m.id === materialId);
    const available = Number(row?.quantity) || 0;
    if (available < requiredQty) {
      shortfalls.push({ materialId, materialName: row?.name || materialId, required: requiredQty, available });
    }
  });
  return shortfalls;
};

// Commits the run: one Postgres transaction via apply_production_start (function_trigger.sql) — persists
// the produce quantity per line, rewrites each usage row's planned_quantity to the SCALED reservation
// (the snapshot confirmProductionDone reconciles actual usage against later), deducts that material
// (row-locked, throws on insufficient stock — closes the negative-stock race the old unlocked JS loop
// left open), and opens the Kanban tasks. All-or-nothing: a partial failure can no longer leave some
// materials deducted and others not, and a retry starts from a clean ORDERED/PARTIALLY_DELIVERED state
// instead of double-deducting whatever succeeded last time.
export const startProduction = async (header: SalesHeader, produce: ProduceLine[]): Promise<void> => {
  // Producing nothing is not a production run: it would open workflow_tasks, flip the header to
  // IN_PRODUCTION and reserve zero material — an order stuck in a stage with no work in it. If stock
  // already covers everything, the answer is Deliver, not a zero-quantity run. (The RPC enforces this
  // too — this is just a faster round trip for the common case.)
  if (produce.every(p => p.quantity <= 0)) {
    throw new Error('Enter a produce quantity for at least one product — a run with nothing to make is not allowed.');
  }

  const { error } = await supabase.rpc('apply_production_start', {
    p_header_id: header.id,
    p_produce: produce.map(p => ({ detail_id: p.detailId, quantity: p.quantity })),
  });
  if (error) {
    console.error('startProduction', error);
    throw error;
  }
};

// Finished-goods stock for a set of products, keyed by id. sales_detail carries no stock column
// (stock lives on the trigger-maintained catalog table), so Start Production has to look it up to
// work out what actually still needs making.
export const getProductStock = async (productIds: string[]): Promise<Record<string, number>> => {
  const ids = Array.from(new Set(productIds)).filter(Boolean);
  if (ids.length === 0) return {};

  const { data, error } = await supabase.from('product').select('id, quantity').in('id', ids);
  if (error) {
    console.error('getProductStock', error);
    return {};
  }
  return Object.fromEntries((data || []).map((p: any) => [p.id, Number(p.quantity) || 0]));
};

export interface DemandRow {
  id: string;
  name: string;
  inStock: number;
  outstanding: number; // available to promise = inStock − outstanding
}

// Planning visibility only — this never reserves anything and never blocks a save. Inventory always
// means physical stock; outstanding demand is a number we show next to it so the user can see that
// accepting another order implies more production or more purchasing.
//
// The two halves count different populations on purpose:
//   products  — every open order, because finished goods aren't consumed until they ship.
//   materials — ORDERED orders only. Once an order is IN_PRODUCTION its material has ALREADY been
//               deducted from material.quantity by startProduction, so counting it as "still
//               required" would double-count the very shortage it caused.
//
// excludeHeaderId drops the order currently being edited, so its own lines don't show up as demand
// competing with itself.
export const getOutstandingDemand = async (
  excludeHeaderId?: string,
): Promise<{ products: DemandRow[]; materials: DemandRow[] }> => {
  const { data, error } = await supabase
    .from('sales_header')
    .select(`
      id, status,
      sales_detail(detail_id, product_id, quantity, delivered_quantity,
        product(name),
        production_material_usage(material_id, planned_quantity, material(name)))
    `)
    .in('status', ['ORDERED', 'IN_PRODUCTION', 'DONE_IN_PRODUCTION', 'PARTIALLY_DELIVERED']);
  if (error) {
    console.error('getOutstandingDemand', error);
    return { products: [], materials: [] };
  }

  const products = new Map<string, DemandRow>();
  const materials = new Map<string, DemandRow>();

  for (const header of (data || []) as any[]) {
    if (header.id === excludeHeaderId) continue;

    for (const detail of header.sales_detail || []) {
      const undelivered = (Number(detail.quantity) || 0) - (Number(detail.delivered_quantity) || 0);
      if (detail.product_id && undelivered > 0) {
        const row = products.get(detail.product_id)
          || { id: detail.product_id, name: detail.product?.name || '', inStock: 0, outstanding: 0 };
        row.outstanding += undelivered;
        products.set(detail.product_id, row);
      }

      if (header.status !== 'ORDERED') continue;
      for (const usage of detail.production_material_usage || []) {
        const planned = Number(usage.planned_quantity) || 0;
        if (!usage.material_id || planned <= 0) continue;
        const row = materials.get(usage.material_id)
          || { id: usage.material_id, name: usage.material?.name || '', inStock: 0, outstanding: 0 };
        row.outstanding += planned;
        materials.set(usage.material_id, row);
      }
    }
  }

  // Stock is trigger-maintained on the catalog tables, so it has to be read from there — the ledger
  // above only knows what was ordered, not what's on the shelf.
  const [productStock, materialStock] = await Promise.all([
    products.size
      ? supabase.from('product').select('id, quantity').in('id', Array.from(products.keys()))
      : Promise.resolve({ data: [] as any[], error: null }),
    materials.size
      ? supabase.from('material').select('id, quantity').in('id', Array.from(materials.keys()))
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);

  for (const row of (productStock.data || [])) {
    const p = products.get(row.id);
    if (p) p.inStock = Number(row.quantity) || 0;
  }
  for (const row of (materialStock.data || [])) {
    const m = materials.get(row.id);
    if (m) m.inStock = Number(row.quantity) || 0;
  }

  const byName = (a: DemandRow, b: DemandRow) => a.name.localeCompare(b.name);
  return {
    products: Array.from(products.values()).sort(byName),
    materials: Array.from(materials.values()).sort(byName),
  };
};

export interface MaterialReconciliationInput {
  usageId: string; // production_material_usage.id
  actualQuantity: number;
}

export interface LeftoverMaterialInput {
  salesDetailId: string;
  materialId: string;
  quantity: number;
}

// What actually came off the floor, per line. An actual above the planned produce qty IS extra
// production, so there is one number here, not two.
export interface ProducedLine {
  detailId: string;
  quantity: number;
}

// Pre-flight for Confirm Production Done, mirroring checkProductionStock (Start Production's stock
// gate). Front-runs the same guard apply_material_consumption enforces server-side: a reconciliation
// that uses MORE than the Start Production reservation draws the diff from live stock, and AUTOMATIC
// consumables (fixed earlier by addOrderConsumable, never reserved) draw their full actual_quantity.
// Everything else — actual <= planned, leftovers, MANUAL consumables — never touches live stock and
// is excluded.
export const checkProductionCompletionStock = async (
  header: SalesHeader,
  reconciliations: MaterialReconciliationInput[],
): Promise<MaterialShortfall[]> => {
  const usageById = new Map<string, ProductionMaterialUsage>(
    header.details.flatMap(d => d.materials.map(m => [m.id, m] as const))
  );
  const required = new Map<string, number>();

  for (const r of reconciliations) {
    const usage = usageById.get(r.usageId);
    if (!usage) continue;
    const extra = r.actualQuantity - usage.plannedQuantity;
    if (extra > 0) required.set(usage.materialId, (required.get(usage.materialId) || 0) + extra);
  }

  for (const usage of usageById.values()) {
    if (usage.materialType === 'CONSUMABLE_MATERIAL' && usage.consumptionMode === 'AUTOMATIC' && usage.actualQuantity > 0) {
      required.set(usage.materialId, (required.get(usage.materialId) || 0) + usage.actualQuantity);
    }
  }

  const materialIds = Array.from(required.keys());
  if (materialIds.length === 0) return [];

  const { data, error } = await supabase.from('material').select('id, name, quantity').in('id', materialIds);
  if (error) {
    console.error('checkProductionCompletionStock', error);
    throw error;
  }

  const shortfalls: MaterialShortfall[] = [];
  required.forEach((requiredQty, materialId) => {
    const row = (data || []).find((m: any) => m.id === materialId);
    const available = Number(row?.quantity) || 0;
    if (available < requiredQty) {
      shortfalls.push({ materialId, materialName: row?.name || materialId, required: requiredQty, available });
    }
  });
  return shortfalls;
};

// The whole "Mark Production Done" action in one transaction via apply_production_completion
// (function_trigger.sql): reconciles actual material usage against the startProduction reservation,
// burns AUTOMATIC consumables, credits leftover/by-product material, credits the finished goods
// actually produced, closes workflow_tasks, and advances the header to DONE_IN_PRODUCTION — all
// server-side. planned_quantity and material_id/product_id are read off the locked rows inside the
// function, not trusted from this call.
export const confirmProductionDone = async (
  header: SalesHeader,
  reconciliations: MaterialReconciliationInput[],
  leftovers: LeftoverMaterialInput[],
  produced: ProducedLine[],
): Promise<void> => {
  const { error } = await supabase.rpc('apply_production_completion', {
    p_header_id: header.id,
    p_reconciliations: reconciliations.map(r => ({ usage_id: r.usageId, actual_quantity: r.actualQuantity })),
    p_leftovers: leftovers.map(l => ({ sales_detail_id: l.salesDetailId, material_id: l.materialId, quantity: l.quantity })),
    p_produced: produced.map(p => ({ detail_id: p.detailId, quantity: p.quantity })),
  });
  if (error) {
    console.error('confirmProductionDone', error);
    throw error;
  }
};

export interface DeliveryLine {
  detailId: string;
  quantity: number; // > 0; clamped server-side to min(quantity − deliveredQuantity, product stock)
}

// Shipping is what takes finished goods out of stock — one atomic transaction per submit via
// apply_sales_delivery_batch (function_trigger.sql). Clamps rather than throws (decision #1's
// exception): a request that outruns what's left is a benign race (another delivery, or stock
// genuinely short), not a mistake, so it silently ships what it can rather than blocking the rest
// of the batch.
export const markDelivered = async (
  header: SalesHeader,
  lines: DeliveryLine[],
  remark?: string,
): Promise<void> => {
  const payload = lines.filter(l => l.quantity > 0).map(l => ({ detail_id: l.detailId, quantity: l.quantity }));
  if (payload.length === 0) return;

  const { error } = await supabase.rpc('apply_sales_delivery_batch', {
    p_header_id: header.id,
    p_lines: payload,
    p_remark: remark ?? null,
  });
  if (error) {
    console.error('markDelivered', error);
    throw error;
  }
};

// If the order already reserved material stock (Start Production ran), a cancel from
// IN_PRODUCTION must return that stock and close the order's workflow_tasks rows — symmetric
// with what startProduction reserved/opened. The returned material is typed ADJUSTMENT, not
// SALES_RETURN: un-reserving is an internal correction (exactly what the "used less than
// planned" reconciliation already emits), whereas SALES_RETURN now means one thing only — the
// client sent finished goods back.
// Cancelling from ORDERED (before any reservation) or from DONE_IN_PRODUCTION (goods already
// made — they stay in stock to sell to someone else) is a plain status flip.
export const cancelSalesOrder = async (header: SalesHeader): Promise<void> => {
  const today = new Date().toISOString().split('T')[0];

  if (header.status === 'IN_PRODUCTION') {
    for (const detail of header.details) {
      for (const material of detail.materials) {
        await saveInventoryTransaction({
          id: generateId(),
          transactionType: 'ADJUSTMENT',
          quantity: material.plannedQuantity,
          materialId: material.materialId,
          productionMaterialUsageId: material.id,
          transactionDate: nowIso(),
        });
      }
    }

    const { error: taskError } = await supabase
      .from('workflow_tasks')
      .update({ status: 'CANCELLED', end_date: today })
      .in('sales_detail_id', header.details.map(d => d.detailId));
    if (taskError) {
      console.error('cancelSalesOrder(workflow_tasks)', taskError);
      throw taskError;
    }
  }

  const { error } = await supabase.from('sales_header').update({ status: 'CANCELLED' }).eq('id', header.id);
  if (error) {
    console.error('cancelSalesOrder', error);
    throw error;
  }
};

export const deleteSalesOrder = async (headerId: string): Promise<void> => {
  const { error } = await supabase.from('sales_header').delete().eq('id', headerId);
  if (error) {
    console.error('deleteSalesOrder', error);
    throw error;
  }
};

export interface SalesOrderLinkOption {
  id: string;
  salesNo: string;
  clientName: string;
}

export interface SalesOrderMaterialRequirement {
  materialId: string;
  materialName: string;
  materialCode?: string;
  requiredQuantity: number;
}

// Aggregates planned material usage across every product line of a sales
// header — used by PurchasesView.tsx's "Linked Sales Order" picker so the
// buyer can see how much material the linked contract actually needs.
export const getSalesOrderMaterialRequirements = async (salesHeaderId: string): Promise<SalesOrderMaterialRequirement[]> => {
  const { data, error } = await supabase
    .from('sales_detail')
    .select('production_material_usage(material_id, planned_quantity, material(name, code))')
    .eq('header_id', salesHeaderId);
  if (error) {
    console.error('getSalesOrderMaterialRequirements', error);
    return [];
  }

  const totals = new Map<string, SalesOrderMaterialRequirement>();
  for (const row of (data || []) as any[]) {
    for (const usage of row.production_material_usage || []) {
      const existing = totals.get(usage.material_id);
      if (existing) {
        existing.requiredQuantity += Number(usage.planned_quantity) || 0;
      } else {
        totals.set(usage.material_id, {
          materialId: usage.material_id,
          materialName: usage.material?.name || '',
          materialCode: usage.material?.code || undefined,
          requiredQuantity: Number(usage.planned_quantity) || 0,
        });
      }
    }
  }
  return Array.from(totals.values());
};

// Lightweight list for PurchasesView.tsx's "Linked Sales Order" picker —
// doesn't need line items, just enough to label a ComboBox option.
export const getSalesOrdersForLinking = async (search = ''): Promise<SalesOrderLinkOption[]> => {
  let query = supabase
    .from('sales_header')
    .select('id, sales_no, clients(company_name)')
    .in('status', ['QUOTATION', 'ORDERED'])
    .order('created_at', { ascending: false });

  const q = search.trim();
  if (q) {
    const matchedClients = await getClients(q);
    const clientIds = matchedClients.map(c => c.id);
    const orParts = [`sales_no.ilike.%${q}%`];
    if (clientIds.length > 0) orParts.push(`client_id.in.(${clientIds.join(',')})`);
    query = query.or(orParts.join(','));
  }

  const { data, error } = await query;
  if (error) {
    console.error('getSalesOrdersForLinking', error);
    return [];
  }
  return (data || []).map((row: any) => ({
    id: row.id,
    salesNo: row.sales_no,
    clientName: row.clients?.company_name || '',
  }));
};

export interface SalesReturnLine {
  detailId: string;
  quantity: number; // > 0; validated server-side against deliveredQuantity − returnedQuantity
}

// The client sends finished goods back — one atomic transaction per submit via
// apply_sales_return_batch (function_trigger.sql). Throws on over-return (decision #1): you cannot
// return more than actually shipped, and that's a data-entry mistake, not a race.
export const returnSalesOrder = async (
  header: SalesHeader,
  lines: SalesReturnLine[],
  remark?: string,
): Promise<void> => {
  const payload = lines.filter(l => l.quantity > 0).map(l => ({ detail_id: l.detailId, quantity: l.quantity }));
  if (payload.length === 0) return;

  const { error } = await supabase.rpc('apply_sales_return_batch', {
    p_header_id: header.id,
    p_lines: payload,
    p_remark: remark ?? null,
  });
  if (error) {
    console.error('returnSalesOrder', error);
    throw error;
  }
};
