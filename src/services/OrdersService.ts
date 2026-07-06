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
import { Attachment, SalesHeader, SalesDetail, ProductionMaterialUsage } from "../types";

export const generateId = (): string => crypto.randomUUID();

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
  materials: MaterialUsageInput[];
}

export interface SalesFormInput {
  clientId: string;
  remark?: string;
  attachments?: Attachment[];
  details: SalesDetailInput[];
}

const mapMaterialUsageRow = (row: any): ProductionMaterialUsage => ({
  id: row.id,
  salesDetailId: row.sales_detail_id,
  materialId: row.material_id,
  materialName: row.material?.name || '',
  materialCode: row.material?.code || undefined,
  plannedQuantity: Number(row.planned_quantity) || 0,
});

const mapSalesDetailRow = (row: any): SalesDetail => ({
  detailId: row.detail_id,
  headerId: row.header_id,
  productId: row.product_id,
  productName: row.product_name,
  productCode: row.product_code || undefined,
  quantity: Number(row.quantity) || 0,
  unitPrice: Number(row.unit_price) || 0,
  totalPrice: Number(row.total_price) || 0,
  remark: row.remark || undefined,
  materials: (row.production_material_usage || []).map(mapMaterialUsageRow),
});

const mapSalesHeaderRow = (row: any): SalesHeader => ({
  id: row.id,
  salesNo: row.sales_no,
  orderDate: row.order_date,
  deliveryDate: row.delivery_date || undefined,
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

export const getSalesOrders = async (tab: 'QUOTATION' | 'SO', search = ''): Promise<SalesHeader[]> => {
  let query = supabase
    .from('sales_header')
    .select('*, clients(company_name), sales_detail(*, production_material_usage(*, material(name, code)))')
    .order('created_at', { ascending: false });

  query = tab === 'QUOTATION'
    ? query.eq('status', 'QUOTATION')
    : query.in('status', ['ORDERED', 'DELIVERED', 'CANCELLED']);

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

  const { data, error } = await query;
  if (error) {
    console.error('getSalesOrders', error);
    return [];
  }
  return (data || []).map(mapSalesHeaderRow);
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
  const today = new Date().toISOString().split('T')[0];

  const { error: headerError } = await supabase.from('sales_header').insert({
    id,
    sales_no: `SO-${id.slice(0, 8).toUpperCase()}`,
    order_date: today,
    status: 'QUOTATION',
    client_id: input.clientId,
    total_amount: totalAmount,
    remark: input.remark || null,
    attachments: input.attachments || [],
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

// Status-only transition — no inventory_transaction insert. Actual product/
// material stock movement is deferred to a future production/workflow step
// that will consume production_material_usage.actual_quantity.
export const markDelivered = async (headerId: string): Promise<void> => {
  const { error } = await supabase.from('sales_header').update({ status: 'DELIVERED' }).eq('id', headerId);
  if (error) {
    console.error('markDelivered', error);
    throw error;
  }
};

export const cancelSalesOrder = async (headerId: string): Promise<void> => {
  const { error } = await supabase.from('sales_header').update({ status: 'CANCELLED' }).eq('id', headerId);
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

// Lightweight list for PurchasesView.tsx's "Linked Sales Order" picker —
// doesn't need line items, just enough to label a ComboBox option.
export const getSalesOrdersForLinking = async (search = ''): Promise<SalesOrderLinkOption[]> => {
  let query = supabase
    .from('sales_header')
    .select('id, sales_no, clients(company_name)')
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
