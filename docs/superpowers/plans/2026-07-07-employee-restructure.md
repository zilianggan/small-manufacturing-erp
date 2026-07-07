# Employee Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the `Employee` type and every file that touches it with `schema.sql`'s real `employees` table (`full_name`, `contact_no`, `job_position` FK, `status`), migrate `EmployeesService.ts`/`EmployeesView.tsx` to the pattern-A direct-to-Supabase style, and fix two live bugs this mismatch already causes (blank writes via `upsertRecord`, blank assignee names in the production kanban), per `docs/superpowers/specs/2026-07-07-employee-restructure-design.md`.

**Architecture:** New pattern-A `EmployeesService.ts` (direct Supabase reads + `helper.ts`'s `upsertRecord`/`deleteRecord`), mirroring `ContactsService.ts`. `EmployeesView.tsx` drops `useTableData` for `CallAPI` + local state, matching `ContactsView.tsx`. Job position becomes a proper FK (`jobPositionId`) with a `ComboBox` + `Map` display lookup, mirroring `ContactDetailView.tsx`'s existing job-position pattern. Ripple fixes land in `helper.ts`, `useTableData.ts`, `WorkflowsService.ts`, `WorkflowsView.tsx`, `OrderAccordion.tsx`, and `ImportExportModal.tsx`.

**Tech Stack:** React 19 + TypeScript, Supabase JS client, Tailwind v4. No automated test runner in this repo (`npm run lint` = `tsc --noEmit` is the only CI-style check) — per-task verification is a clean `tsc --noEmit`; the user does manual browser QA themselves (see final checklist in Task 8 — do not launch the dev server or browser automation).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-07-employee-restructure-design.md` — every task below implements a section of it.
- No commits are being made during this plan (user preference) — review each task's diff as uncommitted working-tree changes.
- No `db.ts` changes: `getEmployees`/`saveEmployees`/`loadEmployeesData` and `db.ts`'s own (dead) `ROW_MAPPERS.erp_employees`/`loadTableProgressively` are untouched — see spec's Problem section for why they don't need it.
- No new Employee fields beyond `schema.sql`'s columns (`full_name`, `contact_no`, `email`, `status`, `job_position`). No Employee detail/drill-down page.
- `WorkflowsView.tsx` stays on `useTableData` for its assignee-search picker — only its row mapper and 1-2 field references change, no architectural migration there.
- Verification command for every task: `npm run lint` (must exit 0, no TypeScript errors).

---

### Task 1: Types — `Employee` interface + `WorkflowTask` comment fix

**Files:**
- Modify: `src/types.ts:209-218` (`Employee` interface)
- Modify: `src/types.ts:200-201` (`WorkflowTask.employeeName` comment)

**Interfaces:**
- Produces: `Employee { id, fullName, contactNo?, email?, jobPositionId?, status, createdAt?, updatedAt? }` — consumed by Task 2's service, Task 3's view, Task 5's `WorkflowsService` mapper, Task 6's `WorkflowsView`/`OrderAccordion`, Task 7's `ImportExportModal`.

- [ ] **Step 1: Replace the `Employee` interface**

In `src/types.ts`, find:

```ts
export interface Employee {
  id: string;
  name: string;
  role: string;
  status: 'ACTIVE' | 'INACTIVE';
  email?: string;
  phone?: string;
  createdAt?: string;
  updatedAt?: string;
}
```

Replace with:

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

- [ ] **Step 2: Fix the `WorkflowTask.employeeName` comment**

In `src/types.ts`, `WorkflowTask` currently reads:

```ts
  employeeId?: string;
  employeeName?: string; // joined via employees.name
```

Replace with:

```ts
  employeeId?: string;
  employeeName?: string; // joined via employees.full_name
```

- [ ] **Step 3: Verify**

Run: `npm run lint`
Expected: fails with errors in every file still using `.name`/`.role`/`.phone` on an `Employee` (`EmployeesView.tsx`, `WorkflowsView.tsx`, `OrderAccordion.tsx`, `ImportExportModal.tsx`). This is expected — those get fixed in Tasks 4, 6, and 7. Confirm the errors are *only* in those files and *only* about the renamed fields (no unrelated breakage). `src/services/EmployeesService.ts` should NOT error yet — it only re-exports functions from `db.ts`/`SystemAdminService.ts` and never references `Employee`'s field names directly.

---

### Task 2: `helper.ts` — fix the `erp_employees` write serializer

**Files:**
- Modify: `src/helper.ts:29-32` (comment above the serializer group)
- Modify: `src/helper.ts:91-95` (`ROW_MAPPERS.erp_employees`)

**Interfaces:**
- Produces: `ROW_MAPPERS.erp_employees` now serializes a camelCase `Employee` into the real `employees` columns — consumed by `upsertRecord('erp_employees', employee)`, which Task 3's `EmployeesService.saveEmployee` and `db.ts`'s existing `saveEmployees` both call.

- [ ] **Step 1: Extend the "repurposed as serializers" comment to include `erp_employees`**

Find:

```ts
    // NOTE: unlike the other entries in this map (which deserialize DB rows
    // for the now-unused loadTableProgressively path), these three entries
    // serialize JS (camelCase) records -> DB (snake_case) rows, since
    // upsertRecord() is their only live caller.
```

(If the exact wording differs slightly, match on "these three entries" and update the count.) Replace `these three entries` with `these four entries` (or the exact phrase used) so the comment accurately describes `erp_vendors`, `erp_clients`, `erp_contacts`, and `erp_employees`.

- [ ] **Step 2: Replace the `erp_employees` mapper**

Find:

```ts
    erp_employees: (e) => ({
        id: e.id, name: e.name, role: e.role, status: e.status,
        email: e.email, phone: e.phone,
        createdAt: e.created_at, updatedAt: e.updated_at
    }),
```

Replace with (matching `erp_contacts`'s serializer style immediately above it):

```ts
    erp_employees: (e) => ({
        id: e.id, full_name: e.fullName, contact_no: e.contactNo || null, email: e.email || null,
        job_position: e.jobPositionId || null, status: e.status || null
    }),
```

- [ ] **Step 3: Verify**

Run: `npm run lint`
Expected: `tsc` still exits non-zero overall (Task 1's renamed-field errors in `EmployeesView.tsx`/`WorkflowsView.tsx`/`OrderAccordion.tsx`/`ImportExportModal.tsx` are still unresolved until Tasks 4, 6, 7). Confirm `helper.ts` itself contributes zero errors — `ROW_MAPPERS`'s value type is `(row: any) => any`, so this shape change alone can't fail `tsc`.

---

### Task 3: `EmployeesService.ts` — rewrite to pattern-A

**Files:**
- Modify: `src/services/EmployeesService.ts` (full rewrite)

**Interfaces:**
- Consumes: `upsertRecord`/`deleteRecord` from `../helper` (Task 2's fixed serializer), `getJobPositions` from `./SystemAdminService` (unchanged), `Employee` from `../types` (Task 1).
- Produces: `getEmployees(search = ''): Promise<Employee[]>`, `saveEmployee(employee: Employee): Promise<void>`, `deleteEmployee(id: string): Promise<void>`, `generateId(): string`, re-exported `getJobPositions` — all consumed by Task 4's `EmployeesView.tsx`.

- [ ] **Step 1: Replace the file contents**

Replace all of `src/services/EmployeesService.ts` with:

```ts
/**
 * Employees module service layer.
 *
 * Pattern A: talks to Supabase directly via helper.ts's shared primitives,
 * mirroring ContactsService.ts. No db.ts full-list localStorage cache, no
 * server.ts REST hop, no useTableData hook.
 */
import { supabase } from "./supabase";
import { upsertRecord, deleteRecord } from "../helper";
import { Employee } from "../types";
import { getJobPositions } from "./SystemAdminService";

export { getJobPositions };

export const generateId = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const mapEmployeeRow = (row: any): Employee => ({
  id: row.id,
  fullName: row.full_name,
  contactNo: row.contact_no,
  email: row.email,
  jobPositionId: row.job_position,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export const getEmployees = async (search = ''): Promise<Employee[]> => {
  let query = supabase.from('employees').select('*').order('created_at', { ascending: true });
  const q = search.trim();
  if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) {
    console.error('getEmployees', error);
    return [];
  }
  return (data || []).map(mapEmployeeRow);
};

export const saveEmployee = (employee: Employee): Promise<void> => upsertRecord('erp_employees', employee);
export const deleteEmployee = (id: string): Promise<void> => deleteRecord('erp_employees', id);
```

- [ ] **Step 2: Verify**

Run: `npm run lint`
Expected: `tsc` still exits non-zero overall. `EmployeesService.ts` itself contributes a new error here — `EmployeesView.tsx` still imports `generateId, saveEmployees, getJobPositions` from it, and `saveEmployees` no longer exists on this module (only `saveEmployee`, singular) — expected, fixed together with the rest of `EmployeesView.tsx` in Task 4.

---

### Task 4: `EmployeesView.tsx` — rewrite data-fetch and form fields

**Files:**
- Modify: `src/components/EmployeesView.tsx` (full rewrite)

**Interfaces:**
- Consumes: `getEmployees`, `saveEmployee`, `deleteEmployee`, `generateId`, `getJobPositions` from `../services/EmployeesService` (Task 3); `Employee`, `JobPosition` from `../types` (Task 1).

- [ ] **Step 1: Replace the file contents**

Replace all of `src/components/EmployeesView.tsx` with:

```tsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  Users,
  Plus,
  Trash2,
  Edit,
  Mail,
  Phone,
  Briefcase,
  Search
} from 'lucide-react';
import { Employee, JobPosition } from '../types';
import { generateId, getEmployees, saveEmployee, deleteEmployee, getJobPositions } from '../services/EmployeesService';
import LoadingSpinner from './LoadingSpinner';
import ComboBox from './ComboBox';
import { Dialog, DialogFooter, DialogCancelButton, DialogSubmitButton, Card, FormField } from './ui';
import { CallAPI } from './UIHelper';

const employeeFieldInputClassName = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 font-sans text-xs text-slate-800';

export default function EmployeesView() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  const loadEmployees = () => {
    CallAPI(() => getEmployees(), {
      onCompleted: (data) => {
        setEmployees(data);
        setLoading(false);
      },
      onError: (err) => {
        console.error(err);
        setLoading(false);
      },
    });
  };

  useEffect(() => { loadEmployees(); }, []);

  // Search and Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Form States
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [fullName, setFullName] = useState('');
  const [jobPositionId, setJobPositionId] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [email, setEmail] = useState('');
  const [contactNo, setContactNo] = useState('');
  const [jobPositions, setJobPositions] = useState<JobPosition[]>([]);

  useEffect(() => {
    CallAPI(getJobPositions, {
      onCompleted: setJobPositions,
      onError: console.error,
    });
  }, [])

  const jobPositionMap = useMemo(() => new Map(jobPositions.map(p => [p.id, p.name])), [jobPositions]);

  const activeJobPositionOptions = jobPositions
    .filter(position => position.is_active || position.id === jobPositionId)
    .map(position => ({ value: position.id, label: position.name }));

  const filteredEmployees = employees.filter(emp => {
    const positionName = (emp.jobPositionId && jobPositionMap.get(emp.jobPositionId)) || '';
    const matchesSearch = emp.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      positionName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (emp.email && emp.email.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesStatus = statusFilter === 'ALL' || emp.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleOpenAddForm = () => {
    setEditingEmployee(null);
    setFullName('');
    setJobPositionId('');
    setStatus('ACTIVE');
    setEmail('');
    setContactNo('');
    setIsFormOpen(true);
  };

  const handleOpenEditForm = (emp: Employee) => {
    setEditingEmployee(emp);
    setFullName(emp.fullName);
    setJobPositionId(emp.jobPositionId || '');
    setStatus(emp.status);
    setEmail(emp.email || '');
    setContactNo(emp.contactNo || '');
    setIsFormOpen(true);
  };

  const handleDelete = async (id: string, empName: string) => {
    if (!confirm(`Are you sure you want to delete ${empName}? This employee will no longer be listed in the team catalog.`)) return;

    const previous = employees;
    setEmployees(employees.filter(e => e.id !== id));

    await CallAPI(() => deleteEmployee(id), {
      onCompleted: loadEmployees,
      onError: (err) => {
        console.error(err);
        setEmployees(previous);
      },
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) return;

    const savedEmployee: Employee = {
      id: editingEmployee ? editingEmployee.id : generateId(),
      fullName: fullName.trim(),
      jobPositionId: jobPositionId || undefined,
      status,
      email: email.trim() || undefined,
      contactNo: contactNo.trim() || undefined
    };

    const previous = employees;
    setEmployees(editingEmployee
      ? employees.map(emp => emp.id === savedEmployee.id ? savedEmployee : emp)
      : [...employees, savedEmployee]);

    await CallAPI(() => saveEmployee(savedEmployee), {
      onCompleted: loadEmployees,
      onError: (err) => {
        console.error(err);
        setEmployees(previous);
      },
    });

    setIsFormOpen(false);
  };

  return (
    <div className="space-y-6">
      {loading && <LoadingSpinner message="Accessing workforce roster..." subtitle="TEAM_CATALOG" />}
      {/* Top action block */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="font-sans font-bold text-slate-900 text-lg flex items-center space-x-2">
            <span className="p-1 bg-blue-50 text-blue-600 rounded">
              <Users className="w-5 h-5" />
            </span>
            <span>Employee Directory</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">Manage personnel records and engineering team availability to assign tasks</p>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <button
            id="btn-add-employee"
            type="button"
            onClick={handleOpenAddForm}
            className="flex items-center space-x-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Add Employee</span>
          </button>
        </div>
      </div>

      {/* Searching & filters panel */}
      <Card className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="relative md:col-span-2">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            id="input-search-employees"
            type="text"
            placeholder="Search by name, role, or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-blue-500 font-sans"
          />
        </div>

        <div>
          <ComboBox
            id="select-status-filter"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'ALL', label: 'All Statuses' },
              { value: 'ACTIVE', label: 'Active Team' },
              { value: 'INACTIVE', label: 'Inactive / Leave' },
            ]}
          />
        </div>
      </Card>

      {/* Employees catalog list */}
      {filteredEmployees.length === 0 ? (
        <Card className="p-12 text-center">
          <Users className="w-10 h-10 text-slate-300 mx-auto stroke-1 mb-2" />
          <span className="text-sm font-semibold text-slate-800 block">No Personnel Found</span>
          <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">Try matching with different filters, using the import helper, or adding employees manually above.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredEmployees.map(emp => (
            <Card
              key={emp.id}
              id={`emp-card-${emp.id}`}
              className="p-5 hover:border-slate-300 hover:shadow-md transition-all flex flex-col justify-between relative group animate-in fade-in slide-in-from-bottom-2 duration-150"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center shrink-0 border border-slate-200 text-slate-500 font-bold font-sans text-xs uppercase">
                      {emp.fullName.split(' ').map(n => n[0]).join('').substring(0, 2)}
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-sans font-bold text-slate-900 text-sm truncate">{emp.fullName}</h4>
                      {emp.jobPositionId && jobPositionMap.get(emp.jobPositionId) && (
                        <p className="text-[11px] text-slate-500 font-semibold truncate flex items-center space-x-1">
                          <Briefcase className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>{jobPositionMap.get(emp.jobPositionId)}</span>
                        </p>
                      )}
                    </div>
                  </div>

                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${emp.status === 'ACTIVE'
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-slate-100 text-slate-500'
                    }`}>
                    {emp.status}
                  </span>
                </div>

                <div className="pt-3 border-t border-slate-100 space-y-1.5 text-xs text-slate-600">
                  {emp.email && (
                    <div className="flex items-center space-x-2 truncate">
                      <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="font-mono text-[11px] truncate">{emp.email}</span>
                    </div>
                  )}
                  {emp.contactNo && (
                    <div className="flex items-center space-x-2">
                      <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="font-mono text-[11px]">{emp.contactNo}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Action buttons drawer overlay on hover */}
              <div className="flex items-center justify-end space-x-1.5 mt-4 pt-3 border-t border-slate-50 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                <button
                  id={`btn-edit-emp-${emp.id}`}
                  type="button"
                  onClick={() => handleOpenEditForm(emp)}
                  className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-slate-50 rounded transition-colors"
                  title="Edit details"
                >
                  <Edit className="w-3.5 h-3.5" />
                </button>
                <button
                  id={`btn-delete-emp-${emp.id}`}
                  type="button"
                  onClick={() => handleDelete(emp.id, emp.fullName)}
                  className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-slate-50 rounded transition-colors"
                  title="Remove employee"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Add / Edit Form Modal */}
      <Dialog
        open={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        maxWidth="max-w-md"
        headerClassName="bg-slate-50"
        titleClassName="font-sans font-bold text-slate-900 text-sm"
        titleIcon={
          <span className="p-1 bg-blue-50 text-blue-600 rounded">
            <Users className="w-4 h-4" />
          </span>
        }
        title={editingEmployee ? 'Edit Personnel Member' : 'Add New Personnel'}
      >
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs text-slate-600">
          <FormField label="Full Name *" labelClassName="font-semibold block text-slate-700">
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. John Doe"
              className={employeeFieldInputClassName}
            />
          </FormField>

          <FormField label="Job Position" labelClassName="font-semibold block text-slate-700">
            <ComboBox
              value={jobPositionId}
              onChange={setJobPositionId}
              noneLabel="-- Select Job Position --"
              options={activeJobPositionOptions}
            />
          </FormField>

          <FormField label="Availability Status" labelClassName="font-semibold block text-slate-700">
            <ComboBox
              value={status}
              onChange={(v) => setStatus(v as 'ACTIVE' | 'INACTIVE')}
              options={[
                { value: 'ACTIVE', label: 'ACTIVE' },
                { value: 'INACTIVE', label: 'INACTIVE' },
              ]}
            />
          </FormField>

          <FormField label="E-mail Address" labelClassName="font-semibold block text-slate-700">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. j.doe@sengjie.com"
              className={employeeFieldInputClassName}
            />
          </FormField>

          <FormField label="Phone Contact" labelClassName="font-semibold block text-slate-700">
            <input
              type="text"
              value={contactNo}
              onChange={(e) => setContactNo(e.target.value)}
              placeholder="e.g. +60 12-345-6789"
              className={employeeFieldInputClassName}
            />
          </FormField>

          <DialogFooter>
            <DialogCancelButton onClick={() => setIsFormOpen(false)} />
            <DialogSubmitButton className="shadow-sm">
              {editingEmployee ? 'Save Changes' : 'Create Record'}
            </DialogSubmitButton>
          </DialogFooter>
        </form>
      </Dialog>

    </div>
  );
}
```

Note: `JobPosition` (from `../types`) has `is_active`/`id`/`name` fields accessed in snake_case (`position.is_active`) — this matches the existing convention already used identically in `ContactDetailView.tsx` and the original `EmployeesView.tsx`, not a new inconsistency introduced here.

- [ ] **Step 2: Verify**

Run: `npm run lint`
Expected: exits 0 for `EmployeesView.tsx` and `EmployeesService.ts`. Remaining errors (if any) should only be in `WorkflowsView.tsx`, `OrderAccordion.tsx`, `WorkflowsService.ts`, `ImportExportModal.tsx` — fixed in Tasks 5-7.

---

### Task 5: `WorkflowsService.ts` — fix the `mapTaskRow` employee-name bug

**Files:**
- Modify: `src/services/WorkflowsService.ts:25`

**Interfaces:**
- No signature changes — `mapTaskRow`'s output (`WorkflowTask`) is unchanged in shape, only the source field read is corrected.

- [ ] **Step 1: Fix the row read**

Find:

```ts
    employeeName: row.employees?.name || undefined,
```

Replace with:

```ts
    employeeName: row.employees?.full_name || undefined,
```

(The query already selects `employees(full_name)` at `getWorkflowTasks`'s `.select(...)` call — only the read was wrong.)

- [ ] **Step 2: Verify**

Run: `npm run lint`
Expected: `tsc` still exits non-zero overall (`WorkflowsView.tsx`/`OrderAccordion.tsx`/`ImportExportModal.tsx` are still unresolved until Tasks 6-7) — `WorkflowsService.ts` itself contributes zero errors (no type-level change, just which field is read off an already-`any`-typed join result).

---

### Task 6: `useTableData.ts`, `WorkflowsView.tsx`, `OrderAccordion.tsx` — fix the `employees` mapper and field references

**Files:**
- Modify: `src/hooks/useTableData.ts:59`
- Modify: `src/components/WorkflowsView.tsx:60`
- Modify: `src/components/OrderAccordion.tsx:26`

**Interfaces:**
- Produces: `useTableData<Employee>('employees', ...)` now returns properly-shaped `Employee` objects (`fullName`, `contactNo`, `jobPositionId`, `email`, `status`, `id`) instead of raw untransformed rows.

- [ ] **Step 1: Fix the `employees` row mapper in `useTableData.ts`**

Find:

```ts
  employees: (e) => e,
```

Replace with (matching the file's other mappers' style, e.g. `contacts` immediately above):

```ts
  employees: (e) => ({
    id: e.id, fullName: e.full_name, contactNo: e.contact_no, email: e.email,
    jobPositionId: e.job_position, status: e.status,
    createdAt: e.created_at, updatedAt: e.updated_at
  }),
```

- [ ] **Step 2: Fix `WorkflowsView.tsx`'s field reference**

Find:

```ts
        return { ...t, employeeId: employeeId || undefined, employeeName: employee?.name };
```

Replace with:

```ts
        return { ...t, employeeId: employeeId || undefined, employeeName: employee?.fullName };
```

- [ ] **Step 3: Fix `OrderAccordion.tsx`'s field reference**

Find:

```ts
  const employeeOptions = employees.map(emp => ({ value: emp.id, label: emp.name }));
```

Replace with:

```ts
  const employeeOptions = employees.map(emp => ({ value: emp.id, label: emp.fullName }));
```

- [ ] **Step 4: Verify**

Run: `npm run lint`
Expected: exits 0 across all three files.

---

### Task 7: `ImportExportModal.tsx` — rename fields, relax import validation

**Files:**
- Modify: `src/components/ImportExportModal.tsx:172-183` (EMPLOYEES export)
- Modify: `src/components/ImportExportModal.tsx:286-287` (EMPLOYEES required-columns text)
- Modify: `src/components/ImportExportModal.tsx:474-497` (EMPLOYEES import)

**Interfaces:**
- No exported signatures change — only field names read/written on `Employee` objects and the help text shown to the user.

- [ ] **Step 1: Fix the export block**

Find:

```ts
    } else if (type === 'EMPLOYEES') {
      const employees = getEmployees();
      appendRowsSheet(wb, 'Employees', employees.map((employee) => ({
        id: employee.id,
        name: employee.name,
        role: employee.role,
        status: employee.status,
        email: employee.email || '',
        phone: employee.phone || ''
      })));
      fileName = `ERP_Employees_${dateStamp}.xlsx`;
      exportedRecordCount = employees.length;
```

Replace with:

```ts
    } else if (type === 'EMPLOYEES') {
      const employees = getEmployees();
      appendRowsSheet(wb, 'Employees', employees.map((employee) => ({
        id: employee.id,
        fullName: employee.fullName,
        jobPositionId: employee.jobPositionId || '',
        status: employee.status,
        email: employee.email || '',
        contactNo: employee.contactNo || ''
      })));
      fileName = `ERP_Employees_${dateStamp}.xlsx`;
      exportedRecordCount = employees.length;
```

- [ ] **Step 2: Fix the required-columns help text**

Find:

```ts
      case 'EMPLOYEES':
        return `Required columns:\nname\trole\tstatus\temail\tphone`;
```

Replace with:

```ts
      case 'EMPLOYEES':
        return `Required columns:\nfullName\tstatus\temail\tcontactNo\nOptional: jobPositionId`;
```

- [ ] **Step 3: Fix the import block**

Find:

```ts
      else if (activeImportType === 'EMPLOYEES') {
        const current = importMode === 'OVERWRITE' ? [] : getEmployees();
        const itemsToImport: Employee[] = parsed.map((raw: any, index) => {
          if (!raw.name) throw new Error(`Record #${index + 1} is missing an employee 'name' field.`);
          if (!raw.role) throw new Error(`Record #${index + 1} ('${raw.name}') is missing an employee 'role' field.`);
          return {
            id: raw.id || generateId(),
            name: String(raw.name),
            role: String(raw.role),
            status: raw.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
            email: raw.email || undefined,
            phone: raw.phone || undefined
          };
        });

        const merged = importMode === 'OVERWRITE' ? itemsToImport : [
          ...current.filter(c => !itemsToImport.some(i => i.id === c.id || i.name.toLowerCase() === c.name.toLowerCase())),
          ...itemsToImport
        ];

        saveEmployees(merged);
        successCount = itemsToImport.length;
        logs.push(`Imported ${successCount} employees successfully to the active directory.`);
      }
```

Replace with:

```ts
      else if (activeImportType === 'EMPLOYEES') {
        const current = importMode === 'OVERWRITE' ? [] : getEmployees();
        const itemsToImport: Employee[] = parsed.map((raw: any, index) => {
          if (!raw.fullName) throw new Error(`Record #${index + 1} is missing an employee 'fullName' field.`);
          return {
            id: raw.id || generateId(),
            fullName: String(raw.fullName),
            jobPositionId: raw.jobPositionId || undefined,
            status: raw.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
            email: raw.email || undefined,
            contactNo: raw.contactNo || undefined
          };
        });

        const merged = importMode === 'OVERWRITE' ? itemsToImport : [
          ...current.filter(c => !itemsToImport.some(i => i.id === c.id || i.fullName.toLowerCase() === c.fullName.toLowerCase())),
          ...itemsToImport
        ];

        saveEmployees(merged);
        successCount = itemsToImport.length;
        logs.push(`Imported ${successCount} employees successfully to the active directory.`);
      }
```

- [ ] **Step 4: Verify**

Run: `npm run lint`
Expected: exits 0 across the whole project — this should be the last file with `Employee`-shape errors.

---

### Task 8: Full-project verification + manual QA handoff

**Files:**
- None (verification only).

- [ ] **Step 1: Full lint pass**

Run: `npm run lint`
Expected: exits 0, zero TypeScript errors anywhere in the project.

- [ ] **Step 2: Grep for any remaining old-shape references**

Run: `grep -rn "emp\.name\|emp\.role\|emp\.phone\|employee\.name\|employee\.role\|employee\.phone\|\.name === role\|position.name === role" src/ --include=*.tsx --include=*.ts`

Expected: no matches (or only matches unrelated to `Employee` — inspect each hit before concluding clean).

- [ ] **Step 3: Hand off for manual QA**

Tell the user the following checklist needs manual verification in the running app (per project convention, the agent does not launch the dev server or browser automation):

- Add a new employee with a full name, a job position selected, status ACTIVE, email, and phone — appears in the Employee Directory card grid with the correct job position label shown.
- Add a new employee leaving Job Position blank — saves fine, card shows no job-position line (no crash).
- Edit an existing employee — change job position, status, and contact info; confirm the change persists after closing and reopening the form.
- Delete an employee — confirms, removes from the list, and doesn't reappear on refresh.
- Search box filters by name, job position name, and email; status filter (All/Active/Inactive) still works.
- Go to Workflows tab, open an in-production order's accordion, and assign an employee via the picker — confirm the employee's full name (not blank) appears both in the picker dropdown and on the assigned task after saving.
- Reload the Workflows tab — confirm previously-assigned employee names still render correctly (exercises the `WorkflowsService.mapTaskRow` fix).
- In Import/Export, export the Employee Directory to Excel — confirm the sheet has `fullName`/`jobPositionId`/`status`/`email`/`contactNo` columns (values may reflect stale/cached data if no fresh Employees import has run since this migration — that's a pre-existing limitation, not a regression to chase down here).
- Import an Employee sheet with only `fullName` (no `jobPositionId`) filled in for one row — confirms import succeeds without requiring a job position.
