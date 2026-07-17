# Flat-Category Import Validate/Preview/Confirm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vendors/Clients/Contacts/Material/Product/Inventory imports get the same validate-all-rows → show-preview-with-errors → confirm-only-if-zero-errors flow that Purchase/Sales imports already have, plus new email/phone/name-exists/duplicate checks.

**Architecture:** Each flat category's `importX` service function splits into a non-writing `validateXImport(rows) -> {records, errors}` (collects every row error instead of throwing on the first) and a single generic `commitFlatImport(category, records)` (one `upsertRecords` call — already bulk). The modal gets one new `flatPreview` state and reuses the existing Purchase/Sales preview screen, generalized to also render flat-category previews.

**Tech Stack:** React 19 + TypeScript, Supabase, `libphonenumber-js` (new dependency), Node's built-in `node:test`/`node:assert` for the one pure-function unit test (no test framework exists in this repo — see Testing Constraint below).

## Global Constraints

- Phone validation: `libphonenumber-js`'s `isValidPhoneNumber(value, 'MY')` — default region Malaysia for numbers without an explicit country code.
- Email validation: plain regex format check, no new dependency.
- Confirm & Import stays disabled whenever `errors.length > 0` — all-or-nothing, no partial import.
- Bulk write only: no per-row insert loop. `upsertRecords` (`src/helper.ts:138`) already chunk-batches; `commitFlatImport` must call it directly with the full records array.
- Purchase/Sales code paths (`validatePurchaseImport`, `commitPurchaseImport`, `validateSalesImport`, `commitSalesImport`, and their modal wiring) are untouched.
- `materialType` on Material import stays lenient (invalid value silently becomes `undefined`); only unknown `category` name becomes a hard row error.
- **Testing constraint:** this repo has no test runner configured (no vitest/jest, no `*.test.*` files, no `test` script). `src/services/supabase.ts` reads `import.meta.env.*`, which is `undefined` outside Vite — so anything that transitively imports `ImportExportService.ts` cannot be safely `import`ed from a plain Node/tsx script. Consequently: the two pure validators (email/phone) are extracted into a standalone `src/utils/validators.ts` with zero Supabase-touching imports, and get one real automated test (`node:test`, run via `npx tsx --test`, both already present as a devDependency — no new test framework). Every other task (the Supabase-touching validate/commit functions and the modal wiring) is verified via `npx tsc --noEmit` (type safety) plus a manual QA step — the manual steps are for you (the human running this plan) to perform in the running app; do not launch the dev server or drive a browser yourself if you are an agent executing this plan, per this project's standing convention.

---

### Task 1: Email/phone pure validators + dependency

**Files:**
- Create: `src/utils/validators.ts`
- Create: `src/utils/validators.test.ts`
- Modify: `package.json` (add `libphonenumber-js` dependency)

**Interfaces:**
- Produces: `isValidEmail(email: string): boolean`, `isValidPhone(phone: string): boolean` — both pure, no I/O. Later tasks import these from `../utils/validators`.

- [ ] **Step 1: Install the dependency**

Run: `npm install libphonenumber-js`
Expected: `package.json` gains a `"libphonenumber-js": "^..."` line under `dependencies`.

- [ ] **Step 2: Write the failing test**

Create `src/utils/validators.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidEmail, isValidPhone } from './validators';

test('isValidEmail accepts a well-formed address', () => {
  assert.equal(isValidEmail('someone@example.com'), true);
});

test('isValidEmail rejects a string with no @', () => {
  assert.equal(isValidEmail('not-an-email'), false);
});

test('isValidEmail rejects a string with no domain', () => {
  assert.equal(isValidEmail('someone@'), false);
});

test('isValidPhone accepts a Malaysian mobile number without a country code', () => {
  assert.equal(isValidPhone('012-345 6789'), true);
});

test('isValidPhone accepts a number with an explicit non-MY country code', () => {
  assert.equal(isValidPhone('+1 202-555-0143'), true);
});

test('isValidPhone rejects an obviously invalid string', () => {
  assert.equal(isValidPhone('abcdef'), false);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx --test src/utils/validators.test.ts`
Expected: FAIL — `Cannot find module './validators'` (the file doesn't exist yet).

- [ ] **Step 4: Write minimal implementation**

Create `src/utils/validators.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { isValidPhoneNumber } from 'libphonenumber-js';

export const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// Default region MY: a number typed without an explicit country code (e.g.
// "012-345 6789") is parsed as Malaysian; numbers with an explicit country
// code (e.g. "+1 202-555-0143") still parse via that code.
export const isValidPhone = (phone: string): boolean => isValidPhoneNumber(phone, 'MY');
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --test src/utils/validators.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/utils/validators.ts src/utils/validators.test.ts
git commit -m "feat: add email/phone import validators"
```

---

### Task 2: Vendors + Clients validate/commit split

**Files:**
- Modify: `src/services/ImportExportService.ts:40-105` (the `RowImportResult` interface, `importVendors`, `importClients`)

**Interfaces:**
- Consumes: `isValidEmail`, `isValidPhone` from `../utils/validators` (Task 1); existing `ImportRowError` interface (already defined later in this same file, at line 321 — TS interfaces are hoisted, no reordering needed); existing `getVendors`, `getClients`, `generateId`.
- Produces: `FlatImportResult<T> = { records: T[]; errors: ImportRowError[] }` (new, shared by every task in this plan), `validateVendorsImport(rows) -> Promise<FlatImportResult<Vendor>>`, `validateClientsImport(rows) -> Promise<FlatImportResult<Client>>`. Task 3/4/5 add sibling `validateXImport` functions using the same `FlatImportResult<T>` type. Task 6 consumes the `records` these produce. Task 7 (modal) calls these two functions by name.

- [ ] **Step 1: Add the shared result type and the import**

Add near the top of `src/services/ImportExportService.ts`, right after the `RowImportResult` interface (around line 43):

```ts
export interface FlatImportResult<T> {
  records: T[];
  errors: ImportRowError[];
}
```

Add to the import block at the top of the file (alongside the existing `nowIso`/`types` imports):

```ts
import { isValidEmail, isValidPhone } from '../utils/validators';
```

- [ ] **Step 2: Replace `importVendors` and `importClients`**

Replace (old_string — lines 57-105, from `export const importVendors` through the end of `importClients`):

```ts
// Merge-by-natural-key only (no OVERWRITE/wipe mode): a companyName match
// (case-insensitive) updates that row, otherwise a new one is created.
export const importVendors = async (rows: Record<string, any>[]): Promise<RowImportResult> => {
  const parsed = rows.map((raw, index) => {
    const companyName = String(raw.companyName || '').trim();
    if (!companyName) throw new Error(`Record #${index + 1} is missing a required 'companyName' field.`);
    return {
      companyName,
      email: raw.email || '',
      officeNo: raw.officeNo || '',
      address: raw.address || '',
      description: raw.description || '',
    };
  });

  const existing = await getVendors('');
  const byName = new Map(existing.map(v => [v.companyName.toLowerCase(), v]));

  const vendors: Vendor[] = parsed.map(item => {
    const match = byName.get(item.companyName.toLowerCase());
    return { id: match?.id || generateId(), attachments: match?.attachments, ...item };
  });
  await upsertRecords('erp_vendors', vendors);

  return { successCount: parsed.length, logs: [`Imported ${parsed.length} vendors (created or updated by company name).`] };
};

export const importClients = async (rows: Record<string, any>[]): Promise<RowImportResult> => {
  const parsed = rows.map((raw, index) => {
    const companyName = String(raw.companyName || '').trim();
    if (!companyName) throw new Error(`Record #${index + 1} is missing a required 'companyName' field.`);
    return {
      companyName,
      email: raw.email || '',
      officeNo: raw.officeNo || '',
      address: raw.address || '',
      description: raw.description || '',
    };
  });

  const existing = await getClients('');
  const byName = new Map(existing.map(c => [c.companyName.toLowerCase(), c]));

  const clients: Client[] = parsed.map(item => {
    const match = byName.get(item.companyName.toLowerCase());
    return { id: match?.id || generateId(), attachments: match?.attachments, ...item };
  });
  await upsertRecords('erp_clients', clients);

  return { successCount: parsed.length, logs: [`Imported ${parsed.length} clients (created or updated by company name).`] };
};
```

With (new_string):

```ts
// Merge-by-natural-key only (no OVERWRITE/wipe mode): a companyName match
// (case-insensitive) updates that row, otherwise a new one is created.
// Validation only — no write. A row with any error is left out of `records`
// entirely; the caller only commits once `errors` is empty.
export const validateVendorsImport = async (rows: Record<string, any>[]): Promise<FlatImportResult<Vendor>> => {
  const existing = await getVendors('');
  const byName = new Map(existing.map(v => [v.companyName.toLowerCase(), v]));
  const seenInFile = new Set<string>();
  const errors: ImportRowError[] = [];
  const records: Vendor[] = [];

  rows.forEach((raw, index) => {
    const rowNum = index + 1;
    const companyName = String(raw.companyName || '').trim();
    const email = String(raw.email || '').trim();
    const officeNo = String(raw.officeNo || '').trim();
    let rowValid = true;

    if (!companyName) { errors.push({ row: rowNum, message: "Missing 'Company Name'." }); rowValid = false; }
    if (email && !isValidEmail(email)) { errors.push({ row: rowNum, message: `Email "${email}" is not a valid email address.` }); rowValid = false; }
    if (officeNo && !isValidPhone(officeNo)) { errors.push({ row: rowNum, message: `Office No. "${officeNo}" is not a valid phone number.` }); rowValid = false; }

    if (companyName) {
      const key = companyName.toLowerCase();
      if (seenInFile.has(key)) { errors.push({ row: rowNum, message: `Duplicate Company Name "${companyName}" in file.` }); rowValid = false; }
      seenInFile.add(key);
    }

    if (!rowValid) return;

    const match = byName.get(companyName.toLowerCase());
    records.push({ id: match?.id || generateId(), attachments: match?.attachments, companyName, email, officeNo, address: String(raw.address || ''), description: String(raw.description || '') });
  });

  return { records, errors };
};

export const validateClientsImport = async (rows: Record<string, any>[]): Promise<FlatImportResult<Client>> => {
  const existing = await getClients('');
  const byName = new Map(existing.map(c => [c.companyName.toLowerCase(), c]));
  const seenInFile = new Set<string>();
  const errors: ImportRowError[] = [];
  const records: Client[] = [];

  rows.forEach((raw, index) => {
    const rowNum = index + 1;
    const companyName = String(raw.companyName || '').trim();
    const email = String(raw.email || '').trim();
    const officeNo = String(raw.officeNo || '').trim();
    let rowValid = true;

    if (!companyName) { errors.push({ row: rowNum, message: "Missing 'Company Name'." }); rowValid = false; }
    if (email && !isValidEmail(email)) { errors.push({ row: rowNum, message: `Email "${email}" is not a valid email address.` }); rowValid = false; }
    if (officeNo && !isValidPhone(officeNo)) { errors.push({ row: rowNum, message: `Office No. "${officeNo}" is not a valid phone number.` }); rowValid = false; }

    if (companyName) {
      const key = companyName.toLowerCase();
      if (seenInFile.has(key)) { errors.push({ row: rowNum, message: `Duplicate Company Name "${companyName}" in file.` }); rowValid = false; }
      seenInFile.add(key);
    }

    if (!rowValid) return;

    const match = byName.get(companyName.toLowerCase());
    records.push({ id: match?.id || generateId(), attachments: match?.attachments, companyName, email, officeNo, address: String(raw.address || ''), description: String(raw.description || '') });
  });

  return { records, errors };
};
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: Errors mentioning `importVendors`/`importClients` not found in `ImportExportModal.tsx` — expected at this point, since the modal isn't updated until Task 7. No errors should originate from `ImportExportService.ts` itself. If you see errors inside `ImportExportService.ts`, fix them before proceeding.

- [ ] **Step 4: Commit**

```bash
git add src/services/ImportExportService.ts
git commit -m "feat: split Vendors/Clients import into validate step with email/phone/duplicate checks"
```

---

### Task 3: Contacts validate/commit split

**Files:**
- Modify: `src/services/ImportExportService.ts:119-150` (`importContacts`)

**Interfaces:**
- Consumes: `FlatImportResult<T>` (Task 2), `isValidEmail`/`isValidPhone` (Task 1).
- Produces: `validateContactsImport(rows) -> Promise<FlatImportResult<Contact>>`.

- [ ] **Step 1: Replace `importContacts`**

Replace (old_string):

```ts
// Type + Company Name resolve which vendor/client the contact belongs to
// (mirrors Contact.vendorId/clientId being mutually exclusive). Merge key is
// name + owner id, so the same person name under two different companies
// imports as two contacts instead of colliding.
export const importContacts = async (rows: Record<string, any>[]): Promise<RowImportResult> => {
  const [vendors, clients, existing] = await Promise.all([getVendors(''), getClients(''), getContacts({})]);
  const vendorByName = new Map(vendors.map(v => [v.companyName.toLowerCase(), v]));
  const clientByName = new Map(clients.map(c => [c.companyName.toLowerCase(), c]));
  const existingByKey = new Map(existing.map(c => [`${c.fullName.toLowerCase()}::${c.vendorId || c.clientId || ''}`, c]));

  const contacts: Contact[] = rows.map((raw, index) => {
    const fullName = String(raw.fullName || '').trim();
    if (!fullName) throw new Error(`Record #${index + 1} is missing a required 'fullName' field.`);

    const type = String(raw.type || '').trim().toUpperCase();
    if (type !== 'CLIENT' && type !== 'VENDOR') throw new Error(`Record #${index + 1}: 'type' must be Client or Vendor.`);

    const companyName = String(raw.companyName || '').trim();
    const owner = type === 'VENDOR' ? vendorByName.get(companyName.toLowerCase()) : clientByName.get(companyName.toLowerCase());
    if (!owner) throw new Error(`Record #${index + 1}: ${type === 'VENDOR' ? 'Vendor' : 'Client'} "${companyName}" not found.`);

    const match = existingByKey.get(`${fullName.toLowerCase()}::${owner.id}`);
    return {
      id: match?.id || generateId(),
      fullName,
      email: raw.email || '',
      contactNo: raw.contactNo || '',
      vendorId: type === 'VENDOR' ? owner.id : undefined,
      clientId: type === 'CLIENT' ? owner.id : undefined,
      attachments: match?.attachments,
    };
  });

  await upsertRecords('erp_contacts', contacts);
  return { successCount: contacts.length, logs: [`Imported ${contacts.length} contacts (created or updated by name + company).`] };
};
```

With (new_string):

```ts
// Type + Company Name resolve which vendor/client the contact belongs to
// (mirrors Contact.vendorId/clientId being mutually exclusive). Merge key is
// name + owner id, so the same person name under two different companies
// imports as two contacts instead of colliding.
export const validateContactsImport = async (rows: Record<string, any>[]): Promise<FlatImportResult<Contact>> => {
  const [vendors, clients, existing] = await Promise.all([getVendors(''), getClients(''), getContacts({})]);
  const vendorByName = new Map(vendors.map(v => [v.companyName.toLowerCase(), v]));
  const clientByName = new Map(clients.map(c => [c.companyName.toLowerCase(), c]));
  const existingByKey = new Map(existing.map(c => [`${c.fullName.toLowerCase()}::${c.vendorId || c.clientId || ''}`, c]));
  const seenInFile = new Set<string>();
  const errors: ImportRowError[] = [];
  const records: Contact[] = [];

  rows.forEach((raw, index) => {
    const rowNum = index + 1;
    const fullName = String(raw.fullName || '').trim();
    const type = String(raw.type || '').trim().toUpperCase();
    const companyName = String(raw.companyName || '').trim();
    const email = String(raw.email || '').trim();
    const contactNo = String(raw.contactNo || '').trim();
    let rowValid = true;

    if (!fullName) { errors.push({ row: rowNum, message: "Missing 'Contact Name'." }); rowValid = false; }
    if (type !== 'CLIENT' && type !== 'VENDOR') { errors.push({ row: rowNum, message: "'Type' must be Client or Vendor." }); rowValid = false; }
    if (email && !isValidEmail(email)) { errors.push({ row: rowNum, message: `Email "${email}" is not a valid email address.` }); rowValid = false; }
    if (contactNo && !isValidPhone(contactNo)) { errors.push({ row: rowNum, message: `Contact No. "${contactNo}" is not a valid phone number.` }); rowValid = false; }

    const owner = type === 'VENDOR' ? vendorByName.get(companyName.toLowerCase())
      : type === 'CLIENT' ? clientByName.get(companyName.toLowerCase())
      : undefined;
    if ((type === 'CLIENT' || type === 'VENDOR') && !owner) {
      errors.push({ row: rowNum, message: `${type === 'VENDOR' ? 'Vendor' : 'Client'} "${companyName}" not found.` });
      rowValid = false;
    }

    if (fullName && owner) {
      const key = `${fullName.toLowerCase()}::${owner.id}`;
      if (seenInFile.has(key)) { errors.push({ row: rowNum, message: `Duplicate Contact "${fullName}" for "${companyName}" in file.` }); rowValid = false; }
      seenInFile.add(key);
    }

    if (!rowValid || !owner) return;

    const match = existingByKey.get(`${fullName.toLowerCase()}::${owner.id}`);
    records.push({
      id: match?.id || generateId(),
      fullName,
      email,
      contactNo,
      vendorId: type === 'VENDOR' ? owner.id : undefined,
      clientId: type === 'CLIENT' ? owner.id : undefined,
      attachments: match?.attachments,
    });
  });

  return { records, errors };
};
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: Same pre-existing modal-side errors as Task 2 (not yet fixed until Task 7); no new errors from `ImportExportService.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/services/ImportExportService.ts
git commit -m "feat: split Contacts import into validate step with email/phone/duplicate checks"
```

---

### Task 4: Material + Product validate/commit split

**Files:**
- Modify: `src/services/ImportExportService.ts:210-288` (`importMaterials`, `importProducts`)

**Interfaces:**
- Consumes: `FlatImportResult<T>` (Task 2), existing `VALID_MATERIAL_TYPES`, `getMaterialCategories`, `getProductCategories`.
- Produces: `validateMaterialsImport(rows) -> Promise<FlatImportResult<Material>>`, `validateProductsImport(rows) -> Promise<FlatImportResult<Product>>`.

- [ ] **Step 1: Replace `importMaterials` and `importProducts`**

Replace (old_string — from `export const importMaterials` through the end of `importProducts`):

```ts
// Merge-by-(name+code) — mirrors the DB's own UNIQUE(name, code, dimension)
// constraint. `quantity` is never part of the import row: it's owned by the
// update_material_stock() DB trigger, same as every other Material write
// path (saveMaterial's own row serializer already omits it).
export const importMaterials = async (rows: Record<string, any>[]): Promise<RowImportResult> => {
  const parsed = rows.map((raw, index) => {
    const name = String(raw.name || '').trim();
    if (!name) throw new Error(`Record #${index + 1} is missing a required 'name' field.`);
    const materialType = VALID_MATERIAL_TYPES.includes(raw.materialType) ? raw.materialType : undefined;
    return {
      name,
      code: raw.code || '',
      materialType,
      dimension: raw.dimension || '',
      description: raw.description || '',
      minimumStock: Number(raw.minimumStock) || 0,
      categoryName: String(raw.category || '').trim(),
    };
  });

  const [existing, categories] = await Promise.all([getMaterials(''), getMaterialCategories()]);
  const byNameCode = new Map(existing.map(m => [`${m.name.toLowerCase()}::${(m.code || '').toLowerCase()}`, m]));
  const categoryByName = new Map(categories.map(c => [c.name.toLowerCase(), c.id]));

  const materials: Material[] = parsed.map(item => {
    const key = `${item.name.toLowerCase()}::${item.code.toLowerCase()}`;
    const match = byNameCode.get(key);
    return {
      id: match?.id || generateId(),
      name: item.name,
      code: item.code,
      materialType: item.materialType,
      dimension: item.dimension,
      quantity: match?.quantity ?? 0, // never written — helper.ts's erp_material serialiser omits this field
      description: item.description,
      attachments: match?.attachments, // preserve existing attachments on update; new records get none
      status: match?.status || 'ACTIVE',
      minimumStock: item.minimumStock,
      materialCategoryId: categoryByName.get(item.categoryName.toLowerCase()) || undefined,
    };
  });
  await upsertRecords('erp_material', materials);

  return { successCount: parsed.length, logs: [`Imported ${parsed.length} materials (created or updated by name+code).`] };
};

export const importProducts = async (rows: Record<string, any>[]): Promise<RowImportResult> => {
  const parsed = rows.map((raw, index) => {
    const name = String(raw.name || '').trim();
    if (!name) throw new Error(`Record #${index + 1} is missing a required 'name' field.`);
    return {
      name,
      code: raw.code || '',
      dimension: raw.dimension || '',
      description: raw.description || '',
      sellingPrice: Number(raw.sellingPrice) || 0,
      categoryName: String(raw.category || '').trim(),
    };
  });

  const [existing, categories] = await Promise.all([getProducts(''), getProductCategories()]);
  const byNameCode = new Map(existing.map(p => [`${p.name.toLowerCase()}::${(p.code || '').toLowerCase()}`, p]));
  const categoryByName = new Map(categories.map(c => [c.name.toLowerCase(), c.id]));

  const products: Product[] = parsed.map(item => {
    const key = `${item.name.toLowerCase()}::${item.code.toLowerCase()}`;
    const match = byNameCode.get(key);
    return {
      id: match?.id || generateId(),
      name: item.name,
      code: item.code,
      dimension: item.dimension,
      description: item.description,
      attachments: match?.attachments, // preserve existing attachments on update; new records get none
      status: match?.status || 'ACTIVE',
      sellingPrice: item.sellingPrice,
      productCategoryId: categoryByName.get(item.categoryName.toLowerCase()) || undefined,
    };
  });
  await upsertRecords('erp_product', products);

  return { successCount: parsed.length, logs: [`Imported ${parsed.length} products (created or updated by name+code).`] };
};
```

With (new_string):

```ts
// Merge-by-(name+code) — mirrors the DB's own UNIQUE(name, code, dimension)
// constraint. `quantity` is never part of the import row: it's owned by the
// update_material_stock() DB trigger, same as every other Material write
// path (saveMaterial's own row serializer already omits it).
export const validateMaterialsImport = async (rows: Record<string, any>[]): Promise<FlatImportResult<Material>> => {
  const [existing, categories] = await Promise.all([getMaterials(''), getMaterialCategories()]);
  const byNameCode = new Map(existing.map(m => [`${m.name.toLowerCase()}::${(m.code || '').toLowerCase()}`, m]));
  const categoryByName = new Map(categories.map(c => [c.name.toLowerCase(), c.id]));
  const seenInFile = new Set<string>();
  const errors: ImportRowError[] = [];
  const records: Material[] = [];

  rows.forEach((raw, index) => {
    const rowNum = index + 1;
    const name = String(raw.name || '').trim();
    const code = String(raw.code || '').trim();
    const categoryName = String(raw.category || '').trim();
    let rowValid = true;

    if (!name) { errors.push({ row: rowNum, message: "Missing 'Material Name'." }); rowValid = false; }

    let categoryId: string | undefined;
    if (categoryName) {
      categoryId = categoryByName.get(categoryName.toLowerCase());
      if (!categoryId) { errors.push({ row: rowNum, message: `Category "${categoryName}" not found.` }); rowValid = false; }
    }

    if (name) {
      const key = `${name.toLowerCase()}::${code.toLowerCase()}`;
      if (seenInFile.has(key)) { errors.push({ row: rowNum, message: `Duplicate Material "${name}"${code ? ` (${code})` : ''} in file.` }); rowValid = false; }
      seenInFile.add(key);
    }

    if (!rowValid) return;

    const materialType = VALID_MATERIAL_TYPES.includes(raw.materialType) ? raw.materialType : undefined;
    const match = byNameCode.get(`${name.toLowerCase()}::${code.toLowerCase()}`);
    records.push({
      id: match?.id || generateId(),
      name,
      code,
      materialType,
      dimension: String(raw.dimension || ''),
      quantity: match?.quantity ?? 0, // never written — helper.ts's erp_material serialiser omits this field
      description: String(raw.description || ''),
      attachments: match?.attachments, // preserve existing attachments on update; new records get none
      status: match?.status || 'ACTIVE',
      minimumStock: Number(raw.minimumStock) || 0,
      materialCategoryId: categoryId,
    });
  });

  return { records, errors };
};

export const validateProductsImport = async (rows: Record<string, any>[]): Promise<FlatImportResult<Product>> => {
  const [existing, categories] = await Promise.all([getProducts(''), getProductCategories()]);
  const byNameCode = new Map(existing.map(p => [`${p.name.toLowerCase()}::${(p.code || '').toLowerCase()}`, p]));
  const categoryByName = new Map(categories.map(c => [c.name.toLowerCase(), c.id]));
  const seenInFile = new Set<string>();
  const errors: ImportRowError[] = [];
  const records: Product[] = [];

  rows.forEach((raw, index) => {
    const rowNum = index + 1;
    const name = String(raw.name || '').trim();
    const code = String(raw.code || '').trim();
    const categoryName = String(raw.category || '').trim();
    let rowValid = true;

    if (!name) { errors.push({ row: rowNum, message: "Missing 'Product Name'." }); rowValid = false; }

    let categoryId: string | undefined;
    if (categoryName) {
      categoryId = categoryByName.get(categoryName.toLowerCase());
      if (!categoryId) { errors.push({ row: rowNum, message: `Category "${categoryName}" not found.` }); rowValid = false; }
    }

    if (name) {
      const key = `${name.toLowerCase()}::${code.toLowerCase()}`;
      if (seenInFile.has(key)) { errors.push({ row: rowNum, message: `Duplicate Product "${name}"${code ? ` (${code})` : ''} in file.` }); rowValid = false; }
      seenInFile.add(key);
    }

    if (!rowValid) return;

    const match = byNameCode.get(`${name.toLowerCase()}::${code.toLowerCase()}`);
    records.push({
      id: match?.id || generateId(),
      name,
      code,
      dimension: String(raw.dimension || ''),
      description: String(raw.description || ''),
      attachments: match?.attachments, // preserve existing attachments on update; new records get none
      status: match?.status || 'ACTIVE',
      sellingPrice: Number(raw.sellingPrice) || 0,
      productCategoryId: categoryId,
    });
  });

  return { records, errors };
};
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: Same pre-existing modal-side errors as Task 2/3; no new errors from `ImportExportService.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/services/ImportExportService.ts
git commit -m "feat: split Material/Product import into validate step with category-exists/duplicate checks"
```

---

### Task 5: Inventory validate/commit split

**Files:**
- Modify: `src/services/ImportExportService.ts:746-782` (`importInventoryTransactions`)

**Interfaces:**
- Consumes: `FlatImportResult<T>` (Task 2).
- Produces: `validateInventoryImport(rows) -> Promise<FlatImportResult<InventoryTransaction>>`.

- [ ] **Step 1: Add the `InventoryTransaction` type import**

The original file never imports this type (the old `importInventoryTransactions` never typed its array explicitly). Replace (old_string, the `types` import line near the top of the file):

```ts
import { Vendor, Client, Contact, Material, Product, Attachment } from "../types";
```

With (new_string):

```ts
import { Vendor, Client, Contact, Material, Product, Attachment, InventoryTransaction } from "../types";
```

- [ ] **Step 2: Replace `importInventoryTransactions`**

Replace (old_string):

```ts
// Bulk stock adjustments only (ADJUSTMENT type) — PURCHASE/SALES/*_RETURN
// rows are always system-generated off a purchase/sales order, never
// hand-entered here.
export const importInventoryTransactions = async (rows: Record<string, any>[]): Promise<RowImportResult> => {
  const [materials, products] = await Promise.all([getMaterials(''), getProducts('')]);
  const materialByCode = new Map(materials.filter(m => m.code).map(m => [m.code!.toLowerCase(), m]));
  const productByCode = new Map(products.filter(p => p.code).map(p => [p.code!.toLowerCase(), p]));

  const parsed = rows.map((raw, index) => {
    const itemType = String(raw.itemType || '').trim().toUpperCase();
    if (itemType !== 'MATERIAL' && itemType !== 'PRODUCT') throw new Error(`Record #${index + 1}: 'Item Type' must be Material or Product.`);

    const code = String(raw.code || '').trim();
    if (!code) throw new Error(`Record #${index + 1} is missing a required 'code' field.`);

    const item = itemType === 'MATERIAL' ? materialByCode.get(code.toLowerCase()) : productByCode.get(code.toLowerCase());
    if (!item) throw new Error(`Record #${index + 1}: ${itemType === 'MATERIAL' ? 'Material' : 'Product'} code "${code}" not found.`);

    const quantity = Number(raw.quantity);
    if (!quantity) throw new Error(`Record #${index + 1}: Quantity must be a non-zero number.`);

    const date = String(raw.date || '').trim();
    const transactionDate = date && !isNaN(Date.parse(date)) ? new Date(date).toISOString() : nowIso();

    return {
      id: generateId(),
      transactionType: 'ADJUSTMENT' as const,
      quantity,
      unitCost: raw.unitCost !== undefined && raw.unitCost !== '' ? Number(raw.unitCost) : undefined,
      remark: raw.remark ? String(raw.remark) : undefined,
      materialId: itemType === 'MATERIAL' ? item.id : undefined,
      productId: itemType === 'PRODUCT' ? item.id : undefined,
      transactionDate,
    };
  });

  await upsertRecords('erp_inventory_transaction', parsed);

  return { successCount: parsed.length, logs: [`Imported ${parsed.length} inventory transaction(s) as stock adjustments.`] };
};
```

With (new_string):

```ts
// Bulk stock adjustments only (ADJUSTMENT type) — PURCHASE/SALES/*_RETURN
// rows are always system-generated off a purchase/sales order, never
// hand-entered here.
export const validateInventoryImport = async (rows: Record<string, any>[]): Promise<FlatImportResult<InventoryTransaction>> => {
  const [materials, products] = await Promise.all([getMaterials(''), getProducts('')]);
  const materialByCode = new Map(materials.filter(m => m.code).map(m => [m.code!.toLowerCase(), m]));
  const productByCode = new Map(products.filter(p => p.code).map(p => [p.code!.toLowerCase(), p]));
  const errors: ImportRowError[] = [];
  const records: InventoryTransaction[] = [];

  rows.forEach((raw, index) => {
    const rowNum = index + 1;
    const itemType = String(raw.itemType || '').trim().toUpperCase();
    const code = String(raw.code || '').trim();
    const quantity = Number(raw.quantity);
    let rowValid = true;

    if (itemType !== 'MATERIAL' && itemType !== 'PRODUCT') { errors.push({ row: rowNum, message: "'Item Type' must be Material or Product." }); rowValid = false; }
    if (!code) { errors.push({ row: rowNum, message: "Missing 'Item Code'." }); rowValid = false; }

    const item = itemType === 'MATERIAL' ? materialByCode.get(code.toLowerCase())
      : itemType === 'PRODUCT' ? productByCode.get(code.toLowerCase())
      : undefined;
    if (code && (itemType === 'MATERIAL' || itemType === 'PRODUCT') && !item) {
      errors.push({ row: rowNum, message: `${itemType === 'MATERIAL' ? 'Material' : 'Product'} code "${code}" not found.` });
      rowValid = false;
    }

    if (!quantity) { errors.push({ row: rowNum, message: 'Quantity must be a non-zero number.' }); rowValid = false; }

    if (!rowValid || !item) return;

    const date = String(raw.date || '').trim();
    const transactionDate = date && !isNaN(Date.parse(date)) ? new Date(date).toISOString() : nowIso();

    records.push({
      id: generateId(),
      transactionType: 'ADJUSTMENT' as const,
      quantity,
      unitCost: raw.unitCost !== undefined && raw.unitCost !== '' ? Number(raw.unitCost) : undefined,
      remark: raw.remark ? String(raw.remark) : undefined,
      materialId: itemType === 'MATERIAL' ? item.id : undefined,
      productId: itemType === 'PRODUCT' ? item.id : undefined,
      transactionDate,
    });
  });

  return { records, errors };
};
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: Same pre-existing modal-side errors as prior tasks; no new errors from `ImportExportService.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/services/ImportExportService.ts
git commit -m "feat: split Inventory import into non-throwing validate step"
```

---

### Task 6: Generic `commitFlatImport` + cleanup

**Files:**
- Modify: `src/services/ImportExportService.ts` (remove now-unused `RowImportResult` interface at the original lines 40-43; add `FlatCategory` type + `commitFlatImport` near the bottom, after `getAllExportSheets`)

**Interfaces:**
- Consumes: `upsertRecords` (`../helper`, already imported).
- Produces: `FlatCategory = 'VENDORS' | 'CLIENTS' | 'CONTACTS' | 'MATERIAL' | 'PRODUCT' | 'INVENTORY'`, `commitFlatImport(category: FlatCategory, records: any[]) -> Promise<void>`. Task 7/8 (modal) import both.

- [ ] **Step 1: Remove the now-unused `RowImportResult` interface**

Delete (old_string):

```ts
export interface RowImportResult {
  successCount: number;
  logs: string[];
}

```

(It's no longer returned by anything — every flat category now returns `FlatImportResult<T>` from Task 2-5.)

- [ ] **Step 2: Add `FlatCategory` and `commitFlatImport` at the end of the file**

Append to the end of `src/services/ImportExportService.ts` (after the closing brace of `getAllExportSheets`):

```ts

export type FlatCategory = 'VENDORS' | 'CLIENTS' | 'CONTACTS' | 'MATERIAL' | 'PRODUCT' | 'INVENTORY';

const FLAT_LS_KEY: Record<FlatCategory, string> = {
  VENDORS: 'erp_vendors',
  CLIENTS: 'erp_clients',
  CONTACTS: 'erp_contacts',
  MATERIAL: 'erp_material',
  PRODUCT: 'erp_product',
  INVENTORY: 'erp_inventory_transaction',
};

// Every flat category's commit is the same shape: one upsertRecords call.
// upsertRecords (helper.ts) already chunk-batches internally — this is not
// a per-row insert loop.
export const commitFlatImport = async (category: FlatCategory, records: any[]): Promise<void> => {
  await upsertRecords(FLAT_LS_KEY[category], records);
};
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: Same pre-existing modal-side errors (`ImportExportModal.tsx` still references the old `importX` names) — fixed in Task 7. No errors from `ImportExportService.ts` itself.

- [ ] **Step 4: Commit**

```bash
git add src/services/ImportExportService.ts
git commit -m "feat: add generic commitFlatImport, drop unused RowImportResult"
```

---

### Task 7: Modal — wire validate step into `executeImport`, drop error-Excel fallback

**Files:**
- Modify: `src/components/ImportExportModal.tsx`

**Interfaces:**
- Consumes: `validateVendorsImport`, `validateClientsImport`, `validateContactsImport`, `validateMaterialsImport`, `validateProductsImport`, `validateInventoryImport`, `commitFlatImport`, `FlatCategory` (all from Tasks 2-6, `../services/ImportExportService`).
- Produces: `flatPreview` state (shape `{ category: FlatCategory; totalRows: number; errors: ImportRowError[]; records: any[] } | null`), `runFlatValidation`, `handleConfirmFlatImport` — Task 8 renders `flatPreview` and calls `handleConfirmFlatImport`.

- [ ] **Step 1: Update the import block**

Replace (old_string, lines 13-21):

```ts
import {
  ImportColumn, ImportRowError,
  VENDOR_COLUMNS, CLIENT_COLUMNS, CONTACT_COLUMNS, MATERIAL_COLUMNS, PRODUCT_COLUMNS, PURCHASE_COLUMNS, SALES_COLUMNS, INVENTORY_COLUMNS,
  importVendors, importClients, importContacts, importMaterials, importProducts, importInventoryTransactions,
  validatePurchaseImport, commitPurchaseImport, PurchaseImportPreview, PurchaseImportRow,
  validateSalesImport, commitSalesImport, SalesImportPreview, SalesImportRow,
  getVendorExportRows, getClientExportRows, getContactExportRows, getMaterialExportRows, getProductExportRows,
  getPurchaseExportSheets, getSalesExportSheets, getInventoryExportRows, getAllExportSheets,
} from '../services/ImportExportService';
```

With (new_string):

```ts
import {
  ImportColumn, ImportRowError, FlatCategory,
  VENDOR_COLUMNS, CLIENT_COLUMNS, CONTACT_COLUMNS, MATERIAL_COLUMNS, PRODUCT_COLUMNS, PURCHASE_COLUMNS, SALES_COLUMNS, INVENTORY_COLUMNS,
  validateVendorsImport, validateClientsImport, validateContactsImport, validateMaterialsImport, validateProductsImport, validateInventoryImport, commitFlatImport,
  validatePurchaseImport, commitPurchaseImport, PurchaseImportPreview, PurchaseImportRow,
  validateSalesImport, commitSalesImport, SalesImportPreview, SalesImportRow,
  getVendorExportRows, getClientExportRows, getContactExportRows, getMaterialExportRows, getProductExportRows,
  getPurchaseExportSheets, getSalesExportSheets, getInventoryExportRows, getAllExportSheets,
} from '../services/ImportExportService';
```

- [ ] **Step 2: Add `flatPreview` state next to the existing preview states**

Replace (old_string, lines 68-69):

```ts
  const [purchasePreview, setPurchasePreview] = useState<PurchaseImportPreview | null>(null);
  const [salesPreview, setSalesPreview] = useState<SalesImportPreview | null>(null);
```

With (new_string):

```ts
  const [purchasePreview, setPurchasePreview] = useState<PurchaseImportPreview | null>(null);
  const [salesPreview, setSalesPreview] = useState<SalesImportPreview | null>(null);
  const [flatPreview, setFlatPreview] = useState<{ category: FlatCategory; totalRows: number; errors: ImportRowError[]; records: any[] } | null>(null);
```

- [ ] **Step 3: Reset `flatPreview` when switching category**

Replace (old_string, inside the category list `onClick`, lines 429-435):

```ts
                      onClick={() => {
                        setActiveCategory(item.id);
                        setStatus({ type: 'idle', message: '' });
                        setMappingState(null);
                        setPurchasePreview(null);
                        setSalesPreview(null);
                      }}
```

With (new_string):

```ts
                      onClick={() => {
                        setActiveCategory(item.id);
                        setStatus({ type: 'idle', message: '' });
                        setMappingState(null);
                        setPurchasePreview(null);
                        setSalesPreview(null);
                        setFlatPreview(null);
                      }}
```

- [ ] **Step 4: Remove `downloadErrorExcel` and replace `runFlatImport` with `runFlatValidation`**

Replace (old_string, lines 191-216 — `downloadErrorExcel` through the end of `runFlatImport`):

```ts
  const downloadErrorExcel = (headers: string[], rows: any[][], errors: string[]) => {
    const newHeaders = [...headers, 'Error Message'];
    const newRows = rows.map((row, i) => [...row, errors[i] || '']);
    const ws = XLSX.utils.aoa_to_sheet([newHeaders, ...newRows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Import_Errors');
    XLSX.writeFile(wb, 'Import_Errors.xlsx');
  };

  const runFlatImport = async (category: 'VENDORS' | 'CLIENTS' | 'CONTACTS' | 'MATERIAL' | 'PRODUCT' | 'INVENTORY', rows: Record<string, any>[]) => {
    try {
      const result = category === 'VENDORS' ? await importVendors(rows)
        : category === 'CLIENTS' ? await importClients(rows)
        : category === 'CONTACTS' ? await importContacts(rows)
        : category === 'MATERIAL' ? await importMaterials(rows)
        : category === 'PRODUCT' ? await importProducts(rows)
        : await importInventoryTransactions(rows);

      setStatus({ type: 'success', message: 'Successfully completed import.', details: result.logs });
      toast.success('Import completed successfully.');
      onDataImported();
    } catch (err: any) {
      setStatus({ type: 'error', message: 'Import failed!', details: [err.message || 'Make sure the Excel file is correctly formatted.'] });
      toast.error(err.message || 'Import failed. Make sure the Excel file is correctly formatted.');
    }
  };
```

With (new_string):

```ts
  const runFlatValidation = async (category: FlatCategory, rows: Record<string, any>[]) => {
    try {
      const result = category === 'VENDORS' ? await validateVendorsImport(rows)
        : category === 'CLIENTS' ? await validateClientsImport(rows)
        : category === 'CONTACTS' ? await validateContactsImport(rows)
        : category === 'MATERIAL' ? await validateMaterialsImport(rows)
        : category === 'PRODUCT' ? await validateProductsImport(rows)
        : await validateInventoryImport(rows);

      setFlatPreview({ category, totalRows: rows.length, errors: result.errors, records: result.records });
    } catch (err: any) {
      setStatus({ type: 'error', message: 'Validation failed!', details: [err.message || 'Make sure the Excel file is correctly formatted.'] });
      toast.error(err.message || 'Validation failed. Make sure the Excel file is correctly formatted.');
    }
  };

  const handleConfirmFlatImport = async () => {
    if (!flatPreview) return;
    await commitFlatImport(flatPreview.category, flatPreview.records);
    setStatus({ type: 'success', message: 'Successfully completed import.', details: [`Imported ${flatPreview.records.length} record(s).`] });
    toast.success('Import completed successfully.');
    onDataImported();
    setFlatPreview(null);
  };
```

- [ ] **Step 5: Rewrite `executeImport` to always go through validation, dedupe row-parsing between the two branches**

Replace (old_string, lines 231-302 — the entire `executeImport` function):

```ts
  const executeImport = () => {
    if (!mappingState) return;
    const importCategory = mappingState.category;
    const expectedCols = EXPECTED_COLUMNS[importCategory];

    const missingMapped = expectedCols.filter(col => col.required && !mappingState.mapping[col.key]);
    if (missingMapped.length > 0) {
      setStatus({ type: 'error', message: 'Missing Required Column Mappings', details: missingMapped.map(m => `Please map: ${m.label}`) });
      toast.warning('Please map all required columns before continuing.');
      return;
    }

    if (isHeaderDetailCategory(importCategory)) {
      // Header+detail categories surface row-level errors in the Preview
      // screen (validatePurchaseImport/validateSalesImport) instead of the
      // download-an-error-Excel flow the flat categories use below.
      const parsed: Record<string, any>[] = mappingState.dataRows.map((rowArray) => {
        const rowObj: Record<string, any> = {};
        mappingState.fileHeaders.forEach((header, index) => { rowObj[header] = rowArray[index]; });
        const mappedObj: Record<string, any> = {};
        expectedCols.forEach(col => {
          const fileHeader = mappingState.mapping[col.key];
          mappedObj[col.key] = fileHeader ? rowObj[fileHeader] : undefined;
        });
        return mappedObj;
      });

      setMappingState(null);
      runHeaderDetailValidation(importCategory, parsed);
      return;
    }

    const parsed: Record<string, any>[] = [];
    const rowErrors: string[] = [];
    let hasErrors = false;

    mappingState.dataRows.forEach((rowArray) => {
      const rowObj: Record<string, any> = {};
      mappingState.fileHeaders.forEach((header, index) => { rowObj[header] = rowArray[index]; });

      const mappedObj: Record<string, any> = {};
      let rowError = '';

      expectedCols.forEach(col => {
        const fileHeader = mappingState.mapping[col.key];
        const val = fileHeader ? rowObj[fileHeader] : undefined;
        mappedObj[col.key] = val;
        if (col.required && (val === undefined || val === null || String(val).trim() === '')) {
          rowError += `Missing value for ${col.label}. `;
          hasErrors = true;
        }
      });

      parsed.push(mappedObj);
      rowErrors.push(rowError);
    });

    if (hasErrors) {
      downloadErrorExcel(mappingState.fileHeaders, mappingState.dataRows, rowErrors);
      setStatus({
        type: 'error',
        message: 'Import failed due to missing required data in some rows.',
        details: ['An Excel file with error messages has been downloaded. Please fix the errors and try again.'],
      });
      toast.warning('Import failed: some rows are missing required data. Check the downloaded error file.');
      setMappingState(null);
      return;
    }

    setMappingState(null);
    runFlatImport(importCategory, parsed);
  };
```

With (new_string):

```ts
  const executeImport = () => {
    if (!mappingState) return;
    const importCategory = mappingState.category;
    const expectedCols = EXPECTED_COLUMNS[importCategory];

    const missingMapped = expectedCols.filter(col => col.required && !mappingState.mapping[col.key]);
    if (missingMapped.length > 0) {
      setStatus({ type: 'error', message: 'Missing Required Column Mappings', details: missingMapped.map(m => `Please map: ${m.label}`) });
      toast.warning('Please map all required columns before continuing.');
      return;
    }

    // Every category surfaces row-level errors in the Preview screen
    // (validateXImport) before anything is written.
    const parsed: Record<string, any>[] = mappingState.dataRows.map((rowArray) => {
      const rowObj: Record<string, any> = {};
      mappingState.fileHeaders.forEach((header, index) => { rowObj[header] = rowArray[index]; });
      const mappedObj: Record<string, any> = {};
      expectedCols.forEach(col => {
        const fileHeader = mappingState.mapping[col.key];
        mappedObj[col.key] = fileHeader ? rowObj[fileHeader] : undefined;
      });
      return mappedObj;
    });

    setMappingState(null);

    if (isHeaderDetailCategory(importCategory)) {
      runHeaderDetailValidation(importCategory, parsed);
    } else {
      runFlatValidation(importCategory, parsed);
    }
  };
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: Remaining errors, if any, should only be in the Preview-screen JSX (`activePreview`/button wiring) — fixed in Task 8. No errors about missing `importVendors`/`runFlatImport`/`downloadErrorExcel` should remain.

- [ ] **Step 7: Commit**

```bash
git add src/components/ImportExportModal.tsx
git commit -m "feat: route flat-category imports through validate step, drop error-Excel download"
```

---

### Task 8: Modal — generalize the Preview screen, fix mapping-screen button label

**Files:**
- Modify: `src/components/ImportExportModal.tsx`

**Interfaces:**
- Consumes: `flatPreview`, `runFlatValidation`, `handleConfirmFlatImport` (Task 7).

- [ ] **Step 1: Widen `activePreview` and add display-only helper variables**

Replace (old_string, line 395):

```ts
  const activePreview = activeCategory === 'PURCHASE' ? purchasePreview : activeCategory === 'SALES' ? salesPreview : null;
```

With (new_string):

```ts
  const activePreview = activeCategory === 'PURCHASE' ? purchasePreview
    : activeCategory === 'SALES' ? salesPreview
    : (flatPreview && flatPreview.category === activeCategory ? flatPreview : null);

  // Display-only: the three preview shapes (Purchase/Sales/flat) share `errors`
  // but differ on the other stat(s), so pull those out here instead of doing
  // TS union-narrowing gymnastics inside the JSX below.
  const previewGroupsCount = activeCategory === 'PURCHASE' ? purchasePreview?.groups.length
    : activeCategory === 'SALES' ? salesPreview?.groups.length
    : undefined;
  const previewSecondaryCount = isHeaderDetailCategory(activeCategory)
    ? (activeCategory === 'PURCHASE' ? purchasePreview?.totalDetailRows : salesPreview?.totalDetailRows)
    : flatPreview?.totalRows;
```

- [ ] **Step 2: Generalize the Preview screen JSX**

Replace (old_string, lines 517-560 — the entire `activePreview ? ( ... ) : mappingState ? (` block's Preview branch, up to but not including `mappingState ? (`):

```tsx
            {activePreview ? (
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex-1 overflow-y-auto space-y-4">
                <h4 className="font-bold text-slate-900 text-sm">Import Preview — {activeCategory === 'PURCHASE' ? 'Purchase Orders' : 'Sales Orders'}</h4>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="bg-slate-50 rounded-lg p-3">
                    <div className="text-lg font-bold text-slate-900">{activePreview.groups.length}</div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">Total Orders</div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3">
                    <div className="text-lg font-bold text-slate-900">{activePreview.totalDetailRows}</div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">Total Detail Rows</div>
                  </div>
                  <div className={`rounded-lg p-3 ${activePreview.errors.length > 0 ? 'bg-red-50' : 'bg-emerald-50'}`}>
                    <div className={`text-lg font-bold ${activePreview.errors.length > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{activePreview.errors.length}</div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">Validation Errors</div>
                  </div>
                </div>

                {activePreview.errors.length > 0 && (
                  <div className="bg-red-50 border border-red-100 rounded-lg p-3 max-h-[220px] overflow-y-auto">
                    <ul className="space-y-1 text-[11px] text-red-800 font-mono">
                      {activePreview.errors.map((err: ImportRowError, idx: number) => (
                        <li key={idx}>Row {err.row}: {err.message}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex space-x-3 justify-end pt-2 border-t border-slate-100">
                  <button
                    onClick={() => { setPurchasePreview(null); setSalesPreview(null); }}
                    className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-xs font-medium transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={activeCategory === 'PURCHASE' ? handleConfirmPurchaseImport : handleConfirmSalesImport}
                    disabled={activePreview.errors.length > 0}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium transition-colors hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Confirm &amp; Import
                  </button>
                </div>
              </div>
            ) : mappingState ? (
```

With (new_string):

```tsx
            {activePreview ? (
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex-1 overflow-y-auto space-y-4">
                <h4 className="font-bold text-slate-900 text-sm">Import Preview — {activeCategoryLabel}</h4>
                <div className={`grid gap-3 text-center ${isHeaderDetailCategory(activeCategory) ? 'grid-cols-3' : 'grid-cols-2'}`}>
                  {isHeaderDetailCategory(activeCategory) && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <div className="text-lg font-bold text-slate-900">{previewGroupsCount}</div>
                      <div className="text-[10px] text-slate-500 uppercase tracking-wide">Total Orders</div>
                    </div>
                  )}
                  <div className="bg-slate-50 rounded-lg p-3">
                    <div className="text-lg font-bold text-slate-900">{previewSecondaryCount}</div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">{isHeaderDetailCategory(activeCategory) ? 'Total Detail Rows' : 'Total Rows'}</div>
                  </div>
                  <div className={`rounded-lg p-3 ${activePreview.errors.length > 0 ? 'bg-red-50' : 'bg-emerald-50'}`}>
                    <div className={`text-lg font-bold ${activePreview.errors.length > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{activePreview.errors.length}</div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">Validation Errors</div>
                  </div>
                </div>

                {activePreview.errors.length > 0 && (
                  <div className="bg-red-50 border border-red-100 rounded-lg p-3 max-h-[220px] overflow-y-auto">
                    <ul className="space-y-1 text-[11px] text-red-800 font-mono">
                      {activePreview.errors.map((err: ImportRowError, idx: number) => (
                        <li key={idx}>Row {err.row}: {err.message}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex space-x-3 justify-end pt-2 border-t border-slate-100">
                  <button
                    onClick={() => { setPurchasePreview(null); setSalesPreview(null); setFlatPreview(null); }}
                    className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-xs font-medium transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={activeCategory === 'PURCHASE' ? handleConfirmPurchaseImport : activeCategory === 'SALES' ? handleConfirmSalesImport : handleConfirmFlatImport}
                    disabled={activePreview.errors.length > 0}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium transition-colors hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Confirm &amp; Import
                  </button>
                </div>
              </div>
            ) : mappingState ? (
```

- [ ] **Step 3: Always show "Continue to Preview" on the mapping screen**

Replace (old_string, lines 590-592):

```tsx
                  <button onClick={executeImport} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium transition-colors hover:bg-blue-700">
                    {isHeaderDetailCategory(mappingState.category) ? 'Continue to Preview' : 'Confirm & Import'}
                  </button>
```

With (new_string):

```tsx
                  <button onClick={executeImport} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium transition-colors hover:bg-blue-700">
                    Continue to Preview
                  </button>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: Clean — no errors anywhere in `src/`.

- [ ] **Step 5: Commit**

```bash
git add src/components/ImportExportModal.tsx
git commit -m "feat: generalize import preview screen to cover all 8 categories"
```

---

### Task 9: Manual QA (human — do not launch the app yourself if you are an agent)

**Files:** none (verification only).

- [ ] **Step 1: Full type-check one more time**

Run: `npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 2: Manual QA checklist (perform this yourself in the running app — `npm run dev`)**

For each of the 8 categories in the Import/Export Hub:
1. Download the template, fill a few rows including at least one deliberately broken row (e.g. a Vendor row with `email = "not-an-email"`, a Material row with an unknown `category`, two Vendor rows with the same Company Name), upload it.
2. Map columns, click "Continue to Preview."
3. Confirm the preview shows the correct row/error counts, the broken row(s) appear in the error list with a sensible message, and "Confirm & Import" is disabled.
4. Fix the file, re-upload, re-map, confirm the preview now shows 0 errors and "Confirm & Import" is enabled.
5. Click "Confirm & Import," confirm success toast/status and that the new/updated records show up in that category's list view (e.g. Vendors list, Material Catalog).
6. Specifically for phone: try a Malaysian-format number without a country code (e.g. `012-345 6789`) and confirm it's accepted; try `123` and confirm it's rejected.
7. Specifically for Purchase/Sales: re-run one existing scenario end-to-end to confirm nothing regressed (these paths weren't touched by this plan, but they share the modal file).

- [ ] **Step 3: Commit (only if Step 2 turned up fixes)**

If manual QA required any follow-up edits, commit them with a message describing what was fixed. If QA passed clean, there's nothing to commit for this task.
