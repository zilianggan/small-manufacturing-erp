# Seng Jie Engineering ERP System - Project Knowledge

## Quick Overview
**Manufacturing ERP desktop app** using Electron + React + TypeScript + Tailwind. Manages inventory, sales/purchase orders, workflows, employees, clients/vendors + their contacts, and system admin reference data. Data stored in Supabase. Built by Gan Zi Liang.

## Tech Stack
- **Frontend**: React 19 + TypeScript + Tailwind CSS v4
- **Backend**: Node.js + Express (server.ts) — legacy REST path only, see Architecture below
- **Database**: Supabase
- **AI Integration**: Google Gemini API
- **Desktop**: Electron 43
- **Build**: Vite 6 + esbuild
- **State**: Zustand (legacy, `db.ts` only)
- **Charts**: Recharts
- **Spreadsheet**: XLSX
- **Markdown**: react-markdown

## Architecture: two coexisting data-access patterns
The app is mid-migration between two patterns. When touching a module, prefer pattern A; don't extend pattern B.

**A. Module-owned service (preferred, direct-to-Supabase)** — `CompanyProfileService.ts`, `SystemAdminService.ts`, `ContactsService.ts`, `MaterialService.ts`, `ProductService.ts`, `InventoryTransactionService.ts`, `PurchasesService.ts`, `OrdersService.ts`, `ImportExportService.ts`.
- The service imports `supabase` (from `services/supabase.ts`) directly for reads (with `.ilike`/`.eq` for search/filters), and `helper.ts`'s `upsertRecord`/`deleteRecord` for writes (these serialize camelCase → snake_case via a `ROW_MAPPERS` table keyed by a legacy `erp_*` string and resolve the real table name via `LS_TO_TABLE` — that indirection is just helper.ts's internal API, not a localStorage requirement).
- Optional read-through localStorage cache for rarely-changing reference data only (see `SystemAdminService.getJobPositions`) — always invalidated (`removeStorageItem`) right after a write.
- The view owns its own `useState` + `useEffect` + `CallAPI` (from `components/UIHelper.ts`) loading/loading-state — no shared data hook.
- No `db.ts`, no `server.ts` REST hop, no `useTableData` hook.

**B. Legacy REST hook** — `useTableData<T>('table_name')` (in `hooks/useTableData.ts`) calls `server.ts`'s `GET /api/data/:table?q=&<filterCol>=`, which runs the query server-side via a second Supabase client. Writes still go through `db.ts`'s per-table `save*`/localStorage-array functions. Still used by `EmployeesView`, `ReportsView`. Don't add new dependents; migrate a view to pattern A when you next touch it.

## Project Structure
```
src/
├── App.tsx           # Main app, tab routing, company profile settings
├── types.ts          # All TS interfaces
├── helper.ts          # Shared Supabase primitives used by pattern-A services
├── main.tsx          # React entry
├── index.css         # Tailwind
├── hooks/
│   └── useTableData.ts   # Legacy REST-backed fetch hook (pattern B only)
├── components/
│   ├── DashboardView.tsx
│   ├── InventoryView.tsx
│   ├── ContactsView.tsx       # Vendor/Client company listing (search/add/edit/delete + drill-in); click-to-contact phone/email, logo via CompanyLogo
│   ├── ContactDetailView.tsx  # Drill-down: one company's info + its Contacts CRUD; same click-to-contact + logo as ContactsView
│   ├── CompanyFormFields.tsx  # Shared Vendor/Client form fields (used by both of the above)
│   ├── CompanyLogo.tsx        # Renders a company's attachments[0] as a circular avatar (image) or Building2 placeholder — no dedicated logo column, reuses attachments[]
│   ├── OrdersView.tsx        # Quotation → Sales Order → Production → Delivered workflow over sales_header/sales_detail; drills into SalesOrderDetailView.tsx via an Eye-icon row button
│   ├── SalesOrderDetailView.tsx  # Drill-down: one SalesHeader's summary + status-lifecycle actions + line item/material breakdown (actions delegate back to OrdersView's handlers)
│   ├── PurchasesView.tsx     # Quotation → Purchase Order workflow over purchase_header/purchase_detail; drills into PurchaseOrderDetailView.tsx via an Eye-icon row button
│   ├── PurchaseOrderDetailView.tsx  # Drill-down: one PurchaseHeader's summary + status-lifecycle actions + material line item table (actions delegate back to PurchasesView's handlers)
│   ├── ProductView.tsx       # Product catalog listing; drills into ProductDetailView.tsx
│   ├── ProductDetailView.tsx # Drill-down: product info + read-only order/sales history, each row linking cross-tab to SalesOrderDetailView.tsx
│   ├── MaterialView.tsx      # Material catalog listing; drills into MaterialDetailView.tsx
│   ├── MaterialDetailView.tsx  # Drill-down: material info + read-only purchase history, each row linking cross-tab to PurchaseOrderDetailView.tsx
│   ├── WorkflowsView.tsx (production tasks)
│   ├── EmployeesView.tsx
│   ├── SystemAdminView.tsx   # Job Position / Material Category / Product Category reference data
│   ├── ReportsView.tsx
│   ├── ImportExportModal.tsx  # Excel import/export: Vendors/Clients/Material/Product/Purchase/Sales, via ImportExportService.ts
│   ├── InvoiceModal.tsx      # Tax invoice print doc (SalesHeader/SalesDetail)
│   ├── SalesQuotationModal.tsx  # Client-facing sales quotation print doc
│   ├── QuotationModal.tsx    # Vendor-facing purchase quotation print doc
│   ├── OrderAccordion.tsx
│   ├── TaskCard.tsx
│   ├── SignaturePad.tsx
│   ├── AttachmentSection.tsx
│   ├── ComboBox.tsx
│   ├── InfiniteScrollSentinel.tsx
│   ├── UIHelper.ts           # `CallAPI()` — try/await/onCompleted/onError wrapper used by every service call
│   ├── ui/                   # Shared primitives: Dialog, Card, FormField, SearchInput, Toast, ConfirmDialog, ActionsMenu (morevert row-actions dropdown, portaled to <body> so ancestor overflow-hidden can't clip it — used by OrdersView/PurchasesView/SystemAdminView)
│   └── ExportGuide.tsx
└── services/
    ├── db.ts                    # Legacy Zustand store (useSyncStore) + per-table localStorage-array helpers
    ├── supabase.ts               # Supabase client init
    ├── helper.ts (re-exported from src/helper.ts)
    ├── CompanyProfileService.ts  # Pattern A reference implementation
    ├── SystemAdminService.ts     # Pattern A; owns Job Position/Material/Product Category reference data
    ├── ContactsService.ts        # Pattern A; Vendors + Clients + Contacts (people)
    ├── ProductService.ts         # Pattern A; product catalog + getProductSalesHistory (ProductDetailView) + getProductById (drill-in restore)
    ├── MaterialService.ts        # Pattern A; material catalog + getMaterialPurchaseHistory (MaterialDetailView) + getMaterialById (drill-in restore)
    ├── EmployeesService.ts       # Thin re-export wrapper over db.ts + SystemAdminService (pattern B)
    ├── InventoryService.ts       # Thin re-export wrapper over db.ts + SystemAdminService (pattern B)
    ├── OrdersService.ts          # Pattern A; sales_header/sales_detail/production_material_usage quotation→SO→production→delivery workflow. Also: getSalesOrderById (single-order fetch for detail/drill-in), getSalesOrderMaterialRequirements (aggregated planned material qty for PurchasesView's linked-SO panel)
    ├── PurchasesService.ts       # Pattern A; purchase_header/purchase_detail quotation-to-PO workflow. Also: getPurchaseById (single-purchase fetch for detail/drill-in)
    └── WorkflowsService.ts       # Thin re-export wrapper over db.ts (pattern B)

Root files:
├── server.ts         # Express + Vite dev/prod server; legacy `/api/data/:table` + Gemini API endpoint
├── main.cjs          # Electron main process
├── vite.config.ts    # Vite config
├── tsconfig.json
├── forge.config.cjs  # Electron forge config
├── supabase/         # schema.sql (tables) + function_trigger.sql (updated_at triggers, get_system_admin_data RPC)
├── .env              # API keys (GEMINI_API_KEY, Supabase vars)
└── package.json      # Scripts: dev, build, start, electron, package, make, lint
```

## Key Data Types (src/types.ts)

### Core Entities
- **InventoryItem**: SKU, type (RAW_MATERIAL | FINISHED_GOOD), materialCategoryId/productCategoryId, qty, unit, unitCost, reorderPoint, supplierId, attachments
- **Vendor** / **Client**: `companyName`, `email`, `officeNo`, `address`, `description?`, `attachments?`. Company-only — no contact-person fields (moved to `Contact`) and no `rating`/`materialsSupplied`/`totalOrdersValue` (removed in the vendor/client restructure).
- **Contact**: a person belonging to exactly one Vendor or Client — `fullName`, `contactNo?`, `email?`, `jobPositionId?` (FK → job_positions), `vendorId?`/`clientId?` (exactly one set, enforced by a DB check constraint), `attachments?`.
- **Employee**: name, role, status (ACTIVE|INACTIVE), contact
- **NamedParameter** (System Admin tab): shared minimal shape (`id`, `name`, `is_active`, `created_at?`, `updated_at?`) for `JobPosition`, `MaterialCategory`, `ProductCategory`.
- **SystemAdminData**: `{ job_positions, material_categories, product_categories }` — shape returned by the `get_system_admin_data` Postgres RPC.
- **CompanyProfile**: name, icon (database|factory|cpu|wrench|custom), address, bank details, signature & chop images (base64)

### Orders & Production
- **SalesOrder**: clientId, itemId, qty, unitPrice, totalPrice, orderDate, deliveryDate, status (PENDING|IN_PRODUCTION|SHIPPED|DELIVERED|CANCELLED), workflowTaskId, items[] — legacy, `sales_orders` table, still used by Dashboard/Reports.
- **PurchaseOrder**: vendorId, itemId, qty, unitCost, totalCost, orderDate, status (DRAFT|ORDERED|RECEIVED|CANCELLED), items[] — legacy, `purchase_orders` table, still used by Dashboard/Reports.
- **WorkflowTask**: orderId, productName, qty, currentStep (PREPARATION|ASSEMBLY|QUALITY_CONTROL|PACKAGING|COMPLETED), assignedTo, dates, notes
- **PurchaseHeader/PurchaseDetail**: `purchase_header`/`purchase_detail` — quotation→PO workflow (status QUOTATION|ORDERED|RECEIVED|CANCELLED), optional `salesHeaderId` link back to a `SalesHeader`, see `PurchasesService.ts`. `purchase_no` is auto-generated (see Auto Document Numbering below).
- **SalesHeader/SalesDetail/ProductionMaterialUsage**: `sales_header`/`sales_detail`/`production_material_usage` — quotation→SO workflow, status `QUOTATION|ORDERED|IN_PRODUCTION|DONE_IN_PRODUCTION|DELIVERED|CANCELLED`. `ORDERED` rows are moved to `IN_PRODUCTION` (`startProduction`), then `DONE_IN_PRODUCTION` (`markProductionDone`), then `DELIVERED` (`markDelivered`) — `OrdersView.tsx` only shows the next action button for the row's current status (status value stays `ORDERED`; `OrdersView.tsx` just displays it as "Pending Production" rather than a delivery-sounding label). Each `SalesDetail` line carries a planned material-usage list (`production_material_usage`, `plannedQuantity` only — `actualQuantity`/`returnedQuantity` unwired until a future production/workflow step), see `OrdersService.ts`. `sales_no` is auto-generated (see Auto Document Numbering below).

### Auto Document Numbering
`sales_header.sales_no` / `purchase_header.purchase_no` are generated by the Postgres function `next_document_number(p_kind text)` (`supabase/function_trigger.sql`), called via `supabase.rpc('next_document_number', { p_kind: 'SO' | 'PO' })` from `OrdersService.ts`/`PurchasesService.ts` on create. It atomically increments `so_next_number`/`po_next_number` on `company_profile` and formats the result against `so_number_format`/`po_number_format` (zero-padded, e.g. `SO-0001`) — company-configurable, not hardcoded.

### Other
- **InventoryTransaction** (see `InventoryTransactionService.ts`): gained `refNo?: string` — a computed/joined display field (no new DB column), populated as `purchaseHeader?.purchase_no || salesHeader?.sales_no` via the existing `purchase_detail(purchase_header(...))` / `production_material_usage(sales_detail(sales_header(...)))` joins, so an inventory transaction row can show which Sales/Purchase order it came from.
- **Attachment**: name, type, size, dataUrl (base64)
- **DashboardStats**: totalSales, totalPurchaseCosts, totalProfit, inventoryValuation, lowStockCount, pendingOrdersCount, activeWorkflowsCount

## Drill-Down Detail Pages & Cross-Tab Navigation
Sales orders and purchases each have a dedicated drill-down detail page, opened only via the row's `ActionsMenu` "View" item (the `<tr>` itself has no `onClick`, so clicking elsewhere in the row does nothing — avoids the old conflict where both a row click and a separate Eye button tried to open the detail page):
- `OrdersView.tsx` → `SalesOrderDetailView.tsx` (header summary + status-lifecycle action buttons, mirroring the row actions, plus line items/materials). Actions (`onEdit`, `onConvert`, `onDelete`, `onStartProduction`, `onProductionCompletion`, `onMarkDelivered`, `onCancel`, `onOpenQuotationDoc`, `onOpenInvoiceDoc`) are passed down from `OrdersView`, which stays the single source of truth for each transition; `refreshSelectedOrder()` re-fetches (`getSalesOrderById`) after any mutation so the open detail page stays in sync.
- `PurchasesView.tsx` → `PurchaseOrderDetailView.tsx`, same shape (`onEdit`/`onConvert`/`onDelete`/`onReceive`/`onCancel`/`onOpenQuotationDoc`, `refreshSelectedPurchase()` via `getPurchaseById`).

**Cross-tab drill-in** (e.g. Product's Order History → a specific Sales Order; Material's Purchase History → a specific Purchase): Product/Material and Orders/Purchases are separate top-level tabs in `App.tsx` with no shared router, and switching tabs unmounts the previous view (`{activeTab === 'X' && <XView key={refreshKey} />}`), so navigation state can't just live in local `useState`. The pattern:
- `App.tsx` owns `pending<X>Id` (id to open on the destination tab) and `<x>ReturnTo<Y>Id` (id to restore on the origin tab if the user hits Back). `navigateToSalesOrder(salesHeaderId, fromProductId?)` / `navigateToPurchaseOrder(purchaseHeaderId, fromMaterialId?)` set both and flip `activeTab`. `returnFromSalesOrder()` / `returnFromPurchaseOrder()` do the reverse.
- Destination view (`OrdersView`/`PurchasesView`) takes `initialOrderId`/`initialPurchaseId` + `onInitial*Handled` (clears the pending id once consumed) + `onReturnToOrigin`. A local `detailOpenedExternally` flag distinguishes "opened via cross-tab prop" (Back calls `onReturnToOrigin()`) from "opened via this view's own Eye button" (Back just closes to this view's own list).
- Origin view (`ProductView`/`MaterialView`) takes `initialProductId`/`initialMaterialId` + `onInitial*Handled`, and re-fetches by id (`getProductById`/`getMaterialById`) to restore its `ProductDetailView`/`MaterialDetailView` drill-down on remount, since local state didn't survive the tab unmount.
- `ProductDetailView`/`MaterialDetailView` accept `onViewSalesOrder`/`onViewPurchaseOrder` (rendered as a "View →" link per history row); `ProductView`/`MaterialView` wrap that callback to also pass their own currently-selected id as the "return to" argument.

## Purchase/Sales Form Notes
- **Line items are editable in-place**: in `PurchasesView.tsx`'s and `OrdersView.tsx`'s edit/convert form, already-added line rows have live `quantity`/`unitCost` (purchases) or `quantity`/`unitPrice` (sales) number inputs — not just the "add new item" panel — recalculating that row's `totalPrice` on change.
- **Linked-SO material requirements**: when a Purchase Quotation/PO has a "Linked Sales Order" selected, `PurchasesView.tsx` shows a "Required Materials for Linked Sales Order" panel (via `OrdersService.getSalesOrderMaterialRequirements`) so the buyer can see how much of each material that contract actually needs.
- **Print modals** (`InvoiceModal.tsx`, `QuotationModal.tsx`, `SalesQuotationModal.tsx`): guard `!companyProfile` before render (state starts `null`; company profile loads async, so the very first open could crash on `companyProfile.name` etc). The popup print window's body keeps its `padding: 40px` — an old `@media print { body { padding: 0 } }` rule was zeroing it out on the one thing that window exists to do (print), and has been removed from all three.

## Contacts Module (Vendors/Clients + their people)
- **DB**: `vendors` and `clients` tables share the same shape (`company_name`, `email`, `office_no`, `address`, `description`, `attachments`). `contacts` table has `vendor_id`/`client_id` FKs (exactly one non-null, `chk_contact_owner` CHECK constraint) plus `job_position` FK → `job_positions`. All three have `updated_at` triggers (`function_trigger.sql`).
- **UI flow**: `ContactsView.tsx` shows a company listing (Vendors/Clients tabs, search, add/edit/delete). Clicking a card (or "View Contacts") drills into `ContactDetailView.tsx`, which shows the company's info (with its own edit/delete) plus a full CRUD list of its Contacts, scoped server-side by `vendor_id`/`client_id`.
- **Logo**: both views render `CompanyLogo` (reuses `attachments[0]`, no new column) next to the company name.
- **Click-to-contact**: in both views, the phone number opens `https://wa.me/${officeNo}` and the email opens a Gmail web-compose URL (`mail.google.com/mail/?view=cm&fs=1&to=`) — both `window.open(..., "_blank")` with `e.stopPropagation()` so they don't also trigger the card's drill-in click.
- **Service**: `ContactsService.ts` — `getVendors(search)`, `getClients(search)`, `saveVendor/deleteVendor`, `saveClient/deleteClient`, `getContacts({vendorId|clientId, search})`, `saveContact/deleteContact`, plus a re-exported `getJobPositions` (from `SystemAdminService`) for the contact form's job-position picker.
- **Materials Supplied** (vendor→material linkage) was removed entirely; `PurchaseOrder` material picker now only matches on `InventoryItem.supplierId`.

## Tabs (App.tsx routing)
1. **DASHBOARD** → DashboardView: KPIs, charts
2. **INVENTORY** → InventoryView: Manage raw materials & finished goods
3. **CONTACTS** → ContactsView (+ ContactDetailView drill-down): Vendors & clients + their contacts
4. **EMPLOYEES** → EmployeesView: Staff management
5. **ORDERS** → OrdersView: Quotation → Sales Order → Production → Delivered workflow over `sales_header`/`sales_detail`, with per-line planned material usage (`production_material_usage`) and quotation/tax-invoice printing
6. **PURCHASES** → PurchasesView: Quotation → Purchase Order workflow over `purchase_header`/`purchase_detail`, receiving stock via `inventory_transaction`
7. **WORKFLOWS** → WorkflowsView: Production tasks (PREPARATION → ASSEMBLY → QC → PACKAGING → COMPLETED)
8. **SYSTEM_ADMIN** → SystemAdminView: Job Position / Material Category / Product Category reference data
9. **REPORTS** → ReportsView: Analytics
10. **EXPORT_GUIDE** → ExportGuide: Help docs (nav entry currently commented out in App.tsx, route still active)

## Backend (server.ts) — legacy REST path (pattern B modules only)
- **Port**: 3000
- **Endpoints**:
  - `GET /api/health` - Health check
  - `GET /api/data/:table?q=<search>&<filterCol>=<val>` - Full-table fetch with optional server-side search/filter (no real pagination despite the name)
  - `GET /api/stats` - Aggregated dashboard stats computed server-side
  - `POST /api/reports/analyze` - Gemini AI report generation
- **Middleware**: express.json()
- **Server Supabase client**: `supabaseServer` (uses VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY)
- **Allowed tables**: inventory_items, vendors, clients, contacts, sales_orders, purchase_orders, workflow_tasks, employees, job_positions, material_categories, product_categories
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
- **Component per feature**: Each view = separate component file; split a drill-down/detail page into its own file (e.g. `ContactDetailView.tsx`) once a view starts doing both list and detail duty.
- **Type safety**: Full TS, all data types in types.ts
- **UI Library**: Lucide icons, Tailwind, motion animations
- **Multi-item support**: Orders store items[] array, display first item in summary
- **Attachments**: Base64 storage for files/images, via `AttachmentSection.tsx`
- **Status workflows**: Defined enums for all statuses (orders, tasks, employees)
- **No hardcoded seed data**: All data comes from Supabase. All getters default to `[]` / empty profile. RECIPES (`export let RECIPES`) loaded dynamically from Supabase `recipes` table at runtime.

## Common Tasks
- **Add new field**: Update types.ts → schema.sql → module service (pattern A) → component view
- **Add a new module/CRUD feature**: Create `services/<Module>Service.ts` following `ContactsService.ts` (direct Supabase reads + `helper.ts` upsert/delete for writes); component owns its own load state via `useState`/`useEffect`/`CallAPI`; split a detail/drill-down page into its own file if the list view would otherwise get long
- **Import/Export Excel**: ImportExportModal uses XLSX lib + `ImportExportService.ts` (pattern A). Vendor/Client/Material/Product import merges by natural key (companyName, or name+code); Purchase/Sales import groups rows by Purchase No/Sales No into header+detail, validates the whole file, shows a Preview, and only writes (landing at status ORDERED) once there are zero errors.
  - **Template download**: `ImportExportModal.tsx`'s `handleDownloadTemplate` builds a blank workbook from `getTemplateHeaders(category)` and downloads `ERP_${category}_Template.xlsx`.
  - **Chunked import**: `commitPurchaseImport`/the sales equivalent in `ImportExportService.ts` write in batches of `COMMIT_CHUNK_SIZE = 25` groups at a time (sequential, one header + one detail insert per chunk) instead of one giant insert; a failed chunk deletes its own just-inserted headers to avoid orphans, and later chunks still proceed.
  - **Export with attachments**: export embeds each record's `attachments[0].dataUrl` as an Excel hyperlink cell (`attachmentLink`) next to an `attachmentName` filename cell. Very large base64 attachments can exceed Excel's hyperlink URL length limit (link won't open) — the filename still shows.
- **Company branding**: CompanyProfile (icon, signature, chop) stored as base64
- **Attach files**: AttachmentSection component, dataUrl = base64
- **Create reports**: ReportsView with Recharts
- **Gemini AI**: Server endpoint (server.ts) integrated
