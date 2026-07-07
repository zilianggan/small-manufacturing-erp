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
import { getVendors, getClients, saveVendor, saveClient } from "./ContactsService";
import { getMaterials, saveMaterial, getMaterialCategories } from "./MaterialService";
import { getProducts, saveProduct, getProductCategories } from "./ProductService";
import { getPurchases } from "./PurchasesService";
import { getSalesOrders } from "./OrdersService";
import { Vendor, Client, Material, Product } from "../types";

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
    const vendor: Vendor = { id: match?.id || generateId(), attachments: match?.attachments, ...item };
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
    const client: Client = { id: match?.id || generateId(), attachments: match?.attachments, ...item };
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
        deliveryDate: String(raw.deliveryDate || '').trim() || undefined, details: [],
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
