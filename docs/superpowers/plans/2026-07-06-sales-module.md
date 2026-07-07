# Sales Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy `sales_orders`-backed Orders tab with a quotation → sales-order workflow built on `sales_header`/`sales_detail`/`production_material_usage`, mirroring the Purchase module (Step 6), and wire an optional Sales↔Purchase header-level link.

**Architecture:** New pattern-A `OrdersService.ts` (direct Supabase reads/writes, mirroring `PurchasesService.ts`/`MaterialService.ts`) backs a two-tab `OrdersView.tsx` (Quotation / Sales Order, same toggle pattern as `PurchasesView.tsx`). A new `SalesQuotationModal.tsx` (copied from `QuotationModal.tsx`) prints client-facing quotation documents; the existing `InvoiceModal.tsx` is retargeted in place from the legacy `SalesOrder` type to the new `SalesHeader`/`SalesDetail`. `PurchasesService.ts`/`PurchasesView.tsx` get a small addition wiring the already-existing `sales_header_id` FK as an optional "Linked Sales Order" picker.

**Tech Stack:** React 19 + TypeScript, Supabase JS client, Tailwind v4. No automated test runner in this repo (`npm run lint` = `tsc --noEmit` is the only CI-style check) — per-task verification is a clean `tsc --noEmit` plus a code-level self-review; the user does manual browser QA themselves (see final checklist in Task 8, do not launch the dev server or browser automation).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-06-sales-module-design.md` — every task below implements a section of it.
- Do NOT touch `SalesOrder`/`SalesOrderItem` types, `sales_orders` table, or `db.ts`'s sales-order functions — `DashboardView.tsx`, `ReportsView.tsx`, `ImportExportModal.tsx`, `App.tsx`, and `server.ts` still depend on them and are out of scope.
- `OrdersService.ts` is only imported by `OrdersView.tsx` today — safe to fully rewrite its exports.
- `InvoiceModal.tsx` is only imported by `OrdersView.tsx` today — safe to retarget its prop type.
- No `production_material_usage.actual_quantity`/`returned_quantity` wiring, no inventory_transaction inserts from Sales, no per-line (`purchase_detail.sales_detail_id`) linking, no `workflow_tasks`/`WorkflowsView.tsx` changes — all deferred per spec's Out of scope section.
- No `db.ts`, no `server.ts` REST hop, no `useTableData` in any new/modified file in this plan.
- Verification command for every task: `npm run lint` (must exit 0, no TypeScript errors).

---

### Task 1: Types — `SalesHeader`/`SalesDetail`/`ProductionMaterialUsage` + `PurchaseHeader.salesHeaderId`

**Files:**
- Modify: `src/types.ts:150` (insert after `PurchaseHeader`'s closing `}`, before `export interface WorkflowTask {`)
- Modify: `src/types.ts:136-150` (`PurchaseHeader` interface — add `salesHeaderId`)

**Interfaces:**
- Produces: `SalesHeader`, `SalesDetail`, `ProductionMaterialUsage` (consumed by Task 2's service, Task 3's `SalesQuotationModal`, Task 4's `InvoiceModal`, Task 5's `OrdersView`), `PurchaseHeader.salesHeaderId?: string` (consumed by Task 6).

- [ ] **Step 1: Add `salesHeaderId` to `PurchaseHeader`**

In `src/types.ts`, `PurchaseHeader` currently reads (lines 136-150):

```ts
export interface PurchaseHeader {
  id: string;
  purchaseNo: string;
  quotationDate: string;
  orderDate?: string;
  receivedDate?: string;
  status: 'QUOTATION' | 'ORDERED' | 'RECEIVED' | 'CANCELLED';
  vendorId: string;
  vendorName: string; // joined, display only
  totalPrice: number;
  attachments?: Attachment[];
  details: PurchaseDetail[];
  createdAt?: string;
  updatedAt?: string;
}
```

Change to (adds `salesHeaderId` after `attachments`):

```ts
export interface PurchaseHeader {
  id: string;
  purchaseNo: string;
  quotationDate: string;
  orderDate?: string;
  receivedDate?: string;
  status: 'QUOTATION' | 'ORDERED' | 'RECEIVED' | 'CANCELLED';
  vendorId: string;
  vendorName: string; // joined, display only
  totalPrice: number;
  attachments?: Attachment[];
  salesHeaderId?: string; // FK -> sales_header.id, optional link to the sales order this purchase serves
  details: PurchaseDetail[];
  createdAt?: string;
  updatedAt?: string;
}
```

- [ ] **Step 2: Insert `ProductionMaterialUsage`/`SalesDetail`/`SalesHeader` into `types.ts`**

Insert immediately after the closing `}` of `PurchaseHeader` and before `export interface WorkflowTask {`:

```ts
export interface ProductionMaterialUsage {
  id: string;
  salesDetailId?: string;
  materialId: string;
  materialName: string; // joined, display only
  materialCode?: string; // joined, display only
  plannedQuantity: number;
}

export interface SalesDetail {
  detailId: string;
  headerId?: string;
  productId: string;
  productName: string; // snapshot
  productCode?: string; // snapshot
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  remark?: string;
  materials: ProductionMaterialUsage[];
}

export interface SalesHeader {
  id: string;
  salesNo: string;
  orderDate: string;
  deliveryDate?: string;
  status: 'QUOTATION' | 'ORDERED' | 'DELIVERED' | 'CANCELLED';
  clientId: string;
  clientName: string; // joined, display only
  totalAmount: number;
  remark?: string;
  attachments?: Attachment[];
  details: SalesDetail[];
  createdAt?: string;
  updatedAt?: string;
}
```

- [ ] **Step 3: Verify**

Run: `npm run lint`
Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat: add SalesHeader/SalesDetail/ProductionMaterialUsage types, wire sales_header_id onto PurchaseHeader"
```

---

### Task 2: `src/services/OrdersService.ts` — full pattern-A rewrite

**Files:**
- Modify: `src/services/OrdersService.ts` (full rewrite, replacing the current `db.ts` re-export wrapper)

**Interfaces:**
- Consumes: `SalesHeader`, `SalesDetail`, `ProductionMaterialUsage` (Task 1), `Attachment` (existing), `ContactsService.getClients(search): Promise<Client[]>` (existing).
- Produces (consumed by Task 5's view and Task 6's `PurchasesView.tsx`): `generateId`, `MaterialUsageInput`, `SalesDetailInput`, `SalesFormInput` (types), `getSalesOrders(tab, search)`, `createSalesQuotation(input)`, `updateSalesOrder(headerId, input)`, `convertToSalesOrder(headerId, input, deliveryDate)`, `markDelivered(headerId)`, `cancelSalesOrder(headerId)`, `deleteSalesOrder(headerId)`, `getSalesOrdersForLinking(search)`.

- [ ] **Step 1: Replace the full file contents**

```ts
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
```

- [ ] **Step 2: Verify**

Run: `npm run lint`
Expected: exits 0. (`OrdersView.tsx` will fail to compile until Task 5 — if `npm run lint` reports errors only inside `OrdersView.tsx`/`InvoiceModal.tsx` at this point, that's expected; confirm no errors are reported inside `OrdersService.ts` itself.)

- [ ] **Step 3: Commit**

```bash
git add src/services/OrdersService.ts
git commit -m "feat: rewrite OrdersService as pattern-A service over sales_header/sales_detail/production_material_usage"
```

---

### Task 3: `src/components/SalesQuotationModal.tsx` — new client-facing print modal

**Files:**
- Create: `src/components/SalesQuotationModal.tsx`

**Interfaces:**
- Consumes: `SalesHeader` (Task 1), `ContactsService.getClients` (existing), `CompanyProfileService.getCompanyProfile` (existing).
- Produces (consumed by Task 5): `SalesQuotationModal` component with props `{ order: SalesHeader | null; isOpen: boolean; onClose: () => void }`.

- [ ] **Step 1: Create the file**

```tsx
import React, { useMemo, useState, useEffect } from 'react';
import { X, Printer, FileText, Mail, Phone, MapPin, Database, Factory, Cpu, Wrench } from 'lucide-react';
import { SalesHeader, Client, CompanyProfile } from '../types';
import { getClients } from '../services/ContactsService';
import { getCompanyProfile } from '../services/CompanyProfileService';

interface SalesQuotationModalProps {
  order: SalesHeader | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function SalesQuotationModal({ order, isOpen, onClose }: SalesQuotationModalProps) {
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile>(null);
  const [clients, setClients] = useState<Client[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    getClients().then(setClients).catch(console.error);
  }, [isOpen]);

  useEffect(() => {
    const load = async () => {
      const cachedProfile = JSON.parse(localStorage.getItem('erp_company_profile'));
      if (cachedProfile && cachedProfile.id) {
        setCompanyProfile(cachedProfile);
        return;
      }
      const profile = await getCompanyProfile();
      if (profile) setCompanyProfile(profile);
    };
    if (isOpen) load();
  }, [isOpen]);

  const [showSignature, setShowSignature] = useState(true);

  const clientDetails = useMemo(() => {
    if (!order) return null;
    return clients.find(c => c.id === order.clientId);
  }, [order, clients]);

  if (!isOpen || !order) return null;

  const referenceNo = order.salesNo;
  const grandTotal = order.totalAmount;

  const handlePrint = () => {
    const sheet = document.getElementById('printable-sales-quotation-sheet');
    if (!sheet) {
      window.print();
      return;
    }

    try {
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        const logoHtml = companyProfile.icon_type === 'custom_image' && companyProfile.icon_data_url
          ? `<img src="${companyProfile.icon_data_url}" style="max-height: 50px; width: auto; object-fit: contain; border-radius: 4px;" />`
          : `<div style="font-size: 24px; font-weight: 800; color: #1e3a8a;">${companyProfile.name}</div>`;

        const signatureHtml = showSignature && companyProfile.signature_url
          ? `<img src="${companyProfile.signature_url}" style="max-height: 70px; max-width: 150px; object-fit: contain;" />`
          : (showSignature ? `<div style="font-family: serif; font-style: italic; font-size: 18px; color: #1e3a8a; font-weight: bold;">${companyProfile.name.split(' ').map(n => n[0]).join('') || 'SJE'}</div>` : '');

        printWindow.document.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Sales Quotation - ${referenceNo}</title>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1e293b; margin: 0; padding: 40px; background: #ffffff; }
                .quotation-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #f1f5f9; padding-bottom: 24px; margin-bottom: 30px; }
                .company-info { max-width: 380px; }
                .company-name { font-size: 18px; font-weight: 800; color: #0f172a; margin: 6px 0 2px 0; }
                .reg-no { font-size: 8px; font-family: monospace; color: #94a3b8; letter-spacing: 0.05em; text-transform: uppercase; }
                .contact-details { font-size: 10px; color: #64748b; margin-top: 8px; line-height: 1.5; }
                .quotation-title-block { text-align: right; }
                .quotation-title { font-size: 24px; font-weight: 900; color: #0f172a; margin: 0 0 6px 0; }
                .meta-details { font-size: 10px; font-family: monospace; color: #475569; line-height: 1.5; }
                .meta-label { font-weight: 700; }
                .billing-block { display: grid; grid-template-cols: 1fr 1fr; gap: 40px; background-color: #f8fafc; border-radius: 12px; padding: 20px; margin-bottom: 30px; }
                .bill-to-title { font-size: 9px; font-weight: 700; color: #94a3b8; letter-spacing: 0.1em; margin-bottom: 6px; }
                .client-name { font-size: 13px; font-weight: bold; color: #0f172a; margin: 0 0 4px 0; }
                .client-info { font-size: 10px; color: #475569; line-height: 1.4; }
                .terms-details { font-size: 10px; color: #475569; line-height: 1.4; }
                .items-title { font-size: 9px; font-weight: 700; color: #94a3b8; letter-spacing: 0.1em; margin-bottom: 8px; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 30px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
                th { background-color: #f1f5f9; color: #475569; font-size: 9px; font-family: monospace; text-transform: uppercase; letter-spacing: 0.05em; padding: 12px; text-align: left; border-bottom: 1px solid #e2e8f0; }
                td { padding: 12px; font-size: 11px; color: #334155; border-bottom: 1px solid #f1f5f9; }
                .item-name { font-weight: 700; color: #0f172a; }
                .item-desc { font-size: 9px; color: #94a3b8; }
                .text-right { text-align: right; }
                .text-mono { font-family: monospace; }
                .totals-section { display: flex; justify-content: space-between; align-items: flex-start; border-top: 1px solid #f1f5f9; padding-top: 20px; margin-bottom: 40px; }
                .declaration { max-width: 360px; font-size: 10px; color: #94a3b8; line-height: 1.5; }
                .declaration-title { font-weight: 700; color: #64748b; margin-bottom: 4px; }
                .totals-box { width: 240px; font-size: 10px; font-family: monospace; line-height: 1.8; }
                .totals-row-grand { display: flex; justify-content: space-between; font-size: 12px; font-weight: 900; font-family: sans-serif; color: #1d4ed8; border-top: 1px solid #e2e8f0; padding-top: 8px; margin-top: 8px; }
                .signatures-area { display: flex; justify-content: flex-start; border-top: 1px solid #f1f5f9; padding-top: 30px; }
                .signature-box { width: 200px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; min-height: 110px; }
                .signature-image-wrapper { height: 60px; display: flex; align-items: center; justify-content: center; margin-bottom: 8px; }
                .signature-line { width: 140px; border-bottom: 1px solid #cbd5e1; margin-bottom: 6px; }
                .signature-title { font-size: 10px; font-weight: 700; color: #334155; }
                @media print { body { padding: 0; } }
              </style>
            </head>
            <body>
              <div class="quotation-header">
                <div class="company-info">
                  <div style="display: flex; align-items: center; gap: 10px;">
                    ${logoHtml}
                    <div>
                      <div class="company-name">${companyProfile.name}</div>
                      <span class="reg-no">REG NO: 202601048292 (159421-P)</span>
                    </div>
                  </div>
                  <div class="contact-details">
                    <p style="margin: 4px 0 2px 0;">📍 ${companyProfile.address || 'Lot 102, Kawasan Perindustrian Balakong, 43300 Selangor, Malaysia'}</p>
                    <p style="margin: 2px 0;">📞 ${companyProfile.phone || '+60 3-8012 3456'}</p>
                    <p style="margin: 2px 0;">✉️ ${companyProfile.email || 'finance@sengjie.com.my'}</p>
                  </div>
                </div>

                <div class="quotation-title-block">
                  <h1 class="quotation-title">SALES QUOTATION</h1>
                  <div class="meta-details">
                    <p style="margin: 2px 0;"><span class="meta-label">Reference No:</span> ${referenceNo}</p>
                    <p style="margin: 2px 0;"><span class="meta-label">Order Date:</span> ${order.orderDate}</p>
                    <p style="margin: 2px 0;"><span class="meta-label">Status:</span> <span style="font-weight: bold; color: #047857; text-transform: uppercase;">${order.status}</span></p>
                  </div>
                </div>
              </div>

              <div class="billing-block">
                <div>
                  <div class="bill-to-title">QUOTATION ISSUED TO</div>
                  <h3 class="client-name">${order.clientName}</h3>
                  ${clientDetails ? `
                    <div class="client-info">
                      <p style="margin: 2px 0; max-width: 250px;">${clientDetails.address}</p>
                      <p style="margin: 2px 0;">📞 ${clientDetails.officeNo}</p>
                      <p style="margin: 2px 0;">✉️ ${clientDetails.email}</p>
                    </div>
                  ` : `<div class="client-info">Client details not available</div>`}
                </div>

                <div>
                  <div class="bill-to-title">QUOTATION TERMS</div>
                  <p class="terms-details">
                    Please confirm product specifications and quantities for the items below. This document is a price quotation and is not a binding sales commitment until confirmed into a Sales Order.
                  </p>
                </div>
              </div>

              <div class="items-title">PRODUCT LINE ITEMS</div>
              <table>
                <thead>
                  <tr>
                    <th style="width: 40px;">#</th>
                    <th>Product Description</th>
                    <th class="text-right" style="width: 100px;">Quantity</th>
                    <th class="text-right" style="width: 120px;">Unit Price</th>
                    <th class="text-right" style="width: 140px;">Amount (RM)</th>
                  </tr>
                </thead>
                <tbody>
                  ${order.details.map((item, idx) => `
                    <tr>
                      <td class="text-mono" style="color: #94a3b8;">${String(idx + 1).padStart(2, '0')}</td>
                      <td>
                        <div class="item-name">${item.productName}</div>
                        <span class="item-desc">Finished product. Code: ${item.productCode || item.productId}</span>
                      </td>
                      <td class="text-right text-mono">${item.quantity} units</td>
                      <td class="text-right text-mono">RM ${item.unitPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td class="text-right text-mono" style="font-weight: 700; color: #0f172a;">RM ${item.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>

              <div class="totals-section">
                <div class="declaration">
                  <div class="declaration-title">QUOTATION DECLARATION</div>
                  <p style="margin: 0;">
                    This quotation is issued by ${companyProfile.name} for product and pricing evaluation purposes only. All values expressed in Malaysian Ringgit (MYR).
                  </p>
                </div>

                <div class="totals-box">
                  <div class="totals-row-grand">
                    <span>ESTIMATED TOTAL</span>
                    <span>RM ${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>

              <div class="signatures-area">
                <div class="signature-box">
                  <div class="signature-image-wrapper">
                    ${signatureHtml}
                  </div>
                  <div class="signature-line"></div>
                  <div class="signature-title">Authorized Signature</div>
                </div>
              </div>

              <script>
                window.addEventListener('load', () => {
                  setTimeout(() => {
                    window.print();
                    window.close();
                  }, 400);
                });
              </script>
            </body>
          </html>
        `);
        printWindow.document.close();
        return;
      }
    } catch (err) {
      console.warn("Popup-based print blocked or failed, falling back to window.print", err);
    }

    window.focus();
    window.print();
  };

  const renderLogo = () => {
    if (companyProfile.icon_type === 'custom_image' && companyProfile.icon_data_url) {
      return (
        <img
          src={companyProfile.icon_data_url}
          alt="Logo"
          className="w-9 h-9 object-contain rounded border border-slate-150 bg-white"
          referrerPolicy="no-referrer"
        />
      );
    }

    const iconSize = "w-5 h-5 text-white";
    switch (companyProfile.icon_type) {
      case 'factory':
        return <div className="w-9 h-9 rounded bg-blue-600 flex items-center justify-center shrink-0"><Factory className={iconSize} /></div>;
      case 'cpu':
        return <div className="w-9 h-9 rounded bg-blue-600 flex items-center justify-center shrink-0"><Cpu className={iconSize} /></div>;
      case 'wrench':
        return <div className="w-9 h-9 rounded bg-blue-600 flex items-center justify-center shrink-0"><Wrench className={iconSize} /></div>;
      case 'database':
      default:
        return <div className="w-9 h-9 rounded bg-blue-600 flex items-center justify-center shrink-0"><Database className={iconSize} /></div>;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto print:p-0 print:bg-white print:static">
      <style dangerouslySetInnerHTML={{
        __html: `
        @media print {
          html, body { background-color: #ffffff !important; color: #000000 !important; margin: 0 !important; padding: 0 !important; height: auto !important; width: 100% !important; }
          aside, header, main, nav, .print\\:hidden, [role="dialog"] > div:not(#printable-sales-quotation-container) { display: none !important; visibility: hidden !important; }
          #printable-sales-quotation-container { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; max-width: 100% !important; border: none !important; box-shadow: none !important; margin: 0 !important; padding: 0 !important; background: #ffffff !important; visibility: visible !important; }
          #printable-sales-quotation-sheet { padding: 0 !important; margin: 0 !important; border: none !important; visibility: visible !important; }
          #printable-sales-quotation-sheet * { visibility: visible !important; }
        }
      `}} />

      <div
        id="printable-sales-quotation-container"
        className="w-full max-w-3xl bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden flex flex-col my-8 animate-in fade-in zoom-in-95 duration-200 print:shadow-none print:border-none print:my-0 print:rounded-none"
      >
        <div className="p-4 border-b border-slate-100 bg-slate-50 flex flex-col md:flex-row md:items-center md:justify-between gap-4 print:hidden">
          <div className="flex items-center space-x-2">
            <FileText className="w-4 h-4 text-blue-600" />
            <div>
              <span className="font-sans font-bold text-slate-800 text-xs uppercase tracking-wider block leading-none">Sales Quotation</span>
              <span className="text-[10px] text-slate-400 mt-0.5 block">Configure print options and finalize document</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center space-x-2 bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 shadow-sm cursor-pointer hover:bg-slate-50 transition-all text-[11px] font-sans font-medium text-slate-600 select-none">
              <input
                type="checkbox"
                checked={showSignature}
                onChange={(e) => setShowSignature(e.target.checked)}
                className="w-3.5 h-3.5 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
              />
              <span>Add Signature</span>
            </label>

            <div className="h-6 w-px bg-slate-200 hidden md:block"></div>

            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center space-x-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-all hover:shadow cursor-pointer"
              title="Print quotation"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Quotation</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-500 hover:text-slate-700 transition-colors"
              title="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-8 space-y-8 text-xs text-slate-600 print:p-0 font-sans bg-white" id="printable-sales-quotation-sheet">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-6 border-b border-slate-100 pb-6">
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                {renderLogo()}
                <div>
                  <h2 className="font-sans font-extrabold text-slate-900 text-base tracking-tight">{companyProfile.name}</h2>
                  <span className="text-[8px] text-slate-400 font-mono font-bold tracking-widest uppercase">REG NO: 202601048292 (159421-P)</span>
                </div>
              </div>

              <div className="text-[10px] text-slate-400 font-sans space-y-0.5">
                <p className="flex items-start space-x-1.5 max-w-[340px]">
                  <MapPin className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
                  <span>{companyProfile.address || 'Lot 102, Kawasan Perindustrian Balakong, 43300 Selangor, Malaysia'}</span>
                </p>
                <p className="flex items-center space-x-1.5">
                  <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                  <span>{companyProfile.phone || '+60 3-8012 3456'}</span>
                </p>
                <p className="flex items-center space-x-1.5">
                  <Mail className="w-3 h-3 text-slate-400 shrink-0" />
                  <span>{companyProfile.email || 'finance@sengjie.com.my'}</span>
                </p>
              </div>
            </div>

            <div className="text-left sm:text-right space-y-1 sm:min-w-[180px]">
              <h1 className="font-sans font-black text-slate-900 text-xl tracking-tight uppercase print:text-2xl">Sales Quotation</h1>
              <div className="space-y-0.5 text-[10px] font-mono text-slate-500">
                <p><span className="font-bold text-slate-700">Reference No:</span> {referenceNo}</p>
                <p><span className="font-bold text-slate-700">Order Date:</span> {order.orderDate}</p>
                <p><span className="font-bold text-slate-700">Status:</span> <span className="text-emerald-700 font-bold uppercase">{order.status}</span></p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 bg-slate-50/70 rounded-xl p-4 border border-slate-100 print:bg-white print:border-none print:p-0">
            <div>
              <span className="text-[9px] font-bold text-slate-400 uppercase font-mono block mb-1">QUOTATION ISSUED TO</span>
              <h3 className="font-sans font-bold text-slate-900 text-xs">{order.clientName}</h3>
              {clientDetails ? (
                <div className="text-[10px] text-slate-500 space-y-0.5 mt-1 leading-relaxed">
                  <p className="max-w-[250px]">{clientDetails.address}</p>
                  <p className="font-mono">{clientDetails.officeNo}</p>
                  <p className="font-mono">{clientDetails.email}</p>
                </div>
              ) : (
                <p className="text-[10px] text-slate-400 mt-1 italic">Client directory match not available.</p>
              )}
            </div>

            <div className="flex flex-col justify-between sm:text-right">
              <div>
                <span className="text-[9px] font-bold text-slate-400 uppercase font-mono block mb-1">QUOTATION TERMS</span>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Please confirm product specifications and quantities for the items below. Not a binding sales commitment until confirmed into a Sales Order.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-[9px] font-bold text-slate-400 uppercase font-mono block">PRODUCT LINE ITEMS</span>
            <div className="border border-slate-200 rounded-lg overflow-hidden print:border-slate-300">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-500 uppercase font-mono tracking-wider text-[9px] print:bg-slate-50">
                    <th className="p-3">#</th>
                    <th className="p-3">Product Description</th>
                    <th className="p-3 text-right">Quantity</th>
                    <th className="p-3 text-right">Unit Price</th>
                    <th className="p-3 text-right">Amount (RM)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 print:divide-slate-200">
                  {order.details.map((item, idx) => (
                    <tr key={item.detailId || idx}>
                      <td className="p-3 font-mono text-slate-400">{String(idx + 1).padStart(2, '0')}</td>
                      <td className="p-3 font-semibold text-slate-800">
                        <div>{item.productName}</div>
                        <span className="text-[9px] text-slate-400 font-normal">Finished product. Code: {item.productCode || item.productId}</span>
                      </td>
                      <td className="p-3 text-right font-mono">{item.quantity} units</td>
                      <td className="p-3 text-right font-mono">RM {item.unitPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right font-mono font-semibold text-slate-900">RM {item.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:justify-between items-start gap-4 pt-4 border-t border-slate-100">
            <div className="max-w-[340px] text-[10px] text-slate-400 leading-relaxed">
              <span className="font-bold text-slate-500 block mb-1">QUOTATION DECLARATION</span>
              <p>
                This quotation is issued by {companyProfile.name} for product and pricing evaluation purposes only. All values expressed in Malaysian Ringgit (MYR).
              </p>
            </div>

            <div className="w-full sm:w-[260px] text-right font-mono text-[10px] space-y-1.5 border-t sm:border-t-0 pt-3 sm:pt-0">
              <div className="flex justify-between pt-2 border-t border-slate-100 font-sans text-xs">
                <span className="font-bold text-slate-800 uppercase">ESTIMATED TOTAL</span>
                <span className="font-mono font-black text-blue-700">RM {grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>

          <div className="flex justify-start pt-8 border-t border-slate-100 items-end">
            <div className="flex flex-col items-center justify-end text-center min-h-[110px] w-48">
              {showSignature ? (
                companyProfile.signature_url ? (
                  <img
                    src={companyProfile.signature_url}
                    alt="Authorized Signature"
                    className="h-14 max-w-[140px] object-contain mb-2 print:max-h-14"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="mb-2 h-14 flex flex-col items-center justify-center select-none">
                    <span className="font-serif italic text-base text-blue-800 font-bold tracking-wider leading-none">
                      {companyProfile.name.split(' ').map(n => n[0]).join('') || 'SJE'}
                    </span>
                    <span className="text-[8px] text-slate-400 font-sans mt-1">Digitally Sealed</span>
                  </div>
                )
              ) : (
                <div className="h-14 mb-2"></div>
              )}
              <div className="w-32 border-b border-slate-300 mb-1.5"></div>
              <span className="font-bold text-slate-700 text-[10px]">Authorized Signature</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run lint`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/SalesQuotationModal.tsx
git commit -m "feat: add SalesQuotationModal for printing client-facing sales quotations"
```

---

### Task 4: `src/components/InvoiceModal.tsx` — retarget from `SalesOrder` to `SalesHeader`/`SalesDetail`

**Files:**
- Modify: `src/components/InvoiceModal.tsx` (full rewrite in place — same file, only consumer is `OrdersView.tsx`)

**Interfaces:**
- Consumes: `SalesHeader`, `SalesDetail` (Task 1), `ContactsService.getClients` (existing), `CompanyProfileService.getCompanyProfile` (existing).
- Produces (consumed by Task 5): `InvoiceModal` component with props `{ order: SalesHeader | null; isOpen: boolean; onClose: () => void }` (prop name unchanged, type changed).

- [ ] **Step 1: Replace the full file contents**

```tsx
import React, { useMemo, useState, useEffect } from 'react';
import { X, Printer, FileText, Mail, Phone, MapPin, Database, Factory, Cpu, Wrench } from 'lucide-react';
import { SalesHeader, Client, CompanyProfile } from '../types';
import { getClients } from '../services/ContactsService';
import { getCompanyProfile } from '../services/CompanyProfileService';

interface InvoiceModalProps {
  order: SalesHeader | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function InvoiceModal({ order, isOpen, onClose }: InvoiceModalProps) {
  // Read and maintain fresh company profile state
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile>(null);
  const [clients, setClients] = useState<Client[]>([]);

  // Fetch the client directory once per open (used to enrich the "Bill To" block)
  useEffect(() => {
    if (!isOpen) return;
    getClients().then(setClients).catch(console.error);
  }, [isOpen]);

  // Sync profile when modal is opened to capture latest changes
  useEffect(() => {
    const load = async () => {
      const cachedProfile = JSON.parse(localStorage.getItem('erp_company_profile'));
      if (cachedProfile && cachedProfile.id) {
        setCompanyProfile(cachedProfile);
        return;
      }
      const profile = await getCompanyProfile();

      if (profile) {
        setCompanyProfile(profile);
      }
    };
    if (isOpen) {
      load();
    }
  }, [isOpen]);

  // Option to include signature on the invoice
  const [showSignature, setShowSignature] = useState(true);

  const clientDetails = useMemo(() => {
    if (!order) return null;
    return clients.find(c => c.id === order.clientId || c.companyName === order.clientName);
  }, [order, clients]);

  if (!isOpen || !order) return null;

  // Let's compute some realistic invoice numbers and dates
  const invoiceNo = `INV-2026-${order.id.slice(0, 8).toUpperCase()}`;

  // Compute tax (Malaysia Sales & Service Tax @ 6%)
  const subtotal = order.totalAmount;
  const sstTax = subtotal * 0.06;
  const grandTotal = subtotal + sstTax;

  const handlePrint = () => {
    const invoiceSheet = document.getElementById('printable-invoice-sheet');
    if (!invoiceSheet) {
      window.print();
      return;
    }

    try {
      // Bulletproof print mechanism: Create a clean popup window to render ONLY the invoice
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        // Prepare base64 images so they are fully loaded in print document
        const logoHtml = companyProfile.icon_type === 'custom_image' && companyProfile.icon_data_url
          ? `<img src="${companyProfile.icon_data_url}" style="max-height: 50px; width: auto; object-fit: contain; border-radius: 4px;" />`
          : `<div style="font-size: 24px; font-weight: 800; color: #1e3a8a;">${companyProfile.name}</div>`;

        const signatureHtml = showSignature && companyProfile.signature_url
          ? `<img src="${companyProfile.signature_url}" style="max-height: 70px; max-width: 150px; object-fit: contain;" />`
          : (showSignature ? `<div style="font-family: serif; font-style: italic; font-size: 18px; color: #1e3a8a; font-weight: bold;">${companyProfile.name.split(' ').map(n => n[0]).join('') || 'SJE'}</div>` : '');

        printWindow.document.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Tax Invoice - ${invoiceNo}</title>
              <style>
                body {
                  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                  color: #1e293b;
                  margin: 0;
                  padding: 40px;
                  background: #ffffff;
                }
                .invoice-header {
                  display: flex;
                  justify-content: space-between;
                  align-items: flex-start;
                  border-bottom: 2px solid #f1f5f9;
                  padding-bottom: 24px;
                  margin-bottom: 30px;
                }
                .company-info {
                  max-width: 380px;
                }
                .company-name {
                  font-size: 18px;
                  font-weight: 800;
                  color: #0f172a;
                  margin: 6px 0 2px 0;
                }
                .reg-no {
                  font-size: 8px;
                  font-family: monospace;
                  color: #94a3b8;
                  letter-spacing: 0.05em;
                  text-transform: uppercase;
                }
                .contact-details {
                  font-size: 10px;
                  color: #64748b;
                  margin-top: 8px;
                  line-height: 1.5;
                }
                .invoice-title-block {
                  text-align: right;
                }
                .invoice-title {
                  font-size: 24px;
                  font-weight: 900;
                  color: #0f172a;
                  margin: 0 0 6px 0;
                }
                .meta-details {
                  font-size: 10px;
                  font-family: monospace;
                  color: #475569;
                  line-height: 1.5;
                }
                .meta-label {
                  font-weight: 700;
                }
                .billing-block {
                  display: grid;
                  grid-template-cols: 1fr 1fr;
                  gap: 40px;
                  background-color: #f8fafc;
                  border-radius: 12px;
                  padding: 20px;
                  margin-bottom: 30px;
                }
                .bill-to-title {
                  font-size: 9px;
                  font-weight: 700;
                  color: #94a3b8;
                  letter-spacing: 0.1em;
                  margin-bottom: 6px;
                }
                .client-name {
                  font-size: 13px;
                  font-weight: bold;
                  color: #0f172a;
                  margin: 0 0 4px 0;
                }
                .client-info {
                  font-size: 10px;
                  color: #475569;
                  line-height: 1.4;
                }
                .payment-details {
                  font-size: 10px;
                  color: #475569;
                  line-height: 1.4;
                }
                .payment-bank-details {
                  font-size: 9px;
                  font-family: monospace;
                  color: #64748b;
                  margin-top: 10px;
                  line-height: 1.5;
                }
                .items-title {
                  font-size: 9px;
                  font-weight: 700;
                  color: #94a3b8;
                  letter-spacing: 0.1em;
                  margin-bottom: 8px;
                }
                table {
                  width: 100%;
                  border-collapse: collapse;
                  margin-bottom: 30px;
                  border: 1px solid #e2e8f0;
                  border-radius: 8px;
                  overflow: hidden;
                }
                th {
                  background-color: #f1f5f9;
                  color: #475569;
                  font-size: 9px;
                  font-family: monospace;
                  text-transform: uppercase;
                  letter-spacing: 0.05em;
                  padding: 12px;
                  text-align: left;
                  border-bottom: 1px solid #e2e8f0;
                }
                @media (prefers-color-scheme: dark) {
                  th {
                    background-color: #1e293b;
                    color: #94a3b8;
                    border-bottom: 1px solid #334155;
                  }
                }
                td {
                  padding: 12px;
                  font-size: 11px;
                  color: #334155;
                  border-bottom: 1px solid #f1f5f9;
                }
                .item-name {
                  font-weight: 700;
                  color: #0f172a;
                }
                .item-desc {
                  font-size: 9px;
                  color: #94a3b8;
                }
                .text-right {
                  text-align: right;
                }
                .text-mono {
                  font-family: monospace;
                }
                .totals-section {
                  display: flex;
                  justify-content: space-between;
                  align-items: flex-start;
                  border-top: 1px solid #f1f5f9;
                  padding-top: 20px;
                  margin-bottom: 40px;
                }
                .declaration {
                  max-width: 360px;
                  font-size: 10px;
                  color: #94a3b8;
                  line-height: 1.5;
                }
                .declaration-title {
                  font-weight: 700;
                  color: #64748b;
                  margin-bottom: 4px;
                }
                .totals-box {
                  width: 240px;
                  font-size: 10px;
                  font-family: monospace;
                  line-height: 1.8;
                }
                .totals-row {
                  display: flex;
                  justify-content: space-between;
                }
                .totals-row-grand {
                  display: flex;
                  justify-content: space-between;
                  font-size: 12px;
                  font-weight: 900;
                  font-family: sans-serif;
                  color: #1d4ed8;
                  border-top: 1px solid #e2e8f0;
                  padding-top: 8px;
                  margin-top: 8px;
                }
                .signatures-area {
                  display: flex;
                  justify-content: flex-start;
                  border-top: 1px solid #f1f5f9;
                  padding-top: 30px;
                }
                .signature-box {
                  width: 200px;
                  text-align: center;
                  display: flex;
                  flex-direction: column;
                  align-items: center;
                  justify-content: flex-end;
                  min-height: 110px;
                }
                .signature-image-wrapper {
                  height: 60px;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  margin-bottom: 8px;
                }
                .signature-line {
                  width: 140px;
                  border-bottom: 1px solid #cbd5e1;
                  margin-bottom: 6px;
                }
                .signature-title {
                  font-size: 10px;
                  font-weight: 700;
                  color: #334155;
                }
                @media print {
                  body {
                    padding: 0;
                  }
                }
              </style>
            </head>
            <body>
              <div class="invoice-header">
                <div class="company-info">
                  <div style="display: flex; align-items: center; gap: 10px;">
                    ${logoHtml}
                    <div>
                      <div class="company-name">${companyProfile.name}</div>
                      <span class="reg-no">REG NO: 202601048292 (159421-P)</span>
                    </div>
                  </div>
                  <div class="contact-details">
                    <p style="margin: 4px 0 2px 0;">📍 ${companyProfile.address || 'Lot 102, Kawasan Perindustrian Balakong, 43300 Selangor, Malaysia'}</p>
                    <p style="margin: 2px 0;">📞 ${companyProfile.phone || '+60 3-8012 3456'}</p>
                    <p style="margin: 2px 0;">✉️ ${companyProfile.email || 'finance@sengjie.com.my'}</p>
                  </div>
                </div>

                <div class="invoice-title-block">
                  <h1 class="invoice-title">TAX INVOICE</h1>
                  <div class="meta-details">
                    <p style="margin: 2px 0;"><span class="meta-label">Invoice No:</span> ${invoiceNo}</p>
                    <p style="margin: 2px 0;"><span class="meta-label">Issue Date:</span> ${order.orderDate}</p>
                    <p style="margin: 2px 0;"><span class="meta-label">Due Date:</span> ${order.deliveryDate}</p>
                    <p style="margin: 2px 0;"><span class="meta-label">Status:</span> <span style="font-weight: bold; color: #047857; text-transform: uppercase;">${order.status}</span></p>
                  </div>
                </div>
              </div>

              <div class="billing-block">
                <div>
                  <div class="bill-to-title">BILL TO CLIENT</div>
                  <h3 class="client-name">${order.clientName}</h3>
                  ${clientDetails ? `
                    <div class="client-info">
                      <p style="margin: 2px 0; max-width: 250px;">${clientDetails.address}</p>
                      <p style="margin: 2px 0;">📞 ${clientDetails.officeNo}</p>
                      <p style="margin: 2px 0;">✉️ ${clientDetails.email}</p>
                    </div>
                  ` : `<div class="client-info">Client details not available</div>`}
                </div>

                <div>
                  <div class="bill-to-title">PAYMENT DETAILS</div>
                  <p class="payment-details">
                    Payment is requested within 14 business days from issuance. Payments must be wired to the bank coordinates below:
                  </p>
                  <div class="payment-bank-details">
                    <p style="margin: 2px 0;"><span style="font-weight: bold;">Bank:</span> ${companyProfile.bank_name || 'Maybank Berhad (Kuala Lumpur)'}</p>
                    <p style="margin: 2px 0;"><span style="font-weight: bold;">A/C:</span> ${companyProfile.bank_account || '5142-8821-3956'}</p>
                    <p style="margin: 2px 0;"><span style="font-weight: bold;">SWIFT:</span> MBBBMYKLXXX</p>
                  </div>
                </div>
              </div>

              <div class="items-title">CONTRACT LINE ITEMS</div>
              <table>
                <thead>
                  <tr>
                    <th style="width: 40px;">#</th>
                    <th>Description & Specifications</th>
                    <th class="text-right" style="width: 100px;">Quantity</th>
                    <th class="text-right" style="width: 120px;">Unit Price</th>
                    <th class="text-right" style="width: 140px;">Amount (RM)</th>
                  </tr>
                </thead>
                <tbody>
                  ${order.details.map((item, idx) => `
                    <tr>
                      <td class="text-mono" style="color: #94a3b8;">${String(idx + 1).padStart(2, '0')}</td>
                      <td>
                        <div class="item-name">${item.productName}</div>
                        <span class="item-desc">Finished product. Code: ${item.productCode || item.productId}</span>
                      </td>
                      <td class="text-right text-mono">${item.quantity} pcs</td>
                      <td class="text-right text-mono">RM ${item.unitPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td class="text-right text-mono" style="font-weight: 700; color: #0f172a;">RM ${item.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>

              <div class="totals-section">
                <div class="declaration">
                  <div class="declaration-title">INVOICE DECLARATION</div>
                  <p style="margin: 0;">
                    This invoice serves as a binding commercial statement. Goods remain the property of ${companyProfile.name} until full settlement is cleared. All values expressed in Malaysian Ringgit (MYR).
                  </p>
                </div>

                <div class="totals-box">
                  <div class="totals-row">
                    <span style="color: #64748b;">SUBTOTAL</span>
                    <span style="font-weight: 600; color: #334155;">RM ${subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div class="totals-row" style="margin-top: 4px;">
                    <span style="color: #64748b;">SALES TAX (SST 6%)</span>
                    <span style="font-weight: 600; color: #334155;">RM ${sstTax.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div class="totals-row-grand">
                    <span>GRAND TOTAL DUE</span>
                    <span>RM ${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>

              <div class="signatures-area">
                <div class="signature-box">
                  <div class="signature-image-wrapper">
                    ${signatureHtml}
                  </div>
                  <div class="signature-line"></div>
                  <div class="signature-title">Authorized Signature</div>
                </div>
              </div>

              <script>
                window.addEventListener('load', () => {
                  setTimeout(() => {
                    window.print();
                    window.close();
                  }, 400);
                });
              </script>
            </body>
          </html>
        `);
        printWindow.document.close();
        return;
      }
    } catch (err) {
      console.warn("Popup-based print blocked or failed, falling back to window.print", err);
    }

    // Direct fallback printing (styled inside app viewport)
    window.focus();
    window.print();
  };



  const renderLogo = () => {
    if (companyProfile.icon_type === 'custom_image' && companyProfile.icon_data_url) {
      return (
        <img
          src={companyProfile.icon_data_url}
          alt="Logo"
          className="w-9 h-9 object-contain rounded border border-slate-150 bg-white"
          referrerPolicy="no-referrer"
        />
      );
    }

    const iconSize = "w-5 h-5 text-white";
    switch (companyProfile.icon_type) {
      case 'factory':
        return <div className="w-9 h-9 rounded bg-blue-600 flex items-center justify-center shrink-0"><Factory className={iconSize} /></div>;
      case 'cpu':
        return <div className="w-9 h-9 rounded bg-blue-600 flex items-center justify-center shrink-0"><Cpu className={iconSize} /></div>;
      case 'wrench':
        return <div className="w-9 h-9 rounded bg-blue-600 flex items-center justify-center shrink-0"><Wrench className={iconSize} /></div>;
      case 'database':
      default:
        return <div className="w-9 h-9 rounded bg-blue-600 flex items-center justify-center shrink-0"><Database className={iconSize} /></div>;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto print:p-0 print:bg-white print:static">

      {/* Dynamic CSS Injection to handle clean single-page printing fallback */}
      <style dangerouslySetInnerHTML={{
        __html: `
        @media print {
          /* Hide all page backgrounds and standard wrappers */
          html, body {
            background-color: #ffffff !important;
            color: #000000 !important;
            margin: 0 !important;
            padding: 0 !important;
            height: auto !important;
            width: 100% !important;
          }
          /* Hide other interactive app components */
          aside, header, main, nav, .print\\:hidden, [role="dialog"] > div:not(#printable-invoice-container) {
            display: none !important;
            visibility: hidden !important;
          }
          /* Position printable sheet to cover full paper */
          #printable-invoice-container {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            border: none !important;
            box-shadow: none !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            visibility: visible !important;
          }
          #printable-invoice-sheet {
            padding: 0 !important;
            margin: 0 !important;
            border: none !important;
            visibility: visible !important;
          }
          #printable-invoice-sheet * {
            visibility: visible !important;
          }
        }
      `}} />

      {/* Modal Container */}
      <div
        id="printable-invoice-container"
        className="w-full max-w-3xl bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden flex flex-col my-8 animate-in fade-in zoom-in-95 duration-200 print:shadow-none print:border-none print:my-0 print:rounded-none"
      >

        {/* Modal Top Command Bar (Hidden on print) */}
        <div className="p-4 border-b border-slate-100 bg-slate-50 flex flex-col md:flex-row md:items-center md:justify-between gap-4 print:hidden">
          <div className="flex items-center space-x-2">
            <FileText className="w-4 h-4 text-blue-600" />
            <div>
              <span className="font-sans font-bold text-slate-800 text-xs uppercase tracking-wider block leading-none">Automated Sales Invoice</span>
              <span className="text-[10px] text-slate-400 mt-0.5 block">Configure print options and finalize document</span>
            </div>
          </div>

          {/* Controls to toggle Signature */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center space-x-2 bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 shadow-sm cursor-pointer hover:bg-slate-50 transition-all text-[11px] font-sans font-medium text-slate-600 select-none">
              <input
                type="checkbox"
                checked={showSignature}
                onChange={(e) => setShowSignature(e.target.checked)}
                className="w-3.5 h-3.5 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
              />
              <span>Add Signature</span>
            </label>

            <div className="h-6 w-px bg-slate-200 hidden md:block"></div>

            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center space-x-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-all hover:shadow cursor-pointer"
              title="Print standard copy"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Invoice</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-500 hover:text-slate-700 transition-colors"
              title="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Printable Sheet Area */}
        <div className="p-8 space-y-8 text-xs text-slate-600 print:p-0 font-sans bg-white" id="printable-invoice-sheet">

          {/* Invoice Header */}
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-6 border-b border-slate-100 pb-6">
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                {renderLogo()}
                <div>
                  <h2 className="font-sans font-extrabold text-slate-900 text-base tracking-tight">{companyProfile.name}</h2>
                  <span className="text-[8px] text-slate-400 font-mono font-bold tracking-widest uppercase">REG NO: 202601048292 (159421-P)</span>
                </div>
              </div>

              {/* Dynamic Company Contact Details */}
              <div className="text-[10px] text-slate-400 font-sans space-y-0.5">
                <p className="flex items-start space-x-1.5 max-w-[340px]">
                  <MapPin className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
                  <span>{companyProfile.address || 'Lot 102, Kawasan Perindustrian Balakong, 43300 Selangor, Malaysia'}</span>
                </p>
                <p className="flex items-center space-x-1.5">
                  <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                  <span>{companyProfile.phone || '+60 3-8012 3456'}</span>
                </p>
                <p className="flex items-center space-x-1.5">
                  <Mail className="w-3 h-3 text-slate-400 shrink-0" />
                  <span>{companyProfile.email || 'finance@sengjie.com.my'}</span>
                </p>
              </div>
            </div>

            {/* Document Metadata block */}
            <div className="text-left sm:text-right space-y-1 sm:min-w-[180px]">
              <h1 className="font-sans font-black text-slate-900 text-xl tracking-tight uppercase print:text-2xl">TAX INVOICE</h1>
              <div className="space-y-0.5 text-[10px] font-mono text-slate-500">
                <p><span className="font-bold text-slate-700">Invoice No:</span> {invoiceNo}</p>
                <p><span className="font-bold text-slate-700">Issue Date:</span> {order.orderDate}</p>
                <p><span className="font-bold text-slate-700">Due Date:</span> {order.deliveryDate}</p>
                <p><span className="font-bold text-slate-700">Status:</span> <span className="text-emerald-700 font-bold uppercase">{order.status}</span></p>
              </div>
            </div>
          </div>

          {/* Billing & Client information */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 bg-slate-50/70 rounded-xl p-4 border border-slate-100 print:bg-white print:border-none print:p-0">
            <div>
              <span className="text-[9px] font-bold text-slate-400 uppercase font-mono block mb-1">BILL TO CLIENT</span>
              <h3 className="font-sans font-bold text-slate-900 text-xs">{order.clientName}</h3>
              {clientDetails ? (
                <div className="text-[10px] text-slate-500 space-y-0.5 mt-1 leading-relaxed">
                  <p className="max-w-[250px]">{clientDetails.address}</p>
                  <p className="font-mono">{clientDetails.officeNo}</p>
                  <p className="font-mono">{clientDetails.email}</p>
                </div>
              ) : (
                <p className="text-[10px] text-slate-400 mt-1 italic">Client metadata directory match not available.</p>
              )}
            </div>

            <div className="flex flex-col justify-between sm:text-right">
              <div>
                <span className="text-[9px] font-bold text-slate-400 uppercase font-mono block mb-1">PAYMENT DETAILS</span>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Payment is requested within 14 business days from issuance. Payments must be wired to the bank wire coordinates below:
                </p>
              </div>
              <div className="text-[9px] font-mono text-slate-450 mt-2 space-y-0.5">
                <p><span className="font-bold text-slate-600">Bank:</span> {companyProfile.bank_name || 'Maybank Berhad (Kuala Lumpur)'}</p>
                <p><span className="font-bold text-slate-600">A/C:</span> {companyProfile.bank_account || '5142-8821-3956'}</p>
                <p><span className="font-bold text-slate-600">SWIFT:</span> MBBBMYKLXXX</p>
              </div>
            </div>
          </div>

          {/* Line Items Table */}
          <div className="space-y-2">
            <span className="text-[9px] font-bold text-slate-400 uppercase font-mono block">CONTRACT LINE ITEMS</span>
            <div className="border border-slate-200 rounded-lg overflow-hidden print:border-slate-300">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-500 uppercase font-mono tracking-wider text-[9px] print:bg-slate-50">
                    <th className="p-3">#</th>
                    <th className="p-3">Description & Specifications</th>
                    <th className="p-3 text-right">Quantity</th>
                    <th className="p-3 text-right">Unit Price</th>
                    <th className="p-3 text-right">Amount (RM)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 print:divide-slate-200">
                  {order.details.map((item, idx) => (
                    <tr key={item.detailId || idx}>
                      <td className="p-3 font-mono text-slate-400">{String(idx + 1).padStart(2, '0')}</td>
                      <td className="p-3 font-semibold text-slate-800">
                        <div>{item.productName}</div>
                        <span className="text-[9px] text-slate-400 font-normal">Finished product. Code: {item.productCode || item.productId}</span>
                      </td>
                      <td className="p-3 text-right font-mono">{item.quantity} pcs</td>
                      <td className="p-3 text-right font-mono">RM {item.unitPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right font-mono font-semibold text-slate-900">RM {item.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Financial Totals block */}
          <div className="flex flex-col sm:flex-row sm:justify-between items-start gap-4 pt-4 border-t border-slate-100">
            <div className="max-w-[340px] text-[10px] text-slate-400 leading-relaxed">
              <span className="font-bold text-slate-500 block mb-1">INVOICE DECLARATION</span>
              <p>
                This invoice serves as a binding commercial statement. Goods remain the property of {companyProfile.name} until full settlement is cleared. All values expressed in Malaysian Ringgit (MYR).
              </p>
            </div>

            <div className="w-full sm:w-[260px] text-right font-mono text-[10px] space-y-1.5 border-t sm:border-t-0 pt-3 sm:pt-0">
              <div className="flex justify-between">
                <span className="text-slate-400">SUBTOTAL</span>
                <span className="text-slate-700 font-semibold">RM {subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">SALES TAX (SST 6%)</span>
                <span className="text-slate-700 font-semibold">RM {sstTax.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-100 font-sans text-xs">
                <span className="font-bold text-slate-800 uppercase">GRAND TOTAL DUE</span>
                <span className="font-mono font-black text-blue-700">RM {grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>

          {/* Dynamic Signatures section (Cleaned according to requirements) */}
          <div className="flex justify-start pt-8 border-t border-slate-100 items-end">

            {/* Signature Area */}
            <div className="flex flex-col items-center justify-end text-center min-h-[110px] w-48">
              {showSignature ? (
                companyProfile.signature_url ? (
                  <img
                    src={companyProfile.signature_url}
                    alt="Authorized Signature"
                    className="h-14 max-w-[140px] object-contain mb-2 print:max-h-14"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  /* Elegant digital signature cursive fallback */
                  <div className="mb-2 h-14 flex flex-col items-center justify-center select-none">
                    <span className="font-serif italic text-base text-blue-800 font-bold tracking-wider leading-none">
                      {companyProfile.name.split(' ').map(n => n[0]).join('') || 'SJE'}
                    </span>
                    <span className="text-[8px] text-slate-400 font-sans mt-1">Digitally Sealed</span>
                  </div>
                )
              ) : (
                <div className="h-14 mb-2"></div>
              )}
              <div className="w-32 border-b border-slate-300 mb-1.5"></div>
              <span className="font-bold text-slate-700 text-[10px]">Authorized Signature</span>
            </div>

          </div>

        </div>

      </div>

    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run lint`
Expected: exits 0. (`OrdersView.tsx` may still error until Task 5 — confirm no errors reported inside `InvoiceModal.tsx` itself.)

- [ ] **Step 3: Commit**

```bash
git add src/components/InvoiceModal.tsx
git commit -m "feat: retarget InvoiceModal from legacy SalesOrder to SalesHeader/SalesDetail"
```

---

### Task 5: `src/components/OrdersView.tsx` — rewrite with Quotation/Sales Order tabs

**Files:**
- Modify: `src/components/OrdersView.tsx` (full rewrite in place, same `ORDERS` tab entry point)

**Interfaces:**
- Consumes: everything exported by Task 2's `OrdersService.ts`, `ProductService.getProducts(search): Promise<Product[]>` (existing), `MaterialService.getMaterials(search): Promise<Material[]>` (existing), `SystemAdminService.getMaterialCategories(): Promise<MaterialCategory[]>` (existing), `ContactsService.getClients(search): Promise<Client[]>` (existing), `SalesQuotationModal` (Task 3), `InvoiceModal` (Task 4), `SalesHeader` (Task 1).
- Produces: `export default function OrdersView()` — no props (`App.tsx:484` already renders `<OrdersView key={refreshKey} />` with no props, so no caller needs updating).

- [ ] **Step 1: Replace the full file contents**

```tsx
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  getSalesOrders, createSalesQuotation, updateSalesOrder, convertToSalesOrder,
  markDelivered, cancelSalesOrder, deleteSalesOrder,
  SalesDetailInput, MaterialUsageInput,
} from '../services/OrdersService';
import { getProducts } from '../services/ProductService';
import { getMaterials } from '../services/MaterialService';
import { getMaterialCategories } from '../services/SystemAdminService';
import { getClients } from '../services/ContactsService';
import { SalesHeader, Client, Product, Material, MaterialCategory, Attachment } from '../types';
import { Plus, Calendar, Check, Paperclip, Trash2, Edit, FileText, ArrowRightCircle } from 'lucide-react';
import AttachmentSection from './AttachmentSection';
import SalesQuotationModal from './SalesQuotationModal';
import InvoiceModal from './InvoiceModal';
import LoadingSpinner from './LoadingSpinner';
import ComboBox from './ComboBox';
import { Dialog, DialogFooter, DialogCancelButton, DialogSubmitButton, Card, FormField, SearchInput } from './ui';
import { CallAPI } from './UIHelper';

type OrderTab = 'QUOTATION' | 'SO';
type FormMode = 'CREATE' | 'EDIT' | 'CONVERT';

export default function OrdersView() {
  const [activeTab, setActiveTab] = useState<OrderTab>('QUOTATION');
  const [searchQuery, setSearchQuery] = useState('');
  const [orders, setOrders] = useState<SalesHeader[]>([]);
  const [loading, setLoading] = useState(true);

  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialCategories, setMaterialCategories] = useState<MaterialCategory[]>([]);
  const [deliveringId, setDeliveringId] = useState<string | null>(null);

  useEffect(() => {
    getClients().then(setClients).catch(console.error);
    getProducts().then(setProducts).catch(console.error);
    getMaterials().then(setMaterials).catch(console.error);
    CallAPI(getMaterialCategories, { onCompleted: setMaterialCategories, onError: console.error });
  }, []);

  const activeProducts = useMemo(
    () => products.filter(p => p.status !== 'INACTIVE'),
    [products]
  );

  const rawMaterials = useMemo(
    () => materials.filter(m => m.materialType === 'RAW_MATERIAL' && m.status !== 'INACTIVE'),
    [materials]
  );

  const materialCategoryMap = useMemo(
    () => new Map(materialCategories.map(c => [c.id, c])),
    [materialCategories]
  );

  const loadOrders = (tab: OrderTab, search = searchQuery) => {
    setLoading(true);
    CallAPI(() => getSalesOrders(tab === 'QUOTATION' ? 'QUOTATION' : 'SO', search), {
      onCompleted: (data) => { setOrders(data); setLoading(false); },
      onError: (err) => { console.error(err); setLoading(false); },
    });
  };

  useEffect(() => { setSearchQuery(''); loadOrders(activeTab, ''); }, [activeTab]);

  useEffect(() => {
    const t = setTimeout(() => loadOrders(activeTab, searchQuery), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  // Quotation print modal
  const [selectedQuotation, setSelectedQuotation] = useState<SalesHeader | null>(null);
  const [isQuotationModalOpen, setIsQuotationModalOpen] = useState(false);

  // Tax invoice print modal
  const [selectedInvoiceOrder, setSelectedInvoiceOrder] = useState<SalesHeader | null>(null);
  const [isInvoiceOpen, setIsInvoiceOpen] = useState(false);

  // Form dialog state
  const [showFormDialog, setShowFormDialog] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>('CREATE');
  const [editHeaderId, setEditHeaderId] = useState<string | null>(null);
  const [formClientId, setFormClientId] = useState('');
  const [formDeliveryDate, setFormDeliveryDate] = useState('');
  const [formRemark, setFormRemark] = useState('');
  const [formDetails, setFormDetails] = useState<SalesDetailInput[]>([]);
  const [tempProductId, setTempProductId] = useState('');
  const [tempQuantity, setTempQuantity] = useState(1);
  const [tempUnitPrice, setTempUnitPrice] = useState(0);
  const [tempMaterials, setTempMaterials] = useState<MaterialUsageInput[]>([]);
  const [tempMaterialId, setTempMaterialId] = useState('');
  const [tempMaterialQty, setTempMaterialQty] = useState(1);
  const [formAttachment, setFormAttachment] = useState<Attachment | undefined>(undefined);

  // Clears the pending (not-yet-committed) product+material staging fields.
  // Mirrors PurchasesView.tsx's clearTempMaterials — without this, values
  // typed into the "add item" panel leak into the next form open.
  const clearTempStaging = () => {
    setTempProductId('');
    setTempQuantity(1);
    setTempUnitPrice(0);
    setTempMaterials([]);
    setTempMaterialId('');
    setTempMaterialQty(1);
  };

  const resetForm = () => {
    setEditHeaderId(null);
    setFormClientId('');
    setFormDeliveryDate('');
    setFormRemark('');
    setFormDetails([]);
    setFormAttachment(undefined);
    clearTempStaging();
  };

  const todayStr = () => new Date().toISOString().split('T')[0];
  const defaultDeliveryDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().split('T')[0];
  };

  const openCreateForm = () => {
    resetForm();
    setFormMode('CREATE');
    setShowFormDialog(true);
  };

  const detailsFromHeader = (order: SalesHeader): SalesDetailInput[] =>
    order.details.map(d => ({
      productId: d.productId,
      productName: d.productName,
      productCode: d.productCode,
      quantity: d.quantity,
      unitPrice: d.unitPrice,
      totalPrice: d.totalPrice,
      materials: d.materials.map(m => ({
        materialId: m.materialId,
        materialName: m.materialName,
        materialCode: m.materialCode,
        plannedQuantity: m.plannedQuantity,
      })),
    }));

  const openEditForm = (order: SalesHeader) => {
    clearTempStaging();
    setFormMode('EDIT');
    setEditHeaderId(order.id);
    setFormClientId(order.clientId);
    setFormRemark(order.remark || '');
    setFormAttachment(order.attachments?.[0]);
    setFormDetails(detailsFromHeader(order));
    setShowFormDialog(true);
  };

  const openConvertForm = (order: SalesHeader) => {
    clearTempStaging();
    setFormMode('CONVERT');
    setEditHeaderId(order.id);
    setFormClientId(order.clientId);
    setFormRemark(order.remark || '');
    setFormAttachment(order.attachments?.[0]);
    setFormDetails(detailsFromHeader(order));
    setFormDeliveryDate(defaultDeliveryDate());
    setShowFormDialog(true);
  };

  // Product catalog rows carry a sellingPrice, so selecting a product
  // prefills the quoted unit price — the seller can still override it.
  const handleProductSelect = (productId: string) => {
    setTempProductId(productId);
    const product = activeProducts.find(p => p.id === productId);
    if (product) setTempUnitPrice(product.sellingPrice);
  };

  const handleAddTempMaterial = () => {
    if (!tempMaterialId || tempMaterialQty <= 0) return;
    const material = rawMaterials.find(m => m.id === tempMaterialId);
    if (!material) return;

    const existingIdx = tempMaterials.findIndex(m => m.materialId === tempMaterialId);
    if (existingIdx !== -1) {
      const updated = [...tempMaterials];
      updated[existingIdx].plannedQuantity += tempMaterialQty;
      setTempMaterials(updated);
    } else {
      setTempMaterials([...tempMaterials, {
        materialId: tempMaterialId,
        materialName: material.name,
        materialCode: material.code,
        plannedQuantity: tempMaterialQty,
      }]);
    }

    setTempMaterialId('');
    setTempMaterialQty(1);
  };

  const handleRemoveTempMaterial = (index: number) => {
    setTempMaterials(tempMaterials.filter((_, idx) => idx !== index));
  };

  const handleAddTempItem = () => {
    if (!tempProductId || tempQuantity <= 0) return;
    const product = activeProducts.find(p => p.id === tempProductId);
    if (!product) return;

    setFormDetails([...formDetails, {
      productId: tempProductId,
      productName: product.name,
      productCode: product.code,
      quantity: tempQuantity,
      unitPrice: tempUnitPrice,
      totalPrice: tempQuantity * tempUnitPrice,
      materials: tempMaterials,
    }]);

    setTempProductId('');
    setTempQuantity(1);
    setTempUnitPrice(0);
    setTempMaterials([]);
    setTempMaterialId('');
    setTempMaterialQty(1);
  };

  const handleRemoveFormItem = (index: number) => {
    setFormDetails(formDetails.filter((_, idx) => idx !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formClientId) return;

    // Check if there's a pending product line selected but not added yet, and
    // automatically add it (same convention as the material-add panel in
    // PurchasesView.tsx).
    let finalDetails = [...formDetails];
    if (tempProductId && tempQuantity > 0) {
      const product = activeProducts.find(p => p.id === tempProductId);
      if (product) {
        finalDetails.push({
          productId: tempProductId,
          productName: product.name,
          productCode: product.code,
          quantity: tempQuantity,
          unitPrice: tempUnitPrice,
          totalPrice: tempQuantity * tempUnitPrice,
          materials: tempMaterials,
        });
      }
    }

    if (finalDetails.length === 0) {
      alert('Please add at least one product item to this sales contract.');
      return;
    }

    const input = {
      clientId: formClientId,
      remark: formRemark || undefined,
      attachments: formAttachment ? [formAttachment] : [],
      details: finalDetails,
    };

    if (formMode === 'CREATE') {
      await CallAPI(() => createSalesQuotation(input), {
        onCompleted: () => loadOrders(activeTab),
        onError: console.error,
      });
    } else if (formMode === 'EDIT' && editHeaderId) {
      await CallAPI(() => updateSalesOrder(editHeaderId, input), {
        onCompleted: () => loadOrders(activeTab),
        onError: console.error,
      });
    } else if (formMode === 'CONVERT' && editHeaderId) {
      await CallAPI(() => convertToSalesOrder(editHeaderId, input, formDeliveryDate || defaultDeliveryDate()), {
        onCompleted: () => loadOrders(activeTab),
        onError: console.error,
      });
    }

    setShowFormDialog(false);
    resetForm();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this sales order?')) return;
    await CallAPI(() => deleteSalesOrder(id), {
      onCompleted: () => loadOrders(activeTab),
      onError: console.error,
    });
  };

  const handleMarkDelivered = async (id: string) => {
    if (deliveringId === id) return;
    setDeliveringId(id);
    await CallAPI(() => markDelivered(id), {
      onCompleted: () => {
        setDeliveringId(null);
        loadOrders(activeTab);
      },
      onError: (err) => {
        setDeliveringId(null);
        console.error(err);
      },
    });
  };

  const handleCancel = async (id: string) => {
    if (!confirm('Cancel this Sales Order?')) return;
    await CallAPI(() => cancelSalesOrder(id), {
      onCompleted: () => loadOrders(activeTab),
      onError: console.error,
    });
  };

  const openQuotationDoc = (order: SalesHeader) => {
    setSelectedQuotation(order);
    setIsQuotationModalOpen(true);
  };

  const openInvoiceDoc = (order: SalesHeader) => {
    setSelectedInvoiceOrder(order);
    setIsInvoiceOpen(true);
  };

  const dialogTitle = formMode === 'CREATE' ? 'Create Sales Quotation'
    : formMode === 'EDIT' ? 'Edit Sales Quotation'
    : 'Confirm Sales Order';

  const submitLabel = formMode === 'CREATE' ? 'Save Quotation'
    : formMode === 'EDIT' ? 'Update Quotation'
    : 'Confirm Sales Order';

  if (loading) {
    return <LoadingSpinner message="Processing sales contracts..." subtitle="SALES_CONTRACTS" />;
  }

  return (
    <div className="space-y-6" id="orders-view">

      {/* Tab toggle + search + actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex space-x-1 p-1 bg-slate-100 rounded-lg border border-slate-200/50 self-start">
          <button
            onClick={() => setActiveTab('QUOTATION')}
            className={`px-4 py-1.5 text-xs font-medium rounded-md font-sans transition-all ${activeTab === 'QUOTATION' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            Quotation
          </button>
          <button
            onClick={() => setActiveTab('SO')}
            className={`px-4 py-1.5 text-xs font-medium rounded-md font-sans transition-all ${activeTab === 'SO' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            Sales Order
          </button>
        </div>

        <div className="flex items-center space-x-2">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search by client or reference no..."
          />
          {activeTab === 'QUOTATION' && (
            <button
              onClick={openCreateForm}
              className="flex items-center space-x-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors font-sans shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>New Quotation</span>
            </button>
          )}
        </div>
      </div>

      {/* Creation/Edit/Convert form as Dialog Modal */}
      <Dialog
        open={showFormDialog}
        onClose={() => { clearTempStaging(); setShowFormDialog(false); }}
        title={dialogTitle}
      >
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-slate-600">

            <FormField label="Client Company *" labelClassName="font-semibold block text-slate-700" colSpan="sm:col-span-2">
              <ComboBox
                required
                value={formClientId}
                onChange={setFormClientId}
                noneLabel="-- Select Client --"
                options={clients.map(c => ({ value: c.id, label: c.companyName, sublabel: c.officeNo || c.email }))}
              />
            </FormField>

            {formMode === 'CONVERT' && (
              <FormField label="Delivery Date *" labelClassName="font-semibold block text-slate-700" colSpan="sm:col-span-2">
                <input
                  type="date"
                  required
                  value={formDeliveryDate}
                  onChange={(e) => setFormDeliveryDate(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800"
                />
              </FormField>
            )}

            {/* Contract Line Items (products, each with its own nested material list) */}
            <div className="sm:col-span-2 border border-slate-150 rounded-lg p-3 bg-slate-50/50 space-y-2">
              <span className="font-semibold block text-slate-700 text-xs">Contract Line Items ({formDetails.length})</span>
              {formDetails.length === 0 ? (
                <div className="text-center py-4 text-slate-400 border border-dashed border-slate-200 rounded-lg bg-white text-[11px]">
                  No items added yet. Specify product details below to add items to this contract.
                </div>
              ) : (
                <div className="space-y-2">
                  {formDetails.map((item, idx) => (
                    <div key={idx} className="border border-slate-200 rounded-lg bg-white p-2.5">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-semibold text-slate-800 text-[11px]">{item.productName}</span>
                          <div className="text-[10px] text-slate-400 font-mono">
                            Qty: {item.quantity} @ RM {item.unitPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} = RM {item.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        </div>
                        <button type="button" onClick={() => handleRemoveFormItem(idx)} className="text-red-500 hover:text-red-700 p-1" title="Remove line item">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {item.materials.length > 0 && (
                        <div className="mt-2 pl-3 border-l-2 border-slate-100 space-y-0.5">
                          {item.materials.map((m, midx) => (
                            <div key={midx} className="text-[10px] text-slate-500 font-mono">
                              {m.materialName} — planned {m.plannedQuantity}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Inline Add Product Panel */}
            <div className="sm:col-span-2 border border-blue-100 rounded-lg p-4 bg-blue-50/20 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <FormField
                label="Product Selection"
                labelClassName="font-semibold block text-slate-700 text-[10px] uppercase tracking-wider"
                colSpan="sm:col-span-6"
              >
                <ComboBox
                  value={tempProductId}
                  onChange={handleProductSelect}
                  noneLabel="-- Choose Product --"
                  options={activeProducts.map(p => ({ value: p.id, label: p.name, sublabel: `RM ${p.sellingPrice.toLocaleString('en-US')}` }))}
                />
              </FormField>

              <FormField
                label="Quantity"
                labelClassName="font-semibold block text-slate-700 text-[10px] uppercase tracking-wider"
                colSpan="sm:col-span-2"
              >
                <input
                  type="number"
                  min="1"
                  value={tempQuantity}
                  onChange={(e) => setTempQuantity(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none text-xs text-slate-800"
                />
              </FormField>

              <FormField
                label="Unit Price (RM)"
                labelClassName="font-semibold block text-slate-700 text-[10px] uppercase tracking-wider"
                colSpan="sm:col-span-2"
              >
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={tempUnitPrice}
                  onChange={(e) => setTempUnitPrice(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none text-xs text-slate-800"
                />
              </FormField>

              {/* Materials for this line — staged until "+ Add Item" commits the whole line */}
              <div className="sm:col-span-12 border border-emerald-100 rounded-lg p-3 bg-emerald-50/20 space-y-2">
                <span className="font-semibold block text-slate-700 text-[10px] uppercase tracking-wider">Materials for this line ({tempMaterials.length})</span>
                {tempMaterials.length > 0 && (
                  <div className="space-y-1">
                    {tempMaterials.map((m, midx) => (
                      <div key={midx} className="flex items-center justify-between bg-white border border-slate-200 rounded px-2 py-1">
                        <span className="text-[10px] text-slate-700">{m.materialName} — planned {m.plannedQuantity}</span>
                        <button type="button" onClick={() => handleRemoveTempMaterial(midx)} className="text-red-500 hover:text-red-700 p-0.5" title="Remove material">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                  <div className="sm:col-span-7">
                    <ComboBox
                      value={tempMaterialId}
                      onChange={setTempMaterialId}
                      noneLabel="-- Choose Material --"
                      options={rawMaterials.map(m => {
                        const category = materialCategoryMap.get(m.materialCategoryId || '');
                        return { value: m.id, label: m.name, sublabel: category ? category.name : `Stock: ${m.quantity}` };
                      })}
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <input
                      type="number"
                      min="1"
                      value={tempMaterialQty}
                      onChange={(e) => setTempMaterialQty(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none text-xs text-slate-800"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <button
                      type="button"
                      onClick={handleAddTempMaterial}
                      disabled={!tempMaterialId || tempMaterialQty <= 0}
                      className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-semibold transition-colors shadow-sm disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
                    >
                      + Add
                    </button>
                  </div>
                </div>
              </div>

              <div className="sm:col-span-12">
                <button
                  type="button"
                  onClick={handleAddTempItem}
                  disabled={!tempProductId || tempQuantity <= 0}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-semibold transition-colors shadow-sm disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
                >
                  + Add Item
                </button>
              </div>
            </div>

            {/* Subtotals Block */}
            <div className="bg-blue-50/70 border border-blue-100 rounded-lg p-3 sm:col-span-2 flex items-center justify-between">
              <div>
                <span className="font-semibold block text-[11px] text-blue-900">Projected Sales Contract Value:</span>
                <span className="text-[10px] text-blue-700">Calculated sum of all added items on this sales contract.</span>
              </div>
              <div className="font-mono text-base font-bold text-blue-900">
                RM {Math.max(0, formDetails.reduce((sum, item) => sum + item.totalPrice, 0) + (tempProductId && tempQuantity > 0 ? tempQuantity * tempUnitPrice : 0)).toLocaleString('en-US')}
              </div>
            </div>

            <FormField label="Remark (Optional)" labelClassName="font-semibold block text-slate-700" colSpan="sm:col-span-2">
              <textarea
                value={formRemark}
                onChange={(e) => setFormRemark(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800"
              />
            </FormField>

            <div className="sm:col-span-2">
              <AttachmentSection
                attachment={formAttachment}
                onAttachmentChange={setFormAttachment}
                label="Signed Contract or Specifications Doc (Optional)"
                helperText="Upload any business contract, product details, or custom design spec (Max 1MB)"
              />
            </div>

          </div>
          <DialogFooter>
            <DialogCancelButton onClick={() => { clearTempStaging(); setShowFormDialog(false); }} />
            <DialogSubmitButton>{submitLabel}</DialogSubmitButton>
          </DialogFooter>
        </form>
      </Dialog>

      {/* Orders Listing Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 uppercase font-mono tracking-wider dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-400">
                <th className="p-4">Contract ID</th>
                <th className="p-4">Client</th>
                <th className="p-4">Product & Quantity</th>
                <th className="p-4">{activeTab === 'QUOTATION' ? 'Order Date' : 'Delivery Due'}</th>
                <th className="p-4">Contract Total</th>
                {activeTab === 'SO' && <th className="p-4">Status</th>}
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={activeTab === 'SO' ? 7 : 6} className="text-center py-12 text-xs text-slate-400 font-sans">
                    No {activeTab === 'QUOTATION' ? 'quotations' : 'sales orders'} found matching your search.
                  </td>
                </tr>
              ) : (
                orders.map((order) => (
                  <tr key={order.id} className="group hover:bg-slate-50/50 transition-colors">

                    {/* Contract ID */}
                    <td className="p-4 font-mono font-semibold text-slate-900">{order.salesNo}</td>

                    {/* Client Company */}
                    <td className="p-4 font-semibold text-slate-900">{order.clientName}</td>

                    {/* Product & Qty */}
                    <td className="p-4">
                      <div className="space-y-1">
                        <div className="space-y-1 max-w-xs">
                          {order.details.map((item, idx) => (
                            <div key={item.detailId || idx} className="flex flex-col border-b border-slate-100 last:border-none pb-1 last:pb-0">
                              <span className="font-semibold text-slate-800">{item.productName}</span>
                              <span className="text-[10px] text-slate-400 font-mono text-slate-500">
                                Qty: {item.quantity} {item.quantity > 1 ? 'units' : 'unit'} @ RM {item.unitPrice}
                              </span>
                            </div>
                          ))}
                        </div>
                        {order.attachments?.[0] && (
                          <div className="pt-1.5 flex items-center">
                            <a
                              href={order.attachments[0].dataUrl}
                              download={order.attachments[0].name}
                              className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-[10px] font-mono transition-colors"
                              title="Download attachment"
                            >
                              <Paperclip className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                              <span className="truncate max-w-[120px]">{order.attachments[0].name}</span>
                            </a>
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Date */}
                    <td className="p-4">
                      <div className="flex items-center space-x-1.5 text-slate-600 font-mono text-[11px]">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        <span>{activeTab === 'QUOTATION' ? order.orderDate : order.deliveryDate}</span>
                      </div>
                    </td>

                    {/* Contract Value */}
                    <td className="p-4 font-mono font-semibold text-slate-900">
                      RM {order.totalAmount.toLocaleString('en-US')}
                    </td>

                    {/* Status Badge */}
                    {activeTab === 'SO' && (
                      <td className="p-4">
                        <span className={`px-2.5 py-1 rounded-full font-mono text-[10px] font-medium border ${
                          order.status === 'ORDERED' ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : order.status === 'DELIVERED' ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : 'bg-red-50 text-red-800 border-red-200'
                        }`}>
                          {order.status === 'ORDERED' ? 'Pending Delivery' : order.status}
                        </span>
                      </td>
                    )}

                    {/* Transition actions */}
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end space-x-1.5">
                        {order.status === 'QUOTATION' && (
                          <>
                            <button onClick={() => openEditForm(order)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded transition-colors" title="Edit">
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleDelete(order.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded transition-colors" title="Delete">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => openQuotationDoc(order)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded transition-colors" title="Generate Quotation">
                              <FileText className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => openConvertForm(order)} className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors" title="Proceed to Sales Order">
                              <ArrowRightCircle className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}

                        {order.status === 'ORDERED' && (
                          <>
                            <button onClick={() => openEditForm(order)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded transition-colors" title="Edit">
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => openInvoiceDoc(order)} title="Generate Tax Invoice" className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded transition-colors">
                              <FileText className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleMarkDelivered(order.id)}
                              disabled={deliveringId === order.id}
                              title="Mark as delivered"
                              className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleCancel(order.id)} className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors text-[10px] font-medium">
                              Cancel
                            </button>
                          </>
                        )}

                        {order.status === 'DELIVERED' && (
                          <>
                            <button onClick={() => openInvoiceDoc(order)} title="Generate Tax Invoice" className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded transition-colors">
                              <FileText className="w-3.5 h-3.5" />
                            </button>
                            <span className="text-[10px] text-emerald-600 font-semibold flex items-center space-x-0.5 font-mono px-1.5">
                              <span>✓ Delivered</span>
                            </span>
                          </>
                        )}

                        {order.status === 'CANCELLED' && (
                          <>
                            <span className="text-[10px] text-slate-400 font-mono italic px-1.5">Cancelled</span>
                            <button onClick={() => handleDelete(order.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded transition-colors" title="Delete">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>

                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Quotation print modal */}
      <SalesQuotationModal
        order={selectedQuotation}
        isOpen={isQuotationModalOpen}
        onClose={() => { setIsQuotationModalOpen(false); setSelectedQuotation(null); }}
      />

      {/* Tax invoice print modal */}
      <InvoiceModal
        order={selectedInvoiceOrder}
        isOpen={isInvoiceOpen}
        onClose={() => {
          setIsInvoiceOpen(false);
          setSelectedInvoiceOrder(null);
        }}
      />

    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run lint`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/OrdersView.tsx
git commit -m "feat: rewrite OrdersView with Quotation/Sales Order tabs"
```

---

### Task 6: `PurchasesService.ts` + `PurchasesView.tsx` — wire optional "Linked Sales Order"

**Files:**
- Modify: `src/services/PurchasesService.ts`
- Modify: `src/components/PurchasesView.tsx`

**Interfaces:**
- Consumes: `PurchaseHeader.salesHeaderId` (Task 1), `OrdersService.getSalesOrdersForLinking(search): Promise<SalesOrderLinkOption[]>` (Task 2).
- Produces: `PurchaseFormInput.salesHeaderId?: string` (new field on the existing type).

- [ ] **Step 1: Add `salesHeaderId` to `PurchaseFormInput` and the header row mapper**

In `src/services/PurchasesService.ts`, `PurchaseFormInput` currently reads (lines 29-33):

```ts
export interface PurchaseFormInput {
  vendorId: string;
  attachments?: Attachment[];
  details: PurchaseDetailInput[];
}
```

Change to:

```ts
export interface PurchaseFormInput {
  vendorId: string;
  salesHeaderId?: string;
  attachments?: Attachment[];
  details: PurchaseDetailInput[];
}
```

In the same file, `mapPurchaseHeaderRow` currently reads (lines 47-61):

```ts
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
```

Change to (adds `salesHeaderId` after `attachments`):

```ts
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
  salesHeaderId: row.sales_header_id || undefined,
  details: (row.purchase_detail || []).map(mapPurchaseDetailRow),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
```

- [ ] **Step 2: Persist `sales_header_id` in the header insert/update payloads**

In `createPurchaseQuotation`, the header insert currently reads:

```ts
  const { error: headerError } = await supabase.from('purchase_header').insert({
    id,
    purchase_no: `PO-${id.slice(0, 8).toUpperCase()}`,
    quotation_date: today,
    status: 'QUOTATION',
    vendor_id: input.vendorId,
    total_price: totalPrice,
    attachments: input.attachments || [],
  });
```

Change to:

```ts
  const { error: headerError } = await supabase.from('purchase_header').insert({
    id,
    purchase_no: `PO-${id.slice(0, 8).toUpperCase()}`,
    quotation_date: today,
    status: 'QUOTATION',
    vendor_id: input.vendorId,
    sales_header_id: input.salesHeaderId || null,
    total_price: totalPrice,
    attachments: input.attachments || [],
  });
```

In `updatePurchase`, the header update currently reads:

```ts
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
```

Change to:

```ts
  const { error } = await supabase
    .from('purchase_header')
    .update({
      vendor_id: input.vendorId,
      sales_header_id: input.salesHeaderId || null,
      total_price: totalPrice,
      attachments: input.attachments || [],
    })
    .eq('id', headerId);
  if (error) {
    console.error('updatePurchase(header)', error);
    throw error;
  }
```

In `convertToPurchaseOrder`, the header update currently reads:

```ts
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
```

Change to:

```ts
  const { error } = await supabase
    .from('purchase_header')
    .update({
      vendor_id: input.vendorId,
      sales_header_id: input.salesHeaderId || null,
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
```

- [ ] **Step 3: Verify**

Run: `npm run lint`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/services/PurchasesService.ts
git commit -m "feat: wire sales_header_id through PurchasesService"
```

- [ ] **Step 5: Add the "Linked Sales Order" picker to `PurchasesView.tsx`**

In `src/components/PurchasesView.tsx`, the imports currently read:

```ts
import { getMaterials } from '../services/MaterialService';
import { getVendors } from '../services/ContactsService';
import { PurchaseHeader, Vendor, Material, Attachment, MaterialCategory } from '../types';
```

Change to:

```ts
import { getMaterials } from '../services/MaterialService';
import { getVendors } from '../services/ContactsService';
import { getSalesOrdersForLinking, SalesOrderLinkOption } from '../services/OrdersService';
import { PurchaseHeader, Vendor, Material, Attachment, MaterialCategory } from '../types';
```

Add a new piece of state next to the existing `materialCategories` state:

```ts
  const [materialCategories, setMaterialCategories] = useState<MaterialCategory[]>([]);
  const [salesLinkOptions, setSalesLinkOptions] = useState<SalesOrderLinkOption[]>([]);
  const [receivingId, setReceivingId] = useState<string | null>(null);
```

Add its fetch to the mount-time `useEffect`, which currently reads:

```ts
  useEffect(() => {
    getVendors().then(setVendors).catch(console.error);
    getMaterials().then(setMaterials).catch(console.error);
    CallAPI(getMaterialCategories, { onCompleted: setMaterialCategories, onError: console.error });
  }, []);
```

Change to:

```ts
  useEffect(() => {
    getVendors().then(setVendors).catch(console.error);
    getMaterials().then(setMaterials).catch(console.error);
    CallAPI(getMaterialCategories, { onCompleted: setMaterialCategories, onError: console.error });
    getSalesOrdersForLinking().then(setSalesLinkOptions).catch(console.error);
  }, []);
```

Add form state next to `formOrderDate`, which currently reads:

```ts
  const [formVendorId, setFormVendorId] = useState('');
  const [formOrderDate, setFormOrderDate] = useState('');
```

Change to:

```ts
  const [formVendorId, setFormVendorId] = useState('');
  const [formOrderDate, setFormOrderDate] = useState('');
  const [formSalesHeaderId, setFormSalesHeaderId] = useState('');
```

Add it to `resetForm`, which currently reads:

```ts
  const resetForm = () => {
    setEditHeaderId(null);
    setFormVendorId('');
    setFormOrderDate('');
    setFormDetails([]);
    setTempMaterialId('');
    setTempQuantity(10);
    setTempUnitCost(0);
    setFormAttachment(undefined);
  };
```

Change to:

```ts
  const resetForm = () => {
    setEditHeaderId(null);
    setFormVendorId('');
    setFormOrderDate('');
    setFormSalesHeaderId('');
    setFormDetails([]);
    setTempMaterialId('');
    setTempQuantity(10);
    setTempUnitCost(0);
    setFormAttachment(undefined);
  };
```

Populate it in `openEditForm`/`openConvertForm`, which currently read:

```ts
  const openEditForm = (purchase: PurchaseHeader) => {
    clearTempMaterials();
    setFormMode('EDIT');
    setEditHeaderId(purchase.id);
    setFormVendorId(purchase.vendorId);
    setFormAttachment(purchase.attachments?.[0]);
    setFormDetails(detailsFromHeader(purchase));
    setShowFormDialog(true);
  };

  const openConvertForm = (purchase: PurchaseHeader) => {
    clearTempMaterials();
    setFormMode('CONVERT');
    setEditHeaderId(purchase.id);
    setFormVendorId(purchase.vendorId);
    setFormAttachment(purchase.attachments?.[0]);
    setFormDetails(detailsFromHeader(purchase));
    setFormOrderDate(todayStr());
    setShowFormDialog(true);
  };
```

Change to:

```ts
  const openEditForm = (purchase: PurchaseHeader) => {
    clearTempMaterials();
    setFormMode('EDIT');
    setEditHeaderId(purchase.id);
    setFormVendorId(purchase.vendorId);
    setFormSalesHeaderId(purchase.salesHeaderId || '');
    setFormAttachment(purchase.attachments?.[0]);
    setFormDetails(detailsFromHeader(purchase));
    setShowFormDialog(true);
  };

  const openConvertForm = (purchase: PurchaseHeader) => {
    clearTempMaterials();
    setFormMode('CONVERT');
    setEditHeaderId(purchase.id);
    setFormVendorId(purchase.vendorId);
    setFormSalesHeaderId(purchase.salesHeaderId || '');
    setFormAttachment(purchase.attachments?.[0]);
    setFormDetails(detailsFromHeader(purchase));
    setFormOrderDate(todayStr());
    setShowFormDialog(true);
  };
```

Include it in the submitted `input`, which currently reads:

```ts
    const input = { vendorId: formVendorId, attachments: formAttachment ? [formAttachment] : [], details: finalDetails };
```

Change to:

```ts
    const input = {
      vendorId: formVendorId,
      salesHeaderId: formSalesHeaderId || undefined,
      attachments: formAttachment ? [formAttachment] : [],
      details: finalDetails,
    };
```

Add the picker to the form JSX, immediately after the "Select Vendor *" `FormField` block, which currently reads:

```tsx
            <FormField label="Select Vendor *" labelClassName="font-semibold block text-slate-700" colSpan="sm:col-span-2">
              <ComboBox
                required
                value={formVendorId}
                onChange={setFormVendorId}
                noneLabel="-- Select Vendor --"
                options={vendors.map(v => ({ value: v.id, label: v.companyName, sublabel: v.officeNo || v.email }))}
              />
            </FormField>

            {formMode === 'CONVERT' && (
```

Change to:

```tsx
            <FormField label="Select Vendor *" labelClassName="font-semibold block text-slate-700" colSpan="sm:col-span-2">
              <ComboBox
                required
                value={formVendorId}
                onChange={setFormVendorId}
                noneLabel="-- Select Vendor --"
                options={vendors.map(v => ({ value: v.id, label: v.companyName, sublabel: v.officeNo || v.email }))}
              />
            </FormField>

            <FormField label="Linked Sales Order (Optional)" labelClassName="font-semibold block text-slate-700" colSpan="sm:col-span-2">
              <ComboBox
                value={formSalesHeaderId}
                onChange={setFormSalesHeaderId}
                noneLabel="-- No Linked Sales Order --"
                options={salesLinkOptions.map(s => ({ value: s.id, label: s.salesNo, sublabel: s.clientName }))}
              />
            </FormField>

            {formMode === 'CONVERT' && (
```

- [ ] **Step 6: Verify**

Run: `npm run lint`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/PurchasesView.tsx
git commit -m "feat: add optional Linked Sales Order picker to PurchasesView"
```

---

### Task 7: `supabase/schema.sql` — confirm no new SQL is needed

**Files:**
- No file changes (schema already committed in a prior session's diff — this task is a verification step, not a code change).

**Interfaces:**
- Consumes: `supabase/schema.sql` (already has `sales_header`, `sales_detail`, `production_material_usage`, and `purchase_header.sales_header_id`/`purchase_detail.sales_detail_id` — confirmed during brainstorming).

- [ ] **Step 1: Confirm the tables and FK this plan depends on already exist**

This plan only adds TypeScript types and service/view code — no ALTER TABLE is required.

Run: `grep -n "CREATE TABLE sales_header\|CREATE TABLE sales_detail\|CREATE TABLE production_material_usage\|sales_header_id" supabase/schema.sql`
Expected: matches for `sales_header` (table definition), `sales_detail` (table definition), `production_material_usage` (table definition), and `purchase_header.sales_header_id` (the `ALTER TABLE purchase_header ADD COLUMN sales_header_id ...` statement).

- [ ] **Step 2: No commit needed for this task** (no file changes).

---

### Task 8: Update `knowledge.md` + manual QA checklist

**Files:**
- Modify: `knowledge.md`

**Interfaces:**
- None (documentation only).

- [ ] **Step 1: Update the pattern-A description line (around line 21)**

Find:

```
**A. Module-owned service (preferred, direct-to-Supabase)** — `CompanyProfileService.ts`, `SystemAdminService.ts`, `ContactsService.ts`, `MaterialService.ts`, `ProductService.ts`, `InventoryTransactionService.ts`, `PurchasesService.ts`.
```

Replace with:

```
**A. Module-owned service (preferred, direct-to-Supabase)** — `CompanyProfileService.ts`, `SystemAdminService.ts`, `ContactsService.ts`, `MaterialService.ts`, `ProductService.ts`, `InventoryTransactionService.ts`, `PurchasesService.ts`, `OrdersService.ts`.
```

- [ ] **Step 2: Update the pattern-B list (around line 27)**

Find:

```
**B. Legacy REST hook** — `useTableData<T>('table_name')` (in `hooks/useTableData.ts`) calls `server.ts`'s `GET /api/data/:table?q=&<filterCol>=`, which runs the query server-side via a second Supabase client. Writes still go through `db.ts`'s per-table `save*`/localStorage-array functions. Still used by `OrdersView`, `EmployeesView`, `ReportsView`, `ImportExportModal` (bulk backup). Don't add new dependents; migrate a view to pattern A when you next touch it.
```

Replace with:

```
**B. Legacy REST hook** — `useTableData<T>('table_name')` (in `hooks/useTableData.ts`) calls `server.ts`'s `GET /api/data/:table?q=&<filterCol>=`, which runs the query server-side via a second Supabase client. Writes still go through `db.ts`'s per-table `save*`/localStorage-array functions. Still used by `EmployeesView`, `ReportsView`, `ImportExportModal` (bulk backup). Don't add new dependents; migrate a view to pattern A when you next touch it.
```

- [ ] **Step 3: Update the Project Structure tree's one-liners (around lines 45-46, 52)**

Find:

```
│   ├── OrdersView.tsx (sales orders)
│   ├── PurchasesView.tsx (purchase orders)
│   ├── WorkflowsView.tsx (production tasks)
│   ├── EmployeesView.tsx
│   ├── SystemAdminView.tsx   # Job Position / Material Category / Product Category reference data
│   ├── ReportsView.tsx
│   ├── ImportExportModal.tsx (Excel import/export)
│   ├── InvoiceModal.tsx
```

Replace with:

```
│   ├── OrdersView.tsx        # Quotation → Sales Order workflow over sales_header/sales_detail
│   ├── PurchasesView.tsx     # Quotation → Purchase Order workflow over purchase_header/purchase_detail
│   ├── WorkflowsView.tsx (production tasks)
│   ├── EmployeesView.tsx
│   ├── SystemAdminView.tsx   # Job Position / Material Category / Product Category reference data
│   ├── ReportsView.tsx
│   ├── ImportExportModal.tsx (Excel import/export)
│   ├── InvoiceModal.tsx      # Tax invoice print doc (SalesHeader/SalesDetail)
│   ├── SalesQuotationModal.tsx  # Client-facing sales quotation print doc
│   ├── QuotationModal.tsx    # Vendor-facing purchase quotation print doc
```

- [ ] **Step 4: Update the services list under Project Structure (around line 71)**

Find:

```
    ├── OrdersService.ts          # Thin re-export wrapper over db.ts (pattern B)
```

Replace with:

```
    ├── OrdersService.ts          # Pattern A; sales_header/sales_detail/production_material_usage quotation-to-SO workflow
```

- [ ] **Step 5: Document the new pattern-A types under Key Data Types (around line 100, after `WorkflowTask`)**

Find:

```
- **SalesOrder**: clientId, itemId, qty, unitPrice, totalPrice, orderDate, deliveryDate, status (PENDING|IN_PRODUCTION|SHIPPED|DELIVERED|CANCELLED), workflowTaskId, items[]
- **PurchaseOrder**: vendorId, itemId, qty, unitCost, totalCost, orderDate, status (DRAFT|ORDERED|RECEIVED|CANCELLED), items[]
- **WorkflowTask**: orderId, productName, qty, currentStep (PREPARATION|ASSEMBLY|QUALITY_CONTROL|PACKAGING|COMPLETED), assignedTo, dates, notes
```

Replace with:

```
- **SalesOrder**: clientId, itemId, qty, unitPrice, totalPrice, orderDate, deliveryDate, status (PENDING|IN_PRODUCTION|SHIPPED|DELIVERED|CANCELLED), workflowTaskId, items[] — legacy, `sales_orders` table, still used by Dashboard/Reports/ImportExportModal.
- **PurchaseOrder**: vendorId, itemId, qty, unitCost, totalCost, orderDate, status (DRAFT|ORDERED|RECEIVED|CANCELLED), items[] — legacy, `purchase_orders` table, still used by Dashboard/Reports/ImportExportModal.
- **WorkflowTask**: orderId, productName, qty, currentStep (PREPARATION|ASSEMBLY|QUALITY_CONTROL|PACKAGING|COMPLETED), assignedTo, dates, notes
- **PurchaseHeader/PurchaseDetail**: `purchase_header`/`purchase_detail` — quotation→PO workflow (status QUOTATION|ORDERED|RECEIVED|CANCELLED), optional `salesHeaderId` link back to a `SalesHeader`, see `PurchasesService.ts`.
- **SalesHeader/SalesDetail/ProductionMaterialUsage**: `sales_header`/`sales_detail`/`production_material_usage` — quotation→SO workflow (status QUOTATION|ORDERED|DELIVERED|CANCELLED); each `SalesDetail` line carries a planned material-usage list (`production_material_usage`, `plannedQuantity` only — `actualQuantity`/`returnedQuantity` unwired until a future production/workflow step), see `OrdersService.ts`.
```

- [ ] **Step 6: Update the Tabs section entry for Orders (around line 117)**

Find:

```
5. **ORDERS** → OrdersView: Sales orders + invoicing
```

Replace with:

```
5. **ORDERS** → OrdersView: Quotation → Sales Order workflow over `sales_header`/`sales_detail`, with per-line planned material usage (`production_material_usage`) and quotation/tax-invoice printing
```

- [ ] **Step 7: Verify**

Run: `npm run lint`
Expected: exits 0 (docs-only change, should already pass — this just confirms nothing else broke).

- [ ] **Step 8: Commit**

```bash
git add knowledge.md
git commit -m "docs: update knowledge.md for OrdersService/OrdersView pattern-A migration"
```

- [ ] **Step 9: Hand off for manual QA**

Tell the user the following checklist needs manual verification in the running app (per project convention, the agent does not launch the dev server or browser automation):

- Create a new Sales Quotation (client + 1 product with 2 planned materials + 1 product with none) — appears in Quotation tab with correct total.
- Edit that quotation — change quantity/price, confirm total recalculates and persists, and the product's material list survives the edit (replace-all round trip).
- Generate Quotation — print modal opens, shows client + product lines, no tax row.
- Proceed to Sales Order — form opens prefilled, Delivery Date defaults to today+14 and is editable, submitting moves the row to the Sales Order tab with status "Pending Delivery".
- Generate Tax Invoice on that Sales Order — print modal opens, shows SST 6% tax line and correct grand total.
- Mark Delivered on that Sales Order — status becomes DELIVERED, and confirm no new row appears in the Inventory ledger tab (no inventory_transaction should be created by this action).
- Cancel a different ORDERED sales order — status becomes CANCELLED, Delete button appears and works.
- Search box filters by client name and by reference number in both tabs.
- In Purchases, create/edit a Purchase Quotation and pick a "Linked Sales Order" — save, reopen the edit form, confirm the picker still shows the same linked order. Leave it blank on another purchase and confirm it saves fine with no link.
- Dashboard/Reports/Import-Export tabs still load without errors (they read the untouched legacy `sales_orders`/`purchase_orders` tables).

---

## Self-Review Notes

- **Spec coverage**: material-list transactional scope via `production_material_usage` (Task 2/5), 3-state status mirror QUOTATION/ORDERED/DELIVERED/CANCELLED (Task 2/5), column mapping `order_date`=creation, `delivery_date`=set at convert (Task 2), no inventory_transaction from Sales (Task 2's `markDelivered`), two tabs (Task 5), product picker via `ProductService` (Task 5), nested per-line material add panel (Task 5), Delivery Lead Time field removed → explicit Delivery Date input defaulting today+14 (Task 5), edit/delete rules mirroring Purchase's actual shipped behavior — QUOTATION fully editable/deletable, ORDERED editable (not deletable, Cancel instead), DELIVERED not editable/deletable, CANCELLED deletable (Task 5), Proceed-to-Sales-Order prefilled dialog (Task 5), Generate Quotation via new `SalesQuotationModal` (Task 3), Generate Tax Invoice via retargeted `InvoiceModal` (Task 4), header-level Sales↔Purchase link (Task 1/6) — all covered.
- **Placeholder scan**: none found — every step has complete, runnable code.
- **Type consistency**: `MaterialUsageInput`/`SalesDetailInput`/`SalesFormInput` (Task 2) match the shapes constructed and consumed in Task 5's `OrdersView.tsx`; `SalesHeader`/`SalesDetail`/`ProductionMaterialUsage` (Task 1) match the mapper functions in Task 2, the render code in Task 5, Task 3's `SalesQuotationModal`, and Task 4's `InvoiceModal`. `markDelivered(headerId: string)` signature in Task 2 matches its call site `handleMarkDelivered(id)` in Task 5. `PurchaseFormInput.salesHeaderId` (Task 6) matches `PurchaseHeader.salesHeaderId` (Task 1) and the `formSalesHeaderId` state threaded through `PurchasesView.tsx`'s `openEditForm`/`openConvertForm`/`handleSubmit`. `SalesOrderLinkOption` (Task 2) matches the `salesLinkOptions` render code in Task 6.
