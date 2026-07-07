import { create } from 'zustand';

interface SyncStore {
  isSyncing: boolean;
  setSyncing: (val: boolean) => void;
}
export const useSyncStore = create<SyncStore>((set) => ({ isSyncing: false, setSyncing: (val) => set({ isSyncing: val }) }));
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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
import { deleteRecord, getStorageItem, loadTable, setStorageItem, upsertRecord } from '../helper';

// RECIPES: loaded dynamically from Supabase (no hardcoded values).
// Populated at runtime by loadRecipes() into this module-level cache.
export let RECIPES: Record<string, { materialId: string; quantityNeeded: number }[]> = {};

// Generates a real UUID v4 client-side so every new record's `id` matches
// the `uuid` column type used across all Supabase tables.
export const generateId = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Fallback (older environments without crypto.randomUUID)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export const getInventory = (): InventoryItem[] => getStorageItem('erp_inventory', []);
export const getVendors = (): Vendor[] => getStorageItem('erp_vendors', []);
export const getContacts = (): Contact[] => getStorageItem('erp_contacts', []);
export const getSalesOrders = (): SalesOrder[] => getStorageItem('erp_sales_orders', []);
export const getPurchaseOrders = (): PurchaseOrder[] => getStorageItem('erp_purchase_orders', []);
// ─── Base mutations: write localStorage + fire targeted Supabase ops ─────────
// Each saver accepts the full in-memory array (for localStorage) plus the
// specific changed/deleted record so Supabase only touches that one row.

export const saveInventory = async (items: InventoryItem[], changed?: InventoryItem, deletedId?: string) => {
  setStorageItem('erp_inventory', items);
  if (changed) await upsertRecord('erp_inventory', changed);
  if (deletedId) await deleteRecord('erp_inventory', deletedId);
};
// Contacts are always scoped to (and fetched per) a single vendor/client via
// useTableData filters, so unlike the other savers here there's no full-list
// localStorage cache to keep in sync - each call just upserts/deletes one row.
export const saveContact = async (contact: Contact) => upsertRecord('erp_contacts', contact);
export const deleteContact = async (id: string) => deleteRecord('erp_contacts', id);
export const saveSalesOrders = async (items: SalesOrder[], changed?: SalesOrder, deletedId?: string) => {
  setStorageItem('erp_sales_orders', items);
  if (changed) await upsertRecord('erp_sales_orders', changed);
  if (deletedId) await deleteRecord('erp_sales_orders', deletedId);
};
export const savePurchaseOrders = async (items: PurchaseOrder[], changed?: PurchaseOrder, deletedId?: string) => {
  setStorageItem('erp_purchase_orders', items);
  if (changed) await upsertRecord('erp_purchase_orders', changed);
  if (deletedId) await deleteRecord('erp_purchase_orders', deletedId);
};

// Trackability (non-trackable/cost-only categories) was removed along with
// the old Product/Inventory Category split. All inventory is now trackable.
export const getTrackableInventory = (): InventoryItem[] => {
  return getInventory();
};

// Complex manufacturing triggers and actions

/**
 * Creates a new Purchase Order.
 * If status is immediately RECEIVED or transitioned to RECEIVED, raw stock increases.
 */
export const addPurchaseOrder = (po: Omit<PurchaseOrder, 'id' | 'orderDate' | 'totalCost'> & { items?: PurchaseOrderItem[] }): PurchaseOrder => {
  const pos = getPurchaseOrders();

  const items = po.items && po.items.length > 0 ? po.items : [{
    itemId: po.itemId,
    itemName: po.itemName,
    quantity: po.quantity,
    unitCost: po.unitCost,
    totalCost: po.quantity * po.unitCost
  }];

  const totalCost = items.reduce((sum, item) => sum + item.totalCost, 0);

  const newPo: PurchaseOrder = {
    ...po,
    id: generateId(),
    orderDate: new Date().toISOString().split('T')[0],
    itemId: items[0].itemId,
    itemName: items[0].itemName,
    quantity: items[0].quantity,
    unitCost: items[0].unitCost,
    totalCost,
    items
  };

  pos.push(newPo);
  savePurchaseOrders(pos, newPo);

  if (newPo.status === 'RECEIVED') {
    items.forEach(item => {
      adjustRawMaterialStock(item.itemId, item.quantity);
    });
  }

  return newPo;
};

export const updatePurchaseOrderStatus = (poId: string, status: PurchaseOrder['status']): PurchaseOrder | null => {
  const pos = getPurchaseOrders();
  const index = pos.findIndex(p => p.id === poId);
  if (index === -1) return null;

  const previousStatus = pos[index].status;
  const currentPo = pos[index];

  const items = currentPo.items && currentPo.items.length > 0 ? currentPo.items : [{
    itemId: currentPo.itemId,
    itemName: currentPo.itemName,
    quantity: currentPo.quantity,
    unitCost: currentPo.unitCost,
    totalCost: currentPo.totalCost
  }];

  if (status === 'RECEIVED') {
    currentPo.receivedDate = new Date().toISOString().split('T')[0];
    // If it was not already received, add to stock!
    if (previousStatus !== 'RECEIVED') {
      items.forEach(item => {
        adjustRawMaterialStock(item.itemId, item.quantity);
      });
    }
  } else if (previousStatus === 'RECEIVED') {
    // Revert stock adjustment if changed back
    items.forEach(item => {
      adjustRawMaterialStock(item.itemId, -item.quantity);
    });
    currentPo.receivedDate = undefined;
  }

  currentPo.status = status;
  savePurchaseOrders(pos, currentPo);
  return currentPo;
};

/**
 * Creates a Sales Order.
 */
export const addSalesOrder = (so: Omit<SalesOrder, 'id' | 'orderDate' | 'totalPrice'> & { items?: SalesOrderItem[] }): SalesOrder => {
  const sos = getSalesOrders();

  const items = so.items && so.items.length > 0 ? so.items : [{
    itemId: so.itemId,
    itemName: so.itemName,
    quantity: so.quantity,
    unitPrice: so.unitPrice,
    totalPrice: so.quantity * so.unitPrice
  }];

  const totalPrice = items.reduce((sum, item) => sum + item.totalPrice, 0);

  const newSo: SalesOrder = {
    ...so,
    id: generateId(),
    orderDate: new Date().toISOString().split('T')[0],
    itemId: items[0].itemId,
    itemName: items[0].itemName,
    quantity: items[0].quantity,
    unitPrice: items[0].unitPrice,
    totalPrice,
    items
  };

  sos.push(newSo);
  saveSalesOrders(sos, newSo);

  // NOTE: Client no longer tracks a stored totalOrdersValue metric (dropped
  // in the vendor/client restructure) - order value per client can be
  // derived on demand from sales_orders if a rollup is needed again later.

  return newSo;
};

export const updateSalesOrderStatus = (soId: string, status: SalesOrder['status']): SalesOrder | null => {
  const sos = getSalesOrders();
  const index = sos.findIndex(s => s.id === soId);
  if (index === -1) return null;

  sos[index].status = status;
  const currentSo = sos[index];

  saveSalesOrders(sos, currentSo);
  return currentSo;
};

const adjustRawMaterialStock = (materialId: string, quantityChange: number) => {
  const inventory = getInventory();
  const idx = inventory.findIndex(i => i.id === materialId);
  if (idx !== -1) {
    inventory[idx].quantity = Math.max(0, inventory[idx].quantity + quantityChange);
    saveInventory(inventory, inventory[idx]);
  }
};

// Basic metrics and stats
export const getDashboardStats = (): DashboardStats => {
  const inventory = getTrackableInventory();
  const sos = getSalesOrders();
  const pos = getPurchaseOrders();

  const totalSales = sos
    .filter(s => s.status !== 'CANCELLED')
    .reduce((sum, s) => sum + s.totalPrice, 0);

  const totalPurchaseCosts = pos
    .filter(p => p.status === 'RECEIVED')
    .reduce((sum, p) => sum + p.totalCost, 0);

  const inventoryValuation = inventory.reduce((sum, item) => sum + (item.quantity * item.unitCost), 0);
  const lowStockCount = inventory.filter(item => item.quantity <= item.reorderPoint).length;
  const pendingOrdersCount = sos.filter(s => s.status === 'PENDING').length;

  return {
    totalSales,
    totalPurchaseCosts,
    totalProfit: totalSales - totalPurchaseCosts,
    inventoryValuation,
    lowStockCount,
    pendingOrdersCount,
    // Recomputed by the caller from WorkflowsService.getWorkflowTasks() —
    // the old workflow_tasks shape this used to read no longer exists.
    activeWorkflowsCount: 0
  };
};

// ─── Per-tab lazy loaders ───────────────────────────────────────────────────
// Each view calls its own loader; data is cached in localStorage after first
// fetch so subsequent tab visits are instant (no network round-trip).

const isTabLoaded = (key: string): boolean => !!localStorage.getItem(key);

// const loadTable = async (lsKey: string, tableName: string) => {
//   if (isTabLoaded(lsKey)) return; // already cached, skip
//   await loadTableProgressively(lsKey, tableName);
// };

export const loadInventoryData = () => loadTable('erp_inventory', 'inventory_items');
export const loadVendorsData = () => loadTable('erp_vendors', 'vendors');
export const loadClientsData = () => loadTable('erp_clients', 'clients');
export const loadEmployeesData = () => loadTable('erp_employees', 'employees');
export const loadSalesOrdersData = () => loadTable('erp_sales_orders', 'sales_orders');
export const loadPurchaseOrdersData = () => loadTable('erp_purchase_orders', 'purchase_orders');

// Contacts tab = vendors + clients
export const loadContactsData = () => Promise.all([
  loadTable('erp_vendors', 'vendors'),
  loadTable('erp_clients', 'clients')
]);

// Dashboard needs a snapshot of everything for stats — load all in parallel
export const loadDashboardData = () => Promise.all([
  loadTable('erp_inventory', 'inventory_items'),
  loadTable('erp_sales_orders', 'sales_orders'),
  loadTable('erp_purchase_orders', 'purchase_orders')
]);

// Row-shape mappers, keyed by localStorage key (same table set as before)
const ROW_MAPPERS: Record<string, (row: any) => any> = {
  erp_inventory: (i) => ({
    id: i.id, name: i.name, sku: i.sku, type: i.type,
    materialCategoryId: i.material_category_id,
    productCategoryId: i.product_category_id,
    quantity: Number(i.quantity),
    unit: i.unit,
    unitCost: Number(i.unit_cost),
    reorderPoint: Number(i.reorder_point),
    supplierId: i.supplier_id,
    description: i.description,
    attachments: i.attachments || [],
    createdAt: i.created_at,
    updatedAt: i.updated_at
  }),
  erp_vendors: (v) => ({
    id: v.id, companyName: v.company_name, email: v.email, officeNo: v.office_no,
    address: v.address, description: v.description || '',
    attachments: v.attachments || [],
    createdAt: v.created_at, updatedAt: v.updated_at
  }),
  erp_clients: (c) => ({
    id: c.id, companyName: c.company_name, email: c.email, officeNo: c.office_no,
    address: c.address, description: c.description || '',
    attachments: c.attachments || [],
    createdAt: c.created_at, updatedAt: c.updated_at
  }),
  erp_contacts: (p) => ({
    id: p.id, fullName: p.full_name, contactNo: p.contact_no, email: p.email,
    jobPositionId: p.job_position, vendorId: p.vendor_id, clientId: p.client_id,
    attachments: p.attachments || [],
    createdAt: p.created_at, updatedAt: p.updated_at
  }),
  erp_sales_orders: (o) => ({
    id: o.id, clientId: o.client_id, clientName: o.client_name, itemId: o.item_id,
    itemName: o.item_name, quantity: Number(o.quantity), unitPrice: Number(o.unit_price),
    totalPrice: Number(o.total_price), orderDate: o.order_date, deliveryDate: o.delivery_date,
    status: o.status, workflowTaskId: o.workflow_task_id,
    attachments: o.attachments || [], items: o.items || [],
    createdAt: o.created_at, updatedAt: o.updated_at
  }),
  erp_purchase_orders: (o) => ({
    id: o.id, vendorId: o.vendor_id, vendorName: o.vendor_name, itemId: o.item_id,
    itemName: o.item_name, quantity: Number(o.quantity), unitCost: Number(o.unit_cost),
    totalCost: Number(o.total_cost), orderDate: o.order_date, status: o.status,
    receivedDate: o.received_date, attachments: o.attachments || [], items: o.items || [],
    createdAt: o.created_at, updatedAt: o.updated_at
  }),
  erp_employees: (e) => ({
    id: e.id, name: e.name, role: e.role, status: e.status,
    email: e.email, phone: e.phone,
    createdAt: e.created_at, updatedAt: e.updated_at
  }),
  erp_job_positions: (p) => ({
    id: p.id, name: p.name, isActive: p.is_active ?? true,
    createdAt: p.created_at, updatedAt: p.updated_at
  }),
  erp_material_categories: (c) => ({
    id: c.id, name: c.name, isActive: c.is_active ?? true,
    createdAt: c.created_at, updatedAt: c.updated_at
  }),
  erp_product_categories: (c) => ({
    id: c.id, name: c.name, isActive: c.is_active ?? true,
    createdAt: c.created_at, updatedAt: c.updated_at
  }),
};

const TABLE_MAP: Record<string, string> = {
  'erp_inventory': 'inventory_items',
  'erp_vendors': 'vendors',
  'erp_clients': 'clients',
  'erp_contacts': 'contacts',
  'erp_sales_orders': 'sales_orders',
  'erp_purchase_orders': 'purchase_orders',
  'erp_employees': 'employees'
};

interface DataResponse {
  data: any[];
  total: number;
  hasMore: boolean;
}

// Fetches the full table via the backend endpoint.
// NOTE: limit/offset pagination was rolled back here (it was causing bugs) -
// this now always fetches the whole table in one request, same as useTableData.ts.
const fetchAllRows = async (table: string): Promise<DataResponse> => {
  const res = await fetch(`/api/data/${table}`);
  if (!res.ok) throw new Error(`Failed to fetch ${table}: ${res.status}`);
  return res.json();
};

// Loads a table's full contents into localStorage in one shot.
const loadTableProgressively = async (key: string, tableName: string) => {
  const mapper = ROW_MAPPERS[key] || ((r: any) => r);
  const result = await fetchAllRows(tableName);
  const rows = (result.data || []).map(mapper);
  if (rows.length > 0) {
    localStorage.setItem(key, JSON.stringify(rows));
  }
};