import { supabase } from './supabase';
import { create } from 'zustand';

export const useSyncStore = create((set) => ({ isSyncing: false, setSyncing: (val) => set({ isSyncing: val }) }));
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { InventoryItem, Vendor, Client, SalesOrder, PurchaseOrder, WorkflowTask, DashboardStats, CompanyProfile, Employee, SalesOrderItem, PurchaseOrderItem } from '../types';

// Let's define the ingredients (Recipe) for each Finished Good
// This lets us automatically subtract raw materials when a production run finishes!
export const RECIPES: Record<string, { materialId: string; quantityNeeded: number }[]> = {
  'fg-1': [ // Precision Gearbox Assembly
    { materialId: 'rm-1', quantityNeeded: 0.05 }, // Steel Billets (tons)
    { materialId: 'rm-2', quantityNeeded: 4 },    // Industrial Ball Bearings (pcs)
    { materialId: 'rm-3', quantityNeeded: 2 },    // Machining Coolant & Lubricant (liters)
    { materialId: 'rm-4', quantityNeeded: 12 }    // High-Tensile Bolts (pcs)
  ],
  'fg-2': [ // Machined Steel Shaft
    { materialId: 'rm-1', quantityNeeded: 0.02 }, // Steel Billets (tons)
    { materialId: 'rm-3', quantityNeeded: 1 }     // Machining Coolant & Lubricant (liters)
  ],
  'fg-3': [ // Hydraulic Cylinder Unit
    { materialId: 'rm-1', quantityNeeded: 0.1 },  // Steel Billets (tons)
    { materialId: 'rm-2', quantityNeeded: 2 },    // Industrial Ball Bearings (pcs)
    { materialId: 'rm-3', quantityNeeded: 3 },    // Machining Coolant & Lubricant (liters)
    { materialId: 'rm-4', quantityNeeded: 8 },    // High-Tensile Bolts (pcs)
    { materialId: 'rm-5', quantityNeeded: 1 }     // Hydraulic Seals Kit (sets)
  ]
};

// Seed Data
const initialInventory: InventoryItem[] = [
  // Raw Materials
  { id: 'rm-1', name: 'Premium Steel Billets', sku: 'RM-SBLT-01', type: 'RAW_MATERIAL', quantity: 25, unit: 'tons', unitCost: 1200, reorderPoint: 5, supplierId: 'v-1', description: 'High-quality industrial carbon steel billets for precision hot forging and machining.' },
  { id: 'rm-2', name: 'Industrial Ball Bearings', sku: 'RM-BRNG-02', type: 'RAW_MATERIAL', quantity: 180, unit: 'pcs', unitCost: 25, reorderPoint: 40, supplierId: 'v-2', description: 'Deep groove heavy-duty radial ball bearings with reinforced chrome steel shields.' },
  { id: 'rm-3', name: 'CNC Coolant & Lubricant', sku: 'RM-COOL-03', type: 'RAW_MATERIAL', quantity: 120, unit: 'liters', unitCost: 15, reorderPoint: 20, supplierId: 'v-3', description: 'Soluble cutting oil fluid for optimal thermal stabilization during high-speed CNC milling.' },
  { id: 'rm-4', name: 'High-Tensile Bolts (M12)', sku: 'RM-BLT-04', type: 'RAW_MATERIAL', quantity: 1500, unit: 'pcs', unitCost: 1.5, reorderPoint: 200, supplierId: 'v-2', description: 'Grade 10.9 zinc plated high-tensile structural hexagon flange fastening bolts.' },
  { id: 'rm-5', name: 'Hydraulic Seal Kits', sku: 'RM-SEAL-05', type: 'RAW_MATERIAL', quantity: 45, unit: 'sets', unitCost: 45, reorderPoint: 15, supplierId: 'v-3', description: 'Double-acting nitrile rubber piston seal kits with polyurethane wear rings.' },

  // Finished Goods
  { id: 'fg-1', name: 'Precision Gearbox Assembly', sku: 'FG-GRBX-01', type: 'FINISHED_GOOD', quantity: 12, unit: 'pcs', unitCost: 450, reorderPoint: 5, supplierId: undefined, description: 'Dual-reduction inline helical gearbox with high torque transfer capacity.' },
  { id: 'fg-2', name: 'Machined Steel Shaft', sku: 'FG-SHFT-02', type: 'FINISHED_GOOD', quantity: 24, unit: 'pcs', unitCost: 180, reorderPoint: 10, supplierId: undefined, description: 'Micro-polished balanced carbon steel drive shaft designed for high torque machines.' },
  { id: 'fg-3', name: 'Hydraulic Cylinder Unit', sku: 'FG-HYDR-03', type: 'FINISHED_GOOD', quantity: 4, unit: 'pcs', unitCost: 850, reorderPoint: 3, supplierId: undefined, description: 'Heavy-duty linear motion hydraulic cylinder actuator with chrome-plated rod.' }
];

const initialVendors: Vendor[] = [
  { id: 'v-1', name: 'PentaSteel Mills', contactName: 'Tan Seng Jie', email: 'sales@pentasteel.com.my', phone: '+60 3-8012 3456', materialsSupplied: ['rm-1'], address: 'Lot 102, Kawasan Perindustrian Balakong, Selangor, Malaysia', rating: 4.8 },
  { id: 'v-2', name: 'Nippon Bearing & Fasteners', contactName: 'Kenji Sato', email: 'support@nipponbearing.com.my', phone: '+60 3-5631 8899', materialsSupplied: ['rm-2', 'rm-4'], address: '15, Jalan Subang 3, Subang Jaya, Selangor, Malaysia', rating: 4.5 },
  { id: 'v-3', name: 'Apex Fluid & Seals', contactName: 'Sarah Wong', email: 'wong@apexfluid.com.my', phone: '+60 3-7956 2211', materialsSupplied: ['rm-3', 'rm-5'], address: 'A-3-G, Block A, Jaya One, Petaling Jaya, Selangor, Malaysia', rating: 4.9 }
];

const initialClients: Client[] = [
  { id: 'c-1', name: 'Mega Machinery Sdn Bhd', contactName: 'Mr. Lee', email: 'lee@megamachinery.com.my', phone: '+60 3-8890 1122', companyName: 'Mega Machinery Sdn Bhd', address: 'Lot 45, Shah Alam Industrial Park, Selangor, Malaysia', totalOrdersValue: 125000 },
  { id: 'c-2', name: 'United Palm Oil Engineering', contactName: 'Aris Munandar', email: 'aris@unitedpalm.com.my', phone: '+60 3-3341 5566', companyName: 'United Palm Oil Engineering', address: 'Klang Port Industrial Zone, Selangor, Malaysia', totalOrdersValue: 84000 },
  { id: 'c-3', name: 'Kuala Lumpur Tech Parts', contactName: 'Alex Tan', email: 'alex@kltechparts.com', phone: '+60 3-2144 9900', companyName: 'Kuala Lumpur Tech Parts', address: 'No. 8, Jalan Tuanku Abdul Rahman, Kuala Lumpur, Malaysia', totalOrdersValue: 189000 }
];

const initialSalesOrders: SalesOrder[] = [
  { id: 'so-1', clientId: 'c-1', clientName: 'Mega Machinery Sdn Bhd', itemId: 'fg-1', itemName: 'Precision Gearbox Assembly', quantity: 5, unitPrice: 950, totalPrice: 4750, orderDate: '2026-06-15', deliveryDate: '2026-07-05', status: 'DELIVERED' },
  { id: 'so-2', clientId: 'c-2', clientName: 'United Palm Oil Engineering', itemId: 'fg-2', itemName: 'Machined Steel Shaft', quantity: 12, unitPrice: 380, totalPrice: 4560, orderDate: '2026-06-20', deliveryDate: '2026-07-10', status: 'IN_PRODUCTION', workflowTaskId: 'wf-1' },
  { id: 'so-3', clientId: 'c-3', clientName: 'Kuala Lumpur Tech Parts', itemId: 'fg-3', itemName: 'Hydraulic Cylinder Unit', quantity: 2, unitPrice: 1800, totalPrice: 3600, orderDate: '2026-06-28', deliveryDate: '2026-07-20', status: 'PENDING' }
];

const initialPurchaseOrders: PurchaseOrder[] = [
  { id: 'po-1', vendorId: 'v-1', vendorName: 'PentaSteel Mills', itemId: 'rm-1', itemName: 'Premium Steel Billets', quantity: 10, unitCost: 1200, totalCost: 12000, orderDate: '2026-06-10', status: 'RECEIVED', receivedDate: '2026-06-14' },
  { id: 'po-2', vendorId: 'v-3', vendorName: 'Apex Fluid & Seals', itemId: 'rm-3', itemName: 'CNC Coolant & Lubricant', quantity: 50, unitCost: 15, totalCost: 750, orderDate: '2026-06-25', status: 'ORDERED' }
];

const initialWorkflowTasks: WorkflowTask[] = [
  { id: 'wf-1', orderId: 'so-2', productName: 'Machined Steel Shaft', quantity: 12, currentStep: 'ASSEMBLY', assignedTo: 'Jim Halpert', startDate: '2026-06-22', notes: 'Using custom heat treatment profile and hard-chrome finishing.' }
];

// Helper to initialize and retrieve from LocalStorage
const getStorageItem = <T>(key: string, defaultValue: T): T => {
  // Check if stale woodcraft data exists, and if so, clear to trigger clean engineering reseed
  try {
    const rawInv = localStorage.getItem('erp_inventory');
    if (rawInv && (rawInv.includes('Timber') || rawInv.includes('Varnish') || rawInv.includes('Desk'))) {
      localStorage.clear();
    }
  } catch (e) {
    console.error('LocalStorage migration error:', e);
  }

  const data = localStorage.getItem(key);
  if (!data) {
    localStorage.setItem(key, JSON.stringify(defaultValue));
    return defaultValue;
  }
  return JSON.parse(data);
};

const setStorageItem = <T>(key: string, value: T): void => {
  localStorage.setItem(key, JSON.stringify(value));
  
  // Sync to Supabase in background
  const syncToSupabase = async () => {
    useSyncStore.getState().setSyncing(true);
    try {
      const tableMap: Record<string, string> = {
        'erp_inventory': 'inventory_items',
        'erp_vendors': 'vendors',
        'erp_clients': 'clients',
        'erp_sales_orders': 'sales_orders',
        'erp_purchase_orders': 'purchase_orders',
        'erp_workflow_tasks': 'workflow_tasks',
        'erp_employees': 'employees',
        'erp_company_profile': 'company_profile'
      };
      const tableName = tableMap[key];
      if (!tableName) return;
      
      if (key === 'erp_company_profile') {
        const v = value as any;
        await supabase.from(tableName).upsert({
          id: 'default',
          name: v.name,
          icon_type: v.iconType,
          icon_data_url: v.iconDataUrl,
          address: v.address,
          phone: v.phone,
          email: v.email,
          bank_name: v.bankName,
          bank_account: v.bankAccount,
          signature_url: v.signatureUrl,
          chop_url: v.chopUrl
        });
      } else {
        const items = value as any[];
        // We do a simple upsert of all items
        if (items.length > 0) {
           let payload = items;
           if (key === 'erp_inventory') payload = items.map(i => ({
              id: i.id,
              name: i.name,
              sku: i.sku,
              type: i.type,
              quantity: i.quantity,
              unit: i.unit,
              unit_cost: i.unitCost,
              reorder_point: i.reorderPoint,
              supplier_id: i.supplierId,
              description: i.description,
              attachments: i.attachments || []
           }));
           else if (key === 'erp_vendors') payload = items.map(v => ({
              id: v.id,
              name: v.name,
              contact_name: v.contactName,
              email: v.email,
              phone: v.phone,
              materials_supplied: v.materialsSupplied || [],
              address: v.address,
              rating: v.rating,
              attachments: v.attachments || []
           }));
           else if (key === 'erp_clients') payload = items.map(c => ({
              id: c.id,
              name: c.name,
              contact_name: c.contactName,
              email: c.email,
              phone: c.phone,
              company_name: c.companyName,
              address: c.address,
              total_orders_value: c.totalOrdersValue,
              attachments: c.attachments || []
           }));
           else if (key === 'erp_sales_orders') payload = items.map(o => ({
              id: o.id,
              client_id: o.clientId,
              client_name: o.clientName,
              item_id: o.itemId,
              item_name: o.itemName,
              quantity: o.quantity,
              unit_price: o.unitPrice,
              total_price: o.totalPrice,
              order_date: o.orderDate,
              delivery_date: o.deliveryDate,
              status: o.status,
              workflow_task_id: o.workflowTaskId,
              attachments: o.attachments || [],
              items: o.items || []
           }));
           else if (key === 'erp_purchase_orders') payload = items.map(o => ({
              id: o.id,
              vendor_id: o.vendorId,
              vendor_name: o.vendorName,
              item_id: o.itemId,
              item_name: o.itemName,
              quantity: o.quantity,
              unit_cost: o.unitCost,
              total_cost: o.totalCost,
              order_date: o.orderDate,
              status: o.status,
              received_date: o.receivedDate,
              attachments: o.attachments || [],
              items: o.items || []
           }));
           else if (key === 'erp_workflow_tasks') payload = items.map(t => ({
              id: t.id,
              order_id: t.orderId,
              product_name: t.productName,
              quantity: t.quantity,
              current_step: t.currentStep,
              assigned_to: t.assignedTo,
              start_date: t.startDate,
              end_date: t.endDate,
              notes: t.notes
           }));
           
           await supabase.from(tableName).upsert(payload);
           
           // Fetch current db to delete missing
           const { data: currentData } = await supabase.from(tableName).select('id');
           if (currentData) {
              const currentIds = currentData.map((d: any) => d.id);
              const newIds = new Set(items.map(i => i.id));
              const toDelete = currentIds.filter((id: string) => !newIds.has(id));
              if (toDelete.length > 0) {
                 await supabase.from(tableName).delete().in('id', toDelete);
              }
           }
        } else {
           // Delete all if array is empty
           const { data: currentData } = await supabase.from(tableName).select('id');
           if (currentData && currentData.length > 0) {
             await supabase.from(tableName).delete().in('id', currentData.map((d: any) => d.id));
           }
        }
      }
    } catch (err) {
      console.error("Supabase sync error:", err);
    } finally {
      useSyncStore.getState().setSyncing(false);
    }
  };
  
  syncToSupabase();

  localStorage.setItem(key, JSON.stringify(value));
};

export const getInventory = (): InventoryItem[] => getStorageItem('erp_inventory', initialInventory);
export const getVendors = (): Vendor[] => getStorageItem('erp_vendors', initialVendors);
export const getClients = (): Client[] => getStorageItem('erp_clients', initialClients);
export const getSalesOrders = (): SalesOrder[] => getStorageItem('erp_sales_orders', initialSalesOrders);
export const getPurchaseOrders = (): PurchaseOrder[] => getStorageItem('erp_purchase_orders', initialPurchaseOrders);
export const getWorkflowTasks = (): WorkflowTask[] => {
  const tasks = getStorageItem<WorkflowTask[]>('erp_workflow_tasks', initialWorkflowTasks);
  
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

// Base mutations
export const saveInventory = (items: InventoryItem[]) => setStorageItem('erp_inventory', items);
export const saveVendors = (items: Vendor[]) => setStorageItem('erp_vendors', items);
export const saveClients = (items: Client[]) => setStorageItem('erp_clients', items);
export const saveSalesOrders = (items: SalesOrder[]) => setStorageItem('erp_sales_orders', items);
export const savePurchaseOrders = (items: PurchaseOrder[]) => setStorageItem('erp_purchase_orders', items);
export const saveWorkflowTasks = (items: WorkflowTask[]) => setStorageItem('erp_workflow_tasks', items);

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
  savePurchaseOrders(pos);

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
  savePurchaseOrders(pos);
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
  saveSalesOrders(sos);

  // Update client metrics
  const clients = getClients();
  const clientIdx = clients.findIndex(c => c.id === so.clientId);
  if (clientIdx !== -1) {
    clients[clientIdx].totalOrdersValue += newSo.totalPrice;
    saveClients(clients);
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

  saveSalesOrders(sos);
  return currentSo;
};

/**
 * Helper to update workflow step.
 * If step becomes COMPLETED, we:
 * 1. Increment the finished goods inventory level.
 * 2. Subtract required raw materials (based on RECIPES).
 * 3. Transition Sales Order status to SHIPPED.
 */
export const updateWorkflowStep = (taskId: string, step: WorkflowTask['currentStep'], notes?: string): WorkflowTask | null => {
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
      saveSalesOrders(sos);

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
      saveSalesOrders(sos);

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

  saveWorkflowTasks(tasks);
  return tasks[index];
};

// Raw Material consumption
const consumeRawMaterials = (finishedGoodId: string, quantityProduced: number) => {
  const recipe = RECIPES[finishedGoodGoodMapping(finishedGoodId)];
  if (!recipe) return;

  const inventory = getInventory();
  recipe.forEach(requirement => {
    const itemIdx = inventory.findIndex(i => i.id === requirement.materialId);
    if (itemIdx !== -1) {
      // quantityProduced * needed per item
      inventory[itemIdx].quantity = Math.max(0, inventory[itemIdx].quantity - (requirement.quantityNeeded * quantityProduced));
    }
  });
  saveInventory(inventory);
};

// Help map client item ids if they diverge, just safety
const finishedGoodGoodMapping = (id: string): string => {
  // E.g. if so.itemId matches fg-1, return fg-1
  if (id.startsWith('fg-')) return id;
  // If named something else
  if (id.toLowerCase().includes('gearbox')) return 'fg-1';
  if (id.toLowerCase().includes('shaft')) return 'fg-2';
  return 'fg-3';
};

const adjustRawMaterialStock = (materialId: string, quantityChange: number) => {
  const inventory = getInventory();
  const idx = inventory.findIndex(i => i.id === materialId);
  if (idx !== -1) {
    inventory[idx].quantity = Math.max(0, inventory[idx].quantity + quantityChange);
    saveInventory(inventory);
  }
};

const adjustFinishedGoodStock = (fgId: string, quantityChange: number) => {
  const inventory = getInventory();
  const idx = inventory.findIndex(i => i.id === fgId || i.sku === fgId);
  if (idx !== -1) {
    inventory[idx].quantity = Math.max(0, inventory[idx].quantity + quantityChange);
    saveInventory(inventory);
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
  saveWorkflowTasks(tasks);
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

const initialCompanyProfile: CompanyProfile = {
  name: 'Seng Jie Engineering',
  iconType: 'database',
  address: 'Lot 102, Kawasan Perindustrian Balakong, 43300 Selangor, Malaysia',
  phone: '+60 3-8012 3456',
  email: 'finance@sengjie.com.my',
  bankName: 'Maybank Berhad (Kuala Lumpur)',
  bankAccount: '5142-8821-3956'
};

export const getCompanyProfile = (): CompanyProfile => {
  return getStorageItem('erp_company_profile', initialCompanyProfile);
};

export const saveCompanyProfile = (profile: CompanyProfile): void => {
  setStorageItem('erp_company_profile', profile);
};

// --- Employees database ---
const initialEmployees: Employee[] = [
  { id: 'emp-1', name: 'Jim Halpert', role: 'Production Supervisor', department: 'Operations', status: 'ACTIVE', email: 'jim@sengjie.com', phone: '+60 12-445-9871' },
  { id: 'emp-2', name: 'Pam Beesly', role: 'Quality Control Lead', department: 'Quality', status: 'ACTIVE', email: 'pam@sengjie.com', phone: '+60 17-233-1244' },
  { id: 'emp-3', name: 'Dwight Schrute', role: 'Machinist Technician', department: 'Machining', status: 'ACTIVE', email: 'dwight@sengjie.com', phone: '+60 13-909-5632' },
  { id: 'emp-4', name: 'Ryan Howard', role: 'Material Handling Associate', department: 'Logistics', status: 'ACTIVE', email: 'ryan@sengjie.com', phone: '+60 19-331-8976' }
];

export const getEmployees = (): Employee[] => getStorageItem('erp_employees', initialEmployees);

export const saveEmployees = (employees: Employee[]): void => {
  setStorageItem('erp_employees', employees);
};



export const loadInitialDataFromSupabase = async () => {
  useSyncStore.getState().setSyncing(true);
  try {
    const tableMap: Record<string, string> = {
      'erp_inventory': 'inventory_items',
      'erp_vendors': 'vendors',
      'erp_clients': 'clients',
      'erp_sales_orders': 'sales_orders',
      'erp_purchase_orders': 'purchase_orders',
      'erp_workflow_tasks': 'workflow_tasks',
      'erp_employees': 'employees'
    };
    
    for (const [key, tableName] of Object.entries(tableMap)) {
       const { data, error } = await supabase.from(tableName).select('*');
       if (!error && data && data.length > 0) {
          let mapped = data;
          if (key === 'erp_inventory') mapped = data.map(i => ({
             id: i.id,
             name: i.name,
             sku: i.sku,
             type: i.type,
             quantity: Number(i.quantity),
             unit: i.unit,
             unitCost: Number(i.unit_cost),
             reorderPoint: Number(i.reorder_point),
             supplierId: i.supplier_id,
             description: i.description,
             attachments: i.attachments || []
          }));
          else if (key === 'erp_vendors') mapped = data.map(v => ({
             id: v.id,
             name: v.name,
             contactName: v.contact_name,
             email: v.email,
             phone: v.phone,
             materialsSupplied: v.materials_supplied || [],
             address: v.address,
             rating: Number(v.rating),
             attachments: v.attachments || []
          }));
          else if (key === 'erp_clients') mapped = data.map(c => ({
             id: c.id,
             name: c.name,
             contactName: c.contact_name,
             email: c.email,
             phone: c.phone,
             companyName: c.company_name,
             address: c.address,
             totalOrdersValue: Number(c.total_orders_value),
             attachments: c.attachments || []
          }));
          else if (key === 'erp_sales_orders') mapped = data.map(o => ({
             id: o.id,
             clientId: o.client_id,
             clientName: o.client_name,
             itemId: o.item_id,
             itemName: o.item_name,
             quantity: Number(o.quantity),
             unitPrice: Number(o.unit_price),
             totalPrice: Number(o.total_price),
             orderDate: o.order_date,
             deliveryDate: o.delivery_date,
             status: o.status,
             workflowTaskId: o.workflow_task_id,
             attachments: o.attachments || [],
             items: o.items || []
          }));
          else if (key === 'erp_purchase_orders') mapped = data.map(o => ({
             id: o.id,
             vendorId: o.vendor_id,
             vendorName: o.vendor_name,
             itemId: o.item_id,
             itemName: o.item_name,
             quantity: Number(o.quantity),
             unitCost: Number(o.unit_cost),
             totalCost: Number(o.total_cost),
             orderDate: o.order_date,
             status: o.status,
             receivedDate: o.received_date,
             attachments: o.attachments || [],
             items: o.items || []
          }));
          else if (key === 'erp_workflow_tasks') mapped = data.map(t => ({
             id: t.id,
             orderId: t.order_id,
             productName: t.product_name,
             quantity: Number(t.quantity),
             currentStep: t.current_step,
             assignedTo: t.assigned_to,
             startDate: t.start_date,
             endDate: t.end_date,
             notes: t.notes
          }));
          
          localStorage.setItem(key, JSON.stringify(mapped));
       }
    }
    
    // profile
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
