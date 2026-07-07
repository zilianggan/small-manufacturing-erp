# Sales Module — Design (Restructure Step 7)

## Context

Restructure order: Step 6 (Purchase, done) → **Step 7 (this doc, Sales)**. `sales_header`/`sales_detail`/`production_material_usage` already exist in `schema.sql` (added ahead of this step) but are currently unused by the app except read-only joins in `ProductService.getProductSalesHistory`. `OrdersView.tsx`/`OrdersService.ts` still run on the legacy `sales_orders` table via `useTableData`/`db.ts` (pattern B) — this step replaces them with a pattern-A rewrite against `sales_header`/`sales_detail`/`production_material_usage`, and adds a quotation → sales-order workflow, mirroring the Purchase module (Step 6).

`purchase_header.sales_header_id`/`purchase_detail.sales_detail_id` FK columns already exist (for linking a PO back to the sales order that triggered it) and stayed unwired in Step 6 pending this step. This step wires the header-level link (`purchase_header.sales_header_id` only).

## Decisions made during brainstorming

1. **Material list scope — transactional only.** `production_material_usage` rows are entered fresh per sales-order line (`planned_quantity` only), not a reusable per-product BOM template. `actual_quantity`/`returned_quantity` stay unwired — that's production/workflow consumption tracking, a future step.
2. **Status enum — mirrors Purchase (3 post-quotation states).** `sales_header.status` = `QUOTATION | ORDERED | DELIVERED | CANCELLED`. Today's richer `PENDING/IN_PRODUCTION/SHIPPED/DELIVERED` states (tied to the legacy `WorkflowTask` type) are dropped for this pass — granular production tracking is deferred to a future Workflows migration step.
3. **Column mapping.** `sales_header.order_date` (NOT NULL) is set at creation and acts as the quotation/creation date (schema has no separate `quotation_date` column, unlike `purchase_header`). `sales_header.delivery_date` (nullable) is set only when a quotation is confirmed into a Sales Order — mirrors `purchase_header.order_date`.
4. **No inventory transactions from Sales in this pass.** "Mark Delivered" (ORDERED → DELIVERED) only flips status. No `inventory_transaction` insert — actual product/material stock movement is deferred to a future production/workflow step that will consume `production_material_usage.actual_quantity`.
5. **Two tabs**, same toggle pattern as `PurchasesView.tsx`/`ContactsView.tsx`: **Quotation** tab (`status=QUOTATION`), **Sales Order** tab (`status in (ORDERED,DELIVERED,CANCELLED)`).
6. **Product picker** uses `ProductService.getProducts()` (ACTIVE only) — replaces today's `inventory_items` (type=FINISHED_GOOD) picker.
7. **Per-product-line material list** is entered inline while adding a product line to the form (before it's pushed into the line-items table), mirroring the material-add panel in `PurchasesView.tsx`'s form. Once a line is added, its materials are read-only in the table — editing means removing and re-adding the line (same limitation Purchase's line items already have).
8. **Estimated Delivery Lead Time (Days) field removed**, replaced by an explicit **Delivery Date** date input shown only in Convert-to-Sales-Order mode, defaulting to today+14 (preserves today's default lead time as a starting point), user-editable.
9. **Edit/delete rules** — same as Purchase: QUOTATION rows fully editable/deletable. ORDERED/DELIVERED rows not editable/deletable (use Cancel instead). CANCELLED rows deletable.
10. **"Proceed to Sales Order"** opens the same create/edit form dialog, prefilled from the quotation, adding the Delivery Date field; submit sets `delivery_date`, `status=ORDERED`.
11. **"Generate Quotation"** opens a new `SalesQuotationModal` (print-only, no state change) — copy of `QuotationModal`'s print-popup structure, client-facing, "request for quotation, not binding until confirmed" language.
12. **"Generate Tax Invoice"** reuses `InvoiceModal.tsx`, rewritten in place to accept `SalesHeader`/`SalesDetail` instead of the legacy `SalesOrder` — `InvoiceModal` has no other consumers, safe to retarget.
13. **Sales↔Purchase link — header-level only, added to Purchase's form.** `PurchaseHeader.salesHeaderId` (optional) surfaces as a "Linked Sales Order" `ComboBox` in `PurchasesView.tsx`'s form, sourced from a new lightweight `getSalesOrdersForLinking(search)` export. Nullable; no behavior change if left blank. No new list column in the Purchase table — form-only.

## Types (`src/types.ts`)

Adds (does not replace `SalesOrder`/`SalesOrderItem` — those stay for legacy consumers, see Out of scope):

```ts
export interface ProductionMaterialUsage {
  id: string;
  salesDetailId?: string;
  materialId: string;
  materialName: string;  // joined, display only
  materialCode?: string; // joined, display only
  plannedQuantity: number;
}

export interface SalesDetail {
  detailId: string;
  headerId?: string;
  productId: string;
  productName: string;  // snapshot
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

Also adds `salesHeaderId?: string` to `PurchaseHeader` (wires the existing unwired FK).

`salesNo` generated client-side at creation as `SO-${id.slice(0,8).toUpperCase()}` — same display convention as `purchaseNo`.

## Service Layer — `src/services/OrdersService.ts` (rewritten, pattern A)

Direct Supabase reads/writes, mirroring `PurchasesService.ts`/`MaterialService.ts` — no `db.ts`, no `server.ts` REST hop, no `useTableData`.

- `getSalesOrders(tab: 'QUOTATION' | 'SO', search): Promise<SalesHeader[]>` — `SO` fetches `status in (ORDERED,DELIVERED,CANCELLED)`. Selects `*, clients(company_name), sales_detail(*, production_material_usage(*, material(name, code)))`. `search` (non-empty) resolves matching client ids via `ContactsService.getClients(search)`, then filters with `.or('sales_no.ilike.%q%,client_id.in.(ids)')`.
- `createSalesQuotation(header, details[]): Promise<void>` — inserts one `sales_header` row (`status=QUOTATION`, `order_date=today`), inserts `sales_detail` rows with the returned `header_id`, then inserts each detail's `production_material_usage` rows with the returned `detail_id`.
- `updateSalesOrder(headerId, header, details[]): Promise<void>` — updates the header row, deletes existing `sales_detail` rows for `headerId` (cascades `production_material_usage`), re-inserts `details` and their nested materials (replace-all, matching Purchase's `updatePurchase` pattern).
- `convertToSalesOrder(headerId, header, details[], deliveryDate): Promise<void>` — same as `updateSalesOrder` plus `delivery_date=deliveryDate`, `status='ORDERED'`.
- `markDelivered(headerId): Promise<void>` — sets `status='DELIVERED'`. No inventory_transaction (per decision 4).
- `cancelSalesOrder(headerId): Promise<void>` — sets `status='CANCELLED'`.
- `deleteSalesOrder(headerId): Promise<void>` — deletes the header row (cascades `sales_detail` → `production_material_usage`).
- `getSalesOrdersForLinking(search): Promise<{id: string, salesNo: string, clientName: string}[]>` — lightweight list for `PurchasesView.tsx`'s "Linked Sales Order" picker.
- Re-exports `getProductCategories` from `SystemAdminService` (unchanged from today, mirrors Purchase's `getMaterialCategories` re-export) — only if `OrdersView` needs it; otherwise omit.

## UI — `src/components/OrdersView.tsx` (rewritten in place)

**Tab toggle**: Quotation | Sales Order (same visual pattern as `PurchasesView.tsx`).

**Quotation tab**: table of `QUOTATION` rows — SO code (from `salesNo`), client, product lines (with nested material lines), order date, total, actions: Edit, Delete, Generate Quotation (opens `SalesQuotationModal`), Proceed to Sales Order (opens form prefilled, submit → `convertToSalesOrder`).

**Sales Order tab**: table of `ORDERED/DELIVERED/CANCELLED` rows — SO code, client, product lines, delivery date, total, status badge, actions: Edit (ORDERED only), Delete (CANCELLED only), Mark Delivered (ORDERED → `markDelivered`), Cancel (ORDERED → `cancelSalesOrder`), Generate Tax Invoice (`InvoiceModal`, retargeted to `SalesHeader`/`SalesDetail`).

**Form dialog** (shared by New Quotation / Edit Quotation / Proceed to Sales Order): client `ComboBox`, inline product-add panel (product picker from `ProductService.getProducts()`, ACTIVE only) with a nested "Materials for this line" sub-panel (material picker from `MaterialService.getMaterials()`, RAW_MATERIAL only) for adding planned-quantity rows before the line is committed to the table. Line-items table shows each product row with its materials nested underneath. Subtotal block, optional `remark` textarea, `AttachmentSection`. In Proceed-to-Sales-Order mode only, a **Delivery Date** date input is shown (defaults to today+14, editable).

**`SalesQuotationModal`** (new component, `src/components/SalesQuotationModal.tsx`) — copy of `QuotationModal`'s print-popup structure and styling: company header block, client block (from `ContactsService.getClients`/client id), product lines instead of material lines, title "Sales Quotation", "request for quotation, not a binding sales commitment until confirmed" language.

**`InvoiceModal.tsx`** (rewritten in place) — same print-popup structure, retargeted from `SalesOrder` to `SalesHeader`/`SalesDetail` (field renames: `order.totalPrice` → `header.totalAmount`, `order.items` → `header.details`, `item.itemName` → `detail.productName`, etc.). Tax logic (SST 6%) unchanged.

## Purchase-side change — `src/services/PurchasesService.ts` + `src/components/PurchasesView.tsx`

- `PurchasesService.ts`'s `createPurchaseQuotation`/`updatePurchase`/`convertToPurchaseOrder` add `sales_header_id: input.salesHeaderId || null` to the header insert/update payload.
- `PurchasesView.tsx`'s form gets one new optional field: "Linked Sales Order" `ComboBox`, sourced from `OrdersService.getSalesOrdersForLinking(search)`. Nullable, no behavior change if left blank. No new list column.

## Out of scope (deferred)

- `production_material_usage.actual_quantity`/`returned_quantity` and any inventory_transaction wiring for Sales — belongs to a future production/workflow step.
- Per-line linking (`purchase_detail.sales_detail_id`) — header-level link only this pass.
- `workflow_tasks`/`WorkflowsView.tsx` migration — separate future step, untouched here.
- Legacy `SalesOrder`/`SalesOrderItem` types and `sales_orders` table and its consumers (`DashboardView.tsx`, `ReportsView.tsx`, `ImportExportModal.tsx`, `App.tsx`, `db.ts`) — untouched, out of scope.
- `knowledge.md` update: move `OrdersView`/`OrdersService` from the pattern-B list to pattern-A (reference implementations), same as the Step 6 doc did for `PurchasesView`.
