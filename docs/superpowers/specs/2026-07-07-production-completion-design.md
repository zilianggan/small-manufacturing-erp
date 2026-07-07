# Production Completion — Design (Restructure Step 8)

## Context

Restructure order: Step 7 (Sales, done) → **Step 8 (this doc, Production)**. `OrdersView.tsx`/`OrdersService.ts` already implement the ORDERED → IN_PRODUCTION → DONE_IN_PRODUCTION → DELIVERED status flow and render the right action button per status (`Start Production`, `Mark Production Done`, `Mark Delivered`). What's missing, and what this step adds:

1. `startProduction` currently only flips `sales_header.status` — it doesn't reserve raw material stock or create any production-tracking record.
2. `markProductionDone` currently only flips `sales_header.status` — it doesn't ask the user what was actually consumed, doesn't touch `production_material_usage.actual_quantity`/`returned_quantity` (both present in schema, unwired since Step 7 deferred them here), and doesn't move any inventory.
3. `workflow_tasks` exists in `schema.sql` with a shape (`status`, `start_date`, `end_date`, `remark`, `sales_detail_id`, `employee_id`) that doesn't match today's legacy `WorkflowTask` TS type or `WorkflowsView.tsx`/`db.ts`'s reads (`order_id`, `product_name`, `quantity`, `current_step`, ...). That legacy code stays untouched and out of scope (a separate future migration) — this step only starts **writing** correctly-shaped rows into `workflow_tasks` so that future migration has real data to read.

## Decisions made during brainstorming

1. **Reserve at Start Production, reconcile at Mark Production Done.** `startProduction` deducts every line's `production_material_usage.planned_quantity` from material stock immediately (one `inventory_transaction` per material, `quantity = -plannedQuantity`). This is the only point stock moves downward for the full planned amount.
2. **Mark Production Done opens a dialog** (`ProductionCompletionModal.tsx`) instead of transitioning immediately. It lists every planned material (prefilled `Actual Used = plannedQuantity`, editable) plus two optional panels — a leftover/by-product panel and an extra-produced-quantity panel (both described below). Confirming the dialog performs the reconciliation and the status transition together.
3. **Reconciliation math**: for each material line, `diff = plannedQuantity - actualQuantity`. If `diff != 0`, insert one `inventory_transaction(quantity = diff)` — positive returns unused stock, negative deducts more than was reserved (covers usage running over plan). Update that `production_material_usage` row's `actual_quantity`/`returned_quantity` (`returned_quantity = max(0, diff)`).
4. **Leftover/by-product panel** — real-world case: a planned material (e.g. a rectangular metal bar) yields a different, already-cataloged offcut/remainder item (e.g. a smaller rectangular or round piece) after production. This is not "returning the same material," it's crediting a *different* material's stock. UI: same add-item picker pattern as the Sales form's material sub-panel (`ComboBox` over `getMaterials()` + quantity input + "+ Add Item"). Each entry becomes a **new** `production_material_usage` row (`planned_quantity=0`, `actual_quantity=0`, `returned_quantity=quantity`, `remark='Leftover from production'`) tied to the sales_detail line it came from, plus a `+quantity` `inventory_transaction` crediting that material.
5. **Optional extra-produced quantity** — per product line, defaults to 0. Only used if production yielded more finished units than the order needs (the ordered quantity itself "belongs to the order" and never round-trips through finished-goods inventory). If >0, one `inventory_transaction(quantity = +extra, product_id=...)`.
6. **`workflow_tasks` wiring** — one row per `sales_detail` line, not per header (matches the table's `sales_detail_id` FK). Created on Start Production (`status='IN_PRODUCTION'`, `start_date=today`), closed on Mark Production Done confirm (`status='DONE'`, `end_date=today`). Written via direct `supabase.from('workflow_tasks')` calls in `OrdersService.ts` — no dependency on the legacy `WorkflowTask` type or `WorkflowsService.ts`, since their shapes don't match this table.
7. **`inventory_transaction.transaction_type`** — reservation and any extra-deduction use `'SALES'`; returns (reconciliation surplus and leftover credits) use `'SALES_RETURN'`; extra-produced finished-goods credit uses `'ADJUSTMENT'`. `remark` is `header.salesNo` on every row (mirrors `receivePurchaseOrder`'s `remark: purchase.purchaseNo`).
8. **No cross-statement DB transaction wrapping** — matches existing codebase convention (`insertDetailsWithMaterials`, `receivePurchaseOrder` also loop sequential awaits without a Postgres transaction).
9. **Idempotency** — none added beyond existing status-gated button rendering (once status leaves `ORDERED`/`IN_PRODUCTION`, the triggering button no longer renders). Matches convention elsewhere in `OrdersView.tsx` (no double-click guards beyond `transitioningId` disabling the button while in flight).

## Types (`src/types.ts`)

Add one field to the existing `InventoryTransaction` interface (column already exists in `schema.sql`, just unwired):

```ts
export interface InventoryTransaction {
  // ...existing fields...
  productionMaterialUsageId?: string; // FK -> production_material_usage.id, set when a production reservation/reconciliation generated this row
}
```

No changes to `WorkflowTask`, `SalesHeader`, `SalesDetail`, or `ProductionMaterialUsage` — `ProductionMaterialUsage.actualQuantity`/`returnedQuantity` were already unused-but-present in the DB row shape; `OrdersService.ts`'s `mapMaterialUsageRow` will start reading them.

## Service Layer — `src/services/OrdersService.ts`

- **`mapMaterialUsageRow`**: add `actualQuantity: Number(row.actual_quantity) || 0` and `returnedQuantity: Number(row.returned_quantity) || 0` to the mapped object.
- **`startProduction(header: SalesHeader): Promise<void>`** (signature change — was `(headerId: string)`; caller now passes the full row it already has):
  - `today = new Date().toISOString().split('T')[0]`.
  - Insert one `workflow_tasks` row per `header.details[]` (`sales_detail_id: detail.detailId, status: 'IN_PRODUCTION', start_date: today`).
  - For every material across every detail, insert `inventory_transaction` via `saveInventoryTransaction` (`transactionType: 'SALES', quantity: -material.plannedQuantity, materialId: material.materialId, productionMaterialUsageId: material.id, remark: header.salesNo, transactionDate: today`).
  - Update `sales_header.status = 'IN_PRODUCTION'`.
- **New exported input types**:
  ```ts
  export interface MaterialReconciliationInput {
    usageId: string;       // production_material_usage.id
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
  ```
- **`confirmProductionDone(header: SalesHeader, reconciliations: MaterialReconciliationInput[], leftovers: LeftoverMaterialInput[], extraProduced: ExtraProducedInput[]): Promise<void>`** (replaces the direct `markProductionDone` call from the UI; `markProductionDone` itself can be removed since this supersedes it):
  - For each reconciliation: `diff = plannedQuantity - actualQuantity`; if `diff !== 0`, insert `inventory_transaction` (`transactionType: diff > 0 ? 'SALES_RETURN' : 'SALES', quantity: diff, materialId, productionMaterialUsageId: usageId, remark: header.salesNo`). Always update the `production_material_usage` row: `actual_quantity: actualQuantity, returned_quantity: Math.max(0, diff)`.
  - For each leftover: insert new `production_material_usage` row (`sales_detail_id: salesDetailId, material_id: materialId, planned_quantity: 0, actual_quantity: 0, returned_quantity: quantity, remark: 'Leftover from production'`), then insert `inventory_transaction` (`transactionType: 'SALES_RETURN', quantity: +quantity, materialId, productionMaterialUsageId: <new row's id>, remark: header.salesNo`).
  - For each extraProduced entry (`quantity > 0` only): insert `inventory_transaction` (`transactionType: 'ADJUSTMENT', quantity: +quantity, productId, remark: header.salesNo`).
  - Update `workflow_tasks` rows where `sales_detail_id in (header.details[].detailId)`: `status: 'DONE', end_date: today`.
  - Update `sales_header.status = 'DONE_IN_PRODUCTION'`.

## UI

**`src/components/ProductionCompletionModal.tsx`** (new component, opened from `OrdersView.tsx` in place of the current direct `handleMarkProductionDone` call):
- Props: `order: SalesHeader`, `materials: Material[]` (for the leftover picker's `ComboBox` options, reuse `rawMaterials` already computed in `OrdersView.tsx`), `onConfirm`, `onClose`.
- **Planned Materials section**: one row per material across all `order.details[].materials[]` — shows product line context, material name, planned quantity, and a numeric "Actual Used" input defaulting to `plannedQuantity`.
- **Leftover Items panel**: same add-item UX as the Sales form's material sub-panel — `ComboBox` (material picker) + quantity input + "+ Add Item", staged list with remove buttons. Each staged entry must be tagged with which `sales_detail` line it's attributed to (a line picker if the order has multiple product lines, otherwise implicit).
- **Extra Produced panel**: one optional numeric input per product line, defaulting to 0.
- Confirm button calls `confirmProductionDone(order, reconciliations, leftovers, extraProduced)` via `CallAPI`, then closes and refreshes the order list (mirrors the `CallAPI`/`onCompleted: () => loadOrders(activeTab)` pattern used elsewhere in `OrdersView.tsx`).

**`src/components/OrdersView.tsx`** changes:
- `handleStartProduction(order: SalesHeader)` — change param from `id: string` to the full `order` row; button's `onClick` becomes `() => handleStartProduction(order)`.
- Replace `handleMarkProductionDone`'s direct `markProductionDone(id)` call: clicking "Mark production as done" opens `ProductionCompletionModal` (new piece of state, e.g. `completingOrder: SalesHeader | null`) instead of calling the service directly. The modal's `onConfirm` does what `handleMarkProductionDone` used to do (loading state via `transitioningId`, `loadOrders(activeTab)` on completion).
- Remove the now-unused `markProductionDone` import; import `confirmProductionDone` instead (used inside the new modal or a thin wrapper handler in `OrdersView.tsx` — same pattern as other transitions).

## Out of scope (deferred)

- `WorkflowsView.tsx`/`WorkflowsService.ts`/legacy `WorkflowTask` type migration to the new `workflow_tasks` shape — this step only writes correctly-shaped rows; a future step rewrites the kanban board to read them (pattern-A rewrite, mirroring the Orders/Purchases migrations).
- `employee_id` assignment on `workflow_tasks` rows — left null; assignment UI belongs to the future `WorkflowsView` migration.
- Partial-order production completion (marking only some lines of a multi-line order done while others stay in production) — the dialog reconciles the whole order at once, matching today's single header-level button.
- `knowledge.md` update: note `OrdersService.ts` now owns `startProduction`/`confirmProductionDone` production-side effects, and that `workflow_tasks` has live writers even though `WorkflowsView.tsx` doesn't read them yet.
