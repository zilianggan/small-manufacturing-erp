# Purchase Module — Design (Restructure Step 6)

## Context

Restructure order: Step 5 (inventory ledger, done) → **Step 6 (this doc, Purchase)** → Step 7 (Sales). `purchase_header`/`purchase_detail` already exist in `schema.sql` (added ahead of this step) but are currently unused by the app except read-only joins in `MaterialService.getMaterialPurchaseHistory`. `PurchasesView.tsx`/`PurchasesService.ts` still run on the legacy `purchase_orders` table via `useTableData`/`db.ts` (pattern B) — this step replaces them with a pattern-A rewrite against `purchase_header`/`purchase_detail`, and adds a quotation → purchase order workflow.

`sales_header_id`/`sales_detail_id` FK columns already exist on `purchase_header`/`purchase_detail` (for linking a PO back to the sales order that triggered it) but stay unwired until Step 7 (Sales) exists — no picker for them in this step.

## Decisions made during brainstorming

1. **Status enum**: `purchase_header.status` = `QUOTATION | ORDERED | RECEIVED | CANCELLED`. `quotation_date` set at creation; `order_date` set only when a quotation is confirmed into a PO.
2. **Two tabs**, same toggle pattern as `ContactsView.tsx`: **Quotation** tab (`status=QUOTATION`), **Purchase Order** tab (`status in (ORDERED,RECEIVED,CANCELLED)`).
3. **Material picker** moves from `inventory_items` to `material` table (`materialType='RAW_MATERIAL'`), via `MaterialService.getMaterials()`. The old vendor→material filter (`InventoryItem.supplierId`) is dropped — `material` has no vendor link — picker shows all ACTIVE raw materials regardless of vendor.
4. **Receive Stock** inserts one `inventory_transaction` row per `purchase_detail` line (`PURCHASE`, `+quantity`, `purchase_detail_id`) so the DB trigger bumps `material.quantity`, consistent with the Step 5 ledger. Full-quantity receive only — no partial-receive UI in this pass.
5. **Edit/delete rules**: QUOTATION rows are fully editable and deletable. ORDERED/RECEIVED rows are not editable and not deletable (no delete button shown) — use Cancel instead. CANCELLED rows are deletable.
6. **"Proceed to Purchase Order"** opens the same create/edit form dialog, prefilled from the quotation, so the vendor can adjust qty/cost before committing. Adds an **Order Date** date-picker field (defaults to today, user-editable); submit sets `order_date` to the picked date, `status=ORDERED`.
7. **"Generate Quotation"** opens a new `QuotationModal` (print-only, no state change) — a copy of `InvoiceModal`'s print-popup structure, vendor-facing, no SST tax line.

## Types (`src/types.ts`)

Replaces `PurchaseOrder`/`PurchaseOrderItem` for this module (old interfaces can stay unused/removed — not referenced elsewhere once `PurchasesView`/`PurchasesService` are rewritten):

```ts
export interface PurchaseDetail {
  detailId: string;
  headerId?: string;
  materialId: string;
  materialName: string;   // snapshot
  materialCode?: string;  // snapshot
  quantity: number;
  unitCost: number;
  totalPrice: number;
  receivedQuantity: number;
  salesDetailId?: string; // FK, unwired until Step 7
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
  salesHeaderId?: string; // FK, unwired until Step 7
  details: PurchaseDetail[];
  createdAt?: string;
  updatedAt?: string;
}
```

`purchaseNo` generated client-side at creation as `PO-${id.slice(0,8).toUpperCase()}` — same display convention as today, now persisted into the column instead of computed at render time.

## Service Layer — `src/services/PurchasesService.ts` (rewritten, pattern A)

Direct Supabase reads/writes, mirroring `MaterialService.ts`/`InventoryTransactionService.ts` — no `db.ts`, no `server.ts` REST hop, no `useTableData`.

- `getPurchases(tab: 'QUOTATION' | 'PO', search): Promise<PurchaseHeader[]>` — `PO` fetches `status in (ORDERED,RECEIVED,CANCELLED)`. Selects `*, vendors(company_name), purchase_detail(*)`. `search` (non-empty) first resolves matching vendor ids via `ContactsService.getVendors(search)` (mirrors `InventoryTransactionService`'s search-by-joined-name pattern), then filters with `.or('purchase_no.ilike.%q%,vendor_id.in.(ids)')`.
- `createPurchaseQuotation(header, details[]): Promise<void>` — inserts one `purchase_header` row (`status=QUOTATION`, `quotation_date=today`), then inserts `details` rows with the returned `header_id`.
- `updatePurchase(headerId, header, details[]): Promise<void>` — updates the header row, deletes existing `purchase_detail` rows for `headerId`, re-inserts `details` (replace-all, matching the current `items[]` edit pattern — line counts are small so this is simpler than diffing).
- `convertToPurchaseOrder(headerId, header, details[]): Promise<void>` — same as `updatePurchase` plus `order_date=header.orderDate` (user-picked, defaults to today in the form), `status='ORDERED'`.
- `receivePurchaseOrder(headerId): Promise<void>` — reads the header's details, for each: inserts an `inventory_transaction` (`transaction_type='PURCHASE'`, `quantity=+detail.quantity`, `unit_cost=detail.unitCost`, `purchase_detail_id=detail.detailId`, `remark=purchaseNo`) via `InventoryTransactionService.saveInventoryTransaction`, and sets `received_quantity=quantity` on the detail row; sets header `received_date=today`, `status='RECEIVED'`.
- `cancelPurchaseOrder(headerId): Promise<void>` — sets `status='CANCELLED'`.
- `deletePurchase(headerId): Promise<void>` — deletes the header row (cascades `purchase_detail` via `ON DELETE CASCADE`). Called only from QUOTATION/CANCELLED rows (UI hides the button otherwise).
- Re-exports `getMaterialCategories` from `SystemAdminService` (unchanged from today).

## UI — `src/components/PurchasesView.tsx` (rewritten in place)

**Tab toggle** (same visual pattern as `ContactsView.tsx`'s Vendors/Clients toggle): Quotation | Purchase Order.

**Quotation tab**: table of `QUOTATION` rows — PO code (from `purchaseNo`), vendor, material lines, quotation date, total, actions: Edit (opens form dialog in edit mode), Delete (`confirm()` then `deletePurchase`), Generate Quotation (opens `QuotationModal`), Proceed to Purchase Order (opens form dialog prefilled, submit → `convertToPurchaseOrder`).

**Purchase Order tab**: table of `ORDERED/RECEIVED/CANCELLED` rows — same column shape as today's `PurchasesView` (PO code, vendor, material lines, order date, total, status badge, actions). Actions: Edit (ORDERED only), Delete (CANCELLED only), Receive Stock (ORDERED → `receivePurchaseOrder`), Cancel (ORDERED → `cancelPurchaseOrder`). RECEIVED/CANCELLED show read-only badges (unchanged from current code).

**Form dialog** (shared by New Quotation / Edit Quotation / Proceed to Purchase Order — title and submit label vary by mode): vendor `ComboBox`, inline material-add panel (material picker from `MaterialService.getMaterials()`, no vendor filter), line-items table (material name, qty, unit cost, total, remove), subtotal block, `AttachmentSection`. In Proceed-to-Purchase-Order mode only, an **Order Date** date input is shown (defaults to today, editable). Otherwise structurally identical to today's create/edit form, just retargeted at the new service/types.

**QuotationModal** (new component, `src/components/QuotationModal.tsx`) — copy of `InvoiceModal`'s print-popup structure and styling: company header block (from `CompanyProfileService`), vendor block (from `ContactsService.getVendors`/vendor id) instead of client block, material lines instead of product lines, title "Purchase Quotation", no SST tax row (purchase-side document, not a tax invoice), same print-to-popup-window mechanism.

## Out of scope (deferred to Step 7 — Sales)

- Wiring `salesHeaderId`/`salesDetailId` to an actual picker — needs the Sales module's `sales_header`/`sales_detail` rows to pick from.
- Partial receiving (`received_quantity < quantity`) — full-quantity receive only for now.
- `knowledge.md` update: move `PurchasesView`/`PurchasesService` from the pattern-B list to pattern-A (reference implementations), same as the Step 5 doc did for `InventoryView`.
