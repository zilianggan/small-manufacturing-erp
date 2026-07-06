# CLAUDE.md - Token Saving Reference

Quick reference for efficient prompting with this ERP project.

## Key Context (Keep in Head)
- **Stack**: Electron + React 19 + TypeScript + Tailwind v4 | Node.js/Express backend | Supabase
- **Project**: Seng Jie Manufacturing ERP at `C:\Projects\small-manufacturing-erp`
- **UI**: 8 tabs (Dashboard, Inventory, Contacts, Employees, Orders, Purchases, Workflows, Reports)
- **Data**: All via Supabase (except company_profile: localStorage-first, API fallback)

## Filesystem MCP Rules (CRITICAL)
Use **only these tools** on Windows filesystem:
| Task | Tool |
|------|------|
| Create file | `Filesystem:write_file` |
| Edit file | `Filesystem:edit_file` (JSON edits array) |
| Read file | `Filesystem:read_text_file` (supports head/tail) |
| List dir | `Filesystem:list_directory` (use full paths) |

⚠️ **Never use** `create_file` or `str_replace` — they're Claude sandbox only, don't touch your disk.

## Fast Responses (Lite Caveman Mode)
- Use `/caveman lite` for 30-40% token cut
- Say "terse" or "minimal explanation"
- "just code" for pure implementation
- Skip pleasantries, go direct

## Common Patterns

### Reading Existing Code
```
1. Filesystem:read_text_file(path) → read full or head/tail
2. Ask directly: "what's wrong" not "please explain"
3. Provide edits, not full rewrites
```

### Adding Features
- What view? (Dashboard/Inventory/Contacts/etc)
- What data? (use existing types from `types.ts`)
- Where persists? (always Supabase via `useTableData`)

### File Structure Shortcuts
- Components: `src/components/{ViewName}.tsx` (list/index view), `src/components/{ViewName}Detail.tsx` for drill-down pages (e.g. `ContactDetailView.tsx`) — split out once a view does both list and detail
- Services: `src/services/{Module}Service.ts` (preferred, direct-to-Supabase) — e.g. `ContactsService.ts`, `SystemAdminService.ts`, `CompanyProfileService.ts`; `db.ts` (legacy Zustand + per-table helpers), `supabase.ts` (client)
- Backend: `server.ts` (Express `/api/data/:table` — legacy path only, see Data Flow Checklist)
- Types: `src/types.ts` (all interfaces)

## Data Flow Checklist
- ✅ **Preferred (new/refactored modules)**: module owns a `services/<Module>Service.ts` that talks to Supabase directly via `helper.ts` primitives (`getRecords`/`upsertRecord`/`deleteRecord`/`getStorageItem`/`setStorageItem`) or the `supabase` client for search/filtered reads. No `db.ts`, no `server.ts` REST hop, no `useTableData` hook. Reference implementations: `CompanyProfileService.ts`, `SystemAdminService.ts`, `ContactsService.ts`.
- ⚠️ **Legacy path (older views not yet migrated)**: `useTableData<Type>('table_name')` hook → hits `server.ts`'s `/api/data/:table`. Still used by Inventory/Orders/Purchases/Employees/Reports — don't add new dependents; migrate to a dedicated service when touching those views.
- ✅ Company profile exception? → localStorage-first with direct Supabase read/write in `CompanyProfileService.ts`.
- ❌ localStorage as the source of truth? → No. It's only an optional cache-aside layer (see `SystemAdminService.ts`), always invalidated on write.

### When adding a feature or module
1. Does a `services/<Module>Service.ts` exist? Extend it. If not, create one following `ContactsService.ts` (reads: `supabase.from(table)...`; writes: `helper.ts`'s `upsertRecord`/`deleteRecord`).
2. View owns its own `useState` + `useEffect` + `CallAPI` loading (see `SystemAdminView.tsx`/`ContactsView.tsx`) — no shared data-fetching hook needed.
3. Keep detail/drill-down pages in their own component file (e.g. `ContactDetailView.tsx`) instead of growing the list view — split when a view starts doing two jobs (list vs. detail).

## API Endpoints (server.ts)
```
GET  /api/data/:table        → Paginated table fetch (range-based)
GET  /api/profile            → Company profile
POST /api/gemini             → AI text generation
POST /api/:table             → Insert (if added)
```

## Reference Files
- `knowledge.md` — Updated after each arch change, current codebase state
- `types.ts` — All 15+ interfaces (CompanyProfile, InventoryItem, Order, Vendor, Client, Contact, etc.)
- `helper.ts` — Shared Supabase primitives (`getRecords`/`upsertRecord`/`deleteRecord`/`getStorageItem`/`setStorageItem`) used directly by module services
- `db.ts` — Legacy Zustand store `useSyncStore` + per-table helpers; still backs older views (Inventory/Orders/Purchases/Employees/Reports) and `ImportExportModal.tsx`'s bulk backup — don't extend it for new work

## Micro-Optimizations
- **Reading a file?** Use `head: 50` to grab top lines first
- **Multiple files?** Use `read_multiple_files` in one call
- **Editing?** Exact string match in `edit_file`, include whitespace/newlines
- **Git?** Use bash for complex ops (merge, rebase, worktree)

## When to Ask for Clarification (vs assume)
- ✅ File path ambiguous? Ask.
- ✅ Conflicting requirements? Ask once, decide fast.
- ❌ Obvious from code? Just implement.
- ❌ Data location known? Don't re-verify.

## Session Recovery
After `/clear` in planning mode:
- Context is lost → Re-state what you need (file paths, goal, constraints)
- Use `task_plan.md` / `progress.md` if active
- Filesystem tools work independently (no memory needed)

---
*Last updated: Session start. Maintain this file as arch evolves.*
