# Consumable Materials — Design

**Date:** 2026-07-12
**Status:** Draft (awaiting user review)

## Problem

`material.material_type = 'FINISHED_GOOD'` is vestigial. Real finished goods live
in the `product` table (Sales flow); nothing in production ever moves
`material.quantity` for a FINISHED_GOOD row. Meanwhile there is no home for
production **consumables** — paint, glue, lubricant, welding gas, cleaning
supplies — items that are purchased and used up during a job but never sold and
often not worth reserving up front.

## Goal

1. Remove `FINISHED_GOOD` material type.
2. Add `CONSUMABLE_MATERIAL` type: purchasable, used during production, never sold.
3. Each consumable has a **Consumption Mode** — `AUTOMATIC` or `MANUAL`.
4. Record consumable usage from the **Production Kanban** (multi-select + qty).
5. On production completion, `AUTOMATIC` consumables auto-deduct stock; `MANUAL`
   ones are recorded only (user adjusts later via the existing Inventory
   Stock-Adjustment form).
6. Add a **Usage History** section to the Material detail page, with the sales order
   and assigned employee both drillable.
7. Add an **Employee Detail page** listing the consumable materials that employee has
   worked on (UI modeled on the Purchase Order detail page).

## Decisions (confirmed with user)

| Question | Decision |
|---|---|
| When do AUTOMATIC consumables deduct? | In **Orders → Mark production done** (`confirmProductionDone`). Keeps the existing "Kanban moves no stock" invariant. |
| How is consumable qty entered? | **Multi-select + qty each** on the Kanban card. |
| Usage History "Assigned Employee" source | **Derived via join** (`workflow_tasks.employee_id`), no snapshot column. |
| Dashboard "Finished Goods" tile | Repoint to **`SUM(product.quantity)`** (the real finished goods). |
| MANUAL adjustment UI | **None new.** User uses the existing Inventory Stock-Adjustment drawer (`InventoryView.tsx`). |

## Key architectural fact

Consumables are added **during the Kanban stage (`IN_PRODUCTION`)**, which only
exists *after* Start Production. Therefore:

- `startProduction` and `checkProductionStock` never see consumables — no change needed there.
- Only **`ProductionCompletionModal`** and **`confirmProductionDone`** must
  distinguish consumable usage rows from planned raw-material rows.

## Data model

Reuse `production_material_usage` for consumable usage rows — it already links
`sales_detail → material` with a quantity and remark. No new usage table.

**Schema changes (`supabase/schema.sql`):**

```sql
-- material: replace FINISHED_GOOD in the type comment, add consumption_mode
ALTER TABLE material ADD COLUMN consumption_mode TEXT
  CHECK (consumption_mode IN ('AUTOMATIC','MANUAL'));  -- NULL for non-consumables
-- material_type comment becomes: RAW_MATERIAL or CONSUMABLE_MATERIAL or CUSTOMER_STOCK
```

`consumption_mode` is only meaningful when `material_type = 'CONSUMABLE_MATERIAL'`;
NULL otherwise.

**Consumable usage row shape** (a `production_material_usage` row created from Kanban):
- `sales_detail_id` = the order's first sales_detail line (deterministic). Consumables
  apply to the whole job, not one line; attaching to the first line keeps them under
  the order for traceability without a schema change.
  *(ponytail: first-line attach; add a header-level FK only if per-line consumable
  tracking is ever needed.)*
- `material_id` = the consumable.
- `actual_quantity` = qty used. `planned_quantity` = 0, `returned_quantity` = 0.
- `remark` = optional note from the Kanban entry.

A row is a **consumable** iff its joined `material.material_type = 'CONSUMABLE_MATERIAL'`.
No flag column needed — the material type is the source of truth.

## Data migration

Existing rows with `material_type = 'FINISHED_GOOD'` (expected: few/none, since it
was vestigial) are converted to `RAW_MATERIAL`:

```sql
UPDATE material SET material_type = 'RAW_MATERIAL' WHERE material_type = 'FINISHED_GOOD';
```

## Per-file changes

### Remove FINISHED_GOOD / add CONSUMABLE_MATERIAL
- `src/types.ts` — `MaterialType` union → `'RAW_MATERIAL' | 'CONSUMABLE_MATERIAL' | 'CUSTOMER_STOCK'`.
  Add `consumptionMode?: 'AUTOMATIC' | 'MANUAL'` to `Material`.
  Remove the `FINISHED_GOOD` references in `InventoryItem.type` / comments (that
  legacy interface is Supabase-inventory; drop FINISHED_GOOD from its union too).
- `src/components/MaterialFormFields.tsx` — replace the `FINISHED_GOOD` option with
  `CONSUMABLE_MATERIAL`. When the selected type is `CONSUMABLE_MATERIAL`, show a
  **Consumption Mode** ComboBox (Automatic / Manual). Add `consumptionMode`
  props + wiring.
- `src/components/MaterialView.tsx` — `MATERIAL_TYPE_LABEL`: drop Finished Good, add
  `CONSUMABLE_MATERIAL: 'Consumable Material'`. Update PageHeader description.
  Thread `consumptionMode` through the create/edit form state + `handleSaveMaterial`.
- `src/services/MaterialService.ts` — map/save `consumption_mode` ↔ `consumptionMode`.
- `src/services/ImportExportService.ts` — `VALID_MATERIAL_TYPES`: swap FINISHED_GOOD → CONSUMABLE_MATERIAL.
- `supabase/schema.sql` — column + comment (above).

### Dashboard tile
- `supabase/function_trigger.sql` — in `get_dashboard_data`, change the
  `finished_goods_qty` subquery from
  `SELECT SUM(quantity) FROM material WHERE material_type='FINISHED_GOOD'`
  to `SELECT SUM(quantity) FROM product`.
- No frontend change needed (`DashboardService`/`DashboardView` keep the
  `finishedGoodsQty` field name and "Finished Goods" label — now accurate).

### Kanban consumable entry
- `src/components/WorkflowsView.tsx` / `src/components/OrderAccordion.tsx` — add a
  "Consumables" control on the order card: a multi-select of `CONSUMABLE_MATERIAL`
  materials, each with a qty input. Load consumable materials once
  (`getMaterials` filtered to type, or a small `getConsumableMaterials()` helper).
  Show existing recorded consumables for the order and allow add/remove.
- `src/services/WorkflowsService.ts` — add:
  - `getOrderConsumables(headerId)` → reads `production_material_usage` rows for the
    order whose material is a consumable (join filter).
  - `addOrderConsumable(headerId, materialId, quantity, remark?)` → inserts a usage
    row against the order's first sales_detail line.
  - `removeOrderConsumable(usageId)` → deletes the row (allowed only while the order
    is still IN_PRODUCTION, before completion deduction).

### Completion flow — tell consumables apart
- `src/services/OrdersService.ts`:
  - `getSalesOrders` / `getSalesOrderById` embeds: add `material_type, consumption_mode`
    to the `production_material_usage(..., material(...))` select so the modal and
    `confirmProductionDone` can classify rows.
  - `mapMaterialUsageRow` → carry `materialType` + `consumptionMode` onto
    `ProductionMaterialUsage` (add these optional fields in `types.ts`).
  - `confirmProductionDone`:
    - The existing reconciliation loop **skips** rows where
      `materialType === 'CONSUMABLE_MATERIAL'` (they were never reserved).
    - New loop: for each `CONSUMABLE_MATERIAL` usage row with
      `consumptionMode === 'AUTOMATIC'`, post one `-actual_quantity` inventory
      transaction (`transactionType: 'ADJUSTMENT'`, `productionMaterialUsageId` set).
      `MANUAL` rows → no transaction (history only).
- `src/components/ProductionCompletionModal.tsx` — filter consumable rows **out** of
  the "Planned Materials" reconciliation list. Optionally show a read-only
  "Consumables used" summary (Automatic rows noted as "will deduct", Manual as
  "recorded only"). No qty editing here — qty was set on the Kanban.

### Usage History (Material detail)
- `src/services/MaterialService.ts` — `getMaterialUsageHistory(materialId)`:
  reads `production_material_usage` where `material_id = materialId`, joining
  `sales_detail → sales_header (sales_no, id)` and `workflow_tasks
  (employee_id, stage, employees.full_name)` by `sales_detail_id`. Returns rows
  with: sales order (no + id for drill-in), employee (name + id for drill-in),
  workflow stage, date (`created_at`), quantity used (`actual_quantity`), remark.
- `src/components/MaterialView.tsx` — add a **Usage History** section in the detail
  panel (below/around the existing Inventory List), rendered for the selected
  material. Columns: **Sales Order · Production Order · Assigned Employee · Date ·
  Qty Used · Remarks**.
  - *Sales Order* = `sales_no`, **clickable** — drills into Orders via the existing
    `onViewSalesOrder` cross-tab callback (already wired, return-to-Material works).
  - *Assigned Employee* = `full_name`, **clickable** — drills into the new Employee
    Detail page (see below) via a new `onViewEmployee(employeeId, fromMaterialId)`
    cross-tab callback. Non-clickable "—" when the line has no assigned employee.
  - *Production Order*: this system has no separate production-order number — a
    production run **is** the sales order in `IN_PRODUCTION`/`DONE`. This column shows
    the workflow task's **stage/status** for that line (e.g. "Assembly", "Completed"),
    sourced from `workflow_tasks`. If no workflow task exists, shows "—".
  - Works for raw materials too (shows where each material was consumed).

### Employee Detail page (new)
A drill-down page for one employee, opened from the Usage History employee link
(and from the Employees list itself). **UI modeled on `PurchaseOrderDetailView.tsx`:**
a Back button, a header summary `Card` (name, job position, status, contact/email),
then a `SectionCard` + `DataTable` listing the consumable materials the employee has
worked on.

- `src/components/EmployeeDetailView.tsx` (new) — props: `employee`, `onBack`,
  `backLabel`, `rows` (usage list), `loading`, and `onViewSalesOrder` for the row
  drill-in. Header card mirrors the purchase page's layout; the line-item table
  lists consumable usage.
  - Table columns: **Consumable Material · Qty Used · Sales Order · Stage · Date**.
    Sales Order is clickable (drills into Orders). Client-side sortable like the
    purchase page's line items.
- `src/services/EmployeesService.ts` — `getEmployeeConsumableUsage(employeeId)`:
  1. `workflow_tasks` where `employee_id = employeeId` → the `sales_detail_id`s the
     employee worked, plus each task's `stage`.
  2. `production_material_usage` for those `sales_detail_id`s whose joined
     `material.material_type = 'CONSUMABLE_MATERIAL'`, joined to
     `material (name, code)` and `sales_detail → sales_header (sales_no, id)`.
  Returns rows: material name/code, qty (`actual_quantity`), sales order (no + id),
  stage, date (`created_at`).
  - *Attribution note:* consumables attach to an order's **first** sales_detail line
    (see Data model), so a consumable is credited to that first line's assigned
    employee. Consistent with the order-level consumable model. *(ponytail: revisit
    only if per-line consumable attribution is ever required.)*
- `src/components/EmployeesView.tsx` — make each employee card **clickable** to open
  the detail page in-tab (full-page swap, same as Purchases list → detail). Keep the
  existing edit slide-over on the card's Edit action.
- `src/App.tsx` — add cross-tab wiring mirroring the sales/purchase pattern:
  `pendingEmployeeId` + `employeeReturnTo` state, `navigateToEmployee(employeeId,
  fromMaterialId?)` (sets pending id, `setActiveTab('EMPLOYEES')`), and
  `returnFromEmployee()` restoring the Material detail. Pass `onViewEmployee` into
  `MaterialView` and `initialEmployeeId` into `EmployeesView`.

## Flows after change

**Consumable, AUTOMATIC (e.g. auto-metered paint):**
1. Buyer purchases paint (material, type CONSUMABLE_MATERIAL, mode AUTOMATIC) → stock rises via Purchases.
2. Order goes to production. On the Kanban card, operator adds "Paint × 2L".
   → `production_material_usage` row (first line, actual_qty 2).
3. Orders → Mark production done → `confirmProductionDone` posts −2 ADJUSTMENT for paint.
4. Paint appears in the paint material's Usage History and Inventory List.

**Consumable, MANUAL (e.g. hard-to-meter glue):**
1–2. Same, but material mode = MANUAL.
3. Completion records the usage row but posts **no** transaction.
4. Later the user opens Inventory → Stock Adjustment and deducts glue manually.
   Usage History still shows the recorded usage for traceability.

## Out of scope / non-goals
- No per-line consumable tracking (order-level, attached to first line) — so employee
  attribution follows the first line's assignee.
- No new manual-adjustment UI (reuse existing Inventory drawer).
- No separate production-order entity/number.
- No consumable reservation at Start Production (they're added later, during Kanban).
- Employee Detail page lists **consumable** usage only (the feature's focus), not all
  materials the employee touched.

## Testing
- Migration: a FINISHED_GOOD material becomes RAW_MATERIAL; dashboard "Finished
  Goods" now equals `SUM(product.quantity)`.
- AUTOMATIC consumable: qty entered on Kanban → exactly one −qty transaction after
  completion; material stock drops by qty; not double-counted in raw reconciliation.
- MANUAL consumable: completion creates the usage row, zero transactions; stock
  unchanged until a manual adjustment.
- Completion modal: consumable rows do not appear in the planned-materials
  reconciliation list.
- Usage History: shows sales order, stage, assigned employee, date, qty, remark for
  a material used across ≥1 orders; clicking the sales order drills into Orders and
  Back returns to the material; clicking the employee opens the Employee Detail page
  and Back returns to the material.
- Employee Detail page: lists the consumable materials that employee worked on with
  qty/sales order/stage/date; opens from both the Usage History link and the
  Employees list; the sales order row link drills into Orders.
