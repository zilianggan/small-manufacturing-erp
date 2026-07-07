# Production Kanban Migration — Design

## Problem

`workflow_tasks` was restructured in commit `c0ddff3` ("erp 1.0.2") from a flat legacy shape (`order_id`, `product_name`, `quantity`, `current_step`, `assigned_to`, `notes`) to a normalized one (`sales_detail_id` FK, `status` TEXT, `employee_id` FK, `remark`). The production-completion feature (`docs/superpowers/specs/2026-07-07-production-completion-design.md`) now writes real rows into the new shape via `startProduction`/`confirmProductionDone`/`cancelSalesOrder`, but three consumers were never migrated off the old shape and were explicitly deferred at the time:

- `src/hooks/useTableData.ts`'s `workflow_tasks` row mapper (used by `WorkflowsView.tsx`) — reads `order_id`/`current_step`/etc., none of which exist anymore, so every task maps to `currentStep: undefined`. `WorkflowsView.tsx`'s column grouping (`groups[task.currentStep]`) silently drops every task — the kanban shows "Empty column" everywhere despite rows existing in the table.
- `src/helper.ts`'s `erp_workflow_tasks` entry and `src/services/db.ts`'s `getWorkflowTasks`/`saveWorkflowTasks`/`updateWorkflowStep`/`createWorkflowTaskForOrder` — same stale shape, plus the write-serializer direction is separately broken (it deserializes DB→JS while being invoked as a JS→DB serializer via `upsertRecord`), so writes through this path already produced null columns even before the schema restructure.
- `src/components/ReportsView.tsx` — pulls `getWorkflowTasks()` from `db.ts` to include in the AI-analysis prompt payload; same stale shape, feeds `undefined` fields into the Gemini report.

## Scope

In scope: `workflow_tasks` schema (new `stage` column), a new `WorkflowsService.ts`, `WorkflowTask` type, `WorkflowsView.tsx`/`OrderAccordion.tsx`, `OrdersService.ts`'s `startProduction` insert, and `ReportsView.tsx`'s workflow-task data source.

Out of scope: `ReportsView.tsx`'s `salesOrders`/`purchaseOrders` (also stale, read from the pre-rewrite `sales_orders`/`purchase_orders` tables — separate, larger migration, not touched here).

## Schema change

```sql
ALTER TABLE workflow_tasks
  ADD COLUMN stage TEXT NOT NULL DEFAULT 'PREPARATION'
  CHECK (stage IN ('PREPARATION','ASSEMBLY','QUALITY_CONTROL','PACKAGING','COMPLETED'));
```

Postgres backfills the default onto existing rows, so the row already in the table gets `stage = 'PREPARATION'` automatically.

`workflow_tasks` ends up with two independently-owned columns:
- `status` (`IN_PRODUCTION` / `DONE` / `CANCELLED`) — lifecycle, owned exclusively by `OrdersService.ts` (`startProduction`, `confirmProductionDone`, `cancelSalesOrder`). The kanban never writes it.
- `stage` (`PREPARATION` → `ASSEMBLY` → `QUALITY_CONTROL` → `PACKAGING` → `COMPLETED`) — shop-floor tracking, owned exclusively by the new `WorkflowsService.ts`. `OrdersService.ts` only sets the initial value (`'PREPARATION'`) on insert; it never advances it.

Reaching `stage = 'COMPLETED'` on the kanban has **no inventory or order-status side effects** — it's purely informational. Actual stock movement, material reconciliation, and the `sales_header` status transition to `DONE_IN_PRODUCTION` happen exclusively through Orders → "Mark production done" (`confirmProductionDone`), unchanged from the production-completion feature.

## `WorkflowsService.ts` (new, Pattern-A)

Replaces `db.ts`'s workflow functions and the `useTableData('workflow_tasks')` path, per the project's migrate-on-touch convention (direct `supabase` calls, no `db.ts`/`server.ts`/`useTableData`).

```ts
export const getWorkflowTasks = async (): Promise<WorkflowTask[]> => {
  // supabase.from('workflow_tasks')
  //   .select('*, sales_detail(product_name, quantity, header_id, sales_header(sales_no)), employees(name)')
  //   .eq('status', 'IN_PRODUCTION')
  // Only in-production rows ever reach the board — DONE/CANCELLED rows are excluded at the query.
};

export const updateWorkflowStage = async (taskId: string, stage: WorkflowTask['stage']): Promise<void> => { /* update stage only */ };

export const assignEmployee = async (taskId: string, employeeId: string | null): Promise<void> => { /* update employee_id only */ };
```

`db.ts`'s `getWorkflowTasks`/`saveWorkflowTasks`/`updateWorkflowStep`/`createWorkflowTaskForOrder` and `helper.ts`'s `erp_workflow_tasks` entry (both the `LS_TO_TABLE` and `ROW_MAPPERS` entries) are deleted — dead once nothing calls them. `src/hooks/useTableData.ts`'s `workflow_tasks` mapper entry is also deleted for the same reason.

## Type changes (`types.ts`)

```ts
export interface WorkflowTask {
  id: string;
  headerId: string;        // joined via sales_detail.header_id — used to group tasks by order
  salesNo: string;          // joined via sales_detail.sales_header.sales_no — display label
  productName: string;      // joined via sales_detail.product_name
  quantity: number;         // joined via sales_detail.quantity
  stage: 'PREPARATION' | 'ASSEMBLY' | 'QUALITY_CONTROL' | 'PACKAGING' | 'COMPLETED';
  employeeId?: string;
  employeeName?: string;    // joined via employees.name
  startDate: string;
  endDate?: string;
  remark?: string;
  createdAt?: string;
  updatedAt?: string;
}
```

Replaces the old `orderId`/`assignedTo` (free-text name)/`notes`/`currentStep` fields.

## UI changes

- `WorkflowsView.tsx`: fetches via the new `WorkflowsService.getWorkflowTasks()` instead of `useTableData`. Column grouping keys off `stage`. Info banner rewritten to describe the new flow (stage tracking is informational; stock movement + order completion happens in Orders → "Mark production done").
- `OrderAccordion.tsx`: groups by `headerId`, displays `salesNo` instead of the truncated UUID (`Order #{orderId.slice(0,8)}`). Assignee `ComboBox` keys off `employeeId` (FK) instead of matching free-text names. Next/Prev buttons call `updateWorkflowStage` — no other side effects.
- Order/assignee filters: order filter matches `salesNo`; assignee filter matches `employeeName`.

## `OrdersService.ts` change

`startProduction`'s `workflow_tasks` insert gets an explicit `stage: 'PREPARATION'` field (belt-and-suspenders alongside the column default).

## `ReportsView.tsx` change

Swaps its `getWorkflowTasks()` import from `db.ts` to the new `WorkflowsService.ts`. `salesOrders`/`purchaseOrders` are left untouched (separate, larger, pre-existing staleness against `sales_orders`/`purchase_orders` — not addressed here).

## Error handling

Unchanged pattern: optimistic local state update, rollback on Supabase error (already present in `WorkflowsView.tsx`'s `handleAssignTask`/`handleAdvanceStep`/`handleRevertStep`, carried forward against the new service calls).

## Verification

No test runner in this project (`npm run lint` = `tsc --noEmit` only). Verification here is type-checking; the user runs manual QA themselves (do not launch the dev server or drive the UI).
