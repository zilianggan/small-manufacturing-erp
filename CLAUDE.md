# CLAUDE.md - Token Saving Reference

Quick reference for efficient prompting with this ERP project.

## Key Context (Keep in Head)
- **Stack**: Electron + React 19 + TypeScript + Tailwind v4 | Node.js/Express backend | Supabase
- **Project**: Seng Jie Manufacturing ERP at `C:\Projects\small-manufacturing-erp`
- **UI**: 8 tabs (Dashboard, Inventory, Contacts, Employees, Orders, Purchases, Workflows, Reports)
- **Data**: All via Supabase (except company_profile: localStorage-first, API fallback)

## Fast Responses
- Communication: caveman lite always in this project — terse, no filler/hedging, full sentences kept
- Code: ponytail (lazy-but-correct) always in this project — YAGNI first, reuse before writing, stdlib/native before a dependency, shortest diff that's actually right. Question unrequested scope in one line rather than silently building it.
- "just code" for pure implementation, skip explanation

## Common Patterns

### Reading Existing Code
```
1. Read(path) → use offset/limit for large files, no need to dump the whole thing
2. Ask directly: "what's wrong" not "please explain"
3. Edit, not full rewrites
```

### Adding Features
- What view? (Dashboard/Inventory/Contacts/etc)
- What data? (use existing types from `types.ts`)
- Where persists? (always Supabase, via that module's `services/<Module>Service.ts`)

### File Structure Shortcuts
- Components: `src/components/{ViewName}.tsx` (list/index view), `src/components/{ViewName}Detail.tsx` for drill-down pages (e.g. `ContactDetailView.tsx`) — split out once a view does both list and detail
- Services: `src/services/{Module}Service.ts`, every module — direct-to-Supabase via `helper.ts` primitives or the `supabase` client; `supabase.ts` (client)
- Backend: `server.ts` is just the Vite dev/prod host + `/api/health` — no data API. All data access is client-side Supabase calls.
- Types: `src/types.ts` (all interfaces)

## Data Flow Checklist
- ✅ **Every module** owns a `services/<Module>Service.ts` that talks to Supabase directly via `helper.ts` primitives (`getRecords`/`upsertRecord`/`deleteRecord`/`getStorageItem`/`setStorageItem`) or the `supabase` client for search/filtered reads. No `db.ts` (doesn't exist), no `server.ts` REST hop (doesn't exist — server.ts is just the Vite host + `/api/health`), no `useTableData` hook (doesn't exist). Migration is complete — Inventory/Orders/Purchases/Employees/Reports all moved to `OrdersService.ts`/`PurchasesService.ts`/`MaterialService.ts`/`ProductService.ts`/`EmployeesService.ts`/`DashboardService.ts`. Reference implementations: `CompanyProfileService.ts`, `SystemAdminService.ts`, `ContactsService.ts`.
- ✅ Company profile exception? → localStorage-first with direct Supabase read/write in `CompanyProfileService.ts`.
- ❌ localStorage as the source of truth? → No. It's only an optional cache-aside layer (see `SystemAdminService.ts`), always invalidated on write.

### When adding a feature or module
1. Does a `services/<Module>Service.ts` exist? Extend it. If not, create one following `ContactsService.ts` (reads: `supabase.from(table)...`; writes: `helper.ts`'s `upsertRecord`/`deleteRecord`).
2. View owns its own `useState` + `useEffect` + `CallAPI` loading (see `SystemAdminView.tsx`/`ContactsView.tsx`) — no shared data-fetching hook needed.
3. Keep detail/drill-down pages in their own component file (e.g. `ContactDetailView.tsx`) instead of growing the list view — split when a view starts doing two jobs (list vs. detail).

## API Endpoints (server.ts)
```
GET  /api/health             → { status, time } — that's the whole API
```
Everything else is client-side Supabase (`src/services/*.ts` → `supabase.ts` client). No REST data API.

## Reference Files
- `knowledge.md` — Updated after each arch change, current codebase state
- `docs/flows.md` — Purchase/Sales/Inventory lifecycle (statuses, stock effects, gates), updated after each flow change
- `types.ts` — All 15+ interfaces (CompanyProfile, InventoryItem, Order, Vendor, Client, Contact, etc.)
- `helper.ts` — Shared Supabase primitives (`getRecords`/`upsertRecord`/`deleteRecord`/`getStorageItem`/`setStorageItem`) used directly by module services

## Micro-Optimizations
- **Reading a file?** Use `offset`/`limit` to grab the relevant slice, not the whole file
- **Editing?** `Edit`'s `old_string` must match exactly, whitespace and newlines included
- **Git?** Bash for complex ops (merge, rebase, worktree)

## When to Ask for Clarification (vs assume)
- ✅ File path ambiguous? Ask.
- ✅ Conflicting requirements? Ask once, decide fast.
- ❌ Obvious from code? Just implement.
- ❌ Data location known? Don't re-verify.

## Session Recovery
After `/clear` in planning mode:
- Context is lost → Re-state what you need (file paths, goal, constraints)
- Use `task_plan.md` / `progress.md` if active

---
*Last updated: Session start. Maintain this file as arch evolves.*
