# Employee Module Restructure (Restructure Step 9) — Design

## Problem

`schema.sql`'s `employees` table (`full_name`, `contact_no`, `job_position` FK → `job_positions`, `status`) has never matched the app's `Employee` type (`name`, `role` free-text, `phone`, `status`). Two live row-mapper layers were written against the old, wrong shape and silently produce `undefined` fields today:

- `src/helper.ts`'s `ROW_MAPPERS.erp_employees` (write serializer used by `upsertRecord`) — emits `name`/`role`/`phone` columns that don't exist on the table, so every write silently drops the real data.
- `src/hooks/useTableData.ts`'s `employees` mapper, which is a bare passthrough (`(e) => e`) — the most visible symptom: `WorkflowsView.tsx`'s employee-assignment search box and `src/services/WorkflowsService.ts`'s `mapTaskRow` (`row.employees?.name`, querying `employees(full_name)`) both currently render blank assignee names in the production kanban.

(`src/services/db.ts`'s own `ROW_MAPPERS.erp_employees` and its local `loadTableProgressively` are dead code — `loadTable` is imported from `helper.ts` instead, and db.ts's local copy of that function is commented out. `getEmployees()`/`saveEmployees()` in `db.ts` do a raw, unmapped `getStorageItem`/`setStorageItem` round-trip against whatever's cached in `localStorage['erp_employees']` — nothing needs fixing there beyond the field renames in `ImportExportModal.tsx`, item 9 below.)

This is the same class of fix already applied to `contacts` when `ContactsService.ts` was migrated to the pattern-A (direct-to-Supabase) service style. Employee gets the same treatment.

## Architecture

`EmployeesService.ts` moves from a thin re-export over `db.ts` to a pattern-A service — direct Supabase reads, `helper.ts`'s `upsertRecord`/`deleteRecord` for writes — mirroring `ContactsService.ts`. `EmployeesView.tsx` drops the `useTableData` hook in favor of `CallAPI` + local state, matching `ContactsView.tsx`'s shape.

No debounced server-side search is introduced: the Employee directory is a small flat list, and the current UX already does client-side search/status filtering after a single load. That behavior is preserved as-is — only the data source changes.

Job position moves from a free-text role string to a proper FK: a `ComboBox` over `{value: id, label: name}` job-position options with a `Map` for display lookup, exactly matching `ContactDetailView.tsx`'s existing job-position pattern.

No new fields are introduced beyond what's in `schema.sql`. No detail/drill-down page is added — Employees remains a single list+modal view (it doesn't do a list-then-detail job the way Contacts does, so the project's "split detail pages into their own file" convention doesn't apply here).

## Data Model

```ts
export interface Employee {
  id: string;
  fullName: string;
  contactNo?: string;
  email?: string;
  jobPositionId?: string; // FK -> job_positions.id
  status: 'ACTIVE' | 'INACTIVE';
  createdAt?: string;
  updatedAt?: string;
}
```

`WorkflowTask.employeeName`'s comment ("joined via `employees.name`") gets corrected to `employees.full_name`.

## Files Touched

1. **`src/types.ts`** — `Employee` interface as above.
2. **`src/services/EmployeesService.ts`** — rewrite to pattern-A:
   - `getEmployees(search = ''): Promise<Employee[]>` — reads `employees` table, optional `ilike` on `full_name`/`email`, mirroring `ContactsService.getContacts`.
   - `saveEmployee(employee: Employee): Promise<void>` — `upsertRecord('erp_employees', employee)`.
   - `deleteEmployee(id: string): Promise<void>` — `deleteRecord('erp_employees', id)`.
   - `generateId()` — same UUID helper as `ContactsService.ts`.
   - Re-export `getJobPositions` from `SystemAdminService` (unchanged behavior).
3. **`src/helper.ts`** — fix `ROW_MAPPERS.erp_employees` (write serializer) to emit `full_name`/`contact_no`/`job_position`/`status`/`email` instead of the current wrong `name`/`role`/`phone`.
4. **`src/services/db.ts`** — no changes. `getEmployees`/`saveEmployees`/`loadEmployeesData` and the module's `ROW_MAPPERS`/`loadTableProgressively` are either raw passthroughs or dead code (see Problem section) — nothing there references field names, so nothing breaks and nothing needs fixing. `getEmployees`/`saveEmployees` remain the read/write path `ImportExportModal` uses for bulk backup — same carve-out already given to Vendors/Clients, which also still read through `db.ts` in `ImportExportModal` despite having pattern-A services elsewhere. Note this means, same as Vendors/Clients/Contacts today, the `erp_employees` localStorage cache `ImportExportModal` exports from will go stale after this migration (nothing calls `setStorageItem('erp_employees', ...)` anymore) — pre-existing, accepted limitation, not introduced by this change.
5. **`src/components/EmployeesView.tsx`** — rewrite data-fetch (drop `useTableData`, use `CallAPI`/`getEmployees`/`saveEmployee`/`deleteEmployee`), rename `name`→`fullName`, `phone`→`contactNo`, `role`→`jobPositionId` (with `ComboBox` + `Map` lookup for display), keep existing client-side search/status filtering and card-grid + modal UI shape unchanged.
6. **`src/hooks/useTableData.ts`** — fix the `employees` row mapper from the bare passthrough to a proper `full_name`/`contact_no`/`job_position` → camelCase mapping (matching the file's other mappers' style). `WorkflowsView.tsx` stays on `useTableData` for its search-as-you-type assignee picker — that's a legitimate, still-in-scope use of the generic REST hook for cross-module reference-data lookup, not part of this module's own CRUD.
7. **`src/services/WorkflowsService.ts`** — fix `mapTaskRow`'s `row.employees?.name` → `row.employees?.full_name`.
8. **`src/components/WorkflowsView.tsx`** / **`src/components/OrderAccordion.tsx`** — rename the 2-3 `emp.name` call sites to `emp.fullName`.
9. **`src/components/ImportExportModal.tsx`** — rename `employee.name`/`.role`/`.phone` → `.fullName`/`.jobPositionId`/`.contactNo` in both the export and import code paths (including the merge-dedup comparison, which currently matches on `.name`), and update the "Required columns" help text for the `EMPLOYEES` import type. `jobPositionId` exports/imports as the raw UUID, matching how `materialCategoryId`/`productCategoryId` are already handled for Inventory (no name-lookup convenience column). Only `fullName` is required on import (matches `full_name TEXT NOT NULL` in `schema.sql`) — the old code also required `role`, but `job_position` has no NOT NULL constraint, so `jobPositionId` becomes optional on import.

## Out of Scope

- No new Employee fields beyond `schema.sql`'s current columns.
- No Employee detail/drill-down page.
- `ImportExportModal`'s separate pre-existing localStorage-cache-priming quirk (the `erp_employees` cache is never bootstrapped via `loadTable`, so bulk export/import may see a stale/empty base list) — this affects Vendors/Clients too and isn't unique to Employee, so it's not addressed here.
- `server.ts`'s generic `/api/data/:table` endpoint needs no changes — it's a raw passthrough; all mapping happens client-side.

## Testing

No automated test suite exists for this project's UI layer (per existing convention — manual QA checklist handed to the user after implementation, consistent with prior restructure steps). Verification is `npm run lint` plus a manual QA checklist covering: create/edit/delete an employee with a job position selected, job position displays correctly in the card list, status filter still works, Workflows' employee-assignment search shows correct names, a production task's assigned employee name renders correctly, and Import/Export round-trips an Employee sheet correctly.
