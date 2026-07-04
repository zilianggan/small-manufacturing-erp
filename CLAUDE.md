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
- Components: `src/components/{ViewName}.tsx`
- Services: `src/services/db.ts` (Zustand), `supabase.ts` (client)
- Backend: `server.ts` (Express endpoints)
- Types: `src/types.ts` (all interfaces)

## Data Flow Checklist
- ✅ Need to fetch? → `useTableData<Type>('table_name')` hook
- ✅ Need to save? → Call Supabase client directly or via API endpoint
- ✅ Company profile exception? → localStorage-first with `/api/profile` fallback
- ❌ localStorage for other tables? → No. Supabase only.
- ❌ `company_profile` in `useTableData`? → Error. Use API endpoint.

## API Endpoints (server.ts)
```
GET  /api/data/:table        → Paginated table fetch (range-based)
GET  /api/profile            → Company profile
POST /api/gemini             → AI text generation
POST /api/:table             → Insert (if added)
```

## Reference Files
- `knowledge.md` — Updated after each arch change, current codebase state
- `types.ts` — All 15+ interfaces (CompanyProfile, InventoryItem, Order, etc.)
- `db.ts` — Zustand store `useSyncStore` + helpers

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
