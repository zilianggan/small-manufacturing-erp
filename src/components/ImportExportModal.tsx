import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  X,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  Download,
  Clipboard,
  Info,
  FileText,
  Database,
  ArrowRight,
  FileSpreadsheet,
  Layers,
  Users,
  ShoppingBag,
  History,
  Briefcase
} from 'lucide-react';
import { InventoryItem, Vendor, Client, SalesOrder, PurchaseOrder, Employee } from '../types';
import {
  getInventory, saveInventory,
  getVendors, saveVendors,
  getClients, saveClients,
  getSalesOrders, saveSalesOrders,
  getPurchaseOrders, savePurchaseOrders,
  getEmployees, saveEmployees
} from '../services/db';

interface ImportExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataImported: () => void; // Refresh current views
}

type ImportType = 'FULL_BACKUP' | 'INVENTORY' | 'VENDORS' | 'CLIENTS' | 'EMPLOYEES' | 'SALES' | 'PURCHASES';
type ExportType = 'CONTACTS' | 'INVENTORY' | 'EMPLOYEES' | 'SALES' | 'PURCHASES';

const EXPECTED_COLUMNS: Record<ImportType, { key: string, label: string, required: boolean }[]> = {
  FULL_BACKUP: [],
  INVENTORY: [
    { key: 'id', label: 'Item ID', required: false },
    { key: 'name', label: 'Item Name', required: true },
    { key: 'sku', label: 'SKU', required: false },
    { key: 'type', label: 'Type', required: false },
    { key: 'quantity', label: 'Quantity', required: false },
    { key: 'unit', label: 'Unit', required: false },
    { key: 'unitCost', label: 'Unit Cost', required: false },
    { key: 'reorderPoint', label: 'Reorder Point', required: false },
    { key: 'description', label: 'Description', required: false },
  ],
  VENDORS: [
    { key: 'id', label: 'Vendor ID', required: false },
    { key: 'name', label: 'Vendor Name', required: true },
    { key: 'contactName', label: 'Contact Name', required: false },
    { key: 'email', label: 'Email', required: false },
    { key: 'phone', label: 'Phone', required: false },
    { key: 'address', label: 'Address', required: false },
    { key: 'rating', label: 'Rating (1-5)', required: false },
    { key: 'materialsSupplied', label: 'Materials Supplied', required: false },
  ],
  CLIENTS: [
    { key: 'id', label: 'Client ID', required: false },
    { key: 'name', label: 'Client Name', required: true },
    { key: 'contactName', label: 'Contact Name', required: false },
    { key: 'companyName', label: 'Company Name', required: true },
    { key: 'email', label: 'Email', required: false },
    { key: 'phone', label: 'Phone', required: false },
    { key: 'address', label: 'Address', required: false },
    { key: 'totalOrdersValue', label: 'Total Orders Value', required: false },
  ],
  EMPLOYEES: [
    { key: 'id', label: 'Employee ID', required: false },
    { key: 'name', label: 'Name', required: true },
    { key: 'role', label: 'Role', required: true },
    { key: 'department', label: 'Department', required: false },
    { key: 'status', label: 'Status', required: false },
    { key: 'email', label: 'Email', required: false },
    { key: 'phone', label: 'Phone', required: false },
  ],
  SALES: [
    { key: 'id', label: 'Order ID', required: false },
    { key: 'clientName', label: 'Client Name', required: true },
    { key: 'itemName', label: 'Item Name', required: true },
    { key: 'quantity', label: 'Quantity', required: true },
    { key: 'unitPrice', label: 'Unit Price', required: true },
    { key: 'deliveryDate', label: 'Delivery Date', required: false },
    { key: 'status', label: 'Status', required: false },
  ],
  PURCHASES: [
    { key: 'id', label: 'PO ID', required: false },
    { key: 'vendorName', label: 'Vendor Name', required: true },
    { key: 'itemName', label: 'Item Name', required: true },
    { key: 'quantity', label: 'Quantity', required: true },
    { key: 'unitCost', label: 'Unit Cost', required: true },
    { key: 'status', label: 'Status', required: false },
  ]
};

export default function ImportExportModal({ isOpen, onClose, onDataImported }: ImportExportModalProps) {
  const [activeImportType, setActiveImportType] = useState<ImportType>('FULL_BACKUP');
  const [importMode, setImportMode] = useState<'MERGE' | 'OVERWRITE'>('MERGE');
  const [dragActive, setDragActive] = useState(false);
  const [status, setStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string; details?: string[] }>({ type: 'idle', message: '' });
  const [mappingState, setMappingState] = useState<{
    fileHeaders: string[];
    dataRows: any[][];
    mapping: Record<string, string>; // expectedKey -> fileHeader
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const dateStamp = new Date().toISOString().split('T')[0];

  const listValue = (value: unknown): string => {
    return Array.isArray(value) ? value.map(String).join(', ') : '';
  };

  const attachmentNames = (value: { name?: string }[] | undefined): string => {
    return Array.isArray(value) ? value.map((item) => item.name || 'Attachment').join(', ') : '';
  };

  const appendRowsSheet = (wb: XLSX.WorkBook, sheetName: string, rows: Record<string, unknown>[]) => {
    const data = rows.length > 0 ? rows : [{ Notice: 'No records found' }];
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  };

  const exportCategory = (type: ExportType) => {
    const wb = XLSX.utils.book_new();
    let fileName = `ERP_Export_${dateStamp}.xlsx`;
    let exportedRecordCount = 0;

    if (type === 'CONTACTS') {
      const vendors = getVendors();
      const clients = getClients();
      appendRowsSheet(wb, 'Vendors', vendors.map((vendor) => ({
        id: vendor.id,
        name: vendor.name,
        contactName: vendor.contactName,
        email: vendor.email,
        phone: vendor.phone,
        address: vendor.address,
        rating: vendor.rating,
        materialsSupplied: listValue(vendor.materialsSupplied),
        attachments: attachmentNames(vendor.attachments)
      })));
      appendRowsSheet(wb, 'Clients', clients.map((client) => ({
        id: client.id,
        name: client.name,
        contactName: client.contactName,
        companyName: client.companyName,
        email: client.email,
        phone: client.phone,
        address: client.address,
        totalOrdersValue: client.totalOrdersValue,
        attachments: attachmentNames(client.attachments)
      })));
      fileName = `ERP_Vendors_Clients_${dateStamp}.xlsx`;
      exportedRecordCount = vendors.length + clients.length;
    } else if (type === 'INVENTORY') {
      const inventory = getInventory();
      appendRowsSheet(wb, 'Inventory', inventory.map((item) => ({
        id: item.id,
        name: item.name,
        sku: item.sku,
        type: item.type,
        quantity: item.quantity,
        unit: item.unit,
        unitCost: item.unitCost,
        reorderPoint: item.reorderPoint,
        supplierId: item.supplierId || '',
        description: item.description || '',
        attachments: attachmentNames(item.attachments)
      })));
      fileName = `ERP_Inventory_${dateStamp}.xlsx`;
      exportedRecordCount = inventory.length;
    } else if (type === 'EMPLOYEES') {
      const employees = getEmployees();
      appendRowsSheet(wb, 'Employees', employees.map((employee) => ({
        id: employee.id,
        name: employee.name,
        role: employee.role,
        department: employee.department,
        status: employee.status,
        email: employee.email || '',
        phone: employee.phone || ''
      })));
      fileName = `ERP_Employees_${dateStamp}.xlsx`;
      exportedRecordCount = employees.length;
    } else if (type === 'SALES') {
      const orders = getSalesOrders();
      appendRowsSheet(wb, 'Sales_Orders', orders.map((order) => ({
        id: order.id,
        clientId: order.clientId,
        clientName: order.clientName,
        orderDate: order.orderDate,
        deliveryDate: order.deliveryDate,
        status: order.status,
        itemId: order.itemId,
        itemName: order.itemName,
        quantity: order.quantity,
        unitPrice: order.unitPrice,
        totalPrice: order.totalPrice,
        workflowTaskId: order.workflowTaskId || '',
        itemCount: order.items?.length || 1,
        attachments: attachmentNames(order.attachments)
      })));
      appendRowsSheet(wb, 'Sales_Items', orders.flatMap((order) => {
        const items = order.items && order.items.length > 0 ? order.items : [{
          itemId: order.itemId,
          itemName: order.itemName,
          quantity: order.quantity,
          unitPrice: order.unitPrice,
          totalPrice: order.totalPrice
        }];
        return items.map((item) => ({
          orderId: order.id,
          clientName: order.clientName,
          orderDate: order.orderDate,
          deliveryDate: order.deliveryDate,
          status: order.status,
          itemId: item.itemId,
          itemName: item.itemName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice
        }));
      }));
      fileName = `ERP_Sales_${dateStamp}.xlsx`;
      exportedRecordCount = orders.length;
    } else if (type === 'PURCHASES') {
      const orders = getPurchaseOrders();
      appendRowsSheet(wb, 'Purchase_Orders', orders.map((order) => ({
        id: order.id,
        vendorId: order.vendorId,
        vendorName: order.vendorName,
        orderDate: order.orderDate,
        receivedDate: order.receivedDate || '',
        status: order.status,
        itemId: order.itemId,
        itemName: order.itemName,
        quantity: order.quantity,
        unitCost: order.unitCost,
        totalCost: order.totalCost,
        itemCount: order.items?.length || 1,
        attachments: attachmentNames(order.attachments)
      })));
      appendRowsSheet(wb, 'Purchase_Items', orders.flatMap((order) => {
        const items = order.items && order.items.length > 0 ? order.items : [{
          itemId: order.itemId,
          itemName: order.itemName,
          quantity: order.quantity,
          unitCost: order.unitCost,
          totalCost: order.totalCost
        }];
        return items.map((item) => ({
          purchaseOrderId: order.id,
          vendorName: order.vendorName,
          orderDate: order.orderDate,
          receivedDate: order.receivedDate || '',
          status: order.status,
          itemId: item.itemId,
          itemName: item.itemName,
          quantity: item.quantity,
          unitCost: item.unitCost,
          totalCost: item.totalCost
        }));
      }));
      fileName = `ERP_Purchases_${dateStamp}.xlsx`;
      exportedRecordCount = orders.length;
    }

    XLSX.writeFile(wb, fileName);
    setStatus({
      type: 'success',
      message: `Export file created: ${fileName}`,
      details: [`Exported ${exportedRecordCount} primary records.`]
    });
  };

  // Formatter for help templates
  const getTemplateHeaders = (type: ImportType): string => {
    switch (type) {
      case 'FULL_BACKUP':
        return `File should contain sheets named:\n- erp_inventory\n- erp_vendors\n- erp_clients\n- erp_employees\n- erp_sales_orders\n- erp_purchase_orders`;
      case 'INVENTORY':
        return `Required columns:\nname\tsku\ttype\tquantity\tunit\tunitCost\treorderPoint`;
      case 'VENDORS':
        return `Required columns:\nname\temail\tphone\taddress\trating\nmaterialsSupplied (comma separated)`;
      case 'CLIENTS':
        return `Required columns:\nname\temail\tphone\tcompanyName\taddress`;
      case 'EMPLOYEES':
        return `Required columns:\nname\trole\tdepartment\tstatus\temail\tphone`;
      case 'SALES':
        return `Required columns:\nclientName\titemName\tquantity\tunitPrice\tdeliveryDate\tstatus`;
      case 'PURCHASES':
        return `Required columns:\nvendorName\titemName\tquantity\tunitCost\tstatus`;
      default:
        return ``;
    }
  };

  const validateAndImport = (parsed: any) => {
    try {
      let logs: string[] = [];
      let successCount = 0;

      if (activeImportType === 'FULL_BACKUP') {
        // FULL RESTORE MODE
        const keys = ['erp_inventory', 'erp_vendors', 'erp_clients', 'erp_employees', 'erp_sales_orders', 'erp_purchase_orders', 'erp_workflow_tasks', 'erp_company_profile'];
        let keysFound = 0;

        keys.forEach(key => {
          if (parsed[key]) {
            keysFound++;
            if (importMode === 'OVERWRITE') {
              localStorage.setItem(key, JSON.stringify(parsed[key]));
              logs.push(`Successfully replaced database key: ${key} (${parsed[key].length || 1} records)`);
            } else {
              // Merge logic
              const existingRaw = localStorage.getItem(key);
              if (existingRaw) {
                try {
                  const existingArr = JSON.parse(existingRaw);
                  if (Array.isArray(existingArr) && Array.isArray(parsed[key])) {
                    // Merge by ID
                    const map = new Map();
                    existingArr.forEach((item: any) => { if (item.id) map.set(item.id, item); });
                    parsed[key].forEach((item: any) => {
                      if (!item.id) {
                        item.id = `${key.replace('erp_', '').substring(0, 2)}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                      }
                      map.set(item.id, item);
                    });
                    const merged = Array.from(map.values());
                    localStorage.setItem(key, JSON.stringify(merged));
                    logs.push(`Merged key: ${key} (${merged.length} total records, added/updated ${parsed[key].length})`);
                  } else {
                    // Fallback to overwrite for non-arrays
                    localStorage.setItem(key, JSON.stringify(parsed[key]));
                    logs.push(`Updated config key: ${key}`);
                  }
                } catch {
                  localStorage.setItem(key, JSON.stringify(parsed[key]));
                  logs.push(`Replaced key (invalid existing cache): ${key}`);
                }
              } else {
                localStorage.setItem(key, JSON.stringify(parsed[key]));
                logs.push(`Created key: ${key} (${parsed[key].length || 1} records)`);
              }
            }
          }
        });

        if (keysFound === 0) {
          setStatus({
            type: 'error',
            message: 'Invalid backup format!',
            details: ['The uploaded Excel file does not contain any recognizable ERP database sheets (e.g. erp_inventory).']
          });
          return;
        }

        setStatus({
          type: 'success',
          message: `Successfully imported backup contents (${keysFound} databases restored).`,
          details: logs
        });
        onDataImported();
        return;
      }

      // CATEGORY-SPECIFIC IMPORT
      if (!Array.isArray(parsed)) {
        setStatus({
          type: 'error',
          message: 'Invalid format!',
          details: ['Category-specific imports MUST be a table. Please review the template structure shown below.']
        });
        return;
      }

      if (activeImportType === 'INVENTORY') {
        const current = importMode === 'OVERWRITE' ? [] : getInventory();
        const itemsToImport: InventoryItem[] = parsed.map((raw: any, index) => {
          if (!raw.name) throw new Error(`Record #${index + 1} is missing a required 'name' field.`);

          const itemType = raw.type === 'RAW_MATERIAL' || raw.type === 'FINISHED_GOOD' ? raw.type : 'RAW_MATERIAL';
          const prefix = itemType === 'RAW_MATERIAL' ? 'rm' : 'fg';

          return {
            id: raw.id || `${prefix}-${Date.now()}-${index}-${Math.floor(Math.random() * 100)}`,
            name: String(raw.name),
            sku: raw.sku || `${prefix.toUpperCase()}-${String(raw.name).replace(/\s+/g, '-').toUpperCase()}-${Math.floor(Math.random() * 1000)}`,
            type: itemType,
            quantity: Number(raw.quantity) || 0,
            unit: raw.unit || 'units',
            unitCost: Number(raw.unitCost) || 0,
            reorderPoint: Number(raw.reorderPoint) || 0,
            supplierId: raw.supplierId || undefined,
            description: raw.description || undefined,
            attachments: Array.isArray(raw.attachments) ? raw.attachments : (raw.attachment ? [raw.attachment] : [])
          };
        });

        const merged = importMode === 'OVERWRITE' ? itemsToImport : [
          ...current.filter(c => !itemsToImport.some(i => i.id === c.id)),
          ...itemsToImport
        ];

        saveInventory(merged);
        successCount = itemsToImport.length;
        logs.push(`Imported ${successCount} items successfully to the inventory database.`);
      }

      else if (activeImportType === 'VENDORS') {
        const current = importMode === 'OVERWRITE' ? [] : getVendors();
        const itemsToImport: Vendor[] = parsed.map((raw: any, index) => {
          if (!raw.name) throw new Error(`Record #${index + 1} is missing a required supplier 'name' field.`);
          return {
            id: raw.id || `v-${Date.now()}-${index}`,
            name: String(raw.name),
            contactName: raw.contactName || String(raw.name),
            email: raw.email || '',
            phone: raw.phone || '',
            materialsSupplied: Array.isArray(raw.materialsSupplied) ? raw.materialsSupplied.map(String) : (typeof raw.materialsSupplied === 'string' ? raw.materialsSupplied.split(',').map((s: string) => s.trim()) : []),
            address: raw.address || '',
            rating: Math.min(5, Math.max(1, Number(raw.rating) || 5)),
            attachments: Array.isArray(raw.attachments) ? raw.attachments : (raw.attachment ? [raw.attachment] : [])
          };
        });

        const merged = importMode === 'OVERWRITE' ? itemsToImport : [
          ...current.filter(c => !itemsToImport.some(i => i.id === c.id)),
          ...itemsToImport
        ];

        saveVendors(merged);
        successCount = itemsToImport.length;
        logs.push(`Imported ${successCount} suppliers successfully to the registry.`);
      }

      else if (activeImportType === 'CLIENTS') {
        const current = importMode === 'OVERWRITE' ? [] : getClients();
        const itemsToImport: Client[] = parsed.map((raw: any, index) => {
          if (!raw.name) throw new Error(`Record #${index + 1} is missing a client contact 'name' field.`);
          return {
            id: raw.id || `c-${Date.now()}-${index}`,
            name: String(raw.name),
            contactName: raw.contactName || String(raw.name),
            email: raw.email || '',
            phone: raw.phone || '',
            companyName: raw.companyName || 'Private Individual',
            address: raw.address || '',
            totalOrdersValue: Number(raw.totalOrdersValue) || 0,
            attachments: Array.isArray(raw.attachments) ? raw.attachments : (raw.attachment ? [raw.attachment] : [])
          };
        });

        const merged = importMode === 'OVERWRITE' ? itemsToImport : [
          ...current.filter(c => !itemsToImport.some(i => i.id === c.id)),
          ...itemsToImport
        ];

        saveClients(merged);
        successCount = itemsToImport.length;
        logs.push(`Imported ${successCount} clients successfully to the directory.`);
      }

      else if (activeImportType === 'EMPLOYEES') {
        const current = importMode === 'OVERWRITE' ? [] : getEmployees();
        const itemsToImport: Employee[] = parsed.map((raw: any, index) => {
          if (!raw.name) throw new Error(`Record #${index + 1} is missing an employee 'name' field.`);
          if (!raw.role) throw new Error(`Record #${index + 1} ('${raw.name}') is missing an employee 'role' field.`);
          return {
            id: raw.id || `emp-${Date.now()}-${index}`,
            name: String(raw.name),
            role: String(raw.role),
            department: raw.department || 'Operations',
            status: raw.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
            email: raw.email || undefined,
            phone: raw.phone || undefined
          };
        });

        const merged = importMode === 'OVERWRITE' ? itemsToImport : [
          ...current.filter(c => !itemsToImport.some(i => i.id === c.id || i.name.toLowerCase() === c.name.toLowerCase())),
          ...itemsToImport
        ];

        saveEmployees(merged);
        successCount = itemsToImport.length;
        logs.push(`Imported ${successCount} employees successfully to the active directory.`);
      }

      else if (activeImportType === 'SALES') {
        const current = importMode === 'OVERWRITE' ? [] : getSalesOrders();

        // Let's search inventory items & clients to resolve references
        const clientsList = getClients();
        const inventoryList = getInventory();

        const itemsToImport: SalesOrder[] = parsed.map((raw: any, index) => {
          const clientName = raw.clientName || 'Walk-in Client';
          let clientId = raw.clientId;
          if (!clientId) {
            const foundClient = clientsList.find(c => c.name.toLowerCase() === clientName.toLowerCase() || c.companyName.toLowerCase() === clientName.toLowerCase());
            clientId = foundClient ? foundClient.id : 'c-walk-in';
          }

          const itemName = raw.itemName || 'Custom Parts';
          let itemId = raw.itemId;
          if (!itemId) {
            const foundItem = inventoryList.find(i => i.name.toLowerCase() === itemName.toLowerCase());
            itemId = foundItem ? foundItem.id : 'fg-custom';
          }

          const status = ['PENDING', 'IN_PRODUCTION', 'SHIPPED', 'DELIVERED', 'CANCELLED'].includes(raw.status)
            ? raw.status
            : 'PENDING';

          const qty = Number(raw.quantity) || 1;
          const unitPrice = Number(raw.unitPrice) || 0.0;

          return {
            id: raw.id || `so-${Date.now()}-${index}`,
            clientId,
            clientName,
            itemId,
            itemName,
            quantity: qty,
            unitPrice: unitPrice,
            totalPrice: qty * unitPrice,
            orderDate: raw.orderDate || new Date().toISOString().split('T')[0],
            deliveryDate: raw.deliveryDate || new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString().split('T')[0],
            status,
            workflowTaskId: raw.workflowTaskId || undefined,
            attachments: Array.isArray(raw.attachments) ? raw.attachments : (raw.attachment ? [raw.attachment] : [])
          };
        });

        const merged = importMode === 'OVERWRITE' ? itemsToImport : [
          ...current.filter(c => !itemsToImport.some(i => i.id === c.id)),
          ...itemsToImport
        ];

        saveSalesOrders(merged);
        successCount = itemsToImport.length;
        logs.push(`Imported ${successCount} sales contracts successfully.`);
      }

      else if (activeImportType === 'PURCHASES') {
        const current = importMode === 'OVERWRITE' ? [] : getPurchaseOrders();
        const vendorsList = getVendors();
        const inventoryList = getInventory();

        const itemsToImport: PurchaseOrder[] = parsed.map((raw: any, index) => {
          const vendorName = raw.vendorName || 'Generic Supplier';
          let vendorId = raw.vendorId;
          if (!vendorId) {
            const foundVendor = vendorsList.find(v => v.name.toLowerCase() === vendorName.toLowerCase());
            vendorId = foundVendor ? foundVendor.id : 'v-1';
          }

          const itemName = raw.itemName || 'Raw Material';
          let itemId = raw.itemId;
          if (!itemId) {
            const foundItem = inventoryList.find(i => i.name.toLowerCase() === itemName.toLowerCase());
            itemId = foundItem ? foundItem.id : 'rm-1';
          }

          const status = ['DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED'].includes(raw.status)
            ? raw.status
            : 'ORDERED';

          return {
            id: raw.id || `po-${Date.now()}-${index}`,
            vendorId,
            vendorName,
            itemId,
            itemName,
            quantity: Number(raw.quantity) || 1,
            unitCost: Number(raw.unitCost) || 0.0,
            totalCost: (Number(raw.quantity) || 1) * (Number(raw.unitCost) || 0.0),
            orderDate: raw.orderDate || new Date().toISOString().split('T')[0],
            status,
            receivedDate: raw.receivedDate || undefined,
            attachments: Array.isArray(raw.attachments) ? raw.attachments : (raw.attachment ? [raw.attachment] : [])
          };
        });

        const merged = importMode === 'OVERWRITE' ? itemsToImport : [
          ...current.filter(c => !itemsToImport.some(i => i.id === c.id)),
          ...itemsToImport
        ];

        savePurchaseOrders(merged);
        successCount = itemsToImport.length;
        logs.push(`Imported ${successCount} supplier purchase orders successfully.`);
      }

      setStatus({
        type: 'success',
        message: `Successfully completed import.`,
        details: logs
      });
      onDataImported();
    } catch (err: any) {
      setStatus({
        type: 'error',
        message: 'Parsing or validation failed!',
        details: [err.message || 'Make sure the Excel file is correctly formatted.']
      });
    }
  };

  const downloadErrorExcel = (headers: string[], rows: any[][], errors: string[]) => {
    const newHeaders = [...headers, 'Error Message'];
    const newRows = rows.map((row, i) => [...row, errors[i] || '']);

    const ws = XLSX.utils.aoa_to_sheet([newHeaders, ...newRows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Import_Errors");
    XLSX.writeFile(wb, "Import_Errors.xlsx");
  };

  const executeImport = () => {
    if (!mappingState) return;
    const expectedCols = EXPECTED_COLUMNS[activeImportType];

    // Check if required columns are mapped
    const missingMapped = expectedCols.filter(col => col.required && !mappingState.mapping[col.key]);
    if (missingMapped.length > 0) {
      setStatus({
        type: 'error',
        message: 'Missing Required Column Mappings',
        details: missingMapped.map(m => `Please map: ${m.label}`)
      });
      return;
    }

    const parsed: any[] = [];
    const rowErrors: string[] = [];
    let hasErrors = false;

    mappingState.dataRows.forEach((rowArray, rowIndex) => {
      const rowObj: any = {};
      mappingState.fileHeaders.forEach((header, index) => {
        rowObj[header] = rowArray[index];
      });

      const mappedObj: any = {};
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
        details: ['An Excel file with error messages has been downloaded. Please fix the errors and try again.']
      });
      setMappingState(null);
      return;
    }

    validateAndImport(parsed);
    setMappingState(null);
  };

  const handleFileProcessing = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = e.target?.result;
      if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        const workbook = XLSX.read(data, { type: 'binary' });

        if (activeImportType === 'FULL_BACKUP') {
          const fullBackupData: any = {};
          workbook.SheetNames.forEach(sheetName => {
            fullBackupData[sheetName] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
          });
          validateAndImport(fullBackupData);
        } else {
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][];

          if (rows.length < 2) {
            setStatus({ type: 'error', message: 'File has no data rows.' });
            return;
          }

          const fileHeaders = rows[0].map(h => String(h || '').trim());
          const dataRows = rows.slice(1);

          // Auto-mapping
          const expected = EXPECTED_COLUMNS[activeImportType];
          const mapping: Record<string, string> = {};
          expected.forEach(col => {
            const match = fileHeaders.find(h => h.toLowerCase() === col.key.toLowerCase() || h.toLowerCase() === col.label.toLowerCase());
            if (match) mapping[col.key] = match;
          });

          setMappingState({ fileHeaders, dataRows, mapping });
        }
      } else {
        setStatus({ type: 'error', message: 'Only Excel files (.xlsx, .xls) are supported.' });
      }
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
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileProcessing(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="w-full max-w-4xl bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in duration-200">

        {/* Modal Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
          <div className="flex items-center space-x-2.5">
            <span className="p-1.5 bg-blue-600 rounded text-white shrink-0 flex items-center justify-center">
              <Database className="w-5 h-5" />
            </span>
            <div>
              <h3 className="font-sans font-bold text-slate-900 text-sm">ERP Data Import & Export Hub</h3>
              <p className="text-[10px] text-slate-500 font-mono">Load, merge, overwrite, or export vendors, clients, inventory, employees, sales, and purchases</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 font-bold text-base p-1.5 leading-none bg-transparent"
          >
            &times;
          </button>
        </div>

        {/* Modal Body (Two Column Layout) */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col lg:flex-row gap-5 min-h-0">

          {/* Left Column: Side Controls & Navigation */}
          <div className="w-full lg:w-1/3 flex flex-col space-y-4 shrink-0">

            <div className="space-y-1.5">
              <span className="font-semibold block text-slate-700 text-xs uppercase tracking-wider">1. Select Target Category</span>
              <div className="space-y-1">
                {[
                  { id: 'FULL_BACKUP' as ImportType, label: 'Full System Backup (.xlsx)', icon: Database, color: 'text-blue-600 bg-blue-50 border-blue-200' },
                  { id: 'INVENTORY' as ImportType, label: 'Inventory Items', icon: Layers, color: 'text-amber-600 bg-amber-50 border-amber-200' },
                  { id: 'VENDORS' as ImportType, label: 'Vendors & Suppliers', icon: Users, color: 'text-purple-600 bg-purple-50 border-purple-200' },
                  { id: 'CLIENTS' as ImportType, label: 'Client Database', icon: Users, color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
                  { id: 'EMPLOYEES' as ImportType, label: 'Employee Directory', icon: Briefcase, color: 'text-teal-600 bg-teal-50 border-teal-200' },
                  { id: 'SALES' as ImportType, label: 'Sales Contracts', icon: FileSpreadsheet, color: 'text-sky-600 bg-sky-50 border-sky-200' },
                  { id: 'PURCHASES' as ImportType, label: 'Material Purchases', icon: ShoppingBag, color: 'text-pink-600 bg-pink-50 border-pink-200' },
                ].map((item) => {
                  const Icon = item.icon;
                  const isActive = activeImportType === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveImportType(item.id);
                        setStatus({ type: 'idle', message: '' });
                        setMappingState(null);
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
                      <ArrowRight className={`w-3.5 h-3.5 opacity-60 transition-transform ${isActive ? 'translate-x-0.5' : 'group-hover:translate-x-1'}`} />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5 pt-2 border-t border-slate-100">
              <span className="font-semibold block text-slate-700 text-xs uppercase tracking-wider">2. Choose Import Strategy</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setImportMode('MERGE')}
                  className={`p-2 rounded-lg border text-center transition-all flex flex-col items-center justify-center ${importMode === 'MERGE'
                    ? 'bg-blue-50 border-blue-500 text-blue-700 font-semibold shadow-sm'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                >
                  <span className="text-xs">Merge Records</span>
                  <span className="text-[9px] text-slate-400 font-normal mt-0.5 font-mono">Updates or adds only</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm('WARNING: Overwrite strategy will completely delete current records in this category and replace them with imported ones. Proceed?')) {
                      setImportMode('OVERWRITE');
                    }
                  }}
                  className={`p-2 rounded-lg border text-center transition-all flex flex-col items-center justify-center ${importMode === 'OVERWRITE'
                    ? 'bg-amber-50 border-amber-500 text-amber-700 font-semibold shadow-sm'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                >
                  <span className="text-xs text-amber-800">Overwrite DB</span>
                  <span className="text-[9px] text-red-500/80 font-normal mt-0.5 font-mono">Deletes old records!</span>
                </button>
              </div>
            </div>

            <div className="bg-slate-50 rounded-lg p-3 text-[11px] text-slate-500 space-y-1.5 border border-slate-150">
              <div className="flex items-center space-x-1.5 font-semibold text-slate-700">
                <Info className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <span>Format Guidelines</span>
              </div>
              <p className="leading-relaxed">
                Provide a clean Excel (.xlsx) file. Missing identifiers will be auto-generated on-the-fly. Unit pricing values will default to zero if absent.
              </p>
              <p className="leading-relaxed font-semibold text-amber-700">
                ⚠️ Local storage space limits sizes to &lt; 2.5MB.
              </p>
            </div>

          </div>

          {/* Right Column: Interaction panel */}
          <div className="flex-1 flex flex-col space-y-4 min-w-0">

            {/* Status indicators */}
            {status.type !== 'idle' && (
              <div className={`p-4 rounded-xl border text-xs leading-relaxed animate-in slide-in-from-top-2 duration-200 ${status.type === 'success'
                ? 'bg-emerald-50 border-emerald-100 text-emerald-800'
                : 'bg-red-50 border-red-100 text-red-800'
                }`}>
                <div className="flex items-start space-x-2.5">
                  {status.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5 animate-bounce-subtle" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5 animate-pulse" />
                  )}
                  <div className="space-y-1.5 w-full">
                    <span className="font-bold block text-slate-900">{status.message}</span>
                    {status.details && status.details.length > 0 && (
                      <ul className="list-disc list-inside space-y-1 font-mono text-[10px] bg-white/65 p-2 rounded-lg max-h-[140px] overflow-y-auto">
                        {status.details.map((detail, index) => (
                          <li key={index}>{detail}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Main file uploader area */}
            {mappingState ? (
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm animate-in fade-in zoom-in duration-200 flex-1 overflow-y-auto">
                <h4 className="font-bold text-slate-900 mb-4 text-sm">Map Columns for {activeImportType}</h4>
                <div className="space-y-3 mb-6">
                  {EXPECTED_COLUMNS[activeImportType].map(col => (
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
                            setMappingState(prev => prev ? {
                              ...prev,
                              mapping: { ...prev.mapping, [col.key]: e.target.value }
                            } : null)
                          }}
                        >
                          <option value="">-- Ignore / Not Mapped --</option>
                          {mappingState.fileHeaders.map((h, i) => (
                            <option key={i} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex space-x-3 justify-end mt-4">
                  <button
                    onClick={() => setMappingState(null)}
                    className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-xs font-medium transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={executeImport}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium transition-colors hover:bg-blue-700"
                  >
                    Confirm & Import
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Box A: Drag and Drop Upload */}
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
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      accept=".xlsx,.xls"
                      className="hidden"
                    />
                    <UploadCloud className="w-8 h-8 text-slate-400 mb-2 animate-bounce-subtle" />
                    <span className="text-xs font-semibold text-slate-800 text-center block">
                      Upload raw file backup
                    </span>
                    <span className="text-[10px] text-slate-400 text-center mt-1">
                      Drag and drop your exported <code className="font-mono bg-slate-100 px-1 py-0.5 rounded text-slate-600">.xlsx</code> file or click to browse
                    </span>
                  </div>

                  {/* Box B: Explanatory Template */}
                  <div className="bg-slate-900 text-slate-300 rounded-xl p-4 flex flex-col justify-between min-h-[150px] font-mono text-[10px]">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-slate-400 pb-1.5 border-b border-slate-800">
                        <span className="text-[9px] uppercase tracking-wider font-semibold text-blue-400">Excel Column Blueprint Template</span>
                        <span className="text-[8px] bg-slate-800 px-1 py-0.5 rounded text-slate-500">Read-only template</span>
                      </div>
                      <pre className="mt-2 text-slate-300 font-mono text-[9px] leading-relaxed max-h-[100px] overflow-y-auto overflow-x-hidden select-all whitespace-pre-wrap">
                        {getTemplateHeaders(activeImportType)}
                      </pre>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(getTemplateHeaders(activeImportType));
                        alert("Template copied to clipboard!");
                      }}
                      className="mt-3 w-full py-1.5 bg-slate-800 hover:bg-slate-700 hover:text-white rounded text-[10px] text-slate-300 font-sans font-medium transition-colors flex items-center justify-center space-x-1"
                    >
                      <Clipboard className="w-3 h-3" />
                      <span>Copy Blueprint Template</span>
                    </button>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div>
                      <h4 className="font-bold text-slate-900 text-xs">Export Data</h4>
                      <p className="text-[10px] text-slate-400">Download clean Excel files for accounting, audits, or migration.</p>
                    </div>
                    <Download className="w-4 h-4 text-blue-500 shrink-0" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {[
                      { id: 'CONTACTS' as ExportType, label: 'Vendors & Clients', icon: Users, tone: 'hover:border-emerald-300 hover:bg-emerald-50/50 dark:hover:bg-slate-950' },
                      { id: 'INVENTORY' as ExportType, label: 'Inventory Data', icon: Layers, tone: 'hover:border-amber-300 hover:bg-amber-50/50 dark:hover:bg-slate-950' },
                      { id: 'EMPLOYEES' as ExportType, label: 'Employee Data', icon: Briefcase, tone: 'hover:border-teal-300 hover:bg-teal-50/50 dark:hover:bg-slate-950' },
                      { id: 'SALES' as ExportType, label: 'Sales Data', icon: FileSpreadsheet, tone: 'hover:border-sky-300 hover:bg-sky-50/50 dark:hover:bg-slate-950' },
                      { id: 'PURCHASES' as ExportType, label: 'Purchase Data', icon: ShoppingBag, tone: 'hover:border-pink-300 hover:bg-pink-50/50 dark:hover:bg-slate-950' },
                    ].map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => exportCategory(item.id)}
                          className={`flex items-center justify-between gap-2 px-3 py-2.5 border border-slate-200 rounded-lg text-left text-xs text-slate-700 transition-all ${item.tone}`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <Icon className="w-4 h-4 text-slate-500 shrink-0" />
                            <span className="font-semibold truncate">{item.label}</span>
                          </span>
                          <Download className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors"
              >
                Close Hub
              </button>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
}
