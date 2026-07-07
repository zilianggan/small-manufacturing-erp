# Import/Export Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `ImportExportModal.tsx` to import/export Vendors, Clients, Material, Product, Purchase, and Sales against the current pattern-A services instead of the legacy `db.ts`/localStorage path.

**Architecture:** New `src/services/ImportExportService.ts` (pattern A) holds per-category column configs, natural-key merge logic for flat categories (Vendor/Client/Material/Product), and group→validate→preview→commit logic for header+detail categories (Purchase/Sales). `ImportExportModal.tsx` is rewritten to call it, keeping its existing upload/drag-drop/column-mapping UI shell but adding a new Preview screen for Purchase/Sales imports.

**Tech Stack:** React 19 + TypeScript, Supabase JS client, `xlsx` package (already a dependency), Tailwind v4. No automated test runner in this repo (`npm run lint` = `tsc --noEmit` is the only CI-style check) — per-task verification is a clean `tsc --noEmit` plus a code-level self-review; the user does manual browser QA themselves (see final checklist in Task 7), do not launch the dev server or browser automation.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-07-import-export-redesign-design.md` — every task below implements a section of it.
- Do NOT touch `DashboardView.tsx`/`ReportsView.tsx` or the legacy `sales_orders`/`purchase_orders`/`InventoryItem` reads they still depend on — out of scope.
- `db.ts` changes are limited to Task 6's grep-verified-dead functions only. Do not remove anything still referenced by `ReportsView.tsx` (`getInventory`, `getVendors`, `getSalesOrders`, `getPurchaseOrders`, `getDashboardStats`, `addPurchaseOrder`) or `SystemAdminView.tsx` (`generateId`) or `App.tsx` (`useSyncStore`), and do not remove `saveInventory`/`saveSalesOrders`/`savePurchaseOrders` — they're called internally by functions those live callers depend on.
- No `db.ts` import, no `server.ts` REST hop, no `useTableData` in `ImportExportService.ts` or the rewritten `ImportExportModal.tsx`.
- No `EMPLOYEES` category, no `FULL_BACKUP` mode — dropped per the spec.
- Verification command for every task: `npm run lint` (must exit 0, no TypeScript errors).

---

### Task 1: `src/services/ImportExportService.ts` — create file, Vendor/Client

**Files:**
- Create: `src/services/ImportExportService.ts`

**Interfaces:**
- Consumes: `ContactsService.getVendors(search): Promise<Vendor[]>`, `getClients(search): Promise<Client[]>`, `saveVendor(vendor): Promise<void>`, `saveClient(client): Promise<void>` (all existing).
- Produces (consumed by Task 5's modal): `ImportColumn` (type), `VENDOR_COLUMNS`, `CLIENT_COLUMNS` (`ImportColumn[]`), `RowImportResult` (type), `importVendors(rows: Record<string, any>[]): Promise<RowImportResult>`, `importClients(rows): Promise<RowImportResult>`, `getVendorExportRows(): Promise<Record<string, unknown>[]>`, `getClientExportRows(): Promise<Record<string, unknown>[]>`, `generateId(): string`.

- [ ] **Step 1: Create the file**

```ts
/**
 * Import/Export module service layer.
 *
 * Talks to Supabase directly via each category's existing pattern-A service
 * (ContactsService/MaterialService/ProductService/PurchasesService/
 * OrdersService) plus direct `supabase` calls for header+detail writes. No
 * db.ts, no server.ts REST hop, no useTableData, no FULL_BACKUP/localStorage
 * dump.
 */
import { getVendors, getClients, saveVendor, saveClient } from "./ContactsService";
import { Vendor, Client } from "../types";

export const generateId = (): string => crypto.randomUUID();

export interface ImportColumn {
  key: string;
  label: string;
  required: boolean;
}

export interface RowImportResult {
  successCount: number;
  logs: string[];
}

export const VENDOR_COLUMNS: ImportColumn[] = [
  { key: 'companyName', label: 'Company Name', required: true },
  { key: 'email', label: 'Email', required: false },
  { key: 'officeNo', label: 'Office No.', required: false },
  { key: 'address', label: 'Address', required: false },
  { key: 'description', label: 'Description', required: false },
];

export const CLIENT_COLUMNS: ImportColumn[] = VENDOR_COLUMNS.map(c => ({ ...c }));

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

  for (const item of parsed) {
    const match = byName.get(item.companyName.toLowerCase());
    const vendor: Vendor = { id: match?.id || generateId(), ...item };
    await saveVendor(vendor);
    byName.set(item.companyName.toLowerCase(), vendor);
  }

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

  for (const item of parsed) {
    const match = byName.get(item.companyName.toLowerCase());
    const client: Client = { id: match?.id || generateId(), ...item };
    await saveClient(client);
    byName.set(item.companyName.toLowerCase(), client);
  }

  return { successCount: parsed.length, logs: [`Imported ${parsed.length} clients (created or updated by company name).`] };
};

export const buildVendorExportRows = (vendors: Vendor[]) => vendors.map(v => ({
  id: v.id, companyName: v.companyName, email: v.email, officeNo: v.officeNo,
  address: v.address, description: v.description || '',
}));

export const buildClientExportRows = (clients: Client[]) => clients.map(c => ({
  id: c.id, companyName: c.companyName, email: c.email, officeNo: c.officeNo,
  address: c.address, description: c.description || '',
}));

export const getVendorExportRows = async () => buildVendorExportRows(await getVendors(''));
export const getClientExportRows = async () => buildClientExportRows(await getClients(''));
```

- [ ] **Step 2: Verify**

Run: `npm run lint`
Expected: exits 0, no errors reported inside `ImportExportService.ts`. (`ImportExportModal.tsx` still imports from `db.ts` at this point — untouched until Task 5 — so ignore any pre-existing state there.)

- [ ] **Step 3: Commit**

```bash
git add src/services/ImportExportService.ts
git commit -m "feat: add ImportExportService with Vendor/Client merge-by-name import/export"
```

---

### Task 2: `ImportExportService.ts` — add Material/Product

**Files:**
- Modify: `src/services/ImportExportService.ts` (update the top import block, append new exports before EOF)

**Interfaces:**
- Consumes: `MaterialService.getMaterials(search): Promise<Material[]>`, `saveMaterial(material): Promise<void>`, `getMaterialCategories(): Promise<MaterialCategory[]>`; `ProductService.getProducts(search): Promise<Product[]>`, `saveProduct(product): Promise<void>`, `getProductCategories(): Promise<ProductCategory[]>` (all existing).
- Produces (consumed by Task 5): `MATERIAL_COLUMNS`, `PRODUCT_COLUMNS` (`ImportColumn[]`), `importMaterials(rows): Promise<RowImportResult>`, `importProducts(rows): Promise<RowImportResult>`, `getMaterialExportRows(): Promise<Record<string, unknown>[]>`, `getProductExportRows(): Promise<Record<string, unknown>[]>`.

- [ ] **Step 1: Update the import block**

Find (top of file):

```ts
import { getVendors, getClients, saveVendor, saveClient } from "./ContactsService";
import { Vendor, Client } from "../types";
```

Replace with:

```ts
import { getVendors, getClients, saveVendor, saveClient } from "./ContactsService";
import { getMaterials, saveMaterial, getMaterialCategories } from "./MaterialService";
import { getProducts, saveProduct, getProductCategories } from "./ProductService";
import { Vendor, Client, Material, Product } from "../types";
```

- [ ] **Step 2: Append Material/Product logic before the end of the file**

```ts

const VALID_MATERIAL_TYPES = ['RAW_MATERIAL', 'FINISHED_GOOD', 'CUSTOMER_STOCK'];

export const MATERIAL_COLUMNS: ImportColumn[] = [
  { key: 'name', label: 'Material Name', required: true },
  { key: 'code', label: 'Code', required: false },
  { key: 'materialType', label: 'Material Type', required: false },
  { key: 'dimension', label: 'Dimension', required: false },
  { key: 'description', label: 'Description', required: false },
  { key: 'minimumStock', label: 'Minimum Stock', required: false },
  { key: 'reorderQuantity', label: 'Reorder Quantity', required: false },
  { key: 'category', label: 'Category', required: false },
];

export const PRODUCT_COLUMNS: ImportColumn[] = [
  { key: 'name', label: 'Product Name', required: true },
  { key: 'code', label: 'Code', required: false },
  { key: 'dimension', label: 'Dimension', required: false },
  { key: 'description', label: 'Description', required: false },
  { key: 'sellingPrice', label: 'Selling Price', required: false },
  { key: 'category', label: 'Category', required: false },
];

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
      reorderQuantity: Number(raw.reorderQuantity) || 0,
      categoryName: String(raw.category || '').trim(),
    };
  });

  const [existing, categories] = await Promise.all([getMaterials(''), getMaterialCategories()]);
  const byNameCode = new Map(existing.map(m => [`${m.name.toLowerCase()}::${(m.code || '').toLowerCase()}`, m]));
  const categoryByName = new Map(categories.map(c => [c.name.toLowerCase(), c.id]));

  for (const item of parsed) {
    const key = `${item.name.toLowerCase()}::${item.code.toLowerCase()}`;
    const match = byNameCode.get(key);
    const material: Material = {
      id: match?.id || generateId(),
      name: item.name,
      code: item.code,
      materialType: item.materialType,
      dimension: item.dimension,
      quantity: match?.quantity ?? 0, // never written — saveMaterial's serializer omits this field
      description: item.description,
      attachments: match?.attachments, // preserve existing attachments on update; new records get none
      status: match?.status || 'ACTIVE',
      minimumStock: item.minimumStock,
      reorderQuantity: item.reorderQuantity,
      materialCategoryId: categoryByName.get(item.categoryName.toLowerCase()) || undefined,
    };
    await saveMaterial(material);
    byNameCode.set(key, material);
  }

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

  for (const item of parsed) {
    const key = `${item.name.toLowerCase()}::${item.code.toLowerCase()}`;
    const match = byNameCode.get(key);
    const product: Product = {
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
    await saveProduct(product);
    byNameCode.set(key, product);
  }

  return { successCount: parsed.length, logs: [`Imported ${parsed.length} products (created or updated by name+code).`] };
};

export const buildMaterialExportRows = (materials: Material[], categories: { id: string; name: string }[]) => {
  const categoryNameById = new Map(categories.map(c => [c.id, c.name]));
  return materials.map(m => ({
    id: m.id, name: m.name, code: m.code || '', materialType: m.materialType || '',
    dimension: m.dimension || '', quantity: m.quantity, description: m.description || '',
    status: m.status || 'ACTIVE', minimumStock: m.minimumStock, reorderQuantity: m.reorderQuantity,
    category: m.materialCategoryId ? (categoryNameById.get(m.materialCategoryId) || '') : '',
  }));
};

export const getMaterialExportRows = async () => {
  const [materials, categories] = await Promise.all([getMaterials(''), getMaterialCategories()]);
  return buildMaterialExportRows(materials, categories);
};

export const buildProductExportRows = (products: Product[], categories: { id: string; name: string }[]) => {
  const categoryNameById = new Map(categories.map(c => [c.id, c.name]));
  return products.map(p => ({
    id: p.id, name: p.name, code: p.code || '', dimension: p.dimension || '',
    description: p.description || '', status: p.status || 'ACTIVE', sellingPrice: p.sellingPrice,
    category: p.productCategoryId ? (categoryNameById.get(p.productCategoryId) || '') : '',
  }));
};

export const getProductExportRows = async () => {
  const [products, categories] = await Promise.all([getProducts(''), getProductCategories()]);
  return buildProductExportRows(products, categories);
};
```

- [ ] **Step 3: Verify**

Run: `npm run lint`
Expected: exits 0, no errors inside `ImportExportService.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/services/ImportExportService.ts
git commit -m "feat: add Material/Product merge-by-name+code import/export to ImportExportService"
```

---

### Task 3: `ImportExportService.ts` — add Purchase (group/validate/preview/commit)

**Files:**
- Modify: `src/services/ImportExportService.ts` (update the top import block, append new exports before EOF)

**Interfaces:**
- Consumes: `PurchasesService.getPurchases(tab, search): Promise<PurchaseHeader[]>` (existing), `supabase` client (existing, direct `purchase_header`/`purchase_detail` inserts).
- Produces (consumed by Task 5): `ImportRowError` (type), `PurchaseImportRow`, `PurchaseImportGroup`, `PurchaseImportPreview`, `PurchaseImportCommitResult` (types), `PURCHASE_COLUMNS` (`ImportColumn[]`), `validatePurchaseImport(rows: PurchaseImportRow[]): Promise<PurchaseImportPreview>`, `commitPurchaseImport(groups: PurchaseImportGroup[]): Promise<PurchaseImportCommitResult>`, `getPurchaseExportSheets(): Promise<{ headerRows: Record<string, unknown>[]; itemRows: Record<string, unknown>[] }>`.

- [ ] **Step 1: Update the import block**

Find:

```ts
import { getVendors, getClients, saveVendor, saveClient } from "./ContactsService";
import { getMaterials, saveMaterial, getMaterialCategories } from "./MaterialService";
import { getProducts, saveProduct, getProductCategories } from "./ProductService";
import { Vendor, Client, Material, Product } from "../types";
```

Replace with:

```ts
import { supabase } from "./supabase";
import { getVendors, getClients, saveVendor, saveClient } from "./ContactsService";
import { getMaterials, saveMaterial, getMaterialCategories } from "./MaterialService";
import { getProducts, saveProduct, getProductCategories } from "./ProductService";
import { getPurchases } from "./PurchasesService";
import { Vendor, Client, Material, Product } from "../types";
```

- [ ] **Step 2: Append Purchase import/export logic before the end of the file**

```ts

export interface ImportRowError {
  row: number; // 1-based position within the uploaded file's data rows (excludes the header row)
  message: string;
}

export const PURCHASE_COLUMNS: ImportColumn[] = [
  { key: 'purchaseNo', label: 'Purchase No', required: true },
  { key: 'vendorName', label: 'Vendor', required: true },
  { key: 'orderDate', label: 'Order Date', required: true },
  { key: 'materialName', label: 'Material', required: true },
  { key: 'quantity', label: 'Quantity', required: true },
  { key: 'unitCost', label: 'Unit Cost', required: true },
];

export interface PurchaseImportRow {
  purchaseNo: string;
  vendorName: string;
  orderDate: string;
  materialName: string;
  quantity: number;
  unitCost: number;
}

export interface PurchaseImportGroup {
  purchaseNo: string;
  vendorId: string;
  vendorName: string;
  orderDate: string;
  details: { materialId: string; materialName: string; materialCode?: string; quantity: number; unitCost: number }[];
}

export interface PurchaseImportPreview {
  groups: PurchaseImportGroup[];
  totalDetailRows: number;
  errors: ImportRowError[];
}

// Groups rows by purchaseNo and validates every row before anything is
// written — see PurchaseImportCommitResult below for the actual write step,
// which only runs once the caller confirms a zero-error preview.
export const validatePurchaseImport = async (rows: PurchaseImportRow[]): Promise<PurchaseImportPreview> => {
  const [vendors, materials, existingQuotations, existingOrders] = await Promise.all([
    getVendors(''), getMaterials(''), getPurchases('QUOTATION', ''), getPurchases('PO', ''),
  ]);
  const existingPurchaseNos = new Set(
    [...existingQuotations, ...existingOrders].map(p => p.purchaseNo.toLowerCase())
  );
  const vendorByName = new Map(vendors.map(v => [v.companyName.toLowerCase(), v]));
  const materialByName = new Map(materials.map(m => [m.name.toLowerCase(), m]));

  const errors: ImportRowError[] = [];
  const groupsByNo = new Map<string, PurchaseImportGroup>();
  const seenInFile = new Set<string>();

  rows.forEach((raw, index) => {
    const rowNum = index + 1;
    const purchaseNo = String(raw.purchaseNo || '').trim();
    if (!purchaseNo) {
      errors.push({ row: rowNum, message: 'Missing Purchase No.' });
      return;
    }

    const vendor = vendorByName.get(String(raw.vendorName || '').trim().toLowerCase());
    if (!vendor) errors.push({ row: rowNum, message: `Vendor "${raw.vendorName}" not found.` });

    const material = materialByName.get(String(raw.materialName || '').trim().toLowerCase());
    if (!material) errors.push({ row: rowNum, message: `Material "${raw.materialName}" not found.` });

    const orderDate = String(raw.orderDate || '').trim();
    const orderDateValid = !!orderDate && !isNaN(Date.parse(orderDate));
    if (!orderDateValid) errors.push({ row: rowNum, message: `Order Date "${raw.orderDate}" is not a valid date.` });

    const quantity = Number(raw.quantity);
    if (!(quantity > 0)) errors.push({ row: rowNum, message: 'Quantity must be greater than zero.' });

    const unitCost = Number(raw.unitCost);
    if (!(unitCost >= 0)) errors.push({ row: rowNum, message: 'Unit Cost must be zero or greater.' });

    const purchaseNoKey = purchaseNo.toLowerCase();
    if (!seenInFile.has(purchaseNoKey) && existingPurchaseNos.has(purchaseNoKey)) {
      errors.push({ row: rowNum, message: `Purchase No "${purchaseNo}" already exists in the database.` });
    }
    seenInFile.add(purchaseNoKey);

    if (!vendor || !material || !orderDateValid || !(quantity > 0) || !(unitCost >= 0)) return;

    let group = groupsByNo.get(purchaseNoKey);
    if (!group) {
      group = { purchaseNo, vendorId: vendor.id, vendorName: vendor.companyName, orderDate, details: [] };
      groupsByNo.set(purchaseNoKey, group);
    }
    group.details.push({ materialId: material.id, materialName: material.name, materialCode: material.code, quantity, unitCost });
  });

  const groups = Array.from(groupsByNo.values());
  return { groups, totalDetailRows: groups.reduce((sum, g) => sum + g.details.length, 0), errors };
};

export interface PurchaseImportCommitResult {
  succeeded: string[]; // purchaseNo values successfully written
  failed?: { purchaseNo: string; message: string };
}

// Best-effort sequential write (same non-atomic pattern as
// PurchasesService.createPurchaseQuotation): insert header, then its
// details. If a group's detail insert fails, the just-inserted header is
// deleted (avoids an orphan) and the loop stops — later groups are never
// attempted. Only call this with a PurchaseImportPreview that has zero
// errors.
export const commitPurchaseImport = async (groups: PurchaseImportGroup[]): Promise<PurchaseImportCommitResult> => {
  const succeeded: string[] = [];

  for (const group of groups) {
    const totalPrice = group.details.reduce((sum, d) => sum + d.quantity * d.unitCost, 0);
    const id = generateId();

    const { error: headerError } = await supabase.from('purchase_header').insert({
      id,
      purchase_no: group.purchaseNo,
      quotation_date: group.orderDate,
      order_date: group.orderDate,
      status: 'ORDERED',
      vendor_id: group.vendorId,
      total_price: totalPrice,
    });
    if (headerError) {
      console.error('commitPurchaseImport(header)', headerError);
      return { succeeded, failed: { purchaseNo: group.purchaseNo, message: headerError.message } };
    }

    const { error: detailError } = await supabase.from('purchase_detail').insert(
      group.details.map(d => ({
        header_id: id,
        material_id: d.materialId,
        material_name: d.materialName,
        material_code: d.materialCode || null,
        quantity: d.quantity,
        unit_cost: d.unitCost,
        total_price: d.quantity * d.unitCost,
      }))
    );
    if (detailError) {
      console.error('commitPurchaseImport(detail)', detailError);
      await supabase.from('purchase_header').delete().eq('id', id);
      return { succeeded, failed: { purchaseNo: group.purchaseNo, message: detailError.message } };
    }

    succeeded.push(group.purchaseNo);
  }

  return { succeeded };
};

export const getPurchaseExportSheets = async () => {
  const [quotations, orders] = await Promise.all([getPurchases('QUOTATION', ''), getPurchases('PO', '')]);
  const all = [...quotations, ...orders];

  const headerRows = all.map(p => ({
    id: p.id, purchaseNo: p.purchaseNo, quotationDate: p.quotationDate, orderDate: p.orderDate || '',
    receivedDate: p.receivedDate || '', status: p.status, vendorName: p.vendorName, totalPrice: p.totalPrice,
  }));

  const itemRows = all.flatMap(p => p.details.map(d => ({
    purchaseNo: p.purchaseNo, vendorName: p.vendorName, orderDate: p.orderDate || p.quotationDate,
    status: p.status, materialName: d.materialName, materialCode: d.materialCode || '',
    quantity: d.quantity, unitCost: d.unitCost, totalPrice: d.totalPrice, receivedQuantity: d.receivedQuantity,
  })));

  return { headerRows, itemRows };
};
```

- [ ] **Step 3: Verify**

Run: `npm run lint`
Expected: exits 0, no errors inside `ImportExportService.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/services/ImportExportService.ts
git commit -m "feat: add Purchase group/validate/preview/commit import + export to ImportExportService"
```

---

### Task 4: `ImportExportService.ts` — add Sales (group/validate/preview/commit)

**Files:**
- Modify: `src/services/ImportExportService.ts` (update the top import block, append new exports before EOF)

**Interfaces:**
- Consumes: `OrdersService.getSalesOrders(tab, search): Promise<SalesHeader[]>` (existing), `supabase` client (existing).
- Produces (consumed by Task 5): `SalesImportRow`, `SalesImportGroup`, `SalesImportPreview`, `SalesImportCommitResult` (types), `SALES_COLUMNS` (`ImportColumn[]`), `validateSalesImport(rows: SalesImportRow[]): Promise<SalesImportPreview>`, `commitSalesImport(groups: SalesImportGroup[]): Promise<SalesImportCommitResult>`, `getSalesExportSheets(): Promise<{ headerRows: Record<string, unknown>[]; itemRows: Record<string, unknown>[] }>`.

- [ ] **Step 1: Update the import block**

Find:

```ts
import { supabase } from "./supabase";
import { getVendors, getClients, saveVendor, saveClient } from "./ContactsService";
import { getMaterials, saveMaterial, getMaterialCategories } from "./MaterialService";
import { getProducts, saveProduct, getProductCategories } from "./ProductService";
import { getPurchases } from "./PurchasesService";
import { Vendor, Client, Material, Product } from "../types";
```

Replace with:

```ts
import { supabase } from "./supabase";
import { getVendors, getClients, saveVendor, saveClient } from "./ContactsService";
import { getMaterials, saveMaterial, getMaterialCategories } from "./MaterialService";
import { getProducts, saveProduct, getProductCategories } from "./ProductService";
import { getPurchases } from "./PurchasesService";
import { getSalesOrders } from "./OrdersService";
import { Vendor, Client, Material, Product } from "../types";
```

- [ ] **Step 2: Append Sales import/export logic before the end of the file**

```ts

export const SALES_COLUMNS: ImportColumn[] = [
  { key: 'salesNo', label: 'Sales No', required: true },
  { key: 'clientName', label: 'Client', required: true },
  { key: 'orderDate', label: 'Order Date', required: true },
  { key: 'deliveryDate', label: 'Delivery Date', required: false },
  { key: 'productName', label: 'Product', required: true },
  { key: 'quantity', label: 'Quantity', required: true },
  { key: 'unitPrice', label: 'Unit Price', required: true },
  { key: 'remark', label: 'Remark', required: false },
];

export interface SalesImportRow {
  salesNo: string;
  clientName: string;
  orderDate: string;
  deliveryDate?: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  remark?: string;
}

export interface SalesImportGroup {
  salesNo: string;
  clientId: string;
  clientName: string;
  orderDate: string;
  deliveryDate?: string;
  details: { productId: string; productName: string; productCode?: string; quantity: number; unitPrice: number; remark?: string }[];
}

export interface SalesImportPreview {
  groups: SalesImportGroup[];
  totalDetailRows: number;
  errors: ImportRowError[];
}

export const validateSalesImport = async (rows: SalesImportRow[]): Promise<SalesImportPreview> => {
  const [clients, products, existingQuotations, existingOrders] = await Promise.all([
    getClients(''), getProducts(''), getSalesOrders('QUOTATION', ''), getSalesOrders('SO', ''),
  ]);
  const existingSalesNos = new Set(
    [...existingQuotations, ...existingOrders].map(s => s.salesNo.toLowerCase())
  );
  const clientByName = new Map(clients.map(c => [c.companyName.toLowerCase(), c]));
  const productByName = new Map(products.map(p => [p.name.toLowerCase(), p]));

  const errors: ImportRowError[] = [];
  const groupsByNo = new Map<string, SalesImportGroup>();
  const seenInFile = new Set<string>();

  rows.forEach((raw, index) => {
    const rowNum = index + 1;
    const salesNo = String(raw.salesNo || '').trim();
    if (!salesNo) {
      errors.push({ row: rowNum, message: 'Missing Sales No.' });
      return;
    }

    const client = clientByName.get(String(raw.clientName || '').trim().toLowerCase());
    if (!client) errors.push({ row: rowNum, message: `Client "${raw.clientName}" not found.` });

    const product = productByName.get(String(raw.productName || '').trim().toLowerCase());
    if (!product) errors.push({ row: rowNum, message: `Product "${raw.productName}" not found.` });

    const orderDate = String(raw.orderDate || '').trim();
    const orderDateValid = !!orderDate && !isNaN(Date.parse(orderDate));
    if (!orderDateValid) errors.push({ row: rowNum, message: `Order Date "${raw.orderDate}" is not a valid date.` });

    const quantity = Number(raw.quantity);
    if (!(quantity > 0)) errors.push({ row: rowNum, message: 'Quantity must be greater than zero.' });

    const unitPrice = Number(raw.unitPrice);
    if (!(unitPrice >= 0)) errors.push({ row: rowNum, message: 'Unit Price must be zero or greater.' });

    const salesNoKey = salesNo.toLowerCase();
    const isDuplicateSalesNo = existingSalesNos.has(salesNoKey);
    if (isDuplicateSalesNo && !seenInFile.has(salesNoKey)) {
      errors.push({ row: rowNum, message: `Sales No "${salesNo}" already exists in the database.` });
    }
    seenInFile.add(salesNoKey);

    if (!client || !product || !orderDateValid || !(quantity > 0) || !(unitPrice >= 0) || isDuplicateSalesNo) return;

    let group = groupsByNo.get(salesNoKey);
    if (!group) {
      group = {
        salesNo, clientId: client.id, clientName: client.companyName, orderDate,
        deliveryDate: raw.deliveryDate?.trim() || undefined, details: [],
      };
      groupsByNo.set(salesNoKey, group);
    }
    group.details.push({ productId: product.id, productName: product.name, productCode: product.code, quantity, unitPrice, remark: raw.remark || undefined });
  });

  const groups = Array.from(groupsByNo.values());
  return { groups, totalDetailRows: groups.reduce((sum, g) => sum + g.details.length, 0), errors };
};

export interface SalesImportCommitResult {
  succeeded: string[];
  failed?: { salesNo: string; message: string };
}

export const commitSalesImport = async (groups: SalesImportGroup[]): Promise<SalesImportCommitResult> => {
  const succeeded: string[] = [];

  for (const group of groups) {
    const totalAmount = group.details.reduce((sum, d) => sum + d.quantity * d.unitPrice, 0);
    const id = generateId();

    const { error: headerError } = await supabase.from('sales_header').insert({
      id,
      sales_no: group.salesNo,
      order_date: group.orderDate,
      delivery_date: group.deliveryDate || null,
      status: 'ORDERED',
      client_id: group.clientId,
      total_amount: totalAmount,
    });
    if (headerError) {
      console.error('commitSalesImport(header)', headerError);
      return { succeeded, failed: { salesNo: group.salesNo, message: headerError.message } };
    }

    const { error: detailError } = await supabase.from('sales_detail').insert(
      group.details.map(d => ({
        header_id: id,
        product_id: d.productId,
        product_name: d.productName,
        product_code: d.productCode || null,
        quantity: d.quantity,
        unit_price: d.unitPrice,
        total_price: d.quantity * d.unitPrice,
        remark: d.remark || null,
      }))
    );
    if (detailError) {
      console.error('commitSalesImport(detail)', detailError);
      await supabase.from('sales_header').delete().eq('id', id);
      return { succeeded, failed: { salesNo: group.salesNo, message: detailError.message } };
    }

    succeeded.push(group.salesNo);
  }

  return { succeeded };
};

export const getSalesExportSheets = async () => {
  const [quotations, orders] = await Promise.all([getSalesOrders('QUOTATION', ''), getSalesOrders('SO', '')]);
  const all = [...quotations, ...orders];

  const headerRows = all.map(s => ({
    id: s.id, salesNo: s.salesNo, orderDate: s.orderDate, deliveryDate: s.deliveryDate || '',
    status: s.status, clientName: s.clientName, totalAmount: s.totalAmount, remark: s.remark || '',
  }));

  const itemRows = all.flatMap(s => s.details.map(d => ({
    salesNo: s.salesNo, clientName: s.clientName, orderDate: s.orderDate, deliveryDate: s.deliveryDate || '',
    status: s.status, productName: d.productName, productCode: d.productCode || '',
    quantity: d.quantity, unitPrice: d.unitPrice, totalPrice: d.totalPrice, remark: d.remark || '',
  })));

  return { headerRows, itemRows };
};
```

- [ ] **Step 3: Verify**

Run: `npm run lint`
Expected: exits 0, no errors inside `ImportExportService.ts`. This file is now complete for all 6 categories.

- [ ] **Step 4: Commit**

```bash
git add src/services/ImportExportService.ts
git commit -m "feat: add Sales group/validate/preview/commit import + export to ImportExportService"
```

---

### Task 5: `src/components/ImportExportModal.tsx` — full rewrite

**Files:**
- Modify: `src/components/ImportExportModal.tsx` (full rewrite in place, same props/mount point)

**Interfaces:**
- Consumes: every export from Tasks 1–4's `ImportExportService.ts`.
- Produces: `export default function ImportExportModal({ isOpen, onClose, onDataImported }: ImportExportModalProps)` — same prop shape as before, no caller changes needed.

- [ ] **Step 1: Replace the full file contents**

```tsx
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  X, UploadCloud, CheckCircle2, AlertTriangle, Download, Clipboard, Info,
  Database, ArrowRight, FileSpreadsheet, Layers, Users, ShoppingBag, Briefcase, Package,
} from 'lucide-react';
import {
  ImportColumn, ImportRowError,
  VENDOR_COLUMNS, CLIENT_COLUMNS, MATERIAL_COLUMNS, PRODUCT_COLUMNS, PURCHASE_COLUMNS, SALES_COLUMNS,
  importVendors, importClients, importMaterials, importProducts,
  validatePurchaseImport, commitPurchaseImport, PurchaseImportPreview, PurchaseImportRow,
  validateSalesImport, commitSalesImport, SalesImportPreview, SalesImportRow,
  getVendorExportRows, getClientExportRows, getMaterialExportRows, getProductExportRows,
  getPurchaseExportSheets, getSalesExportSheets,
} from '../services/ImportExportService';

interface ImportExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataImported: () => void; // Refresh current views
}

type Category = 'VENDORS' | 'CLIENTS' | 'MATERIAL' | 'PRODUCT' | 'PURCHASE' | 'SALES';

const EXPECTED_COLUMNS: Record<Category, ImportColumn[]> = {
  VENDORS: VENDOR_COLUMNS,
  CLIENTS: CLIENT_COLUMNS,
  MATERIAL: MATERIAL_COLUMNS,
  PRODUCT: PRODUCT_COLUMNS,
  PURCHASE: PURCHASE_COLUMNS,
  SALES: SALES_COLUMNS,
};

const CATEGORY_LIST: { id: Category; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'VENDORS', label: 'Vendors', icon: Users },
  { id: 'CLIENTS', label: 'Clients', icon: Briefcase },
  { id: 'MATERIAL', label: 'Material Catalog', icon: Layers },
  { id: 'PRODUCT', label: 'Product Catalog', icon: Package },
  { id: 'PURCHASE', label: 'Purchase Orders', icon: ShoppingBag },
  { id: 'SALES', label: 'Sales Orders', icon: FileSpreadsheet },
];

const isHeaderDetailCategory = (category: Category): category is 'PURCHASE' | 'SALES' =>
  category === 'PURCHASE' || category === 'SALES';

export default function ImportExportModal({ isOpen, onClose, onDataImported }: ImportExportModalProps) {
  const [activeCategory, setActiveCategory] = useState<Category>('VENDORS');
  const [dragActive, setDragActive] = useState(false);
  const [status, setStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string; details?: string[] }>({ type: 'idle', message: '' });
  const [mappingState, setMappingState] = useState<{
    fileHeaders: string[];
    dataRows: any[][];
    mapping: Record<string, string>;
  } | null>(null);
  const [purchasePreview, setPurchasePreview] = useState<PurchaseImportPreview | null>(null);
  const [salesPreview, setSalesPreview] = useState<SalesImportPreview | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const dateStamp = new Date().toISOString().split('T')[0];
  const activeCategoryLabel = CATEGORY_LIST.find(c => c.id === activeCategory)?.label || '';

  const appendRowsSheet = (wb: XLSX.WorkBook, sheetName: string, rows: Record<string, unknown>[]) => {
    const data = rows.length > 0 ? rows : [{ Notice: 'No records found' }];
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  };

  const handleExport = async (category: Category) => {
    const wb = XLSX.utils.book_new();
    const fileName = `ERP_${category}_${dateStamp}.xlsx`;
    let exportedCount = 0;

    if (category === 'VENDORS') {
      const rows = await getVendorExportRows();
      appendRowsSheet(wb, 'Vendors', rows);
      exportedCount = rows.length;
    } else if (category === 'CLIENTS') {
      const rows = await getClientExportRows();
      appendRowsSheet(wb, 'Clients', rows);
      exportedCount = rows.length;
    } else if (category === 'MATERIAL') {
      const rows = await getMaterialExportRows();
      appendRowsSheet(wb, 'Material', rows);
      exportedCount = rows.length;
    } else if (category === 'PRODUCT') {
      const rows = await getProductExportRows();
      appendRowsSheet(wb, 'Product', rows);
      exportedCount = rows.length;
    } else if (category === 'PURCHASE') {
      const { headerRows, itemRows } = await getPurchaseExportSheets();
      appendRowsSheet(wb, 'Purchase_Orders', headerRows);
      appendRowsSheet(wb, 'Purchase_Items', itemRows);
      exportedCount = headerRows.length;
    } else {
      const { headerRows, itemRows } = await getSalesExportSheets();
      appendRowsSheet(wb, 'Sales_Orders', headerRows);
      appendRowsSheet(wb, 'Sales_Items', itemRows);
      exportedCount = headerRows.length;
    }

    XLSX.writeFile(wb, fileName);
    setStatus({ type: 'success', message: `Export file created: ${fileName}`, details: [`Exported ${exportedCount} record(s).`] });
  };

  const getTemplateHeaders = (category: Category): string => {
    const cols = EXPECTED_COLUMNS[category];
    const required = cols.filter(c => c.required).map(c => c.label).join('\t');
    const optional = cols.filter(c => !c.required).map(c => c.label).join('\t');
    return `Required columns:\n${required}${optional ? `\nOptional columns:\n${optional}` : ''}`;
  };

  const downloadErrorExcel = (headers: string[], rows: any[][], errors: string[]) => {
    const newHeaders = [...headers, 'Error Message'];
    const newRows = rows.map((row, i) => [...row, errors[i] || '']);
    const ws = XLSX.utils.aoa_to_sheet([newHeaders, ...newRows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Import_Errors');
    XLSX.writeFile(wb, 'Import_Errors.xlsx');
  };

  const runFlatImport = async (category: 'VENDORS' | 'CLIENTS' | 'MATERIAL' | 'PRODUCT', rows: Record<string, any>[]) => {
    try {
      const result = category === 'VENDORS' ? await importVendors(rows)
        : category === 'CLIENTS' ? await importClients(rows)
        : category === 'MATERIAL' ? await importMaterials(rows)
        : await importProducts(rows);

      setStatus({ type: 'success', message: 'Successfully completed import.', details: result.logs });
      onDataImported();
    } catch (err: any) {
      setStatus({ type: 'error', message: 'Import failed!', details: [err.message || 'Make sure the Excel file is correctly formatted.'] });
    }
  };

  const runHeaderDetailValidation = async (category: 'PURCHASE' | 'SALES', rows: Record<string, any>[]) => {
    try {
      if (category === 'PURCHASE') {
        setPurchasePreview(await validatePurchaseImport(rows as unknown as PurchaseImportRow[]));
      } else {
        setSalesPreview(await validateSalesImport(rows as unknown as SalesImportRow[]));
      }
    } catch (err: any) {
      setStatus({ type: 'error', message: 'Validation failed!', details: [err.message || 'Make sure the Excel file is correctly formatted.'] });
    }
  };

  const executeImport = () => {
    if (!mappingState) return;
    const expectedCols = EXPECTED_COLUMNS[activeCategory];

    const missingMapped = expectedCols.filter(col => col.required && !mappingState.mapping[col.key]);
    if (missingMapped.length > 0) {
      setStatus({ type: 'error', message: 'Missing Required Column Mappings', details: missingMapped.map(m => `Please map: ${m.label}`) });
      return;
    }

    if (isHeaderDetailCategory(activeCategory)) {
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
      runHeaderDetailValidation(activeCategory, parsed);
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
      setMappingState(null);
      return;
    }

    setMappingState(null);
    runFlatImport(activeCategory, parsed);
  };

  const handleConfirmPurchaseImport = async () => {
    if (!purchasePreview) return;
    const result = await commitPurchaseImport(purchasePreview.groups);
    setPurchasePreview(null);
    if (result.failed) {
      setStatus({
        type: 'error',
        message: `Import stopped at Purchase No "${result.failed.purchaseNo}".`,
        details: [result.failed.message, `Successfully created before the failure: ${result.succeeded.join(', ') || 'none'}.`],
      });
    } else {
      setStatus({ type: 'success', message: `Successfully imported ${result.succeeded.length} purchase order(s).`, details: result.succeeded });
      onDataImported();
    }
  };

  const handleConfirmSalesImport = async () => {
    if (!salesPreview) return;
    const result = await commitSalesImport(salesPreview.groups);
    setSalesPreview(null);
    if (result.failed) {
      setStatus({
        type: 'error',
        message: `Import stopped at Sales No "${result.failed.salesNo}".`,
        details: [result.failed.message, `Successfully created before the failure: ${result.succeeded.join(', ') || 'none'}.`],
      });
    } else {
      setStatus({ type: 'success', message: `Successfully imported ${result.succeeded.length} sales order(s).`, details: result.succeeded });
      onDataImported();
    }
  };

  const handleFileProcessing = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = e.target?.result;
      if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
        setStatus({ type: 'error', message: 'Only Excel files (.xlsx, .xls) are supported.' });
        return;
      }

      const workbook = XLSX.read(data, { type: 'binary' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][];

      if (rows.length < 2) {
        setStatus({ type: 'error', message: 'File has no data rows.' });
        return;
      }

      const fileHeaders = rows[0].map(h => String(h || '').trim());
      const dataRows = rows.slice(1);

      const expected = EXPECTED_COLUMNS[activeCategory];
      const mapping: Record<string, string> = {};
      expected.forEach(col => {
        const match = fileHeaders.find(h => h.toLowerCase() === col.key.toLowerCase() || h.toLowerCase() === col.label.toLowerCase());
        if (match) mapping[col.key] = match;
      });

      setMappingState({ fileHeaders, dataRows, mapping });
    };
    reader.readAsBinaryString(file);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileProcessing(file);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFileProcessing(e.dataTransfer.files[0]);
  };

  const activePreview = activeCategory === 'PURCHASE' ? purchasePreview : activeCategory === 'SALES' ? salesPreview : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="w-full max-w-4xl bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in duration-200">

        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
          <div className="flex items-center space-x-2.5">
            <span className="p-1.5 bg-blue-600 rounded text-white shrink-0 flex items-center justify-center">
              <Database className="w-5 h-5" />
            </span>
            <div>
              <h3 className="font-sans font-bold text-slate-900 text-sm">ERP Data Import & Export Hub</h3>
              <p className="text-[10px] text-slate-500 font-mono">Load or export Vendors, Clients, Material, Product, Purchase and Sales orders</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 font-bold text-base p-1.5 leading-none bg-transparent">
            &times;
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col lg:flex-row gap-5 min-h-0">

          <div className="w-full lg:w-1/3 flex flex-col space-y-4 shrink-0">
            <div className="space-y-1.5">
              <span className="font-semibold block text-slate-700 text-xs uppercase tracking-wider">1. Select Category</span>
              <div className="space-y-1">
                {CATEGORY_LIST.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeCategory === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveCategory(item.id);
                        setStatus({ type: 'idle', message: '' });
                        setMappingState(null);
                        setPurchasePreview(null);
                        setSalesPreview(null);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium border transition-all text-left ${isActive
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm font-semibold'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-900 dark:hover:bg-slate-950'
                        }`}
                    >
                      <div className="flex items-center space-x-2">
                        <Icon className="w-4 h-4 shrink-0" />
                        <span>{item.label}</span>
                      </div>
                      <ArrowRight className={`w-3.5 h-3.5 opacity-60 transition-transform ${isActive ? 'translate-x-0.5' : ''}`} />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bg-slate-50 rounded-lg p-3 text-[11px] text-slate-500 space-y-1.5 border border-slate-150">
              <div className="flex items-center space-x-1.5 font-semibold text-slate-700">
                <Info className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <span>Format Guidelines</span>
              </div>
              <p className="leading-relaxed">
                Vendors/Clients/Material/Product are matched to existing records by name (and code, for Material/Product) — a match updates that record, otherwise a new one is created.
              </p>
              <p className="leading-relaxed">
                Purchase/Sales rows are grouped into orders by Purchase No/Sales No. Every order is validated before anything is saved — you'll see a preview with any errors first.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <h4 className="font-bold text-slate-900 text-xs">Export Data</h4>
                  <p className="text-[10px] text-slate-400">Download the current {activeCategoryLabel} as Excel.</p>
                </div>
                <Download className="w-4 h-4 text-blue-500 shrink-0" />
              </div>
              <button
                type="button"
                onClick={() => handleExport(activeCategory)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 hover:border-blue-300 hover:bg-blue-50/50 transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export {activeCategoryLabel}</span>
              </button>
            </div>
          </div>

          <div className="flex-1 flex flex-col space-y-4 min-w-0">

            {status.type !== 'idle' && (
              <div className={`p-4 rounded-xl border text-xs leading-relaxed animate-in slide-in-from-top-2 duration-200 ${status.type === 'success'
                ? 'bg-emerald-50 border-emerald-100 text-emerald-800'
                : 'bg-red-50 border-red-100 text-red-800'
                }`}>
                <div className="flex items-start space-x-2.5">
                  {status.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-1.5 w-full">
                    <span className="font-bold block text-slate-900">{status.message}</span>
                    {status.details && status.details.length > 0 && (
                      <ul className="list-disc list-inside space-y-1 font-mono text-[10px] bg-white/65 p-2 rounded-lg max-h-[140px] overflow-y-auto">
                        {status.details.map((detail, index) => <li key={index}>{detail}</li>)}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            )}

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
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex-1 overflow-y-auto">
                <h4 className="font-bold text-slate-900 mb-4 text-sm">Map Columns for {activeCategoryLabel}</h4>
                <div className="space-y-3 mb-6">
                  {EXPECTED_COLUMNS[activeCategory].map(col => (
                    <div key={col.key} className="flex items-center justify-between border-b border-slate-100 pb-3">
                      <div className="w-1/2 flex items-center">
                        <span className="text-xs font-medium text-slate-700">{col.label}</span>
                        {col.required && <span className="text-red-500 ml-1 text-xs">*</span>}
                      </div>
                      <div className="w-1/2 pl-2">
                        <select
                          className="w-full text-xs border border-slate-200 rounded-md p-2 focus:ring-2 focus:ring-blue-500 outline-none"
                          value={mappingState.mapping[col.key] || ''}
                          onChange={(e) => {
                            setMappingState(prev => prev ? { ...prev, mapping: { ...prev.mapping, [col.key]: e.target.value } } : null);
                          }}
                        >
                          <option value="">-- Ignore / Not Mapped --</option>
                          {mappingState.fileHeaders.map((h, i) => <option key={i} value={h}>{h}</option>)}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex space-x-3 justify-end mt-4">
                  <button onClick={() => setMappingState(null)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-xs font-medium transition-colors">
                    Cancel
                  </button>
                  <button onClick={executeImport} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium transition-colors hover:bg-blue-700">
                    {isHeaderDetailCategory(activeCategory) ? 'Continue to Preview' : 'Confirm & Import'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div
                    onDragEnter={handleDrag}
                    onDragOver={handleDrag}
                    onDragLeave={handleDrag}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all min-h-[150px] ${dragActive
                      ? 'border-blue-500 bg-blue-50/40 scale-[0.99]'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50 dark:hover:bg-slate-950'
                      }`}
                  >
                    <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".xlsx,.xls" className="hidden" />
                    <UploadCloud className="w-8 h-8 text-slate-400 mb-2" />
                    <span className="text-xs font-semibold text-slate-800 text-center block">Upload Excel file</span>
                    <span className="text-[10px] text-slate-400 text-center mt-1">
                      Drag and drop your <code className="font-mono bg-slate-100 px-1 py-0.5 rounded text-slate-600">.xlsx</code> file or click to browse
                    </span>
                  </div>

                  <div className="bg-slate-900 text-slate-300 rounded-xl p-4 flex flex-col justify-between min-h-[150px] font-mono text-[10px]">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-slate-400 pb-1.5 border-b border-slate-800">
                        <span className="text-[9px] uppercase tracking-wider font-semibold text-blue-400">Excel Column Blueprint Template</span>
                        <span className="text-[8px] bg-slate-800 px-1 py-0.5 rounded text-slate-500">Read-only template</span>
                      </div>
                      <pre className="mt-2 text-slate-300 font-mono text-[9px] leading-relaxed max-h-[100px] overflow-y-auto overflow-x-hidden select-all whitespace-pre-wrap">
                        {getTemplateHeaders(activeCategory)}
                      </pre>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(getTemplateHeaders(activeCategory));
                        alert('Template copied to clipboard!');
                      }}
                      className="mt-3 w-full py-1.5 bg-slate-800 hover:bg-slate-700 hover:text-white rounded text-[10px] text-slate-300 font-sans font-medium transition-colors flex items-center justify-center space-x-1"
                    >
                      <Clipboard className="w-3 h-3" />
                      <span>Copy Blueprint Template</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100 shrink-0">
              <button type="button" onClick={onClose} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors">
                Close Hub
              </button>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run lint`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ImportExportModal.tsx
git commit -m "feat: rewrite ImportExportModal against ImportExportService (drop FULL_BACKUP/Employees, add Purchase/Sales preview)"
```

---

### Task 6: `src/services/db.ts` cleanup — remove functions only `ImportExportModal.tsx` used

**Files:**
- Modify: `src/services/db.ts`

**Interfaces:**
- None (deletion only). `ReportsView.tsx` (`getInventory`, `getVendors`, `getSalesOrders`, `getPurchaseOrders`, `getDashboardStats`, `addPurchaseOrder`), `SystemAdminView.tsx` (`generateId`), and `App.tsx` (`useSyncStore`) must keep working unchanged.

- [ ] **Step 1: Re-verify each candidate is dead before touching anything**

Run each of these and confirm the only hits are inside `services/db.ts` itself (no other file references them):

```bash
grep -rn "\bsaveVendors\b" src --include=*.ts --include=*.tsx
grep -rn "\bgetClients\b" src --include=*.ts --include=*.tsx
grep -rn "\bsaveClients\b" src --include=*.ts --include=*.tsx
grep -rn "\bgetEmployees\b" src --include=*.ts --include=*.tsx
grep -rn "\bsaveEmployees\b" src --include=*.ts --include=*.tsx
```

Expected: for `getClients`/`getEmployees`, you'll see hits in `ContactsService.ts`/`EmployeesService.ts` and their own consumers (`ContactsView.tsx`, `OrdersView.tsx`, `EmployeesView.tsx`, etc.) — those are unrelated same-named exports from different files, not `db.ts`'s. The only `db.ts`-relevant hits for all five names should be their own `export const` lines inside `services/db.ts`. If any of the five names shows up in a file other than `services/db.ts` that actually imports from `'../services/db'` or `'./services/db'`, STOP and do not remove that one — re-check `Global Constraints` above.

- [ ] **Step 2: Remove the five dead exports and their now-unused type imports**

In `src/services/db.ts`, find:

```ts
export const getInventory = (): InventoryItem[] => getStorageItem('erp_inventory', []);
export const getVendors = (): Vendor[] => getStorageItem('erp_vendors', []);
export const getClients = (): Client[] => getStorageItem('erp_clients', []);
export const getContacts = (): Contact[] => getStorageItem('erp_contacts', []);
export const getSalesOrders = (): SalesOrder[] => getStorageItem('erp_sales_orders', []);
export const getPurchaseOrders = (): PurchaseOrder[] => getStorageItem('erp_purchase_orders', []);
```

Replace with (removes the `getClients` line only):

```ts
export const getInventory = (): InventoryItem[] => getStorageItem('erp_inventory', []);
export const getVendors = (): Vendor[] => getStorageItem('erp_vendors', []);
export const getContacts = (): Contact[] => getStorageItem('erp_contacts', []);
export const getSalesOrders = (): SalesOrder[] => getStorageItem('erp_sales_orders', []);
export const getPurchaseOrders = (): PurchaseOrder[] => getStorageItem('erp_purchase_orders', []);
```

Find:

```ts
export const saveInventory = async (items: InventoryItem[], changed?: InventoryItem, deletedId?: string) => {
  setStorageItem('erp_inventory', items);
  if (changed) await upsertRecord('erp_inventory', changed);
  if (deletedId) await deleteRecord('erp_inventory', deletedId);
};
export const saveVendors = async (items: Vendor[], changed?: Vendor, deletedId?: string) => {
  setStorageItem('erp_vendors', items);
  if (changed) await upsertRecord('erp_vendors', changed);
  if (deletedId) await deleteRecord('erp_vendors', deletedId);
};
export const saveClients = async (items: Client[], changed?: Client, deletedId?: string) => {
  setStorageItem('erp_clients', items);
  if (changed) await upsertRecord('erp_clients', changed);
  if (deletedId) await deleteRecord('erp_clients', deletedId);
};
```

Replace with (removes `saveVendors`/`saveClients`, keeps `saveInventory` — it's called internally by `adjustRawMaterialStock`, which `addPurchaseOrder` depends on and `ReportsView.tsx` still calls `addPurchaseOrder`):

```ts
export const saveInventory = async (items: InventoryItem[], changed?: InventoryItem, deletedId?: string) => {
  setStorageItem('erp_inventory', items);
  if (changed) await upsertRecord('erp_inventory', changed);
  if (deletedId) await deleteRecord('erp_inventory', deletedId);
};
```

Find:

```ts
// --- Employees database ---
export const getEmployees = (): Employee[] => getStorageItem('erp_employees', []);

export const saveEmployees = async (employees: Employee[], changed?: Employee, deletedId?: string): Promise<void> => {
  setStorageItem('erp_employees', employees);
  if (changed) await upsertRecord('erp_employees', changed);
  if (deletedId) await deleteRecord('erp_employees', deletedId);
};


```

Replace with nothing (delete the block entirely). It's immediately followed by a few blank lines and then a `// ─── Per-tab lazy loaders ───...` comment — leave that comment and everything after it untouched, just collapse the deleted block's surrounding blank lines to a single blank line.

Find the top-of-file type import:

```ts
import {
  InventoryItem,
  Vendor,
  Client,
  Contact,
  SalesOrder,
  PurchaseOrder,
  DashboardStats,
  Employee,
  SalesOrderItem,
  PurchaseOrderItem,
} from '../types';
```

Replace with (drops `Client` and `Employee`, both now unused in this file):

```ts
import {
  InventoryItem,
  Vendor,
  Contact,
  SalesOrder,
  PurchaseOrder,
  DashboardStats,
  SalesOrderItem,
  PurchaseOrderItem,
} from '../types';
```

- [ ] **Step 3: Verify**

Run: `npm run lint`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/services/db.ts
git commit -m "chore: remove db.ts exports only the old ImportExportModal used"
```

---

### Task 7: `knowledge.md` docs update + manual QA handoff

**Files:**
- Modify: `knowledge.md`

**Interfaces:**
- None (documentation only).

- [ ] **Step 1: Add `ImportExportService.ts` to the pattern-A list (around line 21)**

Find:

```
**A. Module-owned service (preferred, direct-to-Supabase)** — `CompanyProfileService.ts`, `SystemAdminService.ts`, `ContactsService.ts`, `MaterialService.ts`, `ProductService.ts`, `InventoryTransactionService.ts`, `PurchasesService.ts`, `OrdersService.ts`.
```

Replace with:

```
**A. Module-owned service (preferred, direct-to-Supabase)** — `CompanyProfileService.ts`, `SystemAdminService.ts`, `ContactsService.ts`, `MaterialService.ts`, `ProductService.ts`, `InventoryTransactionService.ts`, `PurchasesService.ts`, `OrdersService.ts`, `ImportExportService.ts`.
```

- [ ] **Step 2: Remove `ImportExportModal` from the pattern-B "still used by" list (around line 27)**

Find:

```
**B. Legacy REST hook** — `useTableData<T>('table_name')` (in `hooks/useTableData.ts`) calls `server.ts`'s `GET /api/data/:table?q=&<filterCol>=`, which runs the query server-side via a second Supabase client. Writes still go through `db.ts`'s per-table `save*`/localStorage-array functions. Still used by `EmployeesView`, `ReportsView`, `ImportExportModal` (bulk backup). Don't add new dependents; migrate a view to pattern A when you next touch it.
```

Replace with:

```
**B. Legacy REST hook** — `useTableData<T>('table_name')` (in `hooks/useTableData.ts`) calls `server.ts`'s `GET /api/data/:table?q=&<filterCol>=`, which runs the query server-side via a second Supabase client. Writes still go through `db.ts`'s per-table `save*`/localStorage-array functions. Still used by `EmployeesView`, `ReportsView`. Don't add new dependents; migrate a view to pattern A when you next touch it.
```

- [ ] **Step 3: Update the `ImportExportModal.tsx` one-liner in Project Structure (around line 51)**

Find:

```
│   ├── ImportExportModal.tsx (Excel import/export)
```

Replace with:

```
│   ├── ImportExportModal.tsx  # Excel import/export: Vendors/Clients/Material/Product/Purchase/Sales, via ImportExportService.ts
```

- [ ] **Step 4: Drop the "still used by ... ImportExportModal" mentions on the legacy SalesOrder/PurchaseOrder type lines (around lines 100-101)**

Find:

```
- **SalesOrder**: clientId, itemId, qty, unitPrice, totalPrice, orderDate, deliveryDate, status (PENDING|IN_PRODUCTION|SHIPPED|DELIVERED|CANCELLED), workflowTaskId, items[] — legacy, `sales_orders` table, still used by Dashboard/Reports/ImportExportModal.
- **PurchaseOrder**: vendorId, itemId, qty, unitCost, totalCost, orderDate, status (DRAFT|ORDERED|RECEIVED|CANCELLED), items[] — legacy, `purchase_orders` table, still used by Dashboard/Reports/ImportExportModal.
```

Replace with:

```
- **SalesOrder**: clientId, itemId, qty, unitPrice, totalPrice, orderDate, deliveryDate, status (PENDING|IN_PRODUCTION|SHIPPED|DELIVERED|CANCELLED), workflowTaskId, items[] — legacy, `sales_orders` table, still used by Dashboard/Reports.
- **PurchaseOrder**: vendorId, itemId, qty, unitCost, totalCost, orderDate, status (DRAFT|ORDERED|RECEIVED|CANCELLED), items[] — legacy, `purchase_orders` table, still used by Dashboard/Reports.
```

- [ ] **Step 5: Rewrite the "Import/Export Excel" Common Task line (around line 167)**

Find:

```
- **Import/Export Excel**: ImportExportModal uses XLSX lib (still reads/writes via `db.ts`'s array-based getters — pattern B, scoped to bulk backup)
```

Replace with:

```
- **Import/Export Excel**: ImportExportModal uses XLSX lib + `ImportExportService.ts` (pattern A). Vendor/Client/Material/Product import merges by natural key (companyName, or name+code); Purchase/Sales import groups rows by Purchase No/Sales No into header+detail, validates the whole file, shows a Preview, and only writes (landing at status ORDERED) once there are zero errors.
```

- [ ] **Step 6: Verify**

Run: `npm run lint`
Expected: exits 0 (docs-only change, should already pass — this just confirms nothing else broke).

- [ ] **Step 7: Commit**

```bash
git add knowledge.md
git commit -m "docs: update knowledge.md for ImportExportModal/ImportExportService rewrite"
```

- [ ] **Step 8: Hand off for manual QA**

Tell the user the following checklist needs manual verification in the running app (per project convention, the agent does not launch the dev server or browser automation):

- Export Vendors, then re-import the same file unchanged — every row updates in place (no duplicates created).
- Edit one row's Email in the exported Vendor file, re-import — that vendor's email updates, no new vendor created.
- Add a brand-new row (new companyName) to the Vendor file, re-import — a new vendor is created.
- Repeat the export → edit → re-import round trip for Clients, Material, and Product. For Material/Product, confirm `quantity` is unaffected by the import regardless of what's in the file.
- Material/Product: put a category name in the "Category" column that matches an existing Material/Product Category — confirm the imported row gets that category. Leave it blank on another row — confirm it imports uncategorized.
- Build a small Purchase Excel file with 2 orders (2-3 line rows sharing one Purchase No each) — upload, map columns, confirm the Preview shows the right Total Orders/Total Detail Rows/0 errors, then Confirm & Import — both purchase orders appear in the Purchases tab at status "Ordered" with correct line items and totals.
- Same for Sales — 2 orders, confirm Preview then import, both appear in Orders' Sales Order tab at status "Ordered" with correct Delivery Date.
- Purchase/Sales negative cases: a row with an unknown Vendor/Client name, a row with an unknown Material/Product name, a row with a non-numeric or non-positive Quantity, and a Purchase No/Sales No that already exists in the database — confirm each produces the expected "Row N: ..." message in the Preview and that Confirm & Import stays disabled (0 rows get written).
- Export Purchase and Sales — confirm the two-sheet workbook (`Purchase_Orders`/`Purchase_Items` or `Sales_Orders`/`Sales_Items`) includes both Quotation and Order-status records.
- Dashboard/Reports tabs still load without errors (they read the untouched legacy `sales_orders`/`purchase_orders` tables via `db.ts`, unaffected by this change).
