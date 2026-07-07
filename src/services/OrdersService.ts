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
    : query.in('status', ['ORDERED', 'IN_PRODUCTION', 'DONE_IN_PRODUCTION', 'DELIVERED', 'CANCELLED']);

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

// Reserves every planned material's stock (one -plannedQuantity
// inventory_transaction each) and opens one workflow_tasks row per
// sales_detail line — reconciliation against actual usage happens in
// confirmProductionDone when the order is marked done.
export const startProduction = async (header: SalesHeader): Promise<void> => {
  const today = new Date().toISOString().split('T')[0];

  const { error: taskError } = await supabase.from('workflow_tasks').insert(
    header.details.map(d => ({
      sales_detail_id: d.detailId,
      status: 'IN_PRODUCTION',
      stage: 'PREPARATION',
      start_date: today,
    }))
  );
  if (taskError) {
    console.error('startProduction(workflow_tasks)', taskError);
    throw taskError;
  }

  for (const detail of header.details) {
    for (const material of detail.materials) {
      await saveInventoryTransaction({
        id: generateId(),
        transactionType: 'SALES',
        quantity: -material.plannedQuantity,
        remark: header.salesNo,
        materialId: material.materialId,
        productionMaterialUsageId: material.id,
        transactionDate: today,
      });
    }
  }

  const { error } = await supabase.from('sales_header').update({ status: 'IN_PRODUCTION' }).eq('id', header.id);
  if (error) {
    console.error('startProduction', error);
    throw error;
  }
};

export interface MaterialReconciliationInput {
  usageId: string; // production_material_usage.id
  materialId: string;
  plannedQuantity: number;
  actualQuantity: number;
}

export interface LeftoverMaterialInput {
  salesDetailId: string;
  materialId: string;
  quantity: number;
}

export interface ExtraProducedInput {
  salesDetailId: string;
  productId: string;
  quantity: number;
}

// Reconciles actual material usage against the reservation made in
// startProduction, credits any leftover/by-product material and any
// extra finished-goods yield, closes the order's workflow_tasks rows, and
// advances the header to DONE_IN_PRODUCTION.
export const confirmProductionDone = async (
  header: SalesHeader,
  reconciliations: MaterialReconciliationInput[],
  leftovers: LeftoverMaterialInput[],
  extraProduced: ExtraProducedInput[],
): Promise<void> => {
  const today = new Date().toISOString().split('T')[0];

  for (const r of reconciliations) {
    const diff = r.plannedQuantity - r.actualQuantity;
    if (diff !== 0) {
      await saveInventoryTransaction({
        id: generateId(),
        transactionType: diff > 0 ? 'SALES_RETURN' : 'SALES',
        quantity: diff,
        remark: header.salesNo,
        materialId: r.materialId,
        productionMaterialUsageId: r.usageId,
        transactionDate: today,
      });
    }

    const { error } = await supabase
      .from('production_material_usage')
      .update({ actual_quantity: r.actualQuantity, returned_quantity: Math.max(0, diff) })
      .eq('id', r.usageId);
    if (error) {
      console.error('confirmProductionDone(reconciliation)', error);
      throw error;
    }
  }

  for (const l of leftovers) {
    const { data: inserted, error: insertError } = await supabase
      .from('production_material_usage')
      .insert({
        sales_detail_id: l.salesDetailId,
        material_id: l.materialId,
        planned_quantity: 0,
        actual_quantity: 0,
        returned_quantity: l.quantity,
        remark: 'Leftover from production',
      })
      .select('id')
      .single();
    if (insertError) {
      console.error('confirmProductionDone(leftover)', insertError);
      throw insertError;
    }

    await saveInventoryTransaction({
      id: generateId(),
      transactionType: 'SALES_RETURN',
      quantity: l.quantity,
      remark: header.salesNo,
      materialId: l.materialId,
      productionMaterialUsageId: inserted.id,
      transactionDate: today,
    });
  }

  for (const p of extraProduced) {
    if (p.quantity <= 0) continue;
    await saveInventoryTransaction({
      id: generateId(),
      transactionType: 'ADJUSTMENT',
      quantity: p.quantity,
      remark: header.salesNo,
      productId: p.productId,
      transactionDate: today,
    });
  }

  const { error: taskError } = await supabase
    .from('workflow_tasks')
    .update({ status: 'DONE', end_date: today })
    .in('sales_detail_id', header.details.map(d => d.detailId));
  if (taskError) {
    console.error('confirmProductionDone(workflow_tasks)', taskError);
    throw taskError;
  }

  const { error } = await supabase.from('sales_header').update({ status: 'DONE_IN_PRODUCTION' }).eq('id', header.id);
  if (error) {
    console.error('confirmProductionDone', error);
    throw error;
  }
};

export const markDelivered = async (headerId: string): Promise<void> => {
  const { error } = await supabase.from('sales_header').update({ status: 'DELIVERED' }).eq('id', headerId);
  if (error) {
    console.error('markDelivered', error);
    throw error;
  }
};

// If the order already reserved material stock (Start Production ran), a
// cancel from IN_PRODUCTION must return that stock and close the order's
// workflow_tasks rows — symmetric with what startProduction reserved/opened.
// Cancelling from ORDERED (before any reservation) is still a plain status flip.
export const cancelSalesOrder = async (header: SalesHeader): Promise<void> => {
  const today = new Date().toISOString().split('T')[0];

  if (header.status === 'IN_PRODUCTION') {
    for (const detail of header.details) {
      for (const material of detail.materials) {
        await saveInventoryTransaction({
          id: generateId(),
          transactionType: 'SALES_RETURN',
          quantity: material.plannedQuantity,
          remark: header.salesNo,
          materialId: material.materialId,
          productionMaterialUsageId: material.id,
          transactionDate: today,
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
