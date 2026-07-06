# Purchase Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy `purchase_orders`-backed Purchases tab with a quotation → purchase-order workflow built on the existing `purchase_header`/`purchase_detail` tables.

**Architecture:** New pattern-A `PurchasesService.ts` (direct Supabase reads/writes, mirroring `MaterialService.ts`/`InventoryTransactionService.ts`) backs a two-tab `PurchasesView.tsx` (Quotation / Purchase Order, same toggle pattern as `ContactsView.tsx`). A new `QuotationModal.tsx` (copied from `InvoiceModal.tsx`) prints vendor-facing quotation documents. Receiving stock inserts `inventory_transaction` rows so the existing DB trigger updates `material.quantity`.

**Tech Stack:** React 19 + TypeScript, Supabase JS client, Tailwind v4. No automated test runner in this repo (`npm run lint` = `tsc --noEmit` is the only CI-style check) — per-task verification is a clean `tsc --noEmit` plus a code-level self-review; the user does manual browser QA themselves (see final checklist in Task 6), do not launch the dev server or browser automation.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-06-purchase-module-design.md` — every task below implements a section of it.
- Do NOT touch `PurchaseOrder`/`PurchaseOrderItem` types, `purchase_orders` table, or `db.ts`'s purchase-order functions — `DashboardView.tsx`, `ReportsView.tsx`, `ImportExportModal.tsx`, and `server.ts` still depend on them and are out of scope.
- `PurchasesService.ts` is only imported by `PurchasesView.tsx` today — safe to fully rewrite its exports.
- No `db.ts`, no `server.ts` REST hop, no `useTableData` in any new/modified file in this plan.
- Verification command for every task: `npm run lint` (must exit 0, no TypeScript errors).

---

### Task 1: Types — `PurchaseHeader`/`PurchaseDetail` + inventory_transaction FK

**Files:**
- Modify: `src/types.ts:122` (insert after `PurchaseOrder` interface, before `WorkflowTask`)
- Modify: `src/types.ts:261-273` (`InventoryTransaction` interface — add `purchaseDetailId`)
- Modify: `src/helper.ts:65-74` (`erp_inventory_transaction` row mapper — serialize the new field)

**Interfaces:**
- Produces: `PurchaseHeader`, `PurchaseDetail` (consumed by Task 3's service and Task 5's view), `InventoryTransaction.purchaseDetailId?: string` (consumed by Task 3's `receivePurchaseOrder`).

- [ ] **Step 1: Insert `PurchaseDetail`/`PurchaseHeader` into `types.ts`**

Insert immediately after the closing `}` of `PurchaseOrder` (line 122) and before `export interface WorkflowTask {` (line 124):

```ts
export interface PurchaseDetail {
  detailId: string;
  headerId?: string;
  materialId: string;
  materialName: string; // snapshot
  materialCode?: string; // snapshot
  quantity: number;
  unitCost: number;
  totalPrice: number;
  receivedQuantity: number;
}

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

- [ ] **Step 2: Add `purchaseDetailId` to `InventoryTransaction`**

In `src/types.ts`, the `InventoryTransaction` interface currently reads (around line 261):

```ts
export interface InventoryTransaction {
  id: string;
  transactionType: InventoryTransactionType;
  quantity: number; // signed: + increases stock, - decreases stock
  unitCost?: number;
  remark?: string;
  materialId?: string; // exactly one of materialId/productId is set
  materialName?: string; // joined, display only
  productId?: string;
  productName?: string; // joined, display only
  transactionDate: string;
  createdAt?: string;
}
```

Add one field so it reads:

```ts
export interface InventoryTransaction {
  id: string;
  transactionType: InventoryTransactionType;
  quantity: number; // signed: + increases stock, - decreases stock
  unitCost?: number;
  remark?: string;
  materialId?: string; // exactly one of materialId/productId is set
  materialName?: string; // joined, display only
  productId?: string;
  productName?: string; // joined, display only
  purchaseDetailId?: string; // FK -> purchase_detail.detail_id, set when a PO receipt generated this row
  transactionDate: string;
  createdAt?: string;
}
```

- [ ] **Step 3: Serialize `purchaseDetailId` in `helper.ts`'s row mapper**

In `src/helper.ts`, the `erp_inventory_transaction` mapper currently reads:

```ts
    erp_inventory_transaction: (t) => ({
        id: t.id,
        transaction_type: t.transactionType,
        quantity: t.quantity,
        unit_cost: t.unitCost ?? null,
        remark: t.remark || null,
        material_id: t.materialId || null,
        product_id: t.productId || null,
        transaction_date: t.transactionDate
    }),
```

Change to:

```ts
    erp_inventory_transaction: (t) => ({
        id: t.id,
        transaction_type: t.transactionType,
        quantity: t.quantity,
        unit_cost: t.unitCost ?? null,
        remark: t.remark || null,
        material_id: t.materialId || null,
        product_id: t.productId || null,
        purchase_detail_id: t.purchaseDetailId || null,
        transaction_date: t.transactionDate
    }),
```

- [ ] **Step 4: Verify**

Run: `npm run lint`
Expected: exits 0, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/helper.ts
git commit -m "feat: add PurchaseHeader/PurchaseDetail types, wire purchase_detail_id onto inventory_transaction"
```

---

### Task 2: `src/services/PurchasesService.ts` — full pattern-A rewrite

**Files:**
- Modify: `src/services/PurchasesService.ts` (full rewrite, replacing the current `db.ts` re-export wrapper)

**Interfaces:**
- Consumes: `PurchaseHeader`, `PurchaseDetail` (Task 1), `Attachment` (existing), `ContactsService.getVendors(search): Promise<Vendor[]>` (existing), `SystemAdminService.getMaterialCategories(): Promise<MaterialCategory[]>` (existing), `InventoryTransactionService.saveInventoryTransaction(tx: InventoryTransaction): Promise<void>` (existing, now accepts `purchaseDetailId` per Task 1).
- Produces (consumed by Task 5's view): `PurchaseDetailInput`, `PurchaseFormInput` (types), `getPurchases(tab, search)`, `createPurchaseQuotation(input)`, `updatePurchase(headerId, input)`, `convertToPurchaseOrder(headerId, input, orderDate)`, `receivePurchaseOrder(purchase)`, `cancelPurchaseOrder(headerId)`, `deletePurchase(headerId)`, `getMaterialCategories` (re-export).

- [ ] **Step 1: Replace the full file contents**

```ts
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
```

- [ ] **Step 2: Verify**

Run: `npm run lint`
Expected: exits 0. (`PurchasesView.tsx` will fail to compile until Task 5 — if `npm run lint` reports errors only inside `PurchasesView.tsx` at this point, that's expected; confirm no errors are reported inside `PurchasesService.ts` itself.)

- [ ] **Step 3: Commit**

```bash
git add src/services/PurchasesService.ts
git commit -m "feat: rewrite PurchasesService as pattern-A service over purchase_header/purchase_detail"
```

---

### Task 3: `src/components/QuotationModal.tsx` — new vendor-facing print modal

**Files:**
- Create: `src/components/QuotationModal.tsx`

**Interfaces:**
- Consumes: `PurchaseHeader` (Task 1), `ContactsService.getVendors` (existing), `CompanyProfileService.getCompanyProfile` (existing).
- Produces (consumed by Task 5): `QuotationModal` component with props `{ purchase: PurchaseHeader | null; isOpen: boolean; onClose: () => void }`.

- [ ] **Step 1: Create the file**

```tsx
import React, { useMemo, useState, useEffect } from 'react';
import { X, Printer, FileText, Mail, Phone, MapPin, Database, Factory, Cpu, Wrench } from 'lucide-react';
import { PurchaseHeader, Vendor, CompanyProfile } from '../types';
import { getVendors } from '../services/ContactsService';
import { getCompanyProfile } from '../services/CompanyProfileService';

interface QuotationModalProps {
  purchase: PurchaseHeader | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function QuotationModal({ purchase, isOpen, onClose }: QuotationModalProps) {
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    getVendors().then(setVendors).catch(console.error);
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

  const vendorDetails = useMemo(() => {
    if (!purchase) return null;
    return vendors.find(v => v.id === purchase.vendorId);
  }, [purchase, vendors]);

  if (!isOpen || !purchase) return null;

  const referenceNo = purchase.purchaseNo;
  const grandTotal = purchase.totalPrice;

  const handlePrint = () => {
    const sheet = document.getElementById('printable-quotation-sheet');
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
              <title>Purchase Quotation - ${referenceNo}</title>
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
                .vendor-name { font-size: 13px; font-weight: bold; color: #0f172a; margin: 0 0 4px 0; }
                .vendor-info { font-size: 10px; color: #475569; line-height: 1.4; }
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
                  <h1 class="quotation-title">PURCHASE QUOTATION</h1>
                  <div class="meta-details">
                    <p style="margin: 2px 0;"><span class="meta-label">Reference No:</span> ${referenceNo}</p>
                    <p style="margin: 2px 0;"><span class="meta-label">Quotation Date:</span> ${purchase.quotationDate}</p>
                    <p style="margin: 2px 0;"><span class="meta-label">Status:</span> <span style="font-weight: bold; color: #047857; text-transform: uppercase;">${purchase.status}</span></p>
                  </div>
                </div>
              </div>

              <div class="billing-block">
                <div>
                  <div class="bill-to-title">QUOTATION REQUESTED FROM</div>
                  <h3 class="vendor-name">${purchase.vendorName}</h3>
                  ${vendorDetails ? `
                    <div class="vendor-info">
                      <p style="margin: 2px 0; max-width: 250px;">${vendorDetails.address}</p>
                      <p style="margin: 2px 0;">📞 ${vendorDetails.officeNo}</p>
                      <p style="margin: 2px 0;">✉️ ${vendorDetails.email}</p>
                    </div>
                  ` : `<div class="vendor-info">Vendor details not available</div>`}
                </div>

                <div>
                  <div class="bill-to-title">QUOTATION TERMS</div>
                  <p class="terms-details">
                    Please confirm unit pricing and delivery lead time for the materials below. This document is a request for quotation and is not a binding purchase commitment until converted to a Purchase Order.
                  </p>
                </div>
              </div>

              <div class="items-title">MATERIAL LINE ITEMS</div>
              <table>
                <thead>
                  <tr>
                    <th style="width: 40px;">#</th>
                    <th>Material Description</th>
                    <th class="text-right" style="width: 100px;">Quantity</th>
                    <th class="text-right" style="width: 120px;">Unit Cost</th>
                    <th class="text-right" style="width: 140px;">Amount (RM)</th>
                  </tr>
                </thead>
                <tbody>
                  ${purchase.details.map((item, idx) => `
                    <tr>
                      <td class="text-mono" style="color: #94a3b8;">${String(idx + 1).padStart(2, '0')}</td>
                      <td>
                        <div class="item-name">${item.materialName}</div>
                        <span class="item-desc">Raw material. Code: ${item.materialCode || item.materialId}</span>
                      </td>
                      <td class="text-right text-mono">${item.quantity} units</td>
                      <td class="text-right text-mono">RM ${item.unitCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td class="text-right text-mono" style="font-weight: 700; color: #0f172a;">RM ${item.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>

              <div class="totals-section">
                <div class="declaration">
                  <div class="declaration-title">QUOTATION DECLARATION</div>
                  <p style="margin: 0;">
                    This quotation request is issued by ${companyProfile.name} for supply evaluation purposes only. All values expressed in Malaysian Ringgit (MYR).
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
          aside, header, main, nav, .print\\:hidden, [role="dialog"] > div:not(#printable-quotation-container) { display: none !important; visibility: hidden !important; }
          #printable-quotation-container { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; max-width: 100% !important; border: none !important; box-shadow: none !important; margin: 0 !important; padding: 0 !important; background: #ffffff !important; visibility: visible !important; }
          #printable-quotation-sheet { padding: 0 !important; margin: 0 !important; border: none !important; visibility: visible !important; }
          #printable-quotation-sheet * { visibility: visible !important; }
        }
      `}} />

      <div
        id="printable-quotation-container"
        className="w-full max-w-3xl bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden flex flex-col my-8 animate-in fade-in zoom-in-95 duration-200 print:shadow-none print:border-none print:my-0 print:rounded-none"
      >
        <div className="p-4 border-b border-slate-100 bg-slate-50 flex flex-col md:flex-row md:items-center md:justify-between gap-4 print:hidden">
          <div className="flex items-center space-x-2">
            <FileText className="w-4 h-4 text-blue-600" />
            <div>
              <span className="font-sans font-bold text-slate-800 text-xs uppercase tracking-wider block leading-none">Purchase Quotation</span>
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

        <div className="p-8 space-y-8 text-xs text-slate-600 print:p-0 font-sans bg-white" id="printable-quotation-sheet">
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
              <h1 className="font-sans font-black text-slate-900 text-xl tracking-tight uppercase print:text-2xl">Purchase Quotation</h1>
              <div className="space-y-0.5 text-[10px] font-mono text-slate-500">
                <p><span className="font-bold text-slate-700">Reference No:</span> {referenceNo}</p>
                <p><span className="font-bold text-slate-700">Quotation Date:</span> {purchase.quotationDate}</p>
                <p><span className="font-bold text-slate-700">Status:</span> <span className="text-emerald-700 font-bold uppercase">{purchase.status}</span></p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 bg-slate-50/70 rounded-xl p-4 border border-slate-100 print:bg-white print:border-none print:p-0">
            <div>
              <span className="text-[9px] font-bold text-slate-400 uppercase font-mono block mb-1">QUOTATION REQUESTED FROM</span>
              <h3 className="font-sans font-bold text-slate-900 text-xs">{purchase.vendorName}</h3>
              {vendorDetails ? (
                <div className="text-[10px] text-slate-500 space-y-0.5 mt-1 leading-relaxed">
                  <p className="max-w-[250px]">{vendorDetails.address}</p>
                  <p className="font-mono">{vendorDetails.officeNo}</p>
                  <p className="font-mono">{vendorDetails.email}</p>
                </div>
              ) : (
                <p className="text-[10px] text-slate-400 mt-1 italic">Vendor directory match not available.</p>
              )}
            </div>

            <div className="flex flex-col justify-between sm:text-right">
              <div>
                <span className="text-[9px] font-bold text-slate-400 uppercase font-mono block mb-1">QUOTATION TERMS</span>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Please confirm unit pricing and delivery lead time for the materials below. Not a binding purchase commitment until converted to a Purchase Order.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-[9px] font-bold text-slate-400 uppercase font-mono block">MATERIAL LINE ITEMS</span>
            <div className="border border-slate-200 rounded-lg overflow-hidden print:border-slate-300">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-500 uppercase font-mono tracking-wider text-[9px] print:bg-slate-50">
                    <th className="p-3">#</th>
                    <th className="p-3">Material Description</th>
                    <th className="p-3 text-right">Quantity</th>
                    <th className="p-3 text-right">Unit Cost</th>
                    <th className="p-3 text-right">Amount (RM)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 print:divide-slate-200">
                  {purchase.details.map((item, idx) => (
                    <tr key={item.detailId || idx}>
                      <td className="p-3 font-mono text-slate-400">{String(idx + 1).padStart(2, '0')}</td>
                      <td className="p-3 font-semibold text-slate-800">
                        <div>{item.materialName}</div>
                        <span className="text-[9px] text-slate-400 font-normal">Raw material. Code: {item.materialCode || item.materialId}</span>
                      </td>
                      <td className="p-3 text-right font-mono">{item.quantity} units</td>
                      <td className="p-3 text-right font-mono">RM {item.unitCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
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
                This quotation request is issued by {companyProfile.name} for supply evaluation purposes only. All values expressed in Malaysian Ringgit (MYR).
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
git add src/components/QuotationModal.tsx
git commit -m "feat: add QuotationModal for printing vendor-facing purchase quotations"
```

---

### Task 4: `src/components/PurchasesView.tsx` — rewrite with Quotation/PO tabs

**Files:**
- Modify: `src/components/PurchasesView.tsx` (full rewrite in place, same `PURCHASES` tab entry point)

**Interfaces:**
- Consumes: everything exported by Task 2's `PurchasesService.ts`, `MaterialService.getMaterials(search): Promise<Material[]>` (existing), `ContactsService.getVendors(search): Promise<Vendor[]>` (existing), `QuotationModal` (Task 3), `PurchaseHeader`/`PurchaseDetail` (Task 1).
- Produces: `export default function PurchasesView()` — no props (the old `quickProcureState`/`clearQuickProcure` props are dropped; `App.tsx:485` already renders `<PurchasesView key={refreshKey} />` with no props, so no caller needs updating).

- [ ] **Step 1: Replace the full file contents**

```tsx
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  getPurchases, createPurchaseQuotation, updatePurchase, convertToPurchaseOrder,
  receivePurchaseOrder, cancelPurchaseOrder, deletePurchase, getMaterialCategories,
  PurchaseDetailInput,
} from '../services/PurchasesService';
import { getMaterials } from '../services/MaterialService';
import { getVendors } from '../services/ContactsService';
import { PurchaseHeader, Vendor, Material, Attachment, MaterialCategory } from '../types';
import { Plus, Calendar, Check, Paperclip, Trash2, Edit, FileText, ArrowRightCircle } from 'lucide-react';
import AttachmentSection from './AttachmentSection';
import QuotationModal from './QuotationModal';
import LoadingSpinner from './LoadingSpinner';
import ComboBox from './ComboBox';
import { Dialog, DialogFooter, DialogCancelButton, DialogSubmitButton, Card, FormField, SearchInput } from './ui';
import { CallAPI } from './UIHelper';

type PurchaseTab = 'QUOTATION' | 'PO';
type FormMode = 'CREATE' | 'EDIT' | 'CONVERT';

export default function PurchasesView() {
  const [activeTab, setActiveTab] = useState<PurchaseTab>('QUOTATION');
  const [searchQuery, setSearchQuery] = useState('');
  const [purchases, setPurchases] = useState<PurchaseHeader[]>([]);
  const [loading, setLoading] = useState(true);

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialCategories, setMaterialCategories] = useState<MaterialCategory[]>([]);

  useEffect(() => {
    getVendors().then(setVendors).catch(console.error);
    getMaterials().then(setMaterials).catch(console.error);
    CallAPI(getMaterialCategories, { onCompleted: setMaterialCategories, onError: console.error });
  }, []);

  const rawMaterials = useMemo(
    () => materials.filter(m => m.materialType === 'RAW_MATERIAL' && m.status !== 'INACTIVE'),
    [materials]
  );

  const materialCategoryMap = useMemo(
    () => new Map(materialCategories.map(c => [c.id, c])),
    [materialCategories]
  );

  const loadPurchases = (tab: PurchaseTab, search = searchQuery) => {
    setLoading(true);
    CallAPI(() => getPurchases(tab === 'QUOTATION' ? 'QUOTATION' : 'PO', search), {
      onCompleted: (data) => { setPurchases(data); setLoading(false); },
      onError: (err) => { console.error(err); setLoading(false); },
    });
  };

  useEffect(() => { setSearchQuery(''); loadPurchases(activeTab, ''); }, [activeTab]);

  useEffect(() => {
    const t = setTimeout(() => loadPurchases(activeTab, searchQuery), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  // Quotation print modal
  const [selectedQuotation, setSelectedQuotation] = useState<PurchaseHeader | null>(null);
  const [isQuotationModalOpen, setIsQuotationModalOpen] = useState(false);

  // Form dialog state
  const [showFormDialog, setShowFormDialog] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>('CREATE');
  const [editHeaderId, setEditHeaderId] = useState<string | null>(null);
  const [formVendorId, setFormVendorId] = useState('');
  const [formOrderDate, setFormOrderDate] = useState('');
  const [formDetails, setFormDetails] = useState<PurchaseDetailInput[]>([]);
  const [tempMaterialId, setTempMaterialId] = useState('');
  const [tempQuantity, setTempQuantity] = useState(10);
  const [tempUnitCost, setTempUnitCost] = useState(0);
  const [formAttachment, setFormAttachment] = useState<Attachment | undefined>(undefined);

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

  const todayStr = () => new Date().toISOString().split('T')[0];

  const openCreateForm = () => {
    resetForm();
    setFormMode('CREATE');
    setShowFormDialog(true);
  };

  const detailsFromHeader = (purchase: PurchaseHeader): PurchaseDetailInput[] =>
    purchase.details.map(d => ({
      materialId: d.materialId,
      materialName: d.materialName,
      materialCode: d.materialCode,
      quantity: d.quantity,
      unitCost: d.unitCost,
      totalPrice: d.totalPrice,
    }));

  const openEditForm = (purchase: PurchaseHeader) => {
    setFormMode('EDIT');
    setEditHeaderId(purchase.id);
    setFormVendorId(purchase.vendorId);
    setFormAttachment(purchase.attachments?.[0]);
    setFormDetails(detailsFromHeader(purchase));
    setShowFormDialog(true);
  };

  const openConvertForm = (purchase: PurchaseHeader) => {
    setFormMode('CONVERT');
    setEditHeaderId(purchase.id);
    setFormVendorId(purchase.vendorId);
    setFormAttachment(purchase.attachments?.[0]);
    setFormDetails(detailsFromHeader(purchase));
    setFormOrderDate(todayStr());
    setShowFormDialog(true);
  };

  // Material catalog rows carry no per-vendor unit cost, so selecting a
  // material doesn't prefill a price — the buyer types the quoted cost.
  const handleMaterialSelect = (materialId: string) => setTempMaterialId(materialId);

  const handleAddTempItem = () => {
    if (!tempMaterialId || tempQuantity <= 0) return;
    const material = rawMaterials.find(m => m.id === tempMaterialId);
    if (!material) return;

    const existingIdx = formDetails.findIndex(d => d.materialId === tempMaterialId);
    if (existingIdx !== -1) {
      const updated = [...formDetails];
      updated[existingIdx].quantity += tempQuantity;
      updated[existingIdx].totalPrice = updated[existingIdx].quantity * updated[existingIdx].unitCost;
      setFormDetails(updated);
    } else {
      setFormDetails([...formDetails, {
        materialId: tempMaterialId,
        materialName: material.name,
        materialCode: material.code,
        quantity: tempQuantity,
        unitCost: tempUnitCost,
        totalPrice: tempQuantity * tempUnitCost,
      }]);
    }

    setTempMaterialId('');
    setTempQuantity(10);
    setTempUnitCost(0);
  };

  const handleRemoveFormItem = (index: number) => {
    setFormDetails(formDetails.filter((_, idx) => idx !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formVendorId) return;

    let finalDetails = [...formDetails];
    if (tempMaterialId && tempQuantity > 0) {
      const material = rawMaterials.find(m => m.id === tempMaterialId);
      if (material) {
        const existingIdx = finalDetails.findIndex(d => d.materialId === tempMaterialId);
        if (existingIdx !== -1) {
          finalDetails[existingIdx].quantity += tempQuantity;
          finalDetails[existingIdx].totalPrice = finalDetails[existingIdx].quantity * finalDetails[existingIdx].unitCost;
        } else {
          finalDetails.push({
            materialId: tempMaterialId,
            materialName: material.name,
            materialCode: material.code,
            quantity: tempQuantity,
            unitCost: tempUnitCost,
            totalPrice: tempQuantity * tempUnitCost,
          });
        }
      }
    }

    if (finalDetails.length === 0) {
      alert('Please add at least one material item to this purchase.');
      return;
    }

    const input = { vendorId: formVendorId, attachments: formAttachment ? [formAttachment] : [], details: finalDetails };

    if (formMode === 'CREATE') {
      await CallAPI(() => createPurchaseQuotation(input), {
        onCompleted: () => loadPurchases(activeTab),
        onError: console.error,
      });
    } else if (formMode === 'EDIT' && editHeaderId) {
      await CallAPI(() => updatePurchase(editHeaderId, input), {
        onCompleted: () => loadPurchases(activeTab),
        onError: console.error,
      });
    } else if (formMode === 'CONVERT' && editHeaderId) {
      await CallAPI(() => convertToPurchaseOrder(editHeaderId, input, formOrderDate || todayStr()), {
        onCompleted: () => loadPurchases(activeTab),
        onError: console.error,
      });
    }

    setShowFormDialog(false);
    resetForm();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this purchase?')) return;
    await CallAPI(() => deletePurchase(id), {
      onCompleted: () => loadPurchases(activeTab),
      onError: console.error,
    });
  };

  const handleReceive = async (purchase: PurchaseHeader) => {
    await CallAPI(() => receivePurchaseOrder(purchase), {
      onCompleted: () => loadPurchases(activeTab),
      onError: console.error,
    });
  };

  const handleCancel = async (id: string) => {
    if (!confirm('Cancel this Purchase Order?')) return;
    await CallAPI(() => cancelPurchaseOrder(id), {
      onCompleted: () => loadPurchases(activeTab),
      onError: console.error,
    });
  };

  const openQuotationDoc = (purchase: PurchaseHeader) => {
    setSelectedQuotation(purchase);
    setIsQuotationModalOpen(true);
  };

  const dialogTitle = formMode === 'CREATE' ? 'Create Material Purchase Quotation'
    : formMode === 'EDIT' ? 'Edit Material Purchase Quotation'
    : 'Confirm Purchase Order';

  const submitLabel = formMode === 'CREATE' ? 'Save Quotation'
    : formMode === 'EDIT' ? 'Update Quotation'
    : 'Confirm Purchase Order';

  if (loading) {
    return <LoadingSpinner message="Verifying supply orders..." subtitle="PURCHASE_ORDERS" />;
  }

  return (
    <div className="space-y-6" id="purchases-view">

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
            onClick={() => setActiveTab('PO')}
            className={`px-4 py-1.5 text-xs font-medium rounded-md font-sans transition-all ${activeTab === 'PO' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            Purchase Order
          </button>
        </div>

        <div className="flex items-center space-x-2">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search by supplier or reference no..."
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
        onClose={() => setShowFormDialog(false)}
        title={dialogTitle}
      >
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-slate-600">

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
              <FormField label="Order Date *" labelClassName="font-semibold block text-slate-700" colSpan="sm:col-span-2">
                <input
                  type="date"
                  required
                  value={formOrderDate}
                  onChange={(e) => setFormOrderDate(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800"
                />
              </FormField>
            )}

            <div className="sm:col-span-2 border border-slate-150 rounded-lg p-3 bg-slate-50/50 space-y-2">
              <span className="font-semibold block text-slate-700 text-xs">Materials to Procure ({formDetails.length})</span>
              {formDetails.length === 0 ? (
                <div className="text-center py-4 text-slate-400 border border-dashed border-slate-200 rounded-lg bg-white text-[11px]">
                  No materials added yet. Specify material details below to add items.
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
                  <table className="w-full text-left text-[11px] border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400">
                        <th className="p-2">Material Name</th>
                        <th className="p-2 text-right">Quantity</th>
                        <th className="p-2 text-right">Unit Cost</th>
                        <th className="p-2 text-right">Total (RM)</th>
                        <th className="p-2 text-center" style={{ width: '40px' }}></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-150 text-slate-700">
                      {formDetails.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="p-2 font-semibold text-slate-800">{item.materialName}</td>
                          <td className="p-2 text-right font-mono">{item.quantity}</td>
                          <td className="p-2 text-right font-mono">RM {item.unitCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td className="p-2 text-right font-mono font-semibold">RM {item.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td className="p-2 text-center">
                            <button type="button" onClick={() => handleRemoveFormItem(idx)} className="text-red-500 hover:text-red-700 p-1" title="Remove item">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="sm:col-span-2 border border-blue-100 rounded-lg p-4 bg-blue-50/20 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <FormField label="Material Selection" labelClassName="font-semibold block text-slate-700 text-[10px] uppercase tracking-wider" colSpan="sm:col-span-6">
                <ComboBox
                  value={tempMaterialId}
                  onChange={handleMaterialSelect}
                  noneLabel="-- Choose Material --"
                  options={rawMaterials.map(m => {
                    const category = materialCategoryMap.get(m.materialCategoryId || '');
                    return { value: m.id, label: m.name, sublabel: category ? category.name : `Stock: ${m.quantity}` };
                  })}
                />
              </FormField>

              <FormField label="Quantity" labelClassName="font-semibold block text-slate-700 text-[10px] uppercase tracking-wider" colSpan="sm:col-span-2">
                <input
                  type="number"
                  min="1"
                  value={tempQuantity}
                  onChange={(e) => setTempQuantity(Number(e.target.value))}
                  disabled={!formVendorId}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none text-xs text-slate-800 disabled:bg-slate-50"
                />
              </FormField>

              <FormField label="Unit Cost (RM)" labelClassName="font-semibold block text-slate-700 text-[10px] uppercase tracking-wider" colSpan="sm:col-span-2">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={tempUnitCost}
                  onChange={(e) => setTempUnitCost(Number(e.target.value))}
                  disabled={!formVendorId}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none text-xs text-slate-800 disabled:bg-slate-50"
                />
              </FormField>

              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={handleAddTempItem}
                  disabled={!formVendorId || !tempMaterialId || tempQuantity <= 0}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-semibold transition-colors shadow-sm disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
                >
                  + Add Item
                </button>
              </div>
            </div>

            <div className="bg-amber-50 rounded-lg p-3 sm:col-span-2 flex items-center justify-between border border-amber-100">
              <div>
                <span className="font-semibold block text-[11px] text-amber-900">Total Purchase Cost:</span>
                <span className="text-[10px] text-amber-700 font-sans">Payment will be logged under company material costs.</span>
              </div>
              <div className="font-mono text-base font-bold text-amber-950">
                RM {Math.max(0, formDetails.reduce((sum, item) => sum + item.totalPrice, 0) + (tempMaterialId && tempQuantity > 0 ? tempQuantity * tempUnitCost : 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>

            <div className="sm:col-span-2">
              <AttachmentSection
                attachment={formAttachment}
                onAttachmentChange={setFormAttachment}
                label="Quotation or Invoice Document (Optional)"
                helperText="Upload any supplier quotation, invoice, specification, or receipt (Max 1MB)"
              />
            </div>

          </div>
          <DialogFooter>
            <DialogCancelButton onClick={() => setShowFormDialog(false)} />
            <DialogSubmitButton>{submitLabel}</DialogSubmitButton>
          </DialogFooter>
        </form>
      </Dialog>

      {/* Listing table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 uppercase font-mono tracking-wider dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-400">
                <th className="p-4">Reference</th>
                <th className="p-4">Supplier</th>
                <th className="p-4">Material Details</th>
                <th className="p-4">{activeTab === 'QUOTATION' ? 'Quotation Date' : 'Order Date'}</th>
                <th className="p-4">Total Cost</th>
                {activeTab === 'PO' && <th className="p-4">Status</th>}
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {purchases.length === 0 ? (
                <tr>
                  <td colSpan={activeTab === 'PO' ? 7 : 6} className="text-center py-12 text-xs text-slate-400 font-sans">
                    No {activeTab === 'QUOTATION' ? 'quotations' : 'purchase orders'} logged yet.
                  </td>
                </tr>
              ) : (
                purchases.map((p) => (
                  <tr key={p.id} className="group hover:bg-slate-50/50 transition-colors">

                    <td className="p-4 font-mono font-semibold text-slate-900">{p.purchaseNo}</td>
                    <td className="p-4 font-semibold text-slate-900">{p.vendorName}</td>

                    <td className="p-4">
                      <div className="space-y-1">
                        <div className="space-y-1 max-w-xs">
                          {p.details.map((item, idx) => (
                            <div key={item.detailId || idx} className="flex flex-col border-b border-slate-100 last:border-none pb-1 last:pb-0">
                              <span className="font-semibold text-slate-800">{item.materialName}</span>
                              <span className="text-[10px] text-slate-400 font-mono">
                                Qty: {item.quantity} @ RM {item.unitCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            </div>
                          ))}
                        </div>
                        {p.attachments?.[0] && (
                          <div className="pt-1.5 flex items-center">
                            <a
                              href={p.attachments[0].dataUrl}
                              download={p.attachments[0].name}
                              className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-[10px] font-mono transition-colors"
                              title="Download attachment"
                            >
                              <Paperclip className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                              <span className="truncate max-w-[120px]">{p.attachments[0].name}</span>
                            </a>
                          </div>
                        )}
                      </div>
                    </td>

                    <td className="p-4">
                      <div className="flex items-center space-x-1.5 text-slate-600 font-mono text-[11px]">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        <span>{activeTab === 'QUOTATION' ? p.quotationDate : p.orderDate}</span>
                      </div>
                    </td>

                    <td className="p-4 font-mono font-semibold text-slate-900">
                      RM {p.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>

                    {activeTab === 'PO' && (
                      <td className="p-4">
                        <span className={`px-2.5 py-1 rounded-full font-mono text-[10px] font-medium border ${
                          p.status === 'ORDERED' ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : p.status === 'RECEIVED' ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : 'bg-red-50 text-red-800 border-red-200'
                        }`}>
                          {p.status === 'ORDERED' ? 'Pending Stock' : p.status}
                        </span>
                      </td>
                    )}

                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end space-x-1.5">
                        {p.status === 'QUOTATION' && (
                          <>
                            <button onClick={() => openEditForm(p)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded transition-colors" title="Edit">
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleDelete(p.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded transition-colors" title="Delete">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => openQuotationDoc(p)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded transition-colors" title="Generate Quotation">
                              <FileText className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => openConvertForm(p)} className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors" title="Proceed to Purchase Order">
                              <ArrowRightCircle className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}

                        {p.status === 'ORDERED' && (
                          <>
                            <button onClick={() => openEditForm(p)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded transition-colors" title="Edit">
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleReceive(p)} title="Mark material package as received" className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors">
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleCancel(p.id)} className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors text-[10px] font-medium">
                              Cancel
                            </button>
                          </>
                        )}

                        {p.status === 'RECEIVED' && (
                          <div className="text-[10px] text-emerald-600 font-semibold flex items-center space-x-0.5 font-mono px-1.5">
                            <span className="px-2 py-0.5 bg-emerald-50 rounded">Replenished ✓</span>
                          </div>
                        )}

                        {p.status === 'CANCELLED' && (
                          <>
                            <span className="text-[10px] text-slate-400 font-mono italic px-1.5">Cancelled</span>
                            <button onClick={() => handleDelete(p.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded transition-colors" title="Delete">
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

      <QuotationModal
        purchase={selectedQuotation}
        isOpen={isQuotationModalOpen}
        onClose={() => { setIsQuotationModalOpen(false); setSelectedQuotation(null); }}
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
git add src/components/PurchasesView.tsx
git commit -m "feat: rewrite PurchasesView with Quotation/Purchase Order tabs"
```

---

### Task 5: `supabase/schema.sql` — apply against the live Supabase project

**Files:**
- No file changes (schema already committed in a prior session's diff — this task is a deployment/verification step, not a code change).

**Interfaces:**
- Consumes: `supabase/schema.sql` (already has `purchase_header.status`, `purchase_header.sales_header_id`, `purchase_detail.sales_detail_id` — no new columns needed for this plan since `purchase_detail_id` already existed on `inventory_transaction` before this plan started).

- [ ] **Step 1: Confirm no new SQL is needed**

This plan only adds `purchaseDetailId` to the TypeScript `InventoryTransaction` type (Task 1) — the underlying `inventory_transaction.purchase_detail_id` column and its `REFERENCES purchase_detail(detail_id)` already exist in `supabase/schema.sql:204` (confirmed during brainstorming). No ALTER TABLE is required for this plan.

Run: `grep -n "purchase_detail_id" supabase/schema.sql`
Expected: one match at the `inventory_transaction` table definition.

- [ ] **Step 2: No commit needed for this task** (no file changes).

---

### Task 6: Update `knowledge.md` + manual QA checklist

**Files:**
- Modify: `knowledge.md`

**Interfaces:**
- None (documentation only).

- [ ] **Step 1: Update the Architecture section's pattern-B list**

In `knowledge.md`, find the line (around line 27):

```
**B. Legacy REST hook** — `useTableData<T>('table_name')` (in `hooks/useTableData.ts`) calls `server.ts`'s `GET /api/data/:table?q=&<filterCol>=`, which runs the query server-side via a second Supabase client. Writes still go through `db.ts`'s per-table `save*`/localStorage-array functions. Still used by `InventoryView`, `OrdersView`, `PurchasesView`, `EmployeesView`, `ReportsView`, `ImportExportModal` (bulk backup). Don't add new dependents; migrate a view to pattern A when you next touch it.
```

Replace with (removing `PurchasesView`, which is now pattern A — `InventoryView` should already have been removed by the Step 5 ledger work; if it's still listed, remove it too):

```
**B. Legacy REST hook** — `useTableData<T>('table_name')` (in `hooks/useTableData.ts`) calls `server.ts`'s `GET /api/data/:table?q=&<filterCol>=`, which runs the query server-side via a second Supabase client. Writes still go through `db.ts`'s per-table `save*`/localStorage-array functions. Still used by `OrdersView`, `EmployeesView`, `ReportsView`, `ImportExportModal` (bulk backup). Don't add new dependents; migrate a view to pattern A when you next touch it.
```

- [ ] **Step 2: Update the pattern-A description line (around line 21)**

Find:

```
**A. Module-owned service (preferred, direct-to-Supabase)** — `CompanyProfileService.ts`, `SystemAdminService.ts`, `ContactsService.ts`.
```

Replace with:

```
**A. Module-owned service (preferred, direct-to-Supabase)** — `CompanyProfileService.ts`, `SystemAdminService.ts`, `ContactsService.ts`, `MaterialService.ts`, `ProductService.ts`, `InventoryTransactionService.ts`, `PurchasesService.ts`.
```

- [ ] **Step 3: Update the Tabs section entry for Purchases (around line 118)**

Find:

```
6. **PURCHASES** → PurchasesView: Purchase orders
```

Replace with:

```
6. **PURCHASES** → PurchasesView: Quotation → Purchase Order workflow over `purchase_header`/`purchase_detail`, receiving stock via `inventory_transaction`
```

- [ ] **Step 4: Update the services list under Project Structure (around line 62-73)**

Find the line:

```
    ├── PurchasesService.ts       # Thin re-export wrapper over db.ts + SystemAdminService (pattern B)
```

Replace with:

```
    ├── PurchasesService.ts       # Pattern A; purchase_header/purchase_detail quotation-to-PO workflow
```

- [ ] **Step 5: Verify**

Run: `npm run lint`
Expected: exits 0 (docs-only change, should already pass — this just confirms nothing else broke).

- [ ] **Step 6: Commit**

```bash
git add knowledge.md
git commit -m "docs: update knowledge.md for PurchasesService/PurchasesView pattern-A migration"
```

- [ ] **Step 7: Hand off for manual QA**

Tell the user the following checklist needs manual verification in the running app (per project convention, the agent does not launch the dev server or browser automation):

- Create a new Quotation (vendor + 2 materials) — appears in Quotation tab with correct total.
- Edit that quotation — change quantity, confirm total recalculates and persists.
- Generate Quotation — print modal opens, shows vendor + material lines, no tax row.
- Proceed to Purchase Order — form opens prefilled, Order Date defaults to today and is editable, submitting moves the row to the Purchase Order tab with status "Pending Stock".
- Receive Stock on that PO — status becomes RECEIVED, and the corresponding `material.quantity` increases by the ordered quantity (check the Inventory ledger tab for a new PURCHASE transaction).
- Cancel a different ORDERED PO — status becomes CANCELLED, Delete button appears and works.
- Search box filters by vendor name and by reference number in both tabs.
- Dashboard/Reports/Import-Export tabs still load without errors (they read the untouched legacy `purchase_orders` table).

---

## Self-Review Notes

- **Spec coverage**: status enum (Task 2/4), material-table picker with dropped vendor filter (Task 4), Receive Stock → inventory_transaction (Task 2), QuotationModal (Task 3), edit/delete rules by status (Task 4), Proceed-to-PO prefilled dialog with editable Order Date (Task 4), deferred sales linkage (not wired anywhere in this plan, confirmed absent from all new code) — all covered.
- **Placeholder scan**: none found — every step has complete, runnable code.
- **Type consistency**: `PurchaseDetailInput`/`PurchaseFormInput` (Task 2) match the shapes constructed and consumed in Task 4's `PurchasesView.tsx`; `PurchaseHeader`/`PurchaseDetail` (Task 1) match the mapper functions in Task 2 and the render code in Task 4 and Task 3's `QuotationModal`. `receivePurchaseOrder(purchase: PurchaseHeader)` signature in Task 2 matches its call site `handleReceive(purchase)` in Task 4.
