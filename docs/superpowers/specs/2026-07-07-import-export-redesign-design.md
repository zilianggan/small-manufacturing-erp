# Import/Export Redesign (Restructure Step 10) — Design

## Problem

`ImportExportModal.tsx` still targets the pre-restructure data model entirely through `db.ts`'s legacy localStorage-first functions (`getInventory`/`getVendors`/`getClients`/`getSalesOrders`/`getPurchaseOrders`/`getEmployees` + their `save*` counterparts, plus `generateId`). None of this matches current architecture:

- `INVENTORY` imports/exports the old unified `InventoryItem` (`RAW_MATERIAL`/`FINISHED_GOOD` in one table) — replaced by separate `Material` and `Product` catalogs (`MaterialService.ts`/`ProductService.ts`) plus an insert-only stock-movement ledger (`InventoryTransactionService.ts`).
- `SALES`/`PURCHASES` import/export the old flat `SalesOrder`/`PurchaseOrder` types — replaced by header+detail structures (`sales_header`/`sales_detail`/`production_material_usage` via `OrdersService.ts`, `purchase_header`/`purchase_detail` via `PurchasesService.ts`) with a quotation→order status workflow.
- `EMPLOYEES` used the pre-restructure `Employee` shape (`name`/`role`/`phone`) — not in scope for this pass (not requested; would need `EmployeesService.ts` wiring separately).
- `FULL_BACKUP` mode dumps/restores every `erp_*` localStorage key — meaningless now that Supabase is the source of truth and most of those keys are dead.

This step rewrites the modal against the current services, matching the "module owns a `services/<Module>Service.ts`" pattern (`CLAUDE.md`).

## Scope

Import **and** Export, symmetrically, cover exactly 6 categories: **Vendors, Clients, Material, Product, Purchase, Sales**. Dropped entirely: `FULL_BACKUP` mode, `EMPLOYEES` category, the old asymmetric `CONTACTS` combined-export grouping (Vendor and Client become separate categories on both import and export).

## Architecture

New `src/services/ImportExportService.ts` (pattern A — direct Supabase reads via existing category services, writes via existing `save*` functions and raw `supabase` calls for header+detail groups). `ImportExportModal.tsx` is rewritten to call it; all `db.ts` imports are removed from this file.

The existing upload → auto-detect-headers → map-columns UI (drag/drop, paste-friendly column mapper, "Copy Blueprint Template") is kept and reused for all 6 categories — it's proven UX, only the column configs and the post-mapping validate/write logic change per category.

Two import shapes:

**A. Flat categories (Vendors, Clients, Material, Product)** — one row = one record. After column mapping, `ImportExportService` merges each row by natural key against a single freshly-fetched list, then writes:

- Vendors/Clients match by `companyName` (case-insensitive exact match).
- Material/Product match by `name`+`code`, case-insensitive exact equality on both (mirrors the DB's own `UNIQUE(name, code, dimension)` constraint).
- Match found → reuse that row's `id`, call `saveVendor`/`saveClient`/`saveMaterial`/`saveProduct` (upsert-by-id).
- No match → generate new `id`, same save call (insert).
- No more MERGE/OVERWRITE toggle — merge-by-natural-key is the only mode. The old OVERWRITE ("wipe entire table, replace with file") is dropped: it meant wiping a live shared Supabase table, which was never actually requested and is too destructive to keep as a one-click option.
- Material/Product `quantity` is never part of the import row — `saveMaterial`'s row serializer already omits it (DB-trigger-owned via `inventory_transaction`); imported materials/products always start at `quantity` `0` on create and are left untouched on update, consistent with every other write path in the app.
- `materialCategoryId`/`productCategoryId` resolve from a **category name** text column (case-insensitive match against `getMaterialCategories()`/`getProductCategories()`), not a raw UUID. Unmatched or blank → uncategorized (`undefined`).
- Row-level required-field validation reuses the existing pattern: missing required value → collected into an error list → `downloadErrorExcel` (unchanged behavior), import aborted for that batch.

**B. Header+detail categories (Purchase, Sales)** — one row = one detail line; rows sharing an order number belong to one header. After column mapping, this becomes a two-phase flow instead of immediate write:

1. **Group**: rows bucketed by `purchaseNo`/`salesNo` (the mapped "Purchase No"/"Sales No" column — required, non-blank). Header-level fields (vendor/client, dates, remark) are taken from each group's *first* row; later rows in the same group only contribute detail fields. No cross-row header-consistency check within a group (YAGNI — real exports naturally have consistent header data per group).
2. **Validate** (whole file, before any DB write):
   - Vendor/client/material/product name lookups resolve against one full pre-fetched list per entity (`getVendors('')`/`getMaterials('')` etc., fetched once up front) matched by case-insensitive **exact** equality on `companyName`/`name` — not the services' `ilike`-substring search, which could multi-match. Zero or ambiguous (shouldn't happen given `UNIQUE` constraints, but guarded anyway by taking the first exact hit) matches are a validation error.
   - Purchase: vendor exists, material exists, order date parses, `quantity > 0`, `unitCost >= 0`, `purchaseNo` not already present in `purchase_header`.
   - Sales: client exists, product exists, order date parses, `quantity > 0`, `unitPrice >= 0`, `salesNo` not already present in `sales_header`.
   - Every failure is collected as `{ row: number, message: string }` — no early exit, so the user gets the full error list in one pass.
3. **Preview**: new UI state (replaces immediate `validateAndImport` call) showing total groups, total detail rows, and the error list. `0` errors required to enable "Confirm Import" — matches the "do not import any records if any validation fails" requirement. On error, the user closes the preview, fixes the source file, and re-uploads (no partial import, no per-row error-Excel download for this path — the preview list already gives row numbers).
4. **Commit** (only reachable with 0 errors): for each group, in sequence — insert the header row directly via `supabase.from('purchase_header'|'sales_header').insert(...)` with the resolved vendor/client id and status **`ORDERED`** (not `QUOTATION` — the input rows include an order date, and Sales additionally includes a delivery date, both of which only make sense for an already-placed order), then insert all its detail rows via `supabase.from('purchase_detail'|'sales_detail').insert(...)`. `purchase_header.quotation_date` is set equal to the given order date (there's no separate quotation step in an import). No `production_material_usage` rows are created for imported sales details (imports don't reserve production material). If a group's detail insert fails, the just-inserted header is deleted (compensating delete, avoids an orphan header) and the commit stops — result reports which order numbers succeeded before the failure and which one failed. This is a best-effort sequential write, not a real DB transaction (matches the existing accepted pattern in `PurchasesService.createPurchaseQuotation`/`OrdersService.createSalesQuotation`, which are also non-atomic multi-insert sequences) — no new SQL/RPC migration.
   - No stock/inventory side effects from import (imported orders land at `ORDERED`; stock only moves on the existing explicit "Receive"/"Start Production" actions elsewhere in the app).

## Export

Flat categories → single-sheet `.xlsx` (Vendor/Client/Material/Product rows, sourced from `getVendors()`/`getClients()`/`getMaterials()`/`getProducts()`). Purchase/Sales → two-sheet `.xlsx` each:

- `Purchase_Orders` (header fields) + `Purchase_Items` (one row per detail line, header fields repeated) — sourced from `PurchasesService.getPurchases('QUOTATION')` + `getPurchases('PO')` (all statuses, both tabs).
- `Sales_Orders` + `Sales_Items` — sourced from `OrdersService.getSalesOrders('QUOTATION')` + `getSalesOrders('SO')` (all statuses, both tabs).

Uses the `xlsx` package already imported in the modal (`XLSX.utils.json_to_sheet`/`book_append_sheet`/`writeFile`) — no new dependency.

## Files Touched

1. **`src/services/ImportExportService.ts`** (new) — column configs per category, natural-key merge helpers for flat categories, `validatePurchaseImport`/`commitPurchaseImport` and `validateSalesImport`/`commitSalesImport` (group/validate/preview/commit for header+detail categories), export-row builder functions for all 6 categories.
2. **`src/components/ImportExportModal.tsx`** — rewritten to import from `ImportExportService.ts` (and directly from `ContactsService`/`MaterialService`/`ProductService`/`PurchasesService`/`OrdersService` where a plain re-fetch is enough) instead of `db.ts`. Category list drops `FULL_BACKUP`/`EMPLOYEES`, Import Strategy toggle (MERGE/OVERWRITE) is removed, and a new Preview screen is added for the Purchase/Sales import path (step between column-mapping and commit).
3. **`src/services/db.ts`** — after the rewrite, check whether `getInventory`/`saveInventory`/`getSalesOrders`/`saveSalesOrders`/`getPurchaseOrders`/`savePurchaseOrders`/`getEmployees`/`saveEmployees`/`getVendors`/`saveVendors`/`getClients`/`saveClients`/`generateId`/the manufacturing-trigger functions (`addPurchaseOrder`/`updatePurchaseOrderStatus`/`addSalesOrder`/`updateSalesOrderStatus`/`adjustRawMaterialStock`/`getDashboardStats`/`getTrackableInventory`) and the various `load*Data` loaders still have any live callers (Dashboard/Reports read the legacy `sales_orders`/`purchase_orders` tables directly per prior steps' notes — confirm during implementation) before deleting anything. Only remove what's confirmed dead; this file is explicitly out of scope beyond that cleanup.

## Out of Scope

- `EMPLOYEES` category (not requested).
- `FULL_BACKUP` mode (dropped per design discussion — no replacement).
- Real DB-transaction atomicity for Purchase/Sales import (would need a new Postgres RPC/migration — explicitly deferred in favor of the best-effort sequential pattern already accepted elsewhere in this codebase).
- Any change to Dashboard/Reports, which still read the legacy `sales_orders`/`purchase_orders` tables directly and are unaffected by this rewrite.
- Cross-row header-consistency validation within a Purchase/Sales group (e.g. flagging a group where row 2's vendor name differs from row 1's).
- `production_material_usage` creation during Sales import (imported sales orders have no planned material usage; that stays a manual step in the normal Sales Order UI).

## Testing

No automated UI test suite exists for this project (per existing convention). Verification is `npm run lint` plus a manual QA checklist handed to the user after implementation, covering: export then re-import round-trip for each of the 6 categories; Vendor/Client/Material/Product merge correctly updates an existing row (by natural key) and creates a genuinely new one; Material/Product import never changes `quantity`; a Purchase/Sales file with a validation error (bad vendor name, bad product name, non-positive quantity, duplicate order number) shows the error in Preview and imports nothing; a clean Purchase/Sales file creates the right number of `ORDERED`-status headers with correct detail lines and totals; a multi-order file where one group's detail insert is forced to fail (e.g. bad material id) doesn't leave an orphan header row.
