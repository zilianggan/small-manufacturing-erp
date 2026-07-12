# Seng Jie Engineering ERP System

A manufacturing ERP desktop application for managing inventory, sales and purchase orders, production workflows, employees, and vendor/client contacts. Built with Electron, React, and Supabase.

## Features

- **Dashboard** — KPIs, charts, recent sales/purchases with drill-through to order detail
- **Inventory** — Material & finished-good stock ledger with transaction history
- **Material / Product catalogs** — Stock levels, purchase/order history, reorder points
- **Contacts** — Vendor & client companies with linked contact people
- **Employees** — Staff records
- **Purchases** — Quotation → Purchase Order workflow, linked to Sales Orders
- **Orders** — Quotation → Sales Order → Production → Delivery workflow, with priority and due-date tracking
- **Workflows** — Drag-and-drop production kanban (Preparation → Assembly → QC → Packaging → Completed)
- **Reports** — Analytics over sales/purchase/inventory data
- **Import/Export** — Bulk Excel import/export for all major entities
- **Print documents** — Invoices, sales quotations, purchase quotations

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Radix UI (shadcn/ui-style component layer)
- **Database**: Supabase (Postgres)
- **Desktop**: Electron 43 (via Electron Forge)
- **Mobile**: Capacitor (Android)
- **Build**: Vite 6 + esbuild
- **Charts**: Recharts
- **Spreadsheet import/export**: XLSX + ExcelJS

## Getting Started

### Prerequisites

- Node.js
- A Supabase project (with the schema in `supabase/schema.sql` applied)

### Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in your Supabase project credentials:
   ```
   VITE_SUPABASE_URL=
   VITE_SUPABASE_ANON_KEY=
   ```
3. Run the app in development:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000`.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server (Vite + Express) |
| `npm run build` | Build the React app and bundle the server into `dist/` |
| `npm start` | Run the production build |
| `npm run electron` | Launch the app in Electron |
| `npm run package` | Package the Electron app |
| `npm run make` | Create platform installers (Electron Forge) |
| `npm run lint` | Type-check the project (`tsc --noEmit`) |

## Architecture

The frontend talks to Supabase directly through module-owned services in `src/services/` (e.g. `OrdersService.ts`, `InventoryTransactionService.ts`, `ContactsService.ts`) built on shared primitives in `src/helper.ts`. `server.ts` only serves the built app and a health check — there is no backend API layer for application data.

Key directories:
```
src/
├── components/   # Views (one per tab) + shared UI/shell component library
├── services/     # Supabase-backed data services, one per module
├── utils/        # Date, priority, and sorting helpers
├── types.ts      # All shared TypeScript interfaces
└── helper.ts     # Shared Supabase read/write primitives

supabase/         # Schema (schema.sql) and Postgres functions/triggers (function_trigger.sql)
android/          # Capacitor Android project
```

Schema changes are tracked in `supabase/schema.sql` / `supabase/function_trigger.sql` and must be applied manually in the Supabase SQL editor — there is no CLI/migration runner wired up.

See `knowledge.md` for a detailed, module-by-module breakdown of the codebase.

## Desktop & Mobile Builds

- **Desktop (Electron)**: `npm run package` (unpacked) or `npm run make` (installers via Electron Forge)
- **Android**: build the web app (`npm run build`), then sync and build via Capacitor in `android/`

## License

Private/internal project — all rights reserved.

## Email
1. Open Chrome.
2. Go to https://mail.google.com and sign in.
3. Click the Protocol Handler (double-diamond) icon in the address bar.
4. Choose Allow Gmail to open email links.
5. On Windows, you may also need to set Chrome (or Gmail) as the handler for the MAILTO protocol in Settings → Apps → Default apps.
Now, clicking a mailto: link can open Gmail in your browser.