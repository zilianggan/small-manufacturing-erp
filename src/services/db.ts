import { supabase } from './supabase';
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

import { InventoryItem, Vendor, Client, SalesOrder, PurchaseOrder, WorkflowTask, DashboardStats, CompanyProfile, Employee, SalesOrderItem, PurchaseOrderItem } from '../types';

// RECIPES: loaded dynamically from Supabase (no hardcoded values).
// Populated at runtime by loadRecipes() into this module-level cache.
export let RECIPES: Record<string, { materialId: string; quantityNeeded: number }[]> = {};

// Helper to retrieve from LocalStorage (Supabase is source of truth; no seed fallbacks)
const getStorageItem = <T>(key: string, defaultValue: T): T => {
  const data = localStorage.getItem(key);
  if (!data) return defaultValue;
  return JSON.parse(data);
};

// ─── Row serialisers: camelCase entity → snake_case DB row ──────────────────
const toDbRow: Record<string, (item: any) => any> = {
  erp_inventory: (i) => ({
    id: i.id, name: i.name, sku: i.sku, type: i.type,
    quantity: i.quantity, unit: i.unit, unit_cost: i.unitCost,
    reorder_point: i.reorderPoint, supplier_id: i.supplierId,
    description: i.description, attachments: i.attachments || []
  }),
  erp_vendors: (v) => ({
    id: v.id, name: v.name, contact_name: v.contactName,
    email: v.email, phone: v.phone,
    materials_supplied: v.materialsSupplied || [],
    address: v.address, rating: v.rating, attachments: v.attachments || []
  }),
  erp_clients: (c) => ({
    id: c.id, name: c.name, contact_name: c.contactName,
    email: c.email, phone: c.phone, company_name: c.companyName,
    address: c.address, total_orders_value: c.totalOrdersValue,
    attachments: c.attachments || []
  }),
  erp_sales_orders: (o) => ({
    id: o.id, client_id: o.clientId, client_name: o.clientName,
    item_id: o.itemId, item_name: o.itemName,
    quantity: o.quantity, unit_price: o.unitPrice, total_price: o.totalPrice,
    order_date: o.orderDate, delivery_date: o.deliveryDate,
    status: o.status, workflow_task_id: o.workflowTaskId,
    attachments: o.attachments || [], items: o.items || []
  }),
  erp_purchase_orders: (o) => ({
    id: o.id, vendor_id: o.vendorId, vendor_name: o.vendorName,
    item_id: o.itemId, item_name: o.itemName,
    quantity: o.quantity, unit_cost: o.unitCost, total_cost: o.totalCost,
    order_date: o.orderDate, status: o.status, received_date: o.receivedDate,
    attachments: o.attachments || [], items: o.items || []
  }),
  erp_workflow_tasks: (t) => ({
    id: t.id, order_id: t.orderId, product_name: t.productName,
    quantity: t.quantity, current_step: t.currentStep,
    assigned_to: t.assignedTo, start_date: t.startDate,
    end_date: t.endDate, notes: t.notes
  }),
  erp_employees: (e) => ({
    id: e.id, name: e.name, role: e.role, department: e.department,
    status: e.status, email: e.email, phone: e.phone
  }),
};

const LS_TO_TABLE: Record<string, string> = {
  erp_inventory: 'inventory_items',
  erp_vendors: 'vendors',
  erp_clients: 'clients',
  erp_sales_orders: 'sales_orders',
  erp_purchase_orders: 'purchase_orders',
  erp_workflow_tasks: 'workflow_tasks',
  erp_employees: 'employees',
};

/**
 * Upsert a SINGLE record to Supabase — only that row's updated_at changes.
 */
const upsertRecord = async (lsKey: string, item: any): Promise<void> => {
  const tableName = LS_TO_TABLE[lsKey];
  if (!tableName) return;
  const serialiser = toDbRow[lsKey];
  if (!serialiser) return;
  const row = serialiser(item);
  const { error } = await supabase.from(tableName).upsert(row);
  if (error) console.error(`upsertRecord(${tableName}) error:`, error);
};

/**
 * Delete a SINGLE record from Supabase by id.
 */
const deleteRecord = async (lsKey: string, id: string): Promise<void> => {
  const tableName = LS_TO_TABLE[lsKey];
  if (!tableName) return;
  const { error } = await supabase.from(tableName).delete().eq('id', id);
  if (error) console.error(`deleteRecord(${tableName}) error:`, error);
};

const setStorageItem = <T>(key: string, value: T): void => {
  localStorage.setItem(key, JSON.stringify(value));
  // NOTE: Supabase writes are now done per-record via upsertRecord / deleteRecord
  // called directly from each mutation function. setStorageItem no longer does
  // bulk upserts so unrelated rows never get their updated_at touched.
};

export const getInventory = (): InventoryItem[] => getStorageItem('erp_inventory', []);
export const getVendors = (): Vendor[] => getStorageItem('erp_vendors', []);
export const getClients = (): Client[] => getStorageItem('erp_clients', []);
export const getSalesOrders = (): SalesOrder[] => getStorageItem('erp_sales_orders', []);
export const getPurchaseOrders = (): PurchaseOrder[] => getStorageItem('erp_purchase_orders', []);
export const getWorkflowTasks = (): WorkflowTask[] => {
  const tasks = getStorageItem<WorkflowTask[]>('erp_workflow_tasks', []);

  // Migration to split concatenated tasks
  let migrated = false;
  const newTasks: WorkflowTask[] = [];
  tasks.forEach(task => {
    if (task.productName && task.productName.includes(',')) {
      migrated = true;
      const parts = task.productName.split(',').map(p => p.trim());
      parts.forEach((part, index) => {
        const match = part.match(/^(\d+)x\s+(.*)$/);
        let qty = task.quantity;
        let name = part;
        if (match) {
          qty = parseInt(match[1], 10) || task.quantity;
          name = match[2];
        }
        newTasks.push({
          ...task,
          id: `${task.id}-${index}`,
          productName: name,
          quantity: qty,
        });
      });
    } else {
      newTasks.push(task);
    }
  });

  if (migrated) {
    setStorageItem('erp_workflow_tasks', newTasks);
    return newTasks;
  }

  return tasks;
};

// ─── Base mutations: write localStorage + fire targeted Supabase ops ─────────
// Each saver accepts the full in-memory array (for localStorage) plus the
// specific changed/deleted record so Supabase only touches that one row.

export const saveInventory = (items: InventoryItem[], changed?: InventoryItem, deletedId?: string) => {
  setStorageItem('erp_inventory', items);
  if (changed) upsertRecord('erp_inventory', changed);
  if (deletedId) deleteRecord('erp_inventory', deletedId);
};
export const saveVendors = (items: Vendor[], changed?: Vendor, deletedId?: string) => {
  setStorageItem('erp_vendors', items);
  if (changed) upsertRecord('erp_vendors', changed);
  if (deletedId) deleteRecord('erp_vendors', deletedId);
};
export const saveClients = (items: Client[], changed?: Client, deletedId?: string) => {
  setStorageItem('erp_clients', items);
  if (changed) upsertRecord('erp_clients', changed);
  if (deletedId) deleteRecord('erp_clients', deletedId);
};
export const saveSalesOrders = (items: SalesOrder[], changed?: SalesOrder, deletedId?: string) => {
  setStorageItem('erp_sales_orders', items);
  if (changed) upsertRecord('erp_sales_orders', changed);
  if (deletedId) deleteRecord('erp_sales_orders', deletedId);
};
export const savePurchaseOrders = (items: PurchaseOrder[], changed?: PurchaseOrder, deletedId?: string) => {
  setStorageItem('erp_purchase_orders', items);
  if (changed) upsertRecord('erp_purchase_orders', changed);
  if (deletedId) deleteRecord('erp_purchase_orders', deletedId);
};
export const saveWorkflowTasks = async (items: WorkflowTask[], changed?: WorkflowTask, deletedId?: string) => {
  setStorageItem('erp_workflow_tasks', items);
  if (changed) await upsertRecord('erp_workflow_tasks', changed);
  if (deletedId) await deleteRecord('erp_workflow_tasks', deletedId);
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
    id: `po-${Date.now()}`,
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
 * If transitioned to IN_PRODUCTION, creates a WorkflowTask automatically.
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
    id: `so-${Date.now()}`,
    orderDate: new Date().toISOString().split('T')[0],
    itemId: items[0].itemId,
    itemName: items[0].itemName,
    quantity: items[0].quantity,
    unitPrice: items[0].unitPrice,
    totalPrice,
    items
  };

  if (newSo.status === 'IN_PRODUCTION') {
    items.forEach((item, index) => {
      createWorkflowTaskForOrder(newSo.id, item.itemName, item.quantity);
    });
  }

  sos.push(newSo);
  saveSalesOrders(sos, newSo);

  // Update client metrics
  const clients = getClients();
  const clientIdx = clients.findIndex(c => c.id === so.clientId);
  if (clientIdx !== -1) {
    clients[clientIdx].totalOrdersValue += newSo.totalPrice;
    saveClients(clients, clients[clientIdx]);
  }

  return newSo;
};

export const updateSalesOrderStatus = (soId: string, status: SalesOrder['status']): SalesOrder | null => {
  const sos = getSalesOrders();
  const index = sos.findIndex(s => s.id === soId);
  if (index === -1) return null;

  const previousStatus = sos[index].status;
  sos[index].status = status;
  const currentSo = sos[index];

  // Trigger workflow task creation if moving to IN_PRODUCTION and doesn't exist
  if (status === 'IN_PRODUCTION' && previousStatus !== 'IN_PRODUCTION' && !currentSo.workflowTaskId) {
    const items = currentSo.items && currentSo.items.length > 0 ? currentSo.items : [{
      itemId: currentSo.itemId,
      itemName: currentSo.itemName,
      quantity: currentSo.quantity,
      unitPrice: currentSo.unitPrice,
      totalPrice: currentSo.totalPrice
    }];

    items.forEach((item, index) => {
      createWorkflowTaskForOrder(currentSo.id, item.itemName, item.quantity);
    });
    // Just flag that it has tasks created
    currentSo.workflowTaskId = 'created';
  }

  saveSalesOrders(sos, currentSo);
  return currentSo;
};

/**
 * Helper to update workflow step.
 * If step becomes COMPLETED, we:
 * 1. Increment the finished goods inventory level.
 * 2. Subtract required raw materials (based on RECIPES).
 * 3. Transition Sales Order status to SHIPPED.
 */
export const updateWorkflowStep = async (taskId: string, step: WorkflowTask['currentStep'], notes?: string): Promise<WorkflowTask | null> => {
  const tasks = getWorkflowTasks();
  const index = tasks.findIndex(t => t.id === taskId);
  if (index === -1) return null;

  const previousStep = tasks[index].currentStep;
  tasks[index].currentStep = step;
  if (notes !== undefined) {
    tasks[index].notes = notes;
  }

  if (step === 'COMPLETED' && previousStep !== 'COMPLETED') {
    tasks[index].endDate = new Date().toISOString().split('T')[0];

    // Find the associated Sales Order
    const sos = getSalesOrders();
    const soIdx = sos.findIndex(s => s.id === tasks[index].orderId);
    if (soIdx !== -1) {
      sos[soIdx].status = 'SHIPPED'; // Automatically ready to ship or shipped
      saveSalesOrders(sos, sos[soIdx]);

      // Perform manufacturing inventory transformations!
      const items = sos[soIdx].items && sos[soIdx].items.length > 0 ? sos[soIdx].items : [{
        itemId: sos[soIdx].itemId,
        itemName: sos[soIdx].itemName,
        quantity: sos[soIdx].quantity,
        unitPrice: sos[soIdx].unitPrice,
        totalPrice: sos[soIdx].totalPrice
      }];

      items.forEach(item => {
        // 1. Increment Finished Good Stock
        adjustFinishedGoodStock(item.itemId, item.quantity);

        // 2. Decrement Raw Materials Stock based on Recipes
        consumeRawMaterials(item.itemId, item.quantity);
      });
    }
  } else if (previousStep === 'COMPLETED' && step !== 'COMPLETED') {
    // Revert inventory transformations if completed by mistake
    const sos = getSalesOrders();
    const soIdx = sos.findIndex(s => s.id === tasks[index].orderId);
    if (soIdx !== -1) {
      sos[soIdx].status = 'IN_PRODUCTION';
      saveSalesOrders(sos, sos[soIdx]);

      const items = sos[soIdx].items && sos[soIdx].items.length > 0 ? sos[soIdx].items : [{
        itemId: sos[soIdx].itemId,
        itemName: sos[soIdx].itemName,
        quantity: sos[soIdx].quantity,
        unitPrice: sos[soIdx].unitPrice,
        totalPrice: sos[soIdx].totalPrice
      }];

      items.forEach(item => {
        adjustFinishedGoodStock(item.itemId, -item.quantity);
        consumeRawMaterials(item.itemId, -item.quantity); // Reverse decrement (i.e. put back raw materials)
      });
    }
    tasks[index].endDate = undefined;
  }

  await saveWorkflowTasks(tasks, tasks[index]);
  return tasks[index];
};

// Raw Material consumption
const consumeRawMaterials = (finishedGoodId: string, quantityProduced: number) => {
  const recipe = RECIPES[finishedGoodGoodMapping(finishedGoodId)];
  if (!recipe) return;

  const inventory = getInventory();
  const changedItems: InventoryItem[] = [];
  recipe.forEach(requirement => {
    const itemIdx = inventory.findIndex(i => i.id === requirement.materialId);
    if (itemIdx !== -1) {
      inventory[itemIdx].quantity = Math.max(0, inventory[itemIdx].quantity - (requirement.quantityNeeded * quantityProduced));
      changedItems.push(inventory[itemIdx]);
    }
  });
  // upsert each affected raw material individually
  setStorageItem('erp_inventory', inventory);
  changedItems.forEach(item => upsertRecord('erp_inventory', item));
};

// Map item id to recipe key (id is already the key in RECIPES)
const finishedGoodGoodMapping = (id: string): string => id;

const adjustRawMaterialStock = (materialId: string, quantityChange: number) => {
  const inventory = getInventory();
  const idx = inventory.findIndex(i => i.id === materialId);
  if (idx !== -1) {
    inventory[idx].quantity = Math.max(0, inventory[idx].quantity + quantityChange);
    saveInventory(inventory, inventory[idx]);
  }
};

const adjustFinishedGoodStock = (fgId: string, quantityChange: number) => {
  const inventory = getInventory();
  const idx = inventory.findIndex(i => i.id === fgId || i.sku === fgId);
  if (idx !== -1) {
    inventory[idx].quantity = Math.max(0, inventory[idx].quantity + quantityChange);
    saveInventory(inventory, inventory[idx]);
  }
};

const createWorkflowTaskForOrder = (orderId: string, productName: string, quantity: number): WorkflowTask => {
  const tasks = getWorkflowTasks();
  const newTask: WorkflowTask = {
    id: `wf-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    orderId,
    productName,
    quantity,
    currentStep: 'PREPARATION',
    startDate: new Date().toISOString().split('T')[0],
    notes: 'Auto-initiated workflow task from sales order.'
  };
  tasks.push(newTask);
  saveWorkflowTasks(tasks, newTask);
  return newTask;
};

// Basic metrics and stats
export const getDashboardStats = (): DashboardStats => {
  const inventory = getInventory();
  const sos = getSalesOrders();
  const pos = getPurchaseOrders();
  const workflows = getWorkflowTasks();

  const totalSales = sos
    .filter(s => s.status !== 'CANCELLED')
    .reduce((sum, s) => sum + s.totalPrice, 0);

  const totalPurchaseCosts = pos
    .filter(p => p.status === 'RECEIVED')
    .reduce((sum, p) => sum + p.totalCost, 0);

  const inventoryValuation = inventory.reduce((sum, item) => sum + (item.quantity * item.unitCost), 0);
  const lowStockCount = inventory.filter(item => item.quantity <= item.reorderPoint).length;
  const pendingOrdersCount = sos.filter(s => s.status === 'PENDING').length;
  const activeWorkflowsCount = workflows.filter(w => w.currentStep !== 'COMPLETED').length;

  return {
    totalSales,
    totalPurchaseCosts,
    totalProfit: totalSales - totalPurchaseCosts,
    inventoryValuation,
    lowStockCount,
    pendingOrdersCount,
    activeWorkflowsCount
  };
};

const EMPTY_COMPANY_PROFILE: CompanyProfile = { name: '', iconType: 'database' };

export const getCompanyProfile = (): CompanyProfile => {
  return getStorageItem('erp_company_profile', EMPTY_COMPANY_PROFILE);
};

export const saveCompanyProfile = (profile: CompanyProfile): void => {
  setStorageItem('erp_company_profile', profile);
};

// --- Employees database ---
export const getEmployees = (): Employee[] => getStorageItem('erp_employees', []);

export const saveEmployees = (employees: Employee[], changed?: Employee, deletedId?: string): void => {
  setStorageItem('erp_employees', employees);
  if (changed) upsertRecord('erp_employees', changed);
  if (deletedId) deleteRecord('erp_employees', deletedId);
};



// ─── Per-tab lazy loaders ───────────────────────────────────────────────────
// Each view calls its own loader; data is cached in localStorage after first
// fetch so subsequent tab visits are instant (no network round-trip).

const isTabLoaded = (key: string): boolean => !!localStorage.getItem(key);

const loadTable = async (lsKey: string, tableName: string) => {
  if (isTabLoaded(lsKey)) return; // already cached, skip
  await loadTableProgressively(lsKey, tableName);
};

export const loadInventoryData = () => loadTable('erp_inventory', 'inventory_items');
export const loadVendorsData = () => loadTable('erp_vendors', 'vendors');
export const loadClientsData = () => loadTable('erp_clients', 'clients');
export const loadEmployeesData = () => loadTable('erp_employees', 'employees');
export const loadSalesOrdersData = () => loadTable('erp_sales_orders', 'sales_orders');
export const loadPurchaseOrdersData = () => loadTable('erp_purchase_orders', 'purchase_orders');
export const loadWorkflowsData = () => loadTable('erp_workflow_tasks', 'workflow_tasks');

// Contacts tab = vendors + clients
export const loadContactsData = () => Promise.all([
  loadTable('erp_vendors', 'vendors'),
  loadTable('erp_clients', 'clients')
]);

// Dashboard needs a snapshot of everything for stats — load all in parallel
export const loadDashboardData = () => Promise.all([
  loadTable('erp_inventory', 'inventory_items'),
  loadTable('erp_sales_orders', 'sales_orders'),
  loadTable('erp_purchase_orders', 'purchase_orders'),
  loadTable('erp_workflow_tasks', 'workflow_tasks')
]);

// Row-shape mappers, keyed by localStorage key (same table set as before)
const ROW_MAPPERS: Record<string, (row: any) => any> = {
  erp_inventory: (i) => ({
    id: i.id, name: i.name, sku: i.sku, type: i.type,
    quantity: Number(i.quantity), unit: i.unit, unitCost: Number(i.unit_cost),
    reorderPoint: Number(i.reorder_point), supplierId: i.supplier_id,
    description: i.description, attachments: i.attachments || [],
    createdAt: i.created_at, updatedAt: i.updated_at
  }),
  erp_vendors: (v) => ({
    id: v.id, name: v.name, contactName: v.contact_name, email: v.email, phone: v.phone,
    materialsSupplied: v.materials_supplied || [], address: v.address,
    rating: Number(v.rating), attachments: v.attachments || [],
    createdAt: v.created_at, updatedAt: v.updated_at
  }),
  erp_clients: (c) => ({
    id: c.id, name: c.name, contactName: c.contact_name, email: c.email, phone: c.phone,
    companyName: c.company_name, address: c.address,
    totalOrdersValue: Number(c.total_orders_value), attachments: c.attachments || [],
    createdAt: c.created_at, updatedAt: c.updated_at
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
  erp_workflow_tasks: (t) => ({
    id: t.id, orderId: t.order_id, productName: t.product_name, quantity: Number(t.quantity),
    currentStep: t.current_step, assignedTo: t.assigned_to, startDate: t.start_date,
    endDate: t.end_date, notes: t.notes,
    createdAt: t.created_at, updatedAt: t.updated_at
  }),
  erp_employees: (e) => ({
    id: e.id, name: e.name, role: e.role, department: e.department, status: e.status,
    email: e.email, phone: e.phone,
    createdAt: e.created_at, updatedAt: e.updated_at
  }),
};

const TABLE_MAP: Record<string, string> = {
  'erp_inventory': 'inventory_items',
  'erp_vendors': 'vendors',
  'erp_clients': 'clients',
  'erp_sales_orders': 'sales_orders',
  'erp_purchase_orders': 'purchase_orders',
  'erp_workflow_tasks': 'workflow_tasks',
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

export const loadInitialDataFromSupabase = async () => {
  useSyncStore.getState().setSyncing(true);
  try {
    // Load all tables in parallel for fast startup.
    await Promise.all(
      Object.entries(TABLE_MAP).map(([key, tableName]) => loadTableProgressively(key, tableName))
    );

    // profile (single row, no pagination needed)
    const { data: profileData } = await supabase.from('company_profile').select('*').eq('id', 'default').single();
    if (profileData) {
      localStorage.setItem('erp_company_profile', JSON.stringify({
        name: profileData.name,
        iconType: profileData.icon_type,
        iconDataUrl: profileData.icon_data_url,
        address: profileData.address,
        phone: profileData.phone,
        email: profileData.email,
        bankName: profileData.bank_name,
        bankAccount: profileData.bank_account,
        signatureUrl: profileData.signature_url,
        chopUrl: profileData.chop_url
      }));
    }
  } catch (err) {
    console.error("Initial load error", err);
  } finally {
    useSyncStore.getState().setSyncing(false);
  }
};
