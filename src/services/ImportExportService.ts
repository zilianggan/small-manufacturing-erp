/**
 * Import/Export module service layer.
 *
 * Talks to Supabase directly via each category's existing pattern-A service
 * (ContactsService/MaterialService/ProductService/PurchasesService/
 * OrdersService) plus direct `supabase` calls for header+detail writes. No
 * db.ts, no server.ts REST hop, no useTableData, no FULL_BACKUP/localStorage
 * dump.
 */
import { supabase } from "./supabase";
import { upsertRecords, generateId } from "../helper";
import { getVendors, getClients, getContacts } from "./ContactsService";
import { getMaterials, getMaterialCategories } from "./MaterialService";
import { getProducts, getProductCategories } from "./ProductService";
import { getPurchases } from "./PurchasesService";
import { getSalesOrders, getProductStock, NewMaterialUsage } from "./OrdersService";
import { getInventoryTransactions } from "./InventoryTransactionService";
import { nowIso } from "../utils/date";
import { isValidEmail, isValidPhone, normalizeEmail, toE164Phone } from "../utils/validators";
import { Vendor, Client, Contact, Material, Product, Attachment, InventoryTransaction } from "../types";

// Groups per DB round-trip pair (header insert + detail insert) for
// Purchase/Sales commit — keeps big files from firing one request per order.
const COMMIT_CHUNK_SIZE = 25;

// Every record type in this file caps attachments at one (the UI's
// AttachmentSection/detail views only ever read/write attachments[0]) — export
// mirrors that: one "attachment" filename column per sheet, hyperlinked to the
// stored base64 dataUrl. Best-effort: Excel enforces a hyperlink URL length
// limit, so large attachments' links may not open — the filename is still
// visible either way.
const attachmentName = (r: { attachments?: Attachment[] }): string => r.attachments?.[0]?.name || '';
const attachmentLink = (r: { attachments?: Attachment[] }): string | undefined => r.attachments?.[0]?.dataUrl;

// A date-formatted Excel cell arrives here as a JS Date (the modal reads the
// workbook with cellDates: true); a typed/manual entry arrives as a plain
// string. Local calendar components (not toISOString, which is UTC) avoid a
// day-shift for timezones ahead of UTC around midnight.
const excelCellToDateString = (val: unknown): string => {
  if (val instanceof Date) {
    const y = val.getFullYear(), m = String(val.getMonth() + 1).padStart(2, '0'), d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(val || '').trim();
};

export interface ImportColumn {
  key: string;
  label: string;
  required: boolean;
}

export interface FlatImportResult<T> {
  records: T[];
  errors: ImportRowError[];
  // Material/Product only: a row's initial-quantity value becomes an
  // ADJUSTMENT inventory_transaction at commit time — keeps
  // update_material_stock() as the only writer of the quantity column
  // instead of setting it directly (see MATERIAL_COLUMNS/PRODUCT_COLUMNS).
  stockAdjustments?: { itemId: string; quantity: number }[];
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
    records.push({
      id: match?.id || generateId(), attachments: match?.attachments, companyName,
      email: email ? normalizeEmail(email) : email, officeNo: officeNo ? toE164Phone(officeNo) : officeNo,
      address: String(raw.address || ''), description: String(raw.description || ''),
    });
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
    records.push({
      id: match?.id || generateId(), attachments: match?.attachments, companyName,
      email: email ? normalizeEmail(email) : email, officeNo: officeNo ? toE164Phone(officeNo) : officeNo,
      address: String(raw.address || ''), description: String(raw.description || ''),
    });
  });

  return { records, errors };
};

export const CONTACT_COLUMNS: ImportColumn[] = [
  { key: 'fullName', label: 'Contact Name', required: true },
  { key: 'type', label: 'Type (Client/Vendor)', required: true },
  { key: 'companyName', label: 'Company Name', required: true },
  { key: 'email', label: 'Email', required: false },
  { key: 'contactNo', label: 'Contact No.', required: false },
];

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
      email: email ? normalizeEmail(email) : email,
      contactNo: contactNo ? toE164Phone(contactNo) : contactNo,
      vendorId: type === 'VENDOR' ? owner.id : undefined,
      clientId: type === 'CLIENT' ? owner.id : undefined,
      attachments: match?.attachments,
    });
  });

  return { records, errors };
};

export const buildVendorExportRows = (vendors: Vendor[]) => vendors.map(v => ({
  id: v.id, companyName: v.companyName, email: v.email, officeNo: v.officeNo,
  address: v.address, description: v.description || '', attachment: attachmentName(v),
}));

export const buildClientExportRows = (clients: Client[]) => clients.map(c => ({
  id: c.id, companyName: c.companyName, email: c.email, officeNo: c.officeNo,
  address: c.address, description: c.description || '', attachment: attachmentName(c),
}));

export const getVendorExportRows = async () => {
  const vendors = await getVendors('');
  return { rows: buildVendorExportRows(vendors), attachmentLinks: vendors.map(attachmentLink) };
};
export const getClientExportRows = async () => {
  const clients = await getClients('');
  return { rows: buildClientExportRows(clients), attachmentLinks: clients.map(attachmentLink) };
};

export const getContactExportRows = async () => {
  const [contacts, vendors, clients] = await Promise.all([getContacts({}), getVendors(''), getClients('')]);
  const vendorNameById = new Map(vendors.map(v => [v.id, v.companyName]));
  const clientNameById = new Map(clients.map(c => [c.id, c.companyName]));

  const rows = contacts.map(c => ({
    id: c.id, fullName: c.fullName,
    type: c.vendorId ? 'VENDOR' : 'CLIENT',
    companyName: c.vendorId ? (vendorNameById.get(c.vendorId) || '') : (clientNameById.get(c.clientId || '') || ''),
    email: c.email || '', contactNo: c.contactNo || '', attachment: attachmentName(c),
  }));
  return { rows, attachmentLinks: contacts.map(attachmentLink) };
};

const VALID_MATERIAL_TYPES = ['RAW_MATERIAL', 'CONSUMABLE_MATERIAL', 'CUSTOMER_STOCK'];

export const MATERIAL_COLUMNS: ImportColumn[] = [
  { key: 'name', label: 'Material Name', required: true },
  { key: 'code', label: 'Code', required: false },
  { key: 'materialType', label: 'Material Type', required: false },
  { key: 'dimension', label: 'Dimension', required: false },
  { key: 'description', label: 'Description', required: false },
  { key: 'minimumStock', label: 'Minimum Stock', required: false },
  { key: 'category', label: 'Category', required: false },
  { key: 'quantity', label: 'Quantity', required: false },
];

export const PRODUCT_COLUMNS: ImportColumn[] = [
  { key: 'name', label: 'Product Name', required: true },
  { key: 'code', label: 'Code', required: false },
  { key: 'dimension', label: 'Dimension', required: false },
  { key: 'description', label: 'Description', required: false },
  { key: 'sellingPrice', label: 'Selling Price', required: false },
  { key: 'category', label: 'Category', required: false },
  { key: 'quantity', label: 'Quantity', required: false },
];

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
  const stockAdjustments: { itemId: string; quantity: number }[] = [];

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
    const id = match?.id || generateId();
    records.push({
      id,
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

    const quantity = Number(raw.quantity) || 0;
    if (quantity > 0) stockAdjustments.push({ itemId: id, quantity });
  });

  return { records, errors, stockAdjustments };
};

export const validateProductsImport = async (rows: Record<string, any>[]): Promise<FlatImportResult<Product>> => {
  const [existing, categories] = await Promise.all([getProducts(''), getProductCategories()]);
  const byNameCode = new Map(existing.map(p => [`${p.name.toLowerCase()}::${(p.code || '').toLowerCase()}`, p]));
  const categoryByName = new Map(categories.map(c => [c.name.toLowerCase(), c.id]));
  const seenInFile = new Set<string>();
  const errors: ImportRowError[] = [];
  const records: Product[] = [];
  const stockAdjustments: { itemId: string; quantity: number }[] = [];

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
    const id = match?.id || generateId();
    records.push({
      id,
      name,
      code,
      dimension: String(raw.dimension || ''),
      description: String(raw.description || ''),
      attachments: match?.attachments, // preserve existing attachments on update; new records get none
      status: match?.status || 'ACTIVE',
      sellingPrice: Number(raw.sellingPrice) || 0,
      productCategoryId: categoryId,
    });

    const quantity = Number(raw.quantity) || 0;
    if (quantity > 0) stockAdjustments.push({ itemId: id, quantity });
  });

  return { records, errors, stockAdjustments };
};

export const buildMaterialExportRows = (materials: Material[], categories: { id: string; name: string }[]) => {
  const categoryNameById = new Map(categories.map(c => [c.id, c.name]));
  return materials.map(m => ({
    id: m.id, name: m.name, code: m.code || '', materialType: m.materialType || '',
    dimension: m.dimension || '', quantity: m.quantity, description: m.description || '',
    status: m.status || 'ACTIVE', minimumStock: m.minimumStock,
    category: m.materialCategoryId ? (categoryNameById.get(m.materialCategoryId) || '') : '',
    attachment: attachmentName(m),
  }));
};

export const getMaterialExportRows = async () => {
  const [materials, categories] = await Promise.all([getMaterials(''), getMaterialCategories()]);
  return { rows: buildMaterialExportRows(materials, categories), attachmentLinks: materials.map(attachmentLink) };
};

export const buildProductExportRows = (products: Product[], categories: { id: string; name: string }[]) => {
  const categoryNameById = new Map(categories.map(c => [c.id, c.name]));
  return products.map(p => ({
    id: p.id, name: p.name, code: p.code || '', dimension: p.dimension || '',
    description: p.description || '', status: p.status || 'ACTIVE', sellingPrice: p.sellingPrice,
    category: p.productCategoryId ? (categoryNameById.get(p.productCategoryId) || '') : '',
    attachment: attachmentName(p),
  }));
};

export const getProductExportRows = async () => {
  const [products, categories] = await Promise.all([getProducts(''), getProductCategories()]);
  return { rows: buildProductExportRows(products, categories), attachmentLinks: products.map(attachmentLink) };
};

export interface ImportRowError {
  row: number; // 1-based position within the uploaded file's data rows (excludes the header row)
  message: string;
}

export const PURCHASE_COLUMNS: ImportColumn[] = [
  { key: 'purchaseNo', label: 'Purchase No', required: true },
  { key: 'vendorName', label: 'Vendor', required: true },
  { key: 'orderDate', label: 'Order Date', required: true },
  { key: 'materialCode', label: 'Material Code', required: true },
  { key: 'quantity', label: 'Quantity', required: true },
  { key: 'unitCost', label: 'Unit Cost', required: true },
];

export interface PurchaseImportRow {
  purchaseNo: string;
  vendorName: string;
  orderDate: string;
  materialCode: string;
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
  const materialByCode = new Map(materials.filter(m => m.code).map(m => [m.code!.toLowerCase(), m]));

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

    const material = materialByCode.get(String(raw.materialCode || '').trim().toLowerCase());
    if (!material) errors.push({ row: rowNum, message: `Material code "${raw.materialCode}" not found.` });

    const orderDate = excelCellToDateString(raw.orderDate);
    const orderDateValid = !!orderDate && !isNaN(Date.parse(orderDate));
    if (!orderDateValid) errors.push({ row: rowNum, message: `Order Date "${raw.orderDate}" is not a valid date.` });

    const quantity = Number(raw.quantity);
    if (!(quantity > 0)) errors.push({ row: rowNum, message: 'Quantity must be greater than zero.' });

    const unitCost = Number(raw.unitCost);
    if (!(unitCost >= 0)) errors.push({ row: rowNum, message: 'Unit Cost must be zero or greater.' });

    const purchaseNoKey = purchaseNo.toLowerCase();
    const isDuplicatePurchaseNo = existingPurchaseNos.has(purchaseNoKey);
    if (isDuplicatePurchaseNo && !seenInFile.has(purchaseNoKey)) {
      errors.push({ row: rowNum, message: `Purchase No "${purchaseNo}" already exists in the database.` });
    }
    seenInFile.add(purchaseNoKey);

    if (!vendor || !material || !orderDateValid || !(quantity > 0) || !(unitCost >= 0) || isDuplicatePurchaseNo) return;

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

// Best-effort chunked write (same non-atomic intent as
// PurchasesService.createPurchaseQuotation, batched for import volume):
// groups are processed COMMIT_CHUNK_SIZE at a time, each chunk writing all
// its headers in one insert, all its details in one insert and all its stock
// movements in one insert — instead of a round trip per order/line. If a
// chunk's write fails, that chunk's just-inserted headers are deleted
// (details cascade, avoiding orphans) and later chunks are never attempted.
// Only call this with a PurchaseImportPreview that has zero errors.
//
// Imported purchases land as RECEIVED (not ORDERED): the goods are already in
// the shop when someone back-fills them from a spreadsheet, so each line gets
// its PURCHASE inventory_transaction (the update_material_stock() trigger then
// raises material.quantity) and received_quantity = quantity, which also keeps
// receivePurchaseOrder's idempotency guard from double-counting if the order is
// ever "received" again from the UI.
export const commitPurchaseImport = async (groups: PurchaseImportGroup[]): Promise<PurchaseImportCommitResult> => {
  const succeeded: string[] = [];

  for (let i = 0; i < groups.length; i += COMMIT_CHUNK_SIZE) {
    const chunk = groups.slice(i, i + COMMIT_CHUNK_SIZE);
    const ids = chunk.map(() => generateId());

    const { error: headerError } = await supabase.from('purchase_header').insert(
      chunk.map((group, idx) => ({
        id: ids[idx],
        purchase_no: group.purchaseNo,
        quotation_date: group.orderDate,
        order_date: group.orderDate,
        received_date: group.orderDate,
        status: 'RECEIVED',
        vendor_id: group.vendorId,
        total_price: group.details.reduce((sum, d) => sum + d.quantity * d.unitCost, 0),
      }))
    );
    if (headerError) {
      console.error('commitPurchaseImport(header)', headerError);
      return { succeeded, failed: { purchaseNo: chunk[0].purchaseNo, message: headerError.message } };
    }

    // Flattened line list kept alongside the insert so the returned detail_ids
    // (RETURNING preserves insert order) can be zipped back onto their line.
    const lines = chunk.flatMap((group, idx) => group.details.map(d => ({ ...d, headerIdx: idx, orderDate: group.orderDate })));

    const { data: insertedDetails, error: detailError } = await supabase.from('purchase_detail').insert(
      lines.map(d => ({
        header_id: ids[d.headerIdx],
        material_id: d.materialId,
        material_name: d.materialName,
        material_code: d.materialCode || null,
        quantity: d.quantity,
        unit_cost: d.unitCost,
        total_price: d.quantity * d.unitCost,
        received_quantity: d.quantity,
      }))
    ).select('detail_id');
    if (detailError) {
      console.error('commitPurchaseImport(detail)', detailError);
      await supabase.from('purchase_header').delete().in('id', ids);
      return { succeeded, failed: { purchaseNo: chunk[0].purchaseNo, message: detailError.message } };
    }

    const { error: txError } = await supabase.from('inventory_transaction').insert(
      lines.map((d, idx) => ({
        id: generateId(),
        transaction_type: 'PURCHASE',
        quantity: d.quantity,
        unit_cost: d.unitCost,
        material_id: d.materialId,
        purchase_detail_id: (insertedDetails || [])[idx]?.detail_id,
        transaction_date: new Date(d.orderDate).toISOString(),
      }))
    );
    if (txError) {
      console.error('commitPurchaseImport(inventory_transaction)', txError);
      await supabase.from('purchase_header').delete().in('id', ids);
      return { succeeded, failed: { purchaseNo: chunk[0].purchaseNo, message: txError.message } };
    }

    succeeded.push(...chunk.map(g => g.purchaseNo));
  }

  return { succeeded };
};

export const getPurchaseExportSheets = async () => {
  const [quotations, orders] = await Promise.all([getPurchases('QUOTATION', ''), getPurchases('PO', '')]);
  const all = [...quotations, ...orders];

  const headerRows = all.map(p => ({
    id: p.id, purchaseNo: p.purchaseNo, quotationDate: p.quotationDate, orderDate: p.orderDate || '',
    receivedDate: p.receivedDate || '', status: p.status, vendorName: p.vendorName, totalPrice: p.totalPrice,
    attachment: attachmentName(p),
  }));

  const itemRows = all.flatMap(p => p.details.map(d => ({
    purchaseNo: p.purchaseNo, vendorName: p.vendorName, orderDate: p.orderDate || p.quotationDate,
    status: p.status, materialName: d.materialName, materialCode: d.materialCode || '',
    quantity: d.quantity, unitCost: d.unitCost, totalPrice: d.totalPrice, receivedQuantity: d.receivedQuantity,
  })));

  return { headerRows, itemRows, attachmentLinks: all.map(attachmentLink) };
};

export const SALES_COLUMNS: ImportColumn[] = [
  { key: 'salesNo', label: 'Sales No', required: true },
  { key: 'clientName', label: 'Client', required: true },
  { key: 'orderDate', label: 'Order Date', required: true },
  { key: 'deliveryDate', label: 'Delivery Date', required: false },
  { key: 'productCode', label: 'Product Code', required: true },
  { key: 'quantity', label: 'Quantity', required: true },
  { key: 'unitPrice', label: 'Unit Price', required: true },
  { key: 'remark', label: 'Remark', required: false },
];

export interface SalesImportRow {
  salesNo: string;
  clientName: string;
  orderDate: string;
  deliveryDate?: string;
  productCode: string;
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
  const productByCode = new Map(products.filter(p => p.code).map(p => [p.code!.toLowerCase(), p]));
  // getProducts() doesn't populate quantity (it's only aggregated by
  // getProductsPage()) — fetch live stock the same way startProduction's
  // checkProductionStock does.
  const productStock = await getProductStock(products.map(p => p.id));

  // Lands as DELIVERED (see commitSalesImport below), so it debits stock the
  // moment it's imported — sum demand per product across the whole file
  // (it can span multiple Sales No) before allowing any of it through.
  const demandByProduct = new Map<string, number>();
  rows.forEach(raw => {
    const product = productByCode.get(String(raw.productCode || '').trim().toLowerCase());
    const quantity = Number(raw.quantity);
    if (product && quantity > 0) demandByProduct.set(product.id, (demandByProduct.get(product.id) || 0) + quantity);
  });

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

    const product = productByCode.get(String(raw.productCode || '').trim().toLowerCase());
    if (!product) errors.push({ row: rowNum, message: `Product code "${raw.productCode}" not found.` });

    let stockSufficient = true;
    if (product) {
      const available = productStock[product.id] || 0;
      const totalDemand = demandByProduct.get(product.id) || 0;
      if (totalDemand > available) {
        errors.push({ row: rowNum, message: `Insufficient stock for Product "${product.name}": ${available} available, ${totalDemand} requested across this file.` });
        stockSufficient = false;
      }
    }

    const orderDate = excelCellToDateString(raw.orderDate);
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

    if (!client || !product || !stockSufficient || !orderDateValid || !(quantity > 0) || !(unitPrice >= 0) || isDuplicateSalesNo) return;

    let group = groupsByNo.get(salesNoKey);
    if (!group) {
      group = {
        salesNo, clientId: client.id, clientName: client.companyName, orderDate,
        deliveryDate: excelCellToDateString(raw.deliveryDate) || undefined, details: [],
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

// Chunked write — see commitPurchaseImport for the batching rationale.
export const commitSalesImport = async (groups: SalesImportGroup[]): Promise<SalesImportCommitResult> => {
  const succeeded: string[] = [];

  for (let i = 0; i < groups.length; i += COMMIT_CHUNK_SIZE) {
    const chunk = groups.slice(i, i + COMMIT_CHUNK_SIZE);
    const ids = chunk.map(() => generateId());

    const { error: headerError } = await supabase.from('sales_header').insert(
      chunk.map((group, idx) => ({
        id: ids[idx],
        sales_no: group.salesNo,
        order_date: group.orderDate,
        delivery_date: group.deliveryDate || null,
        // DELIVERED, not ORDERED: the goods are already out the door when a sales order is
        // back-filled from a spreadsheet, and this importer already writes the one SALES -qty
        // ledger row for that below. Landing the header as ORDERED would leave it live for the
        // normal lifecycle — confirmProductionDone (+qty) then markDelivered (a second -qty) —
        // which would double-debit product.quantity with no way to undo it (the ledger is
        // insert-only). DELIVERED is past both of those, so this row stays the only debit.
        // Symmetric with commitPurchaseImport, which lands its header as RECEIVED for the same
        // reason.
        status: 'DELIVERED',
        client_id: group.clientId,
        total_amount: group.details.reduce((sum, d) => sum + d.quantity * d.unitPrice, 0),
      }))
    );
    if (headerError) {
      console.error('commitSalesImport(header)', headerError);
      return { succeeded, failed: { salesNo: chunk[0].salesNo, message: headerError.message } };
    }

    const { error: detailError } = await supabase.from('sales_detail').insert(
      chunk.flatMap((group, idx) => group.details.map(d => ({
        header_id: ids[idx],
        product_id: d.productId,
        product_name: d.productName,
        product_code: d.productCode || null,
        quantity: d.quantity,
        unit_price: d.unitPrice,
        total_price: d.quantity * d.unitPrice,
        // The header lands as DELIVERED, so the line must say it shipped in full — mirrors
        // commitPurchaseImport's received_quantity above. Without this the imported order reads as
        // "delivered 0 of N" and its Return action caps at zero (returns are capped at what actually
        // shipped), which would make an imported sale impossible to return.
        delivered_quantity: d.quantity,
        remark: d.remark || null,
      })))
    );
    if (detailError) {
      console.error('commitSalesImport(detail)', detailError);
      await supabase.from('sales_header').delete().in('id', ids);
      return { succeeded, failed: { salesNo: chunk[0].salesNo, message: detailError.message } };
    }

    // One SALES movement per line, negative against the product — this is the sole debit for
    // the import (see the DELIVERED status comment on the header insert above).
    // sales_detail_id is left null here — a known importer limitation, not a
    // missing column: it exists on inventory_transaction, and the sales_detail
    // rows to link against are already inserted above, so a future pass could
    // wire this up. Until then imported rows carry no order link and show in
    // the ledger as product movements only.
    const { error: txError } = await supabase.from('inventory_transaction').insert(
      chunk.flatMap(group => group.details.map(d => ({
        id: generateId(),
        transaction_type: 'SALES',
        quantity: -d.quantity,
        product_id: d.productId,
        transaction_date: new Date(group.orderDate).toISOString(),
      })))
    );
    if (txError) {
      console.error('commitSalesImport(inventory_transaction)', txError);
      await supabase.from('sales_header').delete().in('id', ids);
      return { succeeded, failed: { salesNo: chunk[0].salesNo, message: txError.message } };
    }

    succeeded.push(...chunk.map(g => g.salesNo));
  }

  return { succeeded };
};

export const getSalesExportSheets = async () => {
  const [quotations, orders] = await Promise.all([getSalesOrders('QUOTATION', ''), getSalesOrders('SO', '')]);
  const all = [...quotations, ...orders];

  const headerRows = all.map(s => ({
    id: s.id, salesNo: s.salesNo, orderDate: s.orderDate, deliveryDate: s.deliveryDate || '',
    status: s.status, clientName: s.clientName, totalAmount: s.totalAmount, remark: s.remark || '',
    attachment: attachmentName(s),
  }));

  const itemRows = all.flatMap(s => s.details.map(d => ({
    salesNo: s.salesNo, clientName: s.clientName, orderDate: s.orderDate, deliveryDate: s.deliveryDate || '',
    status: s.status, productName: d.productName, productCode: d.productCode || '',
    quantity: d.quantity, unitPrice: d.unitPrice, totalPrice: d.totalPrice, remark: d.remark || '',
  })));

  return { headerRows, itemRows, attachmentLinks: all.map(attachmentLink) };
};

export const INVENTORY_COLUMNS: ImportColumn[] = [
  { key: 'itemType', label: 'Item Type (Material/Product)', required: true },
  { key: 'code', label: 'Item Code', required: true },
  { key: 'quantity', label: 'Quantity (+/-)', required: true },
  { key: 'unitCost', label: 'Unit Cost', required: false },
  { key: 'remark', label: 'Remark', required: false },
  { key: 'date', label: 'Date', required: false },
];

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

    const date = excelCellToDateString(raw.date);
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

export const getInventoryExportRows = async () => {
  const all = [];
  let offset = 0;
  const pageSize = 500;
  while (true) {
    const { rows, hasMore } = await getInventoryTransactions({ offset, limit: pageSize });
    all.push(...rows);
    if (!hasMore) break;
    offset += rows.length;
  }

  const rows = all.map(t => ({
    id: t.id, transactionType: t.transactionType,
    itemType: t.materialId ? 'MATERIAL' : 'PRODUCT',
    itemName: t.materialName || t.productName || '',
    quantity: t.quantity, unitCost: t.unitCost ?? '',
    remark: t.remark || '', refNo: t.refNo || '', counterpartyName: t.counterpartyName || '',
    status: t.status || '', transactionDate: t.transactionDate,
  }));
  return { rows };
};

// "Export All" — one workbook, every category's own sheet builder (same
// functions the per-category export buttons call), so it's always in sync
// with whatever those export sheets currently look like. attachmentLinksBySheet
// only lists sheets that actually carry an "attachment" column (item/detail
// sheets don't — attachments live at the header/record level).
export const getAllExportSheets = async () => {
  const [vendors, clients, contacts, materials, products, purchase, sales, inventory] = await Promise.all([
    getVendorExportRows(), getClientExportRows(), getContactExportRows(), getMaterialExportRows(), getProductExportRows(),
    getPurchaseExportSheets(), getSalesExportSheets(), getInventoryExportRows(),
  ]);

  return {
    sheets: {
      Vendors: vendors.rows,
      Clients: clients.rows,
      Contacts: contacts.rows,
      Material: materials.rows,
      Product: products.rows,
      Purchase_Orders: purchase.headerRows,
      Purchase_Items: purchase.itemRows,
      Sales_Orders: sales.headerRows,
      Sales_Items: sales.itemRows,
      Inventory_Transactions: inventory.rows,
    },
    attachmentLinksBySheet: {
      Vendors: vendors.attachmentLinks,
      Clients: clients.attachmentLinks,
      Contacts: contacts.attachmentLinks,
      Material: materials.attachmentLinks,
      Product: products.attachmentLinks,
      Purchase_Orders: purchase.attachmentLinks,
      Sales_Orders: sales.attachmentLinks,
    },
  };
};

export const PRODUCTION_MATERIAL_COLUMNS: ImportColumn[] = [
  { key: 'salesNo', label: 'Sales No', required: true },
  { key: 'productCode', label: 'Product Code', required: true },
  { key: 'materialCode', label: 'Material Code', required: true },
  { key: 'plannedQuantity', label: 'Planned Quantity', required: true },
  { key: 'remark', label: 'Remark', required: false },
];

// Sales No + Product Code resolve an existing sales_detail line — this
// import only ADDS material usage to a sales order that already exists, it
// never creates sales orders itself. Unlike the live "Add Material" UI
// action (OrdersService.addMaterialUsage, planning-only, no stock effect),
// this lands as already-consumed — same backfill semantics as
// commitPurchaseImport/commitSalesImport — so it debits material.quantity
// immediately (see commitProductionMaterialsImport) and must be blocked if
// stock can't cover it. Consumption Mode is deliberately not a column: it's
// a Material-level setting (see ProductionMaterialUsage in types.ts) that
// nothing writes per-usage anymore.
export const validateProductionMaterialsImport = async (rows: Record<string, any>[]): Promise<FlatImportResult<NewMaterialUsage>> => {
  const [quotations, orders, materials] = await Promise.all([
    getSalesOrders('QUOTATION', ''), getSalesOrders('SO', ''), getMaterials(''),
  ]);
  const detailByKey = new Map<string, string>(); // `${salesNo}::${productCode}` -> detailId
  [...quotations, ...orders].forEach(header => {
    header.details.forEach(detail => {
      if (!detail.productCode) return;
      detailByKey.set(`${header.salesNo.toLowerCase()}::${detail.productCode.toLowerCase()}`, detail.detailId);
    });
  });
  const materialByCode = new Map(materials.filter(m => m.code).map(m => [m.code!.toLowerCase(), m]));

  // Sum demand per material across the whole file (it can span multiple
  // Sales No/Product Code lines) before allowing any of it through.
  const demandByMaterial = new Map<string, number>();
  rows.forEach(raw => {
    const material = materialByCode.get(String(raw.materialCode || '').trim().toLowerCase());
    const plannedQuantity = Number(raw.plannedQuantity);
    if (material && plannedQuantity > 0) demandByMaterial.set(material.id, (demandByMaterial.get(material.id) || 0) + plannedQuantity);
  });

  const errors: ImportRowError[] = [];
  const records: NewMaterialUsage[] = [];
  const seenInFile = new Set<string>();

  rows.forEach((raw, index) => {
    const rowNum = index + 1;
    const salesNo = String(raw.salesNo || '').trim();
    const productCode = String(raw.productCode || '').trim();
    const materialCode = String(raw.materialCode || '').trim();
    const plannedQuantity = Number(raw.plannedQuantity);
    let rowValid = true;

    if (!salesNo) { errors.push({ row: rowNum, message: "Missing 'Sales No'." }); rowValid = false; }
    if (!productCode) { errors.push({ row: rowNum, message: "Missing 'Product Code'." }); rowValid = false; }

    const detailId = salesNo && productCode ? detailByKey.get(`${salesNo.toLowerCase()}::${productCode.toLowerCase()}`) : undefined;
    if (salesNo && productCode && !detailId) {
      errors.push({ row: rowNum, message: `Sales No "${salesNo}" with Product Code "${productCode}" not found.` });
      rowValid = false;
    }

    if (!materialCode) { errors.push({ row: rowNum, message: "Missing 'Material Code'." }); rowValid = false; }
    const material = materialCode ? materialByCode.get(materialCode.toLowerCase()) : undefined;
    if (materialCode && !material) { errors.push({ row: rowNum, message: `Material code "${materialCode}" not found.` }); rowValid = false; }

    if (material) {
      const totalDemand = demandByMaterial.get(material.id) || 0;
      if (totalDemand > material.quantity) {
        errors.push({ row: rowNum, message: `Insufficient stock for Material "${material.name}": ${material.quantity} available, ${totalDemand} requested across this file.` });
        rowValid = false;
      }
    }

    if (!(plannedQuantity > 0)) { errors.push({ row: rowNum, message: 'Planned Quantity must be greater than zero.' }); rowValid = false; }

    if (salesNo && productCode && materialCode) {
      const key = `${salesNo.toLowerCase()}::${productCode.toLowerCase()}::${materialCode.toLowerCase()}`;
      if (seenInFile.has(key)) { errors.push({ row: rowNum, message: `Duplicate Sales No "${salesNo}" + Product "${productCode}" + Material "${materialCode}" in file.` }); rowValid = false; }
      seenInFile.add(key);
    }

    if (!rowValid || !detailId || !material) return;

    records.push({ detailId, materialId: material.id, plannedQuantity, remark: raw.remark ? String(raw.remark) : undefined });
  });

  return { records, errors };
};

// Lands as already-consumed: inserts the usage row (actual_quantity = planned,
// same reasoning as commitPurchaseImport's received_quantity/commitSalesImport's
// delivered_quantity — these rows describe something that already happened, not
// a future reservation) AND immediately debits material.quantity via a
// PRODUCTION inventory_transaction, linked back via production_material_usage_id
// the same way startProduction's reservation links. Only call this with a
// preview that has zero errors — including the stock-sufficiency check above.
export const commitProductionMaterialsImport = async (rows: NewMaterialUsage[]): Promise<void> => {
  const payload = rows.filter(r => r.plannedQuantity > 0);
  if (payload.length === 0) return;

  for (let i = 0; i < payload.length; i += COMMIT_CHUNK_SIZE) {
    const chunk = payload.slice(i, i + COMMIT_CHUNK_SIZE);

    const { data: insertedUsage, error: usageError } = await supabase.from('production_material_usage').insert(
      chunk.map(r => ({
        sales_detail_id: r.detailId, material_id: r.materialId,
        planned_quantity: r.plannedQuantity, actual_quantity: r.plannedQuantity,
        remark: r.remark || null,
      }))
    ).select('id');
    if (usageError) {
      console.error('commitProductionMaterialsImport(usage)', usageError);
      throw usageError;
    }

    const { error: txError } = await supabase.from('inventory_transaction').insert(
      chunk.map((r, idx) => ({
        id: generateId(),
        transaction_type: 'PRODUCTION',
        quantity: -r.plannedQuantity,
        material_id: r.materialId,
        production_material_usage_id: (insertedUsage || [])[idx]?.id,
        transaction_date: nowIso(),
      }))
    );
    if (txError) {
      console.error('commitProductionMaterialsImport(inventory_transaction)', txError);
      throw txError;
    }
  }
};

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

// Material/Product's initial-quantity import column lands here, as an
// ADJUSTMENT transaction per row — never as a direct write to
// material.quantity/product.quantity, which stays trigger-owned
// (update_material_stock()) same as every other stock change in the app.
export const commitStockAdjustments = async (
  category: 'MATERIAL' | 'PRODUCT',
  adjustments: { itemId: string; quantity: number }[]
): Promise<void> => {
  if (adjustments.length === 0) return;
  const transactions: InventoryTransaction[] = adjustments.map(a => ({
    id: generateId(),
    transactionType: 'ADJUSTMENT' as const,
    quantity: a.quantity,
    materialId: category === 'MATERIAL' ? a.itemId : undefined,
    productId: category === 'PRODUCT' ? a.itemId : undefined,
    transactionDate: nowIso(),
  }));
  await upsertRecords('erp_inventory_transaction', transactions);
};
