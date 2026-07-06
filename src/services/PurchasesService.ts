/**
 * Purchases module service layer (purchase_header/purchase_detail).
 *
 * Pattern A: talks to Supabase directly, mirroring MaterialService.ts /
 * InventoryTransactionService.ts. No db.ts, no server.ts REST hop, no
 * useTableData. The legacy purchase_orders table and PurchaseOrder type
 * are untouched — DashboardView/ReportsView/ImportExportModal still read
 * them directly and are out of scope for this rewrite.
 */
import { supabase } from "./supabase";
import { getVendors } from "./ContactsService";
import { getMaterialCategories } from "./SystemAdminService";
import { saveInventoryTransaction } from "./InventoryTransactionService";
import { Attachment, PurchaseHeader, PurchaseDetail } from "../types";

export { getMaterialCategories };

export const generateId = (): string => crypto.randomUUID();

export interface PurchaseDetailInput {
  materialId: string;
  materialName: string;
  materialCode?: string;
  quantity: number;
  unitCost: number;
  totalPrice: number;
}

export interface PurchaseFormInput {
  vendorId: string;
  attachments?: Attachment[];
  details: PurchaseDetailInput[];
}

const mapPurchaseDetailRow = (row: any): PurchaseDetail => ({
  detailId: row.detail_id,
  headerId: row.header_id,
  materialId: row.material_id,
  materialName: row.material_name,
  materialCode: row.material_code || undefined,
  quantity: Number(row.quantity) || 0,
  unitCost: Number(row.unit_cost) || 0,
  totalPrice: Number(row.total_price) || 0,
  receivedQuantity: Number(row.received_quantity) || 0,
});

const mapPurchaseHeaderRow = (row: any): PurchaseHeader => ({
  id: row.id,
  purchaseNo: row.purchase_no,
  quotationDate: row.quotation_date,
  orderDate: row.order_date || undefined,
  receivedDate: row.received_date || undefined,
  status: row.status,
  vendorId: row.vendor_id,
  vendorName: row.vendors?.company_name || '',
  totalPrice: Number(row.total_price) || 0,
  attachments: row.attachments || [],
  details: (row.purchase_detail || []).map(mapPurchaseDetailRow),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const getPurchases = async (tab: 'QUOTATION' | 'PO', search = ''): Promise<PurchaseHeader[]> => {
  let query = supabase
    .from('purchase_header')
    .select('*, vendors(company_name), purchase_detail(*)')
    .order('created_at', { ascending: false });

  query = tab === 'QUOTATION'
    ? query.eq('status', 'QUOTATION')
    : query.in('status', ['ORDERED', 'RECEIVED', 'CANCELLED']);

  const q = search.trim();
  if (q) {
    // purchase_header has no denormalized vendor name column, so vendor-name
    // search resolves matching vendor ids first (mirrors
    // InventoryTransactionService's search-by-joined-name pattern).
    const matchedVendors = await getVendors(q);
    const vendorIds = matchedVendors.map(v => v.id);
    const orParts = [`purchase_no.ilike.%${q}%`];
    if (vendorIds.length > 0) orParts.push(`vendor_id.in.(${vendorIds.join(',')})`);
    query = query.or(orParts.join(','));
  }

  const { data, error } = await query;
  if (error) {
    console.error('getPurchases', error);
    return [];
  }
  return (data || []).map(mapPurchaseHeaderRow);
};

const detailRowsForInsert = (headerId: string, details: PurchaseDetailInput[]) =>
  details.map(d => ({
    header_id: headerId,
    material_id: d.materialId,
    material_name: d.materialName,
    material_code: d.materialCode || null,
    quantity: d.quantity,
    unit_cost: d.unitCost,
    total_price: d.totalPrice,
  }));

const replaceDetails = async (headerId: string, details: PurchaseDetailInput[]): Promise<void> => {
  const { error: deleteError } = await supabase.from('purchase_detail').delete().eq('header_id', headerId);
  if (deleteError) {
    console.error('replaceDetails(delete)', deleteError);
    throw deleteError;
  }

  const { error: insertError } = await supabase.from('purchase_detail').insert(detailRowsForInsert(headerId, details));
  if (insertError) {
    console.error('replaceDetails(insert)', insertError);
    throw insertError;
  }
};

export const createPurchaseQuotation = async (input: PurchaseFormInput): Promise<void> => {
  const id = generateId();
  const totalPrice = input.details.reduce((sum, d) => sum + d.totalPrice, 0);
  const today = new Date().toISOString().split('T')[0];

  const { error: headerError } = await supabase.from('purchase_header').insert({
    id,
    purchase_no: `PO-${id.slice(0, 8).toUpperCase()}`,
    quotation_date: today,
    status: 'QUOTATION',
    vendor_id: input.vendorId,
    total_price: totalPrice,
    attachments: input.attachments || [],
  });
  if (headerError) {
    console.error('createPurchaseQuotation(header)', headerError);
    throw headerError;
  }

  const { error: detailError } = await supabase.from('purchase_detail').insert(detailRowsForInsert(id, input.details));
  if (detailError) {
    console.error('createPurchaseQuotation(detail)', detailError);
    throw detailError;
  }
};

export const updatePurchase = async (headerId: string, input: PurchaseFormInput): Promise<void> => {
  const totalPrice = input.details.reduce((sum, d) => sum + d.totalPrice, 0);

  const { error } = await supabase
    .from('purchase_header')
    .update({
      vendor_id: input.vendorId,
      total_price: totalPrice,
      attachments: input.attachments || [],
    })
    .eq('id', headerId);
  if (error) {
    console.error('updatePurchase(header)', error);
    throw error;
  }

  await replaceDetails(headerId, input.details);
};

export const convertToPurchaseOrder = async (headerId: string, input: PurchaseFormInput, orderDate: string): Promise<void> => {
  const totalPrice = input.details.reduce((sum, d) => sum + d.totalPrice, 0);

  const { error } = await supabase
    .from('purchase_header')
    .update({
      vendor_id: input.vendorId,
      total_price: totalPrice,
      attachments: input.attachments || [],
      order_date: orderDate,
      status: 'ORDERED',
    })
    .eq('id', headerId);
  if (error) {
    console.error('convertToPurchaseOrder(header)', error);
    throw error;
  }

  await replaceDetails(headerId, input.details);
};

export const receivePurchaseOrder = async (purchase: PurchaseHeader): Promise<void> => {
  const today = new Date().toISOString().split('T')[0];

  for (const detail of purchase.details) {
    // Idempotency guard: skip lines already fully received so a retry after a
    // partial failure (or a double-click before the button disables) doesn't
    // insert a second inventory_transaction and double-count material.quantity.
    if (detail.receivedQuantity >= detail.quantity) {
      continue;
    }

    await saveInventoryTransaction({
      id: generateId(),
      transactionType: 'PURCHASE',
      quantity: detail.quantity,
      unitCost: detail.unitCost,
      remark: purchase.purchaseNo,
      materialId: detail.materialId,
      purchaseDetailId: detail.detailId,
      transactionDate: today,
    });

    const { error: detailError } = await supabase
      .from('purchase_detail')
      .update({ received_quantity: detail.quantity })
      .eq('detail_id', detail.detailId);
    if (detailError) {
      console.error('receivePurchaseOrder(detail)', detailError);
      throw detailError;
    }
  }

  const { error: headerError } = await supabase
    .from('purchase_header')
    .update({ received_date: today, status: 'RECEIVED' })
    .eq('id', purchase.id);
  if (headerError) {
    console.error('receivePurchaseOrder(header)', headerError);
    throw headerError;
  }
};

export const cancelPurchaseOrder = async (headerId: string): Promise<void> => {
  const { error } = await supabase.from('purchase_header').update({ status: 'CANCELLED' }).eq('id', headerId);
  if (error) {
    console.error('cancelPurchaseOrder', error);
    throw error;
  }
};

export const deletePurchase = async (headerId: string): Promise<void> => {
  const { error } = await supabase.from('purchase_header').delete().eq('id', headerId);
  if (error) {
    console.error('deletePurchase', error);
    throw error;
  }
};
