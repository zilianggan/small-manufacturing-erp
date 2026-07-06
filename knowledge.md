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

**A. Module-owned service (preferred, direct-to-Supabase)** — `CompanyProfileService.ts`, `SystemAdminService.ts`, `ContactsService.ts`, `MaterialService.ts`, `ProductService.ts`, `InventoryTransactionService.ts`, `PurchasesService.ts`.
- The service imports `supabase` (from `services/supabase.ts`) directly for reads (with `.ilike`/`.eq` for search/filters), and `helper.ts`'s `upsertRecord`/`deleteRecord` for writes (these serialize camelCase → snake_case via a `ROW_MAPPERS` table keyed by a legacy `erp_*` string and resolve the real table name via `LS_TO_TABLE` — that indirection is just helper.ts's internal API, not a localStorage requirement).
- Optional read-through localStorage cache for rarely-changing reference data only (see `SystemAdminService.getJobPositions`) — always invalidated (`removeStorageItem`) right after a write.
- The view owns its own `useState` + `useEffect` + `CallAPI` (from `components/UIHelper.ts`) loading/loading-state — no shared data hook.
- No `db.ts`, no `server.ts` REST hop, no `useTableData` hook.

**B. Legacy REST hook** — `useTableData<T>('table_name')` (in `hooks/useTableData.ts`) calls `server.ts`'s `GET /api/data/:table?q=&<filterCol>=`, which runs the query server-side via a second Supabase client. Writes still go through `db.ts`'s per-table `save*`/localStorage-array functions. Still used by `OrdersView`, `EmployeesView`, `ReportsView`, `ImportExportModal` (bulk backup). Don't add new dependents; migrate a view to pattern A when you next touch it.

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
│   ├── ContactsView.tsx       # Vendor/Client company listing (search/add/edit/delete + drill-in)
│   ├── ContactDetailView.tsx  # Drill-down: one company's info + its Contacts CRUD
│   ├── CompanyFormFields.tsx  # Shared Vendor/Client form fields (used by both of the above)
│   ├── OrdersView.tsx (sales orders)
│   ├── PurchasesView.tsx (purchase orders)
│   ├── WorkflowsView.tsx (production tasks)
│   ├── EmployeesView.tsx
│   ├── SystemAdminView.tsx   # Job Position / Material Category / Product Category reference data
│   ├── ReportsView.tsx
│   ├── ImportExportModal.tsx (Excel import/export)
│   ├── InvoiceModal.tsx
│   ├── OrderAccordion.tsx
│   ├── TaskCard.tsx
│   ├── SignaturePad.tsx
│   ├── AttachmentSection.tsx
│   ├── ComboBox.tsx
│   ├── InfiniteScrollSentinel.tsx
│   ├── UIHelper.ts           # `CallAPI()` — try/await/onCompleted/onError wrapper used by every service call
│   ├── ui/                   # Shared primitives: Dialog, Card, FormField, SearchInput
│   └── ExportGuide.tsx
└── services/
    ├── db.ts                    # Legacy Zustand store (useSyncStore) + per-table localStorage-array helpers
    ├── supabase.ts               # Supabase client init
    ├── helper.ts (re-exported from src/helper.ts)
    ├── CompanyProfileService.ts  # Pattern A reference implementation
    ├── SystemAdminService.ts     # Pattern A; owns Job Position/Material/Product Category reference data
    ├── ContactsService.ts        # Pattern A; Vendors + Clients + Contacts (people)
    ├── EmployeesService.ts       # Thin re-export wrapper over db.ts + SystemAdminService (pattern B)
    ├── InventoryService.ts       # Thin re-export wrapper over db.ts + SystemAdminService (pattern B)
    ├── OrdersService.ts          # Thin re-export wrapper over db.ts (pattern B)
    ├── PurchasesService.ts       # Pattern A; purchase_header/purchase_detail quotation-to-PO workflow
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
- **SalesOrder**: clientId, itemId, qty, unitPrice, totalPrice, orderDate, deliveryDate, status (PENDING|IN_PRODUCTION|SHIPPED|DELIVERED|CANCELLED), workflowTaskId, items[]
- **PurchaseOrder**: vendorId, itemId, qty, unitCost, totalCost, orderDate, status (DRAFT|ORDERED|RECEIVED|CANCELLED), items[]
- **WorkflowTask**: orderId, productName, qty, currentStep (PREPARATION|ASSEMBLY|QUALITY_CONTROL|PACKAGING|COMPLETED), assignedTo, dates, notes

### Other
- **Attachment**: name, type, size, dataUrl (base64)
- **DashboardStats**: totalSales, totalPurchaseCosts, totalProfit, inventoryValuation, lowStockCount, pendingOrdersCount, activeWorkflowsCount

## Contacts Module (Vendors/Clients + their people)
- **DB**: `vendors` and `clients` tables share the same shape (`company_name`, `email`, `office_no`, `address`, `description`, `attachments`). `contacts` table has `vendor_id`/`client_id` FKs (exactly one non-null, `chk_contact_owner` CHECK constraint) plus `job_position` FK → `job_positions`. All three have `updated_at` triggers (`function_trigger.sql`).
- **UI flow**: `ContactsView.tsx` shows a company listing (Vendors/Clients tabs, search, add/edit/delete). Clicking a card (or "View Contacts") drills into `ContactDetailView.tsx`, which shows the company's info (with its own edit/delete) plus a full CRUD list of its Contacts, scoped server-side by `vendor_id`/`client_id`.
- **Service**: `ContactsService.ts` — `getVendors(search)`, `getClients(search)`, `saveVendor/deleteVendor`, `saveClient/deleteClient`, `getContacts({vendorId|clientId, search})`, `saveContact/deleteContact`, plus a re-exported `getJobPositions` (from `SystemAdminService`) for the contact form's job-position picker.
- **Materials Supplied** (vendor→material linkage) was removed entirely; `PurchaseOrder` material picker now only matches on `InventoryItem.supplierId`.

## Tabs (App.tsx routing)
1. **DASHBOARD** → DashboardView: KPIs, charts
2. **INVENTORY** → InventoryView: Manage raw materials & finished goods
3. **CONTACTS** → ContactsView (+ ContactDetailView drill-down): Vendors & clients + their contacts
4. **EMPLOYEES** → EmployeesView: Staff management
5. **ORDERS** → OrdersView: Sales orders + invoicing
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
- **Import/Export Excel**: ImportExportModal uses XLSX lib (still reads/writes via `db.ts`'s array-based getters — pattern B, scoped to bulk backup)
- **Company branding**: CompanyProfile (icon, signature, chop) stored as base64
- **Attach files**: AttachmentSection component, dataUrl = base64
- **Create reports**: ReportsView with Recharts
- **Gemini AI**: Server endpoint (server.ts) integrated
