# Seng Jie Engineering ERP System - Project Knowledge

## Quick Overview
**Manufacturing ERP desktop app** using Electron + React + TypeScript + Tailwind. Manages inventory, sales/purchase orders, production workflows, employees, clients/vendors + their contacts, and system admin reference data. Data stored in Supabase. Built by Gan Zi Liang.

## Tech Stack
- **Frontend**: React 19 + TypeScript + Tailwind CSS v4
- **UI primitives**: Radix UI + `class-variance-authority` + `clsx`/`tailwind-merge` — shadcn/ui-style component layer (see Design System below)
- **Backend**: Node.js + Express (server.ts) — legacy REST path only, see Architecture below
- **Database**: Supabase
- **AI Integration**: Google Gemini API
- **Desktop**: Electron 43
- **Build**: Vite 6 + esbuild
- **State**: Zustand (legacy, `db.ts` only)
- **Charts**: Recharts
- **Spreadsheet**: XLSX + ExcelJS (ExcelJS for embedded-image/hyperlink exports)
- **Markdown**: react-markdown

## Architecture: two coexisting data-access patterns
The app is mid-migration between two patterns. When touching a module, prefer pattern A; don't extend pattern B.

**A. Module-owned service (preferred, direct-to-Supabase)** — `CompanyProfileService.ts`, `SystemAdminService.ts`, `ContactsService.ts`, `MaterialService.ts`, `ProductService.ts`, `EmployeesService.ts`, `InventoryTransactionService.ts`, `PurchasesService.ts`, `OrdersService.ts`, `WorkflowsService.ts`, `DashboardService.ts`, `ImportExportService.ts`.
- The service imports `supabase` (from `services/supabase.ts`) directly for reads (with `.ilike`/`.eq` for search/filters), and `helper.ts`'s `upsertRecord`/`deleteRecord` for writes (these serialize camelCase → snake_case via a `ROW_MAPPERS` table keyed by a legacy `erp_*` string and resolve the real table name via `LS_TO_TABLE` — that indirection is just helper.ts's internal API, not a localStorage requirement).
- Optional read-through localStorage cache for rarely-changing reference data only (see `SystemAdminService.getJobPositions`) — always invalidated (`removeStorageItem`) right after a write.
- The view owns its own `useState` + `useEffect` + `CallAPI` (from `components/UIHelper.ts`) loading/loading-state — no shared data hook.
- No `db.ts`, no `server.ts` REST hop, no `useTableData` hook.
- Two modules use paginated Postgres RPC functions instead of a plain `.select()` for their catalog listing: `MaterialService.getMaterialsPage` → `get_materials_page`, `ProductService.getProductsPage` → `get_products_page` (both in `supabase/function_trigger.sql`). Whenever a column feeding one of these `RETURNS TABLE` functions changes SQL type (e.g. `date` → `timestamptz`), the function's declared return type must be updated too or every call throws `"Returned type ... does not match expected type ..."` — see the Order/Delivery Dates section below for the real incident.

**B. Legacy REST hook** — `useTableData<T>('table_name')` (in `hooks/useTableData.ts`) calls `server.ts`'s `GET /api/data/:table?q=&<filterCol>=`, which runs the query server-side via a second Supabase client. Writes still go through `db.ts`'s per-table `save*`/localStorage-array functions. Still used by `ReportsView` and `WorkflowsView`'s employee-search ComboBox (`useTableData<Employee>('employees', ...)` for search-as-you-type — the rest of Workflows is pattern A). Don't add new dependents; migrate a view to pattern A when you next touch it.

## Design System (shell/ + ui/)
The app is mid-migration from ad-hoc Tailwind (hardcoded `slate-*`/`blue-*` colors, `rounded-lg`/`rounded-xl` mixed) to a shadcn/ui-style token-based system. **Already migrated**: Dashboard, Inventory, Material, Product, Orders (Sales), Purchases, SystemAdmin, Workflows (production kanban), the App shell (sidebar/mobile drawer/branding drawer). **Not yet migrated** (still old slate/hardcoded styling): `ContactsView.tsx`, `ContactDetailView.tsx`, `EmployeesView.tsx`, `ImportExportModal.tsx`, `SignaturePad.tsx` (canvas chrome only — the canvas surface itself stays literal white, see comment in file), print modals (`InvoiceModal`/`QuotationModal`/`SalesQuotationModal` — printed documents render on white paper regardless of app theme, so they intentionally keep `slate-*` classes rather than theme tokens).

- **`src/components/ui/`** — low-level primitives (Button, Badge, Card, Dialog, Sheet, Table, Tabs, FormField, SearchInput, Toast, ConfirmDialog, ActionsMenu, DropdownMenu, Popover, Command, Avatar, ScrollArea, Separator, HoverCard, ContextMenu, Progress, Skeleton, Breadcrumb). All colors are CSS custom-property tokens (`bg-card`, `text-foreground`, `border-border`, `bg-primary`, `bg-secondary`, `text-muted-foreground`, `bg-destructive`, semantic `success`/`warning` — all dark-mode aware via `.dark` root class). `Button`/`SearchInput`/quick-range pills all standardize on `rounded-md`.
- **`src/components/shell/`** — page-composition components built on `ui/`: `PageHeader` (title+description+actions row), `SectionCard` (bordered panel = Card+header+body, the backbone of every list/form panel), `FilterBar` (search input + Filter button + chips row, optional `right` slot), `DataTable` (sortable/loading/empty-state table wrapper), `StatCard`/`MetricCard`/`ChartCard`/`ActionCard`/`TimelineCard`/`NotificationCard` (Dashboard widgets), `SplitView`/`DetailPanel`/`SlideOverForm`/`Pagination`.
- **Cross-cutting helper components** (not in `ui/`/`shell/` since they carry app-specific logic): `FilterDialog.tsx` (multi-section filter modal — checklist sections support `hideSearch` for small static option lists like priority; date-range sections), `SortMenu.tsx` (button-triggered sort-field picker, `rounded-md`), `QuickRangePills.tsx` (Today/Yesterday/Last 7 Days/This Month/Last Month pill row, config in `utils/dateRanges.ts`), `ComboBox.tsx` (searchable single-select popover — the app's de-facto `<Select>`; still uses hardcoded slate colors, not yet migrated to tokens, but functionally the standard picker everywhere including fixed-option pickers like Priority).
- **`ComboBox` inside a `Sheet`/`Dialog` — scroll fix**: `ComboBox`'s dropdown portals to `document.body`, outside the parent Sheet/Dialog's DOM subtree, so the ancestor's scroll-lock (`react-remove-scroll`, engaged by any open Radix `Dialog`) silently swallows native wheel-scroll on the dropdown list. Fixed with a manual `onWheel={(e) => e.currentTarget.scrollTop += e.deltaY}` on the `<ul>` — bypasses the lock. Apply the same fix to any other portaled-scrollable-list-inside-a-Dialog bug.
- **`src/utils/`**: `date.ts` (`nowIso`, `toDateTimeLocal`/`fromDateTimeLocal` for `<input type="datetime-local">` round-trips, `formatDateTime`/`formatDate` for display, `monthStart`/`monthEnd`), `dateRanges.ts` (`QUICK_RANGES` config consumed by `QuickRangePills`), `priority.ts` (`PRIORITY_META`/`PRIORITY_OPTIONS`/`getDueUrgency` — see Priority section), `sortRows.ts` (generic client-side array sort for small already-loaded lists).

## Project Structure
```
src/
├── App.tsx           # Main app, tab routing, sidebar (collapsible), company profile branding drawer
├── types.ts          # All TS interfaces
├── helper.ts          # Shared Supabase primitives used by pattern-A services
├── main.tsx          # React entry
├── index.css         # Tailwind + design tokens (light/dark CSS vars)
├── hooks/
│   ├── useTableData.ts     # Legacy REST-backed fetch hook (pattern B only)
│   ├── useFadeInOnMount.ts # `[data-fade-item]` staggered entrance animation, used on every migrated view
│   └── useCountUp.ts       # Animated number count-up, used by StatCard
├── components/
│   ├── DashboardView.tsx     # KPIs/charts + Recent Sales/Purchases (click-through opens that exact order's detail page, not just the tab)
│   ├── InventoryView.tsx     # Inventory transaction ledger; defaults to current month (QuickRangePills), datetime-local stock-adjustment entry
│   ├── ContactsView.tsx       # Vendor/Client company listing (search/add/edit/delete + drill-in); click-to-contact phone/email
│   ├── ContactDetailView.tsx  # Drill-down: one company's info + its Contacts CRUD; same click-to-contact
│   ├── CompanyFormFields.tsx  # Shared Vendor/Client form fields (used by both of the above); email input lowercases on change
│   ├── CompanyLogo.tsx        # Renders a company's attachments[0] as a circular avatar (image) or Building2 placeholder — no dedicated logo column, reuses attachments[]
│   ├── OrdersView.tsx        # Quotation → Sales Order → Production → Delivered workflow over sales_header/sales_detail; drills into SalesOrderDetailView.tsx; default month filter + QuickRangePills; Priority/Production Due Date fields; "Proceed to Production" checks material stock first
│   ├── SalesOrderDetailView.tsx  # Drill-down: one SalesHeader's summary + status-lifecycle actions + line item/material breakdown (actions delegate back to OrdersView's handlers); shows priority badge + due-date urgency tag
│   ├── PurchasesView.tsx     # Quotation → Purchase Order workflow over purchase_header/purchase_detail; drills into PurchaseOrderDetailView.tsx; default month filter + QuickRangePills; unit cost prefills from the material's last-paid price
│   ├── PurchaseOrderDetailView.tsx  # Drill-down: one PurchaseHeader's summary + status-lifecycle actions + material line item table; shows a "Linked Sales Order" link when salesHeaderId is set
│   ├── ProductView.tsx       # Product catalog listing + inline drill-down detail panel (MaterialDetailView.tsx/ProductDetailView.tsx were deleted — consolidated directly into MaterialView.tsx/ProductView.tsx)
│   ├── MaterialView.tsx      # Material catalog listing + inline drill-down detail panel (same consolidation as ProductView)
│   ├── InventoryListShared.tsx  # `InventoryHistoryTable` — shared "Inventory List" table (MaterialView + ProductView detail); Ref No. is the order drill-in link (no View column); optional Employee column via `showEmployee`/`onViewEmployee` (Material only)
│   ├── WorkflowsView.tsx (production kanban) # Drag-and-drop between stage columns (HTML5 DnD, complements the existing Prev/Next buttons) + FilterBar/FilterDialog (assignee/client/priority/due-date) + SortMenu (due date/priority/order no.) + urgency tags
│   ├── OrderAccordion.tsx    # One order's task group inside a Workflows column — draggable card, priority badge, due-date urgency tag
│   ├── EmployeesView.tsx     # Still old styling; email/phone click-to-contact links; cards click through to EmployeeDetailView (drill-down)
│   ├── EmployeeDetailView.tsx  # Drill-down: one employee's summary + a list of the consumable materials they worked on (modeled on PurchaseOrderDetailView); opened from Employees list or Material Usage History's employee link
│   ├── SystemAdminView.tsx   # Job Position / Material Category / Product Category / Document Numbering reference data — migrated to the new design system (PageHeader/Tabs/SectionCard/DataTable, Sheet drawer for add/edit instead of a Dialog)
│   ├── ReportsView.tsx
│   ├── ImportExportModal.tsx  # Excel import/export: Vendors/Clients/Contacts/Material/Product/Purchase/Sales, via ImportExportService.ts. Still old styling (not yet migrated).
│   ├── InvoiceModal.tsx      # Tax invoice print doc (SalesHeader/SalesDetail) — dates shown date-only (formatDate), not datetime
│   ├── SalesQuotationModal.tsx  # Client-facing sales quotation print doc — same date-only formatting
│   ├── QuotationModal.tsx    # Vendor-facing purchase quotation print doc — same date-only formatting
│   ├── SignaturePad.tsx
│   ├── AttachmentSection.tsx
│   ├── ComboBox.tsx
│   ├── FilterDialog.tsx
│   ├── SortMenu.tsx
│   ├── QuickRangePills.tsx
│   ├── InfiniteScrollSentinel.tsx
│   ├── UIHelper.ts           # `CallAPI()` — try/await/onCompleted/onError wrapper used by every service call; returns the resolved value (or null on error) so callers can also `await` a result directly
│   ├── ui/                   # shadcn-style primitives — see Design System above
│   ├── shell/                 # Page-composition components — see Design System above
│   └── ExportGuide.tsx
├── utils/
│   ├── date.ts        # nowIso/toDateTimeLocal/fromDateTimeLocal/formatDateTime/formatDate/monthStart/monthEnd
│   ├── dateRanges.ts   # QUICK_RANGES config for QuickRangePills
│   ├── priority.ts     # PRIORITY_META/PRIORITY_OPTIONS/getDueUrgency
│   └── sortRows.ts     # generic client-side sort for small loaded lists
└── services/
    ├── db.ts                    # Legacy Zustand store (useSyncStore) + per-table localStorage-array helpers
    ├── supabase.ts               # Supabase client init
    ├── helper.ts (re-exported from src/helper.ts)
    ├── CompanyProfileService.ts  # Pattern A reference implementation
    ├── SystemAdminService.ts     # Pattern A; owns Job Position/Material/Product Category reference data + document-numbering fields on company_profile
    ├── ContactsService.ts        # Pattern A; Vendors + Clients + Contacts (people)
    ├── ProductService.ts         # Pattern A; getProducts (plain, for pickers) + getProductsPage (paginated RPC, get_products_page) + getProductInventoryList + getProductById
    ├── MaterialService.ts        # Pattern A; getMaterials (plain, for pickers) + getMaterialsPage (paginated RPC, get_materials_page) + getMaterialInventoryList + getMaterialById
    ├── EmployeesService.ts       # Pattern A; direct Supabase, no db.ts/server.ts/useTableData
    ├── DashboardService.ts       # Pattern A; get_dashboard_data RPC + getRecentSales/getRecentPurchases (recent sales ranked priority-first then latest, see Priority section)
    ├── OrdersService.ts          # Pattern A; sales_header/sales_detail/production_material_usage quotation→SO→production→delivery workflow. Also: getSalesOrderById, getSalesOrderMaterialRequirements, checkProductionStock (material-sufficiency gate before startProduction)
    ├── PurchasesService.ts       # Pattern A; purchase_header/purchase_detail quotation-to-PO workflow. Also: getPurchaseById, getLatestUnitCost (prefills the add-item unit cost from the material's most recent purchase)
    ├── InventoryTransactionService.ts  # Pattern A; inventory_transaction ledger + cross-linked purchase/sales reference joins
    ├── ImportExportService.ts    # Pattern A; Excel import/export for all categories including Contacts
    └── WorkflowsService.ts       # Pattern A; production kanban (workflow_tasks) — see Architecture above for the status/stage ownership split with OrdersService

Root files:
├── server.ts         # Express + Vite dev/prod server; legacy `/api/data/:table` + Gemini API endpoint
├── main.cjs          # Electron main process
├── vite.config.ts    # Vite config
├── tsconfig.json
├── forge.config.cjs  # Electron forge config
├── supabase/         # schema.sql (tables, appended ALTERs) + function_trigger.sql (triggers, get_system_admin_data/get_dashboard_data/get_materials_page/get_products_page/next_document_number RPCs)
├── .env              # API keys (GEMINI_API_KEY, Supabase vars)
└── package.json      # Scripts: dev, build, start, electron, package, make, lint
```

**No Supabase CLI/MCP access in this environment** — any schema or function change is appended to `supabase/schema.sql` / edited in-place in `supabase/function_trigger.sql` as documentation, and the user is given the raw SQL to run manually in the Supabase SQL editor. Always ask/remind the user to actually run it before assuming a DB-side fix is live.

## Key Data Types (src/types.ts)

### Core Entities
- **InventoryItem**: SKU, type (RAW_MATERIAL | FINISHED_GOOD), materialCategoryId/productCategoryId, qty, unit, unitCost, reorderPoint, supplierId, attachments
- **Vendor** / **Client**: `companyName`, `email`, `officeNo`, `address`, `description?`, `attachments?`. Company-only — no contact-person fields (moved to `Contact`).
- **Contact**: a person belonging to exactly one Vendor or Client — `fullName`, `contactNo?`, `email?`, `jobPositionId?` (FK → job_positions), `vendorId?`/`clientId?` (exactly one set, enforced by a DB check constraint), `attachments?`.
- **Employee**: name, role, status (ACTIVE|INACTIVE), contact
- **NamedParameter** (System Admin tab): shared minimal shape (`id`, `name`, `is_active`, `created_at?`, `updated_at?`) for `JobPosition`, `MaterialCategory`, `ProductCategory`.
- **SystemAdminData**: `{ job_positions, material_categories, product_categories }` — shape returned by the `get_system_admin_data` Postgres RPC.
- **CompanyProfile**: name, icon (database|factory|cpu|wrench|custom), address, bank details, signature & chop images (base64), `so_number_format`/`so_next_number`/`po_number_format`/`po_next_number` (document numbering config)

### Orders & Production
- **SalesOrder** / **PurchaseOrder**: legacy flat types, `sales_orders`/`purchase_orders` tables, still used by Dashboard/Reports only — not the same as SalesHeader/PurchaseHeader below.
- **WorkflowTask**: `headerId`/`salesNo` (joined), `clientId`/`clientName` (joined), `productionDueDate?`/`priority` (joined from the parent SalesHeader — see Priority section), `productName`/`quantity` (joined), `stage` (PREPARATION|ASSEMBLY|QUALITY_CONTROL|PACKAGING|COMPLETED), `employeeId?`/`employeeName?`, `startDate`/`endDate?`, `remark?`.
- **PurchaseHeader/PurchaseDetail**: `purchase_header`/`purchase_detail` — quotation→PO workflow (status QUOTATION|ORDERED|RECEIVED|CANCELLED), optional `salesHeaderId` link back to a `SalesHeader` (`salesNo?` is the joined display value for that link — see Cross-Reference section). `purchase_no` is auto-generated (see Auto Document Numbering below). `quotationDate`/`orderDate` are `timestamptz` (see Order/Delivery Dates below); `receivedDate` stays plain `date`.
- **SalesHeader/SalesDetail/ProductionMaterialUsage**: `sales_header`/`sales_detail`/`production_material_usage` — quotation→SO workflow, status `QUOTATION|ORDERED|IN_PRODUCTION|DONE_IN_PRODUCTION|DELIVERED|CANCELLED`. `ORDERED` rows are moved to `IN_PRODUCTION` (`startProduction` — now gated by `checkProductionStock`, see below), then `DONE_IN_PRODUCTION` (`confirmProductionDone`), then `DELIVERED` (`markDelivered`). `orderDate`/`deliveryDate` are `timestamptz`; `productionDueDate` stays plain `date` (a calendar deadline, not an instant); `priority` is `SalesPriority`. Each `SalesDetail` line carries a planned material-usage list (`production_material_usage`), see `OrdersService.ts`. `sales_no` is auto-generated (see Auto Document Numbering below).

### Priority & Production Due Date (Sales)
- **`SalesPriority`** = `'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'` — a manual field staff set on the sales order (Priority `ComboBox` in the OrdersView form), independent of any date. `PRIORITY_META` (`utils/priority.ts`) maps each level to a label + Badge variant + numeric rank (used for sorting).
- **`productionDueDate`** — a separate internal shop-floor deadline distinct from `deliveryDate` (the client-facing ship date). Editable on the Sales form (create/edit/convert), plain `date` type.
- **Urgency tag** — `getDueUrgency(dueDate)` (`utils/priority.ts`) is *computed*, not stored: `Overdue` (destructive) if past due, `Due Soon` (warning) if ≤2 days out, otherwise no tag. Shown on the Sales table, Sales detail page, and each Workflows kanban card — separate concept from the manual `priority` field.
- **Where it surfaces**: Sales list (Priority + Production Due columns, sortable — Priority sorts client-side over the loaded page since rank order isn't alphabetical; Production Due sorts server-side, a real date column), Sales detail page (priority badge + urgency tag + due-date row), Dashboard "Recent Sales" (ranked priority-first then latest — `getRecentSales` fetches a wider recent window and re-sorts client-side, since PostgREST can't order by a computed enum rank), Workflows kanban (priority badge + urgency tag per card, plus filter/sort by both).

### Order/Delivery Dates (timestamptz migration)
`sales_header.order_date`/`delivery_date` and `purchase_header.quotation_date`/`order_date` were migrated from `date` to `timestamptz` so staff can record a time-of-day, not just a day. `transaction_date` on `inventory_transaction` was already `timestamptz`. `production_due_date`/`received_date` were deliberately left as plain `date` — calendar deadlines, not instants.
- **Entry**: user-picked dates (Sales delivery date, Purchase order date on convert, Inventory stock-adjustment date) are `<input type="datetime-local">`, round-tripped via `toDateTimeLocal`/`fromDateTimeLocal` (`utils/date.ts`). Auto-stamped dates (order/quotation date, every inventory transaction) use `nowIso()`.
- **Display**: interactive screens use `formatDateTime` (date+time). Printed documents (`InvoiceModal`/`QuotationModal`/`SalesQuotationModal`) deliberately stay `formatDate` (date-only) — a timestamp looks out of place on a formal document.
- **Filters**: a date-range "to" bound arriving as a bare date string (`yyyy-MM-dd`) is bumped to end-of-day (`endOfDay()` helper in `OrdersService.ts`/`PurchasesService.ts`, inlined in `InventoryTransactionService.ts`) before being used in a `.lte()` query — otherwise a same-day-afternoon row would be silently excluded now that the column carries a time component.
- **Known incident**: this migration broke `get_materials_page`/`get_products_page` (their `RETURNS TABLE` declared `latest_purchase_date`/`oldest_purchase_date`/`latest_sale_date`/`oldest_sale_date` as `date`, but the aggregated `MAX/MIN(order_date)` became `timestamptz`) — Postgres threw `"Returned type timestamp with time zone does not match expected type date"`. Fixed by casting the aggregates to `::date` in both function bodies. **Lesson**: any RPC with a `RETURNS TABLE` derived from a column you're retyping needs its own fix — grep `function_trigger.sql` for the column name before assuming a plain `ALTER COLUMN` is safe.

### Other
- **InventoryTransaction** (see `InventoryTransactionService.ts`): `refNo?: string` — a computed/joined display field (no new DB column), populated as `purchaseHeader?.purchase_no || salesHeader?.sales_no` via the existing `purchase_detail(purchase_header(...))` / `production_material_usage(sales_detail(sales_header(...)))` joins, so an inventory transaction row can show which Sales/Purchase order it came from.
- **Attachment**: name, type, size, dataUrl (base64)
- **DashboardStats**: totalSales, totalPurchaseCosts, totalProfit, inventoryValuation, lowStockCount, pendingOrdersCount, activeWorkflowsCount

## Purchase ↔ Sales Cross-Reference
A Purchase can optionally link back to the Sales order it was raised to fulfil (`purchase_header.sales_header_id`, set via the "Linked Sales Order" picker in the Purchase form). This is now surfaced, not just stored:
- **List** (`PurchasesView`): the Reference column shows the linked sales no. under the purchase no. (`↳ SO-0001`) when set.
- **Detail** (`PurchaseOrderDetailView`): a "Linked Sales Order" row with a clickable ref (same `font-mono text-primary hover:underline` style as Inventory's reference links) that jumps to that Sales order's detail page.
- **Back-navigation**: this reuses the existing cross-tab drill-in machinery in `App.tsx` (see below) — `navigateToSalesOrder` gained a `fromPurchaseId` param and `'PURCHASES'` is a valid `salesOrderReturnTo`/`OrdersView.initialOrderOrigin` value, so Back from the Sales detail page returns to *that specific* purchase, not just the Purchases tab list.
- **Data**: `PurchaseHeader.salesNo` is joined (`sales_header(sales_no)`) in both `getPurchases` and `getPurchaseById`.

## Sufficient-Inventory Check (Proceed to Production)
`OrdersService.checkProductionStock(header)` sums each material's planned quantity across the order's line items and compares against live `material.quantity`. `OrdersView.handleStartProduction` (shared by the row-action menu and the order detail page's button — single control point) runs this first and blocks with a toast listing exactly which materials are short (`need X, have Y`) instead of proceeding. This closes a real gap: nothing in the DB stops `startProduction`'s `-plannedQuantity` inventory_transaction from driving `material.quantity` negative.

## Cross-Tab Navigation & Drill-Down Detail Pages
Sales orders and purchases each have a dedicated drill-down detail page, opened via the row's `ActionsMenu` "View" item:
- `OrdersView.tsx` → `SalesOrderDetailView.tsx` (header summary + status-lifecycle action buttons + line items/materials + priority/urgency). Actions are passed down from `OrdersView`, which stays the single source of truth for each transition; `refreshSelectedOrder()` re-fetches (`getSalesOrderById`) after any mutation.
- `PurchasesView.tsx` → `PurchaseOrderDetailView.tsx`, same shape, plus the linked-Sales-order link described above.

**Cross-tab drill-in** (e.g. Product's Order History → a specific Sales Order; Material's Purchase History → a specific Purchase; Dashboard's Recent Sales/Purchases → that exact order; a Purchase's linked-Sales-order link): Product/Material/Orders/Purchases/Dashboard are separate top-level tabs in `App.tsx` with no shared router, and switching tabs unmounts the previous view, so navigation state can't just live in local `useState`. The pattern:
- `App.tsx` owns `pending<X>Id` (id to open on the destination tab) and `<x>ReturnTo` (type+id to restore on the origin tab if the user hits Back). `navigateToSalesOrder(salesHeaderId, fromProductId?, fromMaterialId?, fromInventory?, fromPurchaseId?)` / `navigateToPurchaseOrder(purchaseHeaderId, fromMaterialId?, fromInventory?)` set both and flip `activeTab`. `returnFromSalesOrder()` / `returnFromPurchaseOrder()` do the reverse. Dashboard calls `navigateToSalesOrder(id)`/`navigateToPurchaseOrder(id)` with no origin — nothing to return to beyond the list itself.
- Destination view (`OrdersView`/`PurchasesView`) takes `initialOrderId`/`initialPurchaseId` + `onInitial*Handled` (clears the pending id once consumed) + `onReturnToOrigin`. A local `detailOpenedExternally` flag distinguishes "opened via cross-tab prop" from "opened via this view's own row click". **Both `handle*DetailBack` functions always close the detail locally first, then conditionally call `onReturnToOrigin()`** — a Dashboard-opened drill-in has no real origin, so `onReturnToOrigin` (when called) legitimately no-ops; if closing-locally weren't unconditional, Back would silently do nothing and the detail page would appear stuck. (This was a real bug, fixed by reordering — don't regress it.) `backLabel` is likewise computed straight from the origin type with an explicit fallback to "Back to Purchases"/"Back to Sales Contracts", never from `detailOpenedExternally` alone.
- Origin view (`ProductView`/`MaterialView`) takes `initialProductId`/`initialMaterialId` + `onInitial*Handled`, and re-fetches by id to restore its drill-down detail panel on remount.

## Purchase/Sales Form Notes
- **Line items are editable in-place**: in `PurchasesView.tsx`'s and `OrdersView.tsx`'s edit/convert form, already-added line rows have live `quantity`/`unitCost` (purchases) or `quantity`/`unitPrice` (sales) number inputs — not just the "add new item" panel — recalculating that row's `totalPrice` on change.
- **Linked-SO material requirements**: when a Purchase Quotation/PO has a "Linked Sales Order" selected, `PurchasesView.tsx` shows a "Required Materials for Linked Sales Order" panel (via `OrdersService.getSalesOrderMaterialRequirements`).
- **Unit cost prefill**: selecting a material in the Purchase "add item" panel calls `PurchasesService.getLatestUnitCost(materialId)` (most recent `purchase_detail.unit_cost`, 1 row, 0 if never purchased) and prefills the field — buyer can still override.
- **Print modals** (`InvoiceModal.tsx`, `QuotationModal.tsx`, `SalesQuotationModal.tsx`): guard `!companyProfile` before render. Dates print date-only (`formatDate`).

## Date Range Filters (Sales/Purchases/Inventory)
All three default to the **current month** on load (`monthStart(0)`/`monthEnd(0)`, `utils/date.ts`) to avoid pulling the entire ledger. `QuickRangePills` (Today/Yesterday/Last 7 Days/This Month/Last Month, config in `utils/dateRanges.ts`) sits under each view's `FilterBar`, plus a Reset button. Semantics:
- Toggling the **active** pill off clears to all-time (no date filter).
- **Reset** (button, or removing the date filter chip, or the FilterDialog's Clear) always lands back on **this month**, not all-time — matches the page's own default.
- Opening the FilterDialog and applying a custom date range clears `activeQuickRange` to null (no preset highlighted).

## Production Kanban (Workflows)
`WorkflowsView.tsx` (board) + `OrderAccordion.tsx` (draggable per-order card within a column):
- **Drag and drop**: native HTML5 DnD. Dropping an order card onto a column moves every task of that order currently in the source column to the target stage — optimistic update with rollback on failure. Complements, does not replace, the existing per-task Prev/Next buttons on each task row.
- **Filters**: assignee, client, priority (static checklist, `hideSearch`), production-due-date range — via `FilterDialog`. Search by order no. via `FilterBar`.
- **Sort**: `SortMenu` — Production Due Date / Priority / Order No. — reorders the order-groups (accordions) within each column, not the tasks themselves.
- **Urgency**: each card shows a priority badge and (if `productionDueDate` set) an urgency tag, both from `utils/priority.ts`.

## Consumable Materials (paint, glue, lubricant, etc.)
`material.material_type` is now `RAW_MATERIAL | CONSUMABLE_MATERIAL | CUSTOMER_STOCK` — **`FINISHED_GOOD` was retired** (real finished goods live in the `product` table; a migration converts any stray `FINISHED_GOOD` rows → `RAW_MATERIAL`, in `schema.sql`). Consumables are purchasable + used during production but never sold.
- **Consumption mode** (`material.consumption_mode`, `AUTOMATIC | MANUAL`, NULL for non-consumables): edited in the Material form (shown only when type = Consumable Material). `AUTOMATIC` → `confirmProductionDone` posts a `-qty` `ADJUSTMENT` inventory_transaction at completion. `MANUAL` → usage recorded only; user deducts later via the Inventory stock-adjustment drawer.
- **Purchasable**: consumables show in the Purchase form's material picker (`PurchasesView.purchasableMaterials` = RAW_MATERIAL + CONSUMABLE_MATERIAL, minus INACTIVE; CUSTOMER_STOCK excluded). The sales form's material picker stays RAW_MATERIAL only (`OrdersView.rawMaterials`).
- **Where recorded**: on the **Production Kanban** (`OrderAccordion` consumables sub-section — multi-pick + qty; sits *above* the task rows so each task's Prev/Next stays bottommost), *not* the sales order, since consumables are added mid-job by the shop floor. Stored as `production_material_usage` rows (`actual_quantity` = qty, `planned_quantity` 0) against the order's **first** `sales_detail` line (order-level, not per-line). `WorkflowsService`: `getConsumableMaterials`/`getOrderConsumables`/`addOrderConsumable`/`removeOrderConsumable`.
- **Told apart from planned raw materials** by the joined `material.material_type` — the completion embeds select `material(name, code, material_type, consumption_mode)`. `ProductionCompletionModal` filters consumables out of its planned-vs-actual reconciliation (they were never reserved at Start Production); `confirmProductionDone` handles them in a dedicated deduction loop. Consumables can only be added at the Kanban (`IN_PRODUCTION`) stage — after Start Production — so `startProduction`/`checkProductionStock` never see them.
- **Traceability = the Inventory List, no separate usage history.** Because consumables (and raw materials) create `inventory_transaction` rows on purchase/production, the Material detail panel's **Inventory List** already shows every movement. `getInventoryMovements` joins `production_material_usage → sales_detail → workflow_tasks(employees)` so each production-linked row carries the assignee. `InventoryHistoryTable` (shared by Material + Product detail): **Ref No. is the drill-in link** (no separate "View" column), and an optional **Employee column** (`showEmployee` — on for Material, off for Product) shows/links the worker (`onViewEmployee` → `EmployeeDetailView`). The old Usage-History section + `getMaterialUsageHistory` were removed.
- **Employee Detail** (`EmployeeDetailView`, `getEmployeeConsumableUsage`): lists consumables an employee worked on (their assigned `workflow_tasks` → those orders' consumable usage rows). Attribution follows the first-line assignee (consumables attach to the first line). Cross-tab drill-in wired in `App.tsx` (`navigateToEmployee`/`pendingEmployeeId`/`employeeReturnTo`/`returnFromEmployee`, origin = Material); reached from the Employees list card and the Inventory List's Employee column.
- **Dashboard "Finished Goods" tile**: `get_dashboard_data` now sums `product.quantity` (was `material WHERE material_type='FINISHED_GOOD'`, which had become dead data). Field/label names in `DashboardService`/`DashboardView` unchanged.

## Contacts Module (Vendors/Clients + their people)
- **DB**: `vendors` and `clients` tables share the same shape (`company_name`, `email`, `office_no`, `address`, `description`, `attachments`). `contacts` table has `vendor_id`/`client_id` FKs (exactly one non-null, `chk_contact_owner` CHECK constraint) plus `job_position` FK → `job_positions`. All three have `updated_at` triggers (`function_trigger.sql`).
- **UI flow**: `ContactsView.tsx` shows a company listing (Vendors/Clients tabs, search, add/edit/delete). Clicking a card drills into `ContactDetailView.tsx`, which shows the company's info plus a full CRUD list of its Contacts. **Not yet migrated** to the new design system (still old slate styling) — only the email/phone link styling and a stopPropagation bug were fixed (see below).
- **Click-to-contact**: phone opens `https://wa.me/${number}` and email opens a Gmail web-compose URL, both `window.open(..., "_blank")` with `e.stopPropagation()`. Link styling now matches Inventory's reference-column style (`font-mono text-primary hover:underline`) instead of the old hardcoded-blue global `.link` CSS class (removed — was not dark-mode aware). `EmployeesView` gained the same click-to-contact behavior (it previously showed plain, non-clickable text). **Fixed bug**: `ContactDetailView`'s per-contact rows were wired to `company.email`/`company.officeNo` instead of `contact.email`/`contact.contactNo` — clicking a specific contact's phone/email opened the *company's* info, not that person's.
- **Import/Export**: Contacts are now a first-class Excel import category (`ImportExportService.importContacts` / `CONTACT_COLUMNS`) — columns are Contact Name, Type (Client/Vendor), Company Name, Email, Contact No. Type+Company resolves the vendor/client id; merge key is name+owner id (same person name under two different companies imports as two rows).
- **Service**: `ContactsService.ts` — `getVendors(search)`, `getClients(search)`, `saveVendor/deleteVendor`, `saveClient/deleteClient`, `getContacts({vendorId|clientId, search})`, `saveContact/deleteContact`, plus a re-exported `getJobPositions`.

## App Shell (App.tsx)
- **Desktop sidebar**: collapsible (`ChevronsLeft`/`ChevronsRight` toggle, `w-64` ↔ `w-16` icon rail, localStorage-persisted like dark mode). Uses `bg-sidebar`/`text-sidebar-foreground`/`bg-sidebar-active`/`bg-sidebar-hover` tokens.
- **Mobile top bar + menu drawer**: now use the *same* sidebar tokens as the desktop aside (previously hardcoded `bg-foreground`/`text-background`, which diverged visually from desktop and wasn't intentional — fixed for consistency). `rounded-md` throughout, matching desktop nav buttons.
- **Company branding**: `showBrandingModal` opens a `Sheet` drawer (not a centered `Dialog`) — `FormField`/`fieldInputClassName` inputs, `Button` footer, dark-mode-safe tokens throughout except the signature canvas (deliberately stays literal white — the exported PNG is placed onto white printed invoices).
- **Dark mode**: `darkMode` state toggles the `.dark` class on `<html>`, persisted to localStorage, defaults to `prefers-color-scheme`.

## Tabs (App.tsx routing)
1. **DASHBOARD** → DashboardView: KPIs, charts, Recent Sales/Purchases with click-through to that order's detail page
2. **SYSTEM_ADMIN** → SystemAdminView: Job Position / Material Category / Product Category / Document Numbering reference data
3. **CONTACTS** → ContactsView (+ ContactDetailView drill-down): Vendors & clients + their contacts
4. **EMPLOYEES** → EmployeesView: Staff management
5. **MATERIAL** → MaterialView: Material catalog + inline detail panel
6. **PRODUCT** → ProductView: Product catalog + inline detail panel
7. **INVENTORY** → InventoryView: Inventory transaction ledger
8. **PURCHASES** → PurchasesView: Quotation → Purchase Order workflow over `purchase_header`/`purchase_detail`, receiving stock via `inventory_transaction`
9. **ORDERS** → OrdersView: Quotation → Sales Order → Production → Delivered workflow over `sales_header`/`sales_detail`
10. **WORKFLOWS** → WorkflowsView: Production kanban (PREPARATION → ASSEMBLY → QC → PACKAGING → COMPLETED), drag-and-drop
11. **REPORTS** → ReportsView: Analytics (nav entry commented out in App.tsx, route still active)
12. **EXPORT_GUIDE** → ExportGuide: Help docs (nav entry commented out in App.tsx, route still active)

## Backend (server.ts) — legacy REST path (pattern B modules only)
- **Port**: 3000
- **Endpoints**:
  - `GET /api/health` - Health check
  - `GET /api/data/:table?q=<search>&<filterCol>=<val>` - Full-table fetch with optional server-side search/filter (no real pagination despite the name)
  - `GET /api/stats` - Aggregated dashboard stats computed server-side
  - `POST /api/reports/analyze` - Gemini AI report generation
- **Middleware**: express.json()
- **Server Supabase client**: `supabaseServer` (uses VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY)
- **Dev mode**: Vite dev server integration
- **Prod mode**: Serves dist/ (built React + esbuild bundled server)

## Key NPM Scripts
- `npm run dev` - Start dev server (tsx server.ts)
- `npm run build` - Build React + bundle server as dist/server.cjs
- `npm start` - Run production server
- `npm run electron` - Launch Electron app
- `npm run package` - Package Electron app
- `npm run make` - Create installers
- `npm run lint` - Type check (tsc --noEmit)

## Env Variables
- `GEMINI_API_KEY` - Google Gemini API key
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anon key

## Design Patterns
- **Component per feature**: Each view = separate component file; split a drill-down/detail page into its own file once a view starts doing both list and detail duty.
- **Type safety**: Full TS, all data types in types.ts
- **Design tokens over hardcoded colors**: new/touched components use `ui/`+`shell/` tokens, not `slate-*`/`blue-*` literals — see Design System section.
- **Multi-item support**: Orders store items[] array, display first item in summary
- **Attachments**: Base64 storage for files/images, via `AttachmentSection.tsx`
- **Status workflows**: Defined enums for all statuses (orders, tasks, employees)
- **No hardcoded seed data**: All data comes from Supabase. All getters default to `[]` / empty profile.

## Common Tasks
- **Add new field**: Update types.ts → schema.sql (append `ALTER TABLE`, remind user to run it manually — no DB access from this environment) → module service (pattern A) → component view. If the column feeds a paginated RPC (`get_materials_page`/`get_products_page`), check whether the RPC's `RETURNS TABLE` type needs updating too.
- **Add a new module/CRUD feature**: Create `services/<Module>Service.ts` following `ContactsService.ts`; component owns its own load state via `useState`/`useEffect`/`CallAPI`; split a detail/drill-down page into its own file if the list view would otherwise get long.
- **New list/form UI**: reach for `shell/`+`ui/` first (PageHeader, SectionCard, FilterBar, DataTable, Sheet, Button, Badge, FormField) — see Design System section for what's already migrated as reference.
- **Import/Export Excel**: ImportExportModal uses XLSX lib + `ImportExportService.ts` (pattern A). Flat categories (Vendor/Client/Contact/Material/Product) merge by natural key; Purchase/Sales import groups rows by Purchase No/Sales No into header+detail, validates the whole file, shows a Preview, and only writes once there are zero errors.
- **Company branding**: CompanyProfile (icon, signature, chop) stored as base64, edited via the Sheet drawer in App.tsx.
- **Gemini AI**: Server endpoint (server.ts) integrated.
