# Flat-category import: validate → preview → confirm

## Problem

`ImportExportModal`/`ImportExportService` already validates Purchase and Sales imports fully before writing anything: after column mapping, `validatePurchaseImport`/`validateSalesImport` checks every row, shows a preview (row counts + a list of every error), and only enables "Confirm & Import" when there are zero errors.

The other 6 categories (Vendors, Clients, Contacts, Material, Product, Inventory) don't do this. Their `importX` functions parse+resolve+write in one pass and `throw` on the first bad row, aborting mid-write for header-detail-style categories, or (for the generic required-column check only) trigger a download-an-error-Excel fallback. There's no on-screen list of every problem row before commit, and partial writes are possible.

## Goal

Every category gets the same flow: map columns → validate all rows → show a preview with total rows and every error → "Confirm & Import" enabled only when there are zero errors → commit.

## Design

### Service layer (`ImportExportService.ts`)

Each of `importVendors`, `importClients`, `importContacts`, `importMaterials`, `importProducts`, `importInventoryTransactions` is split in two:

- **`validateXImport(rows) -> { records: X[]; errors: ImportRowError[] }`** — same parsing/lookup logic as today, but instead of `throw new Error(...)` on a bad row, it pushes `{ row, message }` onto `errors` and skips adding that row to `records`. No DB write happens here (lookups of existing records for matching stay, since that's read-only).
- **Commit** — a single generic helper, since every flat category's write is just one `upsertRecords(table, records)` call:
  ```ts
  const FLAT_TABLE: Record<FlatCategory, string> = {
    VENDORS: 'erp_vendors', CLIENTS: 'erp_clients', CONTACTS: 'erp_contacts',
    MATERIAL: 'erp_material', PRODUCT: 'erp_product', INVENTORY: 'erp_inventory_transaction',
  };
  export const commitFlatImport = (category: FlatCategory, records: any[]) => upsertRecords(FLAT_TABLE[category], records);
  ```

Row-level validation per category (mirrors current logic, just non-throwing, plus the new checks below):
- **Vendors/Clients**: `companyName` required. New: `email` (if present) must be a valid email format; `officeNo` (if present) must be a valid phone number (see Phone validation below). New: duplicate `companyName` (case-insensitive) appearing more than once in the file is a row error on the later occurrence(s).
- **Contacts**: `fullName` required, `type` must be Client/Vendor, and the named Vendor/Client company must exist. New: `email`/`contactNo` format checks, same as Vendors/Clients. New: duplicate `fullName`+company key within the file is a row error.
- **Material/Product**: `name` required. New: unknown `category` name (non-empty but not matching an existing category) is now a row error instead of silently importing with no category. New: duplicate `name`+`code` (case-insensitive) within the file is a row error.
- **Inventory**: `itemType` must be Material/Product, `code` required and must resolve to an existing item, `quantity` must be non-zero — unchanged, still becomes its own row error instead of an abort.

Each becomes its own row error instead of an abort; a row can carry more than one error (same `row` number, multiple list entries), same as Purchase/Sales already do.

`ImportRowError` (already exists) is reused as-is.

### Email validation

A plain regex format check (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/` or equivalent) — no new dependency, this is a format check, not deliverability.

### Phone validation

New dependency: `libphonenumber-js` (small, no network calls). Validate with `isValidPhoneNumber(value, 'MY')` — default region Malaysia for numbers typed without a country code (e.g. `012-345 6789` parses as a MY number; `+1 555…` still parses via its explicit country code). Applies to Vendor/Client `officeNo` and Contact `contactNo`.

### Duplicate checking (in-file)

For Vendors/Clients (key: `companyName` lower-cased), Material/Product (key: `name+code` lower-cased), and Contacts (key: `fullName`+resolved owner id): track keys seen earlier in the same file with a `Set`. A repeat is a row error ("Duplicate {X} in file") on the row where it repeats — the first occurrence is unaffected. This is in addition to (not a replacement for) the existing DB-match-by-key logic that decides create-vs-update.

### Bulk insert

Already satisfied by the existing `upsertRecords` helper (`helper.ts:138`), which batches all records into chunked `supabase.from(table).upsert(batch)` calls (`BATCH_SIZE` per call) rather than one round-trip per row. `commitFlatImport` below just calls it directly with the full validated `records` array — no per-row insert loop anywhere in this design.

### Modal layer (`ImportExportModal.tsx`)

- New state: `flatPreview: { category: FlatCategory; totalRows: number; errors: ImportRowError[]; records: any[] } | null`, alongside the existing `purchasePreview`/`salesPreview`.
- `executeImport`'s flat-category branch changes from "parse → runFlatImport (writes immediately)" to "parse → call `validateXImport` → set `flatPreview`." Drop `downloadErrorExcel` and its call site (dead code once the on-screen preview covers this).
- The mapping screen's button label always reads "Continue to Preview" (drop the `isHeaderDetailCategory(...) ? ... : 'Confirm & Import'` ternary — every category now goes through preview).
- `activePreview` widens to cover all 8 categories (currently only PURCHASE/SALES). The Preview screen JSX is reused: header-detail categories keep their 3-stat layout (Total Orders / Total Detail Rows / Validation Errors); flat categories show a 2-stat layout (Total Rows / Validation Errors). Error list rendering (`Row {n}: {message}`) is unchanged and shared.
- Confirm button: for flat categories, calls `commitFlatImport(category, flatPreview.records)`, reports success/failure via the existing `status`/`toast` pattern, same as `runFlatImport` does today. Disabled whenever `errors.length > 0`, same as Purchase/Sales.

### Out of scope

- `materialType` on Material import stays lenient (invalid value silently becomes `undefined`, as today) — only `category` name gets the new hard-error treatment.
- No partial-import ("import the valid rows, skip the bad ones") — all-or-nothing, matching Purchase/Sales and the user's stated requirement.
- Purchase/Sales code paths are untouched (they already validate email/phone-free data and already do in-file duplicate detection by Purchase No/Sales No).
