# Page Redesign Design System

Reference doc distilled from the three pages already rebuilt in the premium UI
redesign — **Dashboard** (`DashboardView.tsx`), **Material Catalog**
(`MaterialView.tsx`), and **Inventory Transactions** (`InventoryView.tsx`).
Use this to redesign the remaining legacy tabs (Contacts, Employees, Orders,
Purchases, Workflows, Reports) consistently, instead of re-deriving patterns
from scratch or copy-pasting between the three reference pages.

Stack: React 19 + TypeScript + Tailwind v4 (CSS-token theme, no
`tailwind.config.js`) + shadcn-pattern hand-authored primitives on Radix UI +
GSAP + Recharts. No new component library — everything below already exists
in `src/components/shell/` and `src/components/ui/`.

---

## 1. Design tokens (`src/index.css`)

CSS custom properties, light in `:root` + dark in `.dark`, mapped to Tailwind
utilities via `@theme inline`. Always use the token utility, never a raw
Tailwind color (`bg-slate-50`, `text-blue-600`, etc.) in new/redesigned code:

| Token | Utility | Use |
|---|---|---|
| `--background` / `--foreground` | `bg-background` / `text-foreground` | page canvas |
| `--card` / `--card-foreground` | `bg-card` / `text-card-foreground` | panels, table headers |
| `--popover` | `bg-popover` | dropdowns, dialogs, tooltips |
| `--primary` (blue) | `bg-primary`, `text-primary`, `border-primary` | brand accent, links, active states |
| `--secondary` | `bg-secondary`, `text-secondary-foreground` | neutral chips, hover backgrounds |
| `--muted-foreground` | `text-muted-foreground` | secondary/caption text |
| `--destructive` / `--success` / `--warning` | same pattern | status semantics |
| `--border` / `--input` | `border-border`, `border-input` | all borders |
| `--chart-1`…`--chart-5` | inline `style={{ stroke: 'var(--chart-1)' }}` | Recharts series (CSS vars, not Tailwind classes, inside SVG) |
| `--radius` (1rem base) | `rounded-lg`/`rounded-xl`/`rounded-2xl` (mapped via `@theme inline`) | large, soft corners everywhere |

The **legacy `.dark` override block** further down in `index.css` (targets
raw `bg-slate-*`/`text-slate-*` classes) is untouched and still active — it's
what keeps the *not-yet-redesigned* tabs readable in dark mode. Don't delete
it until every tab is migrated.

`tailwindcss-animate` is registered (`@plugin "tailwindcss-animate";`) — this
is what makes `animate-in`/`fade-in`/`zoom-in-95`/`slide-in-from-right`
actually work on Radix `data-state` attributes. Required for every
Sheet/Dialog/Popover/DropdownMenu/Tooltip/ContextMenu/HoverCard.

---

## 2. Shared component library

### `src/components/shell/*` — page-level building blocks
- **`PageHeader`** — `title`, `description`, `actions` (right-aligned button row), `breadcrumb`. Every page starts with one.
- **`SectionCard`** — generic bordered panel: `title`/`description`/`actions` header + body. The default panel for everything that isn't a chart or a data table.
- **`ChartCard`** — `SectionCard` variant with a `legend` slot; wrap every Recharts chart in one.
- **`StatCard`** — KPI tile with icon chip + GSAP count-up (`useCountUp`) + optional trend line. Dashboard KPI row.
- **`MetricCard`** — bare label/value pair, no card chrome. Used inside `DetailPanel`/drawers for dense field grids.
- **`ActionCard`** — icon + label tile with hover lift, for "quick action" grids.
- **`NotificationCard`** / **`TimelineCard`** — list-item and timeline-entry renderers for Dashboard-style activity feeds.
- **`DataTable<T>`** — the one table component. Columns (`DataTableColumn<T>`: `key/header/sortable/align/className/render`), `sortField/sortDir/onSort`, `selectable/selectedKeys/onToggleSelect(All)`, `activeKey` (highlight a row independent of bulk-select — e.g. "currently shown in the detail panel"), `onRowClick`, `rowActions` (hover-reveal `ActionsMenu`), `loading` (skeleton rows), `emptyState`.
- **`FilterBar`** — search input + "Filter" button (badge count) + filter chips row + `right`/`bulkActions` slot (swaps to `bulkActions` when `selectedCount > 0`).
- **`Pagination`** — page-number Prev/Next control. **Not used by either Material or Inventory** — both use infinite scroll instead (see §5). Keep `Pagination` for a future page that genuinely wants numbered pages.
- **`SplitView`** — two-pane workspace (fixed-width list + flexible detail), stacks to a column below **`min-[1440px]`** (a custom breakpoint — a Split Workspace needs real width, `1440px` not Tailwind's default `lg` 1024px).
- **`DetailPanel`** — the right pane of a `SplitView`: header (image/title/badges/actions) + scrollable body, or a centered `emptyState`.
- **`SlideOverForm`** — `Sheet` + `Tabs` wrapper for a *tabbed* record editor. **Material stopped using this** in favor of a flat (no-tabs) `Sheet` — see §5.4. Keep `SlideOverForm` for a genuinely multi-section editor where tabs earn their keep.
- **`DashboardShell`** — root wrapper that wires the GSAP entrance stagger (`useFadeInOnMount`) for every `data-fade-item` descendant, `space-y-6` layout. Used by Dashboard; Material/Inventory don't use it (they call `useFadeInOnMount` directly, see §6.1) since they aren't pure vertical stacks.

### `src/components/ui/*` — shadcn-pattern primitives (Radix + cva)
`Button`, `Badge`, `Card`(+Header/Title/Description/Content/Footer/EmptyState), `Table`(+Header/Body/Row/Head/Cell), `Tabs`, `Tooltip`, `Popover`, `DropdownMenu`(+CheckboxItem/Label/Separator), `Avatar`, `ScrollArea`, `Separator`, `HoverCard`, `ContextMenu`, `Progress`, `Skeleton`, `Breadcrumb`, `Command`, `Dialog`(+Footer/CancelButton/SubmitButton), `Sheet`, `ActionsMenu`, `FormField`(+`fieldInputClassName`), `SearchInput`, `Toast`(`useToast`), `ConfirmDialog`(`useConfirm`). All exported from `src/components/ui/index.ts` — import from there, not the individual files.

`ComboBox` (`src/components/ComboBox.tsx`, **not** in the `ui/` barrel — it's an older shared component, not part of the new primitive set) is built on `@radix-ui/react-popover` internally. **Do not** reimplement it with a hand-rolled `createPortal(..., document.body)` — see §6.4 for why that breaks inside any Sheet/Dialog.

---

## 3. Pattern A — Command Center (Dashboard)

For: an overview/landing page with no single "record" to manage — KPIs, charts, feeds.

```
<DashboardShell deps={[loading]}>
  <PageHeader title description />
  <div grid>  5× <StatCard data-fade-item />              </div>
  <div grid>  <ChartCard/> (2/3) + <ChartCard/> (1/3)      </div>   -- repeat per chart row
  <SectionCard>  <ActionCard/> grid                        </SectionCard>
  <div grid>  <SectionCard/> (list) × N                    </div>
  <SectionCard>  <TimelineCard/>                            </SectionCard>
</DashboardShell>
```

- Every direct card gets `data-fade-item` so `DashboardShell`'s GSAP stagger picks it up on mount/data-reload (`deps={[loading]}` replays the stagger after the fetch completes).
- Charts are raw Recharts (`AreaChart`/`BarChart`/`PieChart`) inside `ChartCard`, colored via `var(--chart-N)` (CSS var, not a Tailwind class — SVG `fill`/`stroke` need the literal value).
- `Tooltip cursor={{ fill: 'var(--primary)', opacity: 0.08 }}` on bar charts — the recharts default cursor is a flat gray box; this makes hover match the rest of the app's blue-tinted hover states.
- KPI honesty: don't fabricate a stat the schema can't back. Dashboard needed "$ Inventory Value" but no per-unit cost basis exists without a live RPC change — shipped "Inventory Units" instead and said so.
- List-style `SectionCard`s (Recent Sales/Purchases, Critical Stock Alerts) use `divide-y divide-border` rows with a `Badge` for status, not a full `DataTable` — a `DataTable` is overkill for a 3-5 row feed with no sort/filter/pagination need.

---

## 4. Pattern B — Split Workspace (Material Catalog)

For: a browsable catalog/list where the user picks one record and wants to see + edit its full profile without leaving the list.

```
<div className="flex flex-col gap-4 sm:gap-5 min-[1440px]:h-full min-[1440px]:min-h-0">
  <PageHeader actions={<Button>+ Add X</Button>} />
  <SplitView
    leftWidth="min-[1440px]:w-[60%]"
    leftClassName="h-[560px] min-[1440px]:h-auto"
    rightClassName="h-[480px] min-[1440px]:h-auto"
    left={  <SectionCard className="flex-1 min-h-0" contentClassName="p-0 flex-1 min-h-0 flex flex-col">
              <div className="p-5 border-b shrink-0"> <FilterBar/> + quick-filter chip row </div>
              <div ref={tableScrollRef} className="flex-1 min-h-0 overflow-auto">
                <DataTable activeKey={selected?.id} onRowClick={setSelected} .../>
                <InfiniteScrollSentinel rootRef={tableScrollRef} .../>
              </div>
            </SectionCard> }
    right={ <DetailPanel title subtitle badges actions emptyState>
              <MetricCard grid/>, image/attachment preview, related-record table
            </DetailPanel> }
  />
  <FilterDialog .../>       {/* advanced multi-pick filter, existing component, reuse as-is */}
  <Sheet .../>               {/* Add/Edit drawer — see §5.4 */}
</div>
```

Key decisions worth repeating on the next page:

1. **60/40 split, custom `1440px` breakpoint.** Not Tailwind's `lg` (1024px) — a two-pane workspace needs real width or both panes feel cramped. Below 1440px it stacks to one column (table above, detail below), each given an explicit fixed height (`h-[560px]`/`h-[480px]`) so neither pane collapses to zero height on a narrow window — `flex-1`/`min-h-0` alone only work once an ancestor has a *definite* height, which only exists at `1440px`+ here (see §6.2).
2. **Own-scroll table, sticky header, no page-level x-scroll.** The table lives in its own `overflow-auto` div (`tableScrollRef`), not the page. `ui/Table.tsx`'s `<table>` uses **default (`auto`) layout**, not `table-fixed` — `table-fixed` + `w-full` forces the table to exactly the container width and *squeezes* columns that don't fit, rather than letting the table grow and the container scroll. Auto layout + an `overflow-auto` ancestor is what actually reproduces "all columns visible, scroll to see the rest" — give each column a `w-*` hint via `className` and it's respected as a floor, not a hard cap.
3. **Row highlight vs bulk-select are different concepts.** `DataTable`'s `selectedKeys` is for bulk actions (checkboxes); `activeKey` is a *single* highlighted row (the one shown in the detail panel) — don't conflate them, they need independent styling (`activeKey` → `bg-primary/10` + left accent border).
4. **"Shrink-to-fit" column trick**: a narrow column (a badge, a short status) gets `className: 'w-[1%] whitespace-nowrap'`, not a fixed px width — `1%` in an auto-layout table makes the column take only its content's minimum width, handing the saved space to the flexible name/description column instead.
5. **Category/quick-filter chips are resolved client-side** against one unpaginated snapshot fetch (already-existing `getMaterials('')`/equivalent), intersected with the paginated fetch's `p_ids` filter — reuses the exact plumbing the advanced multi-pick filter already has. No new RPC.
6. **Infinite scroll, not page numbers** (`offset`/`hasMore`/`loadingMore` state + `InfiniteScrollSentinel` with `rootRef={tableScrollRef}` so it's watching the *inner* scroll container, not the viewport).

---

## 5. Pattern C — Table-First Ledger (Inventory Transactions)

For: a high-volume, largely read-only, insert-only log where the table itself is 95% of the page — no detail panel, no stat cards competing for space.

```
<div className="flex flex-col gap-5 h-full min-h-0">
  <PageHeader actions={<Button variant=outline>Statistics</Button> <Button>Primary Action</Button>} />
  <SectionCard title="Filters" className="shrink-0" contentClassName="p-4 space-y-3">
    <FilterBar/>
    <div className="flex gap-1.5 flex-wrap"> quick chips </div>
  </SectionCard>
  <SectionCard className="flex-1 min-h-0" contentClassName="p-0 flex-1 min-h-0 flex flex-col">
    <div ref={tableScrollRef} className="flex-1 min-h-0 overflow-auto">
      <DataTable .../>
      <InfiniteScrollSentinel rootRef={tableScrollRef} .../>
    </div>
  </SectionCard>
  <FilterDialog .../>
  <Sheet .../>                {/* row detail drawer, opened from a reference/id cell */}
  <Sheet .../>                {/* create-record drawer, if any manual entry exists */}
  <Dialog maxWidth="max-w-7xl" .../>   {/* Statistics — heavy analytics behind a button, not on the page */}
</div>
```

Differences from Pattern B worth noting:

- **No `SplitView`, no permanent detail panel.** Clicking a row/reference opens a `Sheet` drawer (tabs only if the record genuinely has sub-sections — Overview always, plus Items/Attachments only when a linked order actually exists; a standalone/adjustment row just gets a single Overview panel, no tabs for tabs' sake).
- **Root needs `h-full min-h-0` unconditionally**, not gated behind a breakpoint like Pattern B — there's no competing sibling pane here, so there's no mobile-collapse risk from doing it always. Do check whether your new page has a Pattern-B-style multi-pane risk before copying this exact call.
- **Heavy stats live behind a button → `Dialog maxWidth="max-w-7xl"`**, opened+fetched lazily (`if (stats) return;` guard so re-opening doesn't re-fetch). Never put charts/KPI cards on the main page if the brief says "the table is the hero."
- **Sort split by what the data actually supports**: columns backed by a real table column sort server-side (part of the paginated fetch); columns that are joined/derived from *either of two different foreign tables depending on row type* (e.g. a reference number that's `purchase_no` for one row type and `sales_no` for another) sort **client-side** over whatever's currently loaded — PostgREST can't express "order by whichever of these two joined columns is populated" in one query. Say which is which; don't silently make every column look identically "real-time server sorted" when some aren't.
- **Relabel, don't fabricate.** If the brief's vocabulary doesn't match what the schema actually produces (Inventory's "Sales" movement type turned out to always mean "material consumed in production", never an actual customer sale — verified by reading the insert call sites, not assumed), rename the label to match reality and say so. Don't invent a column/filter (Warehouse, Performed By, running Balance) that has zero backing data — drop it and name the gap instead of faking it.
- **CSV export/import stays lightweight** (`Blob` + anchor download, a hand-rolled CSV parse) unless a page specifically needs the fuller multi-step validate/preview/commit flow that Purchase/Sales imports already have in `ImportExportService.ts` — don't build the heavy version speculatively.

---

## 6. Cross-cutting rules

### 6.1 Entrance animation
`useFadeInOnMount<T>(deps, options?)` (`src/hooks/useFadeInOnMount.ts`) — GSAP fade+slide-up stagger over every `data-fade-item` descendant of the returned ref. Defaults: `duration 0.4`, `stagger 0.045`, `y 10`. Pass `options` to slow it down for something with only 2-3 large items (e.g. a drawer's field groups used `{ duration: 0.7, stagger: 0.18, y: 16 }` — the default is tuned for a dense KPI/card grid, not 3 big sections). Don't touch the *default* values — other pages depend on them.

`DataTable`'s `TableRow` already carries `data-fade-item` — wrapping the table in any ancestor's `useFadeInOnMount` ref gets you row-entrance animation for free.

### 6.2 The height-chain rule (why tables/panels won't scroll)
`overflow-y-auto`/`overflow-auto` only creates a *visible* scrollbar if the element has a **definite height** to overflow *against*. `flex-1 min-h-0` only produces a definite height if every ancestor up to a genuinely-sized box (`h-full`, `h-dvh`, or a fixed px height) also has `min-h-0`+definite height — one missing link and the element just grows to fit content, and the *page* scrolls instead of the intended inner region. When "the table doesn't have its own scroll" is reported, check the whole chain root → SplitView/SectionCard → inner scroll div, not just the innermost div.

Also: **never set only one axis of `overflow`** (e.g. `overflow-x-hidden` alone). CSS auto-promotes the untouched axis from `visible` to `auto`, silently creating a second, unintended scroll container — this specifically broke a sticky table header once (the header stuck to the wrong ancestor). Always set both explicitly (`overflow-auto`, or `overflow-y-auto overflow-x-hidden`) if you need to touch either.

### 6.3 `table-fixed` vs `auto` layout
Use **`table-fixed`** only when you deliberately want columns squeezed to fit the container with no possibility of a wider table (rare). Use **default `auto` layout** (current default in `ui/Table.tsx`) plus an `overflow-auto` ancestor when you want "all columns visible, scroll to see more" — this is the correct choice for basically every data table in this app; `table-fixed` was tried for Material and reverted for exactly this reason.

### 6.4 Radix Dialog/Sheet + portaled popups
Any Radix `Dialog.Content` (which both `Sheet` and `Dialog` are built on) renders with `trapFocus: true` while open — it forcibly returns focus to its own DOM subtree on every `focusin`. A popup manually rendered via `createPortal(..., document.body)` is a DOM **sibling** of the Dialog content, not a descendant, so the trap fights it: typing never registers, clicks get treated as "outside" and can dismiss the dialog. This is why `ComboBox` is built on `@radix-ui/react-popover` (not a hand-rolled portal) — Radix's own primitives share a layering context that correctly recognizes a nested Popover/DropdownMenu/Tooltip as "inside" the Dialog. **Any new dropdown/picker that needs to work inside a Sheet or Dialog must be built on a Radix primitive (Popover/DropdownMenu/Select), never a raw `document.body` portal.**

### 6.5 Column-visibility scope discipline
Not every table needs every "premium data table" feature (column visibility toggle, density switch, export, bulk actions, resizable columns, right-click context menu). Inventory shipped with several of these, then they were explicitly stripped back down to match Material's simpler toolbar once both existed side by side for comparison — bulk-select with no remaining bulk action (export was the only one, and it got cut) is dead UI. Match the toolbar to what the page actually needs; don't build the full feature checklist from a brief by default.

### 6.6 Honest data, always
Before adding a column, filter, or stat, check it's backed by a real field (`types.ts` + the actual `supabase/*.sql` schema), not a schema/RPC change away. If the brief wants something that isn't there: either (a) it's cheaply derivable from existing data (do it — e.g. quantity-in/out from a single signed `quantity` column, or a category filter resolved client-side from an existing unpaginated fetch), or (b) it genuinely needs a schema/RPC change (name the gap explicitly, don't fake it, don't silently drop it without saying so).

---

## 7. Checklist for the next page

1. Read the current view + its service file fully before touching anything — note which pattern (A/B/C) actually fits: single-record-with-editing → Pattern B; high-volume/mostly-read-only log → Pattern C; overview/no-single-record → Pattern A.
2. Check `types.ts` + `supabase/*.sql` for what's *actually* backed before designing any column/filter/stat the brief mentions.
3. Reuse `shell/*` + `ui/*` components as-is — don't rebuild `DataTable`/`FilterBar`/`Sheet`/`SectionCard` per page.
4. Wire GSAP entrance via `useFadeInOnMount` on the root (or reuse `DashboardShell` for a pure-stack page).
5. Apply the height-chain rule (§6.2) up front if the page needs its own scroll region — don't discover it after three follow-up bug reports.
6. Default table layout to `auto`, not `table-fixed`, unless you specifically want hard column squeezing.
7. Any new dropdown/combobox inside a Sheet/Dialog → build it on a Radix primitive.
8. Ship the honest version of anything the schema can't back, and say so in the same turn rather than silently guessing.
