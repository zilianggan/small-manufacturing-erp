/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Attachment {
  name: string;
  type: string;
  size: number;
  dataUrl?: string; // Optional base64 or object URL representation
}

export interface InventoryItem {
  id: string;
  name: string;
  sku: string;
  type: 'RAW_MATERIAL' | 'FINISHED_GOOD';
  quantity: number;
  unit: string;
  unitCost: number;
  reorderPoint: number;
  supplierId?: string;
  description?: string;
  attachments?: Attachment[];
}

export interface Vendor {
  id: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  materialsSupplied: string[];
  address: string;
  rating: number; // 1-5
  attachments?: Attachment[];
}

export interface Client {
  id: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  companyName: string;
  address: string;
  totalOrdersValue: number;
  attachments?: Attachment[];
}

export interface SalesOrderItem {
  itemId: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface SalesOrder {
  id: string;
  clientId: string;
  clientName: string;
  itemId: string; // FINISHED_GOOD (main or first item fallback)
  itemName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  orderDate: string;
  deliveryDate: string;
  status: 'PENDING' | 'IN_PRODUCTION' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
  workflowTaskId?: string;
  attachments?: Attachment[];
  items?: SalesOrderItem[];
}

export interface PurchaseOrderItem {
  itemId: string;
  itemName: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
}

export interface PurchaseOrder {
  id: string;
  vendorId: string;
  vendorName: string;
  itemId: string; // RAW_MATERIAL (main or first item fallback)
  itemName: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  orderDate: string;
  status: 'DRAFT' | 'ORDERED' | 'RECEIVED' | 'CANCELLED';
  receivedDate?: string;
  attachments?: Attachment[];
  items?: PurchaseOrderItem[];
}

export interface WorkflowTask {
  id: string;
  orderId: string;
  productName: string;
  quantity: number;
  currentStep: 'PREPARATION' | 'ASSEMBLY' | 'QUALITY_CONTROL' | 'PACKAGING' | 'COMPLETED';
  assignedTo?: string; // Can be name or employeeId
  startDate: string;
  endDate?: string;
  notes?: string;
}

export interface Employee {
  id: string;
  name: string;
  role: string;
  department: string;
  status: 'ACTIVE' | 'INACTIVE';
  email?: string;
  phone?: string;
}

export interface DashboardStats {
  totalSales: number;
  totalPurchaseCosts: number;
  totalProfit: number;
  inventoryValuation: number;
  lowStockCount: number;
  pendingOrdersCount: number;
  activeWorkflowsCount: number;
}

export interface CompanyProfile {
  name: string;
  iconType: 'database' | 'factory' | 'cpu' | 'wrench' | 'custom_image';
  iconDataUrl?: string; // Stored base64 representation if uploaded
  address?: string;
  phone?: string;
  email?: string;
  bankName?: string;
  bankAccount?: string;
  signatureUrl?: string; // Stored base64 representation of a signature image
  chopUrl?: string; // Stored base64 representation of a rubber stamp/chop image
}
