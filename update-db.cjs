const fs = require('fs');

let content = fs.readFileSync('src/services/db.ts', 'utf8');

// Add import
const importStatement = `import { supabase } from './supabase';\nimport { create } from 'zustand';\n\nexport const useSyncStore = create((set) => ({ isSyncing: false, setSyncing: (val) => set({ isSyncing: val }) }));\n`;
content = importStatement + content;

// Rewrite getStorageItem and setStorageItem
content = content.replace(/const setStorageItem = <T>\(key: string, value: T\): void => {/, `const setStorageItem = <T>(key: string, value: T): void => {
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
           if (key === 'erp_inventory') payload = items.map(i => ({ ...i, unit_cost: i.unitCost, reorder_point: i.reorderPoint, supplier_id: i.supplierId }));
           else if (key === 'erp_vendors') payload = items.map(v => ({ ...v, contact_name: v.contactName, materials_supplied: v.materialsSupplied }));
           else if (key === 'erp_clients') payload = items.map(c => ({ ...c, contact_name: c.contactName, company_name: c.companyName, total_orders_value: c.totalOrdersValue }));
           else if (key === 'erp_sales_orders') payload = items.map(o => ({ ...o, client_id: o.clientId, client_name: o.clientName, item_id: o.itemId, item_name: o.itemName, unit_price: o.unitPrice, total_price: o.totalPrice, order_date: o.orderDate, delivery_date: o.deliveryDate, workflow_task_id: o.workflowTaskId }));
           else if (key === 'erp_purchase_orders') payload = items.map(o => ({ ...o, vendor_id: o.vendorId, vendor_name: o.vendorName, item_id: o.itemId, item_name: o.itemName, unit_cost: o.unitCost, total_cost: o.totalCost, order_date: o.orderDate, received_date: o.receivedDate }));
           else if (key === 'erp_workflow_tasks') payload = items.map(t => ({ ...t, order_id: t.orderId, product_name: t.productName, current_step: t.currentStep, assigned_to: t.assignedTo, start_date: t.startDate, end_date: t.endDate }));
           
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
`);

// Add loadInitialData
const loadFunction = `
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
          if (key === 'erp_inventory') mapped = data.map(i => ({ ...i, unitCost: i.unit_cost, reorderPoint: i.reorder_point, supplierId: i.supplier_id }));
          else if (key === 'erp_vendors') mapped = data.map(v => ({ ...v, contactName: v.contact_name, materialsSupplied: v.materials_supplied }));
          else if (key === 'erp_clients') mapped = data.map(c => ({ ...c, contactName: c.contact_name, companyName: c.company_name, totalOrdersValue: c.total_orders_value }));
          else if (key === 'erp_sales_orders') mapped = data.map(o => ({ ...o, clientId: o.client_id, clientName: o.client_name, itemId: o.item_id, itemName: o.item_name, unitPrice: o.unit_price, totalPrice: o.total_price, orderDate: o.order_date, deliveryDate: o.delivery_date, workflowTaskId: o.workflow_task_id }));
          else if (key === 'erp_purchase_orders') mapped = data.map(o => ({ ...o, vendorId: o.vendor_id, vendorName: o.vendor_name, itemId: o.item_id, itemName: o.item_name, unitCost: o.unit_cost, totalCost: o.total_cost, orderDate: o.order_date, receivedDate: o.received_date }));
          else if (key === 'erp_workflow_tasks') mapped = data.map(t => ({ ...t, orderId: o.order_id, productName: t.product_name, currentStep: t.current_step, assignedTo: t.assigned_to, startDate: t.start_date, endDate: t.end_date }));
          
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
`;
content = content + '\n' + loadFunction;

fs.writeFileSync('src/services/db.ts', content);
console.log("Updated db.ts");
