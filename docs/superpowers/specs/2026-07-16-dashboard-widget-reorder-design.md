# Dashboard Widget Reorder — Design

Builds on [[2026-07-16-dashboard-widget-visibility-design]] (already implemented, uncommitted). Adds drag-and-drop position reordering for the same 11 dashboard sections, and replaces the visibility popover with an explicit "customize mode" that hosts both drag handles and per-card hide toggles.

## Goal
User drags dashboard sections into any order directly on the live dashboard, entered via an explicit customize mode (toggled by the existing gear button). Order persists in Supabase alongside the existing visibility preference.

## Library
Add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` (npm install required — not currently installed). Chosen over hand-rolled HTML5 drag events: touch support, accessible keyboard reordering, and grid-reflow collision detection are all handled; hand-rolling this correctly is substantially more code.

## Layout: unified 6-column grid
The current dashboard uses several separate grid containers with different column counts (5-col KPI row, 3-col chart rows, 2-col alert rows). To make every section freely reorderable relative to every other section while preserving today's visual proportions, all 11 sections move into **one** `grid-cols-1 lg:grid-cols-6` container with `grid-auto-flow: row dense` (dense fill avoids gaps when differently-sized items land adjacent after a reorder). Each section keeps a fixed column span mapped from its current width:

| Key | Span (of 6) | Matches today's width |
|---|---|---|
| `KPI_ROW` | 6 | full row |
| `SALES_TREND` | 4 | 2/3 |
| `INVENTORY_DISTRIBUTION` | 2 | 1/3 |
| `PURCHASE_VS_SALES` | 4 | 2/3 |
| `INVENTORY_HEALTH` | 2 | 1/3 |
| `QUICK_ACTIONS` | 2 | 1/3 |
| `RECENT_SALES` | 2 | 1/3 |
| `RECENT_PURCHASES` | 2 | 1/3 |
| `CRITICAL_STOCK_ALERTS` | 3 | 1/2 |
| `PRODUCTION_STATUS` | 3 | 1/2 |
| `ACTIVITY_TIMELINE` | 6 | full row |

KPI_ROW's internal 5-stat-card layout is unchanged — it's still one draggable unit, just now a grid item with span 6 instead of its own separate grid container.

## Data model
Extend the (not-yet-run) `dashboard_preferences` table from the visibility feature — since it hasn't been deployed yet, edit the same `CREATE TABLE` block in `supabase/schema.sql` rather than adding a migration:

```sql
create table dashboard_preferences (
  id uuid primary key default gen_random_uuid(),
  visible_sections jsonb not null default '{}'::jsonb,
  section_order jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
```

`types.ts`: extend `DashboardPreferences` with `section_order?: DashboardSectionKey[]`. Empty/missing array = default order (the table order above). Any section key missing from a stored `section_order` (e.g. a new section added in a future release) is appended at the end, so old rows never hide new sections.

## UI: customize mode
The gear button (bottom-right, unchanged position) toggles a `customizing` boolean instead of opening a popover — the popover-based checkbox list from the visibility feature is removed, folded into this mode instead.

- **Off (default):** dashboard renders normally, gear button visible, no drag handles, hidden sections not rendered.
- **On:** gear button becomes a "Done" button (same fixed position). Every section — visible or hidden — renders inside a thin overlay header strip added to its card: a drag handle (`GripVertical` icon, dnd-kit's listener target) on the left, an eye/eye-off toggle button on the right. Hidden sections still render in customize mode (so they can be re-shown) but at reduced opacity with a dashed border. Clicking Done exits customize mode; hidden sections stop rendering.
- Dragging updates the in-memory order immediately (dnd-kit's `onDragEnd`); the eye toggle updates visibility immediately — both fire the same debounced-free `saveDashboardPreferences` call used by the existing visibility feature (fire-and-forget, no debounce, singleton-row upsert already handles rapid writes safely).

## Persistence
`saveDashboardPreferences` (existing service, already upsert-based) takes the full `DashboardPreferences` object including `section_order` — no service changes needed beyond the type extension already covering the new field; the existing `upsert(...).select().single()` call persists whatever shape it's given.

## Error handling
Same as the visibility feature: any Supabase error on read → default (natural order, all visible); on write → `console.error`, UI already reflects the optimistic change locally.

## Out of scope
- Free-form (pixel) positioning — grid-slot reordering only.
- Resizing sections / changing column spans per user.
- Per-user order (no auth/session concept in this app, same as visibility).
