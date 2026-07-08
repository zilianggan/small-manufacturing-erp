/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { UUID } from "crypto";

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
  materialCategoryId?: string; // RAW_MATERIAL items
  productCategoryId?: string; // FINISHED_GOOD items
  quantity: number;
  unit: string;
  unitCost: number;
  reorderPoint: number;
  supplierId?: string;
  description?: string;
  attachments?: Attachment[];
  createdAt?: string;
  updatedAt?: string;
}

export interface Vendor {
  id: string;
  companyName: string;
  email: string;
  officeNo: string;
  address: string;
  description?: string;
  attachments?: Attachment[];
  createdAt?: string;
  updatedAt?: string;
}

export interface Client {
  id: string;
  companyName: string;
  email: string;
  officeNo: string;
  address: string;
  description?: string;
  attachments?: Attachment[];
  createdAt?: string;
  updatedAt?: string;
}

// A person belonging to exactly one Vendor or Client company.
export interface Contact {
  id: string;
  fullName: string;
  contactNo?: string;
  email?: string;
  jobPositionId?: string; // FK -> job_positions.id
  vendorId?: string; // Set for a vendor-side contact (mutually exclusive with clientId)
  clientId?: string; // Set for a client-side contact (mutually exclusive with vendorId)
  attachments?: Attachment[];
  createdAt?: string;
  updatedAt?: string;
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
  createdAt?: string;
  updatedAt?: string;
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
  createdAt?: string;
  updatedAt?: string;
}

export interface PurchaseDetail {
  detailId: string;
  headerId?: string;
  materialId: string;
  materialName: string; // snapshot
  materialCode?: string; // snapshot
  quantity: number;
  unitCost: number;
  totalPrice: number;
  receivedQuantity: number;
  material?: Material;
}

export interface PurchaseHeader {
  id: string;
  purchaseNo: string;
  quotationDate: string;
  orderDate?: string;
  receivedDate?: string;
  status: 'QUOTATION' | 'ORDERED' | 'RECEIVED' | 'CANCELLED';
  vendorId: string;
  vendorName: string; // joined, display only
  totalPrice: number;
  attachments?: Attachment[];
  salesHeaderId?: string; // FK -> sales_header.id, optional link to the sales order this purchase serves
  details: PurchaseDetail[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductionMaterialUsage {
  id: string;
  salesDetailId?: string;
  materialId: string;
  materialName: string; // joined, display only
  materialCode?: string; // joined, display only
  plannedQuantity: number;
  actualQuantity: number;
  returnedQuantity: number;
}

export interface SalesDetail {
  detailId: string;
  headerId?: string;
  productId: string;
  productName: string; // snapshot
  productCode?: string; // snapshot
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  remark?: string;
  materials: ProductionMaterialUsage[];
  product?: Product;
}

export interface SalesHeader {
  id: string;
  salesNo: string;
  orderDate: string;
  deliveryDate?: string;
  status: 'QUOTATION' | 'ORDERED' | 'IN_PRODUCTION' | 'DONE_IN_PRODUCTION' | 'DELIVERED' | 'CANCELLED';
  clientId: string;
  clientName: string; // joined, display only
  totalAmount: number;
  remark?: string;
  attachments?: Attachment[];
  details: SalesDetail[];
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkflowTask {
  id: string;
  headerId: string; // joined via sales_detail.header_id — groups tasks by order
  salesNo: string; // joined via sales_detail.sales_header.sales_no
  productName: string; // joined via sales_detail.product_name
  quantity: number; // joined via sales_detail.quantity
  stage: 'PREPARATION' | 'ASSEMBLY' | 'QUALITY_CONTROL' | 'PACKAGING' | 'COMPLETED';
  employeeId?: string;
  employeeName?: string; // joined via employees.full_name
  startDate: string;
  endDate?: string;
  remark?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Employee {
  id: string;
  fullName: string;
  contactNo?: string;
  email?: string;
  jobPositionId?: string; // FK -> job_positions.id
  status: 'ACTIVE' | 'INACTIVE';
  createdAt?: string;
  updatedAt?: string;
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

export interface DashboardMonthlyTotal {
  month: string; // 'YYYY-MM'
  sales: number;
  purchases: number;
}

export interface DashboardLowStockItem {
  id: string;
  name: string;
  code?: string;
  quantity: number;
  minimumStock: number;
}

export interface DashboardData {
  monthlyTotals: DashboardMonthlyTotal[];
  rawMaterialQty: number;
  finishedGoodsQty: number;
  lowStockItems: DashboardLowStockItem[];
  lowStockCount: number;
}

export interface CompanyProfile {
  id?: UUID,
  name: string;
  icon_type: 'database' | 'factory' | 'cpu' | 'wrench' | 'custom_image';
  icon_data_url?: string; // Stored base64 representation if uploaded
  address?: string;
  phone?: string;
  email?: string;
  bank_name?: string;
  bank_account?: string;
  signature_url?: string; // Stored base64 representation of a signature image
  chop_url?: string; // Stored base64 representation of a rubber stamp/chop image
  so_number_format?: string; // e.g. "SO-0000" — the run of zeros marks the zero-padded number position
  so_next_number?: number;
  po_number_format?: string; // e.g. "PO-0000"
  po_next_number?: number;
}

// Minimal parameter shape shared by Job Position and Material/Product Category.
// All admin parameters carry only these four fields — nothing else.
export interface NamedParameter {
  id: string; // UUID
  name: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export type JobPosition = NamedParameter;
export type MaterialCategory = NamedParameter;
export type ProductCategory = NamedParameter;

export type MaterialType = 'RAW_MATERIAL' | 'FINISHED_GOOD' | 'CUSTOMER_STOCK';

export interface Material {
  id: string;
  name: string;
  code?: string;
  materialType?: MaterialType;
  dimension?: string;
  quantity: number; // Read-only: maintained by the update_material_stock() DB trigger
  description?: string;
  attachments?: Attachment[];
  status?: 'ACTIVE' | 'INACTIVE';
  minimumStock: number;
  reorderQuantity: number;
  materialCategoryId?: string; // FK -> material_categories.id
  createdAt?: string;
  updatedAt?: string;
  // Only populated by getMaterialsPage() (aggregated from purchase_detail/purchase_header
  // via the get_materials_page() RPC) — undefined when fetched through getMaterials().
  latestPurchaseDate?: string;
  oldestPurchaseDate?: string;
}

export interface Product {
  id: string;
  name: string;
  code?: string;
  dimension?: string;
  description?: string;
  attachments?: Attachment[];
  status?: 'ACTIVE' | 'INACTIVE';
  sellingPrice: number;
  productCategoryId?: string; // FK -> product_categories.id
  createdAt?: string;
  updatedAt?: string;
  // Only populated by getProductsPage() (quantity is trigger-maintained same as
  // Material.quantity; latest/oldestSaleDate aggregated from sales_detail/
  // sales_header via the get_products_page() RPC) — all undefined when
  // fetched through getProducts().
  quantity?: number;
  latestSaleDate?: string;
  oldestSaleDate?: string;
}

export type InventoryTransactionType = 'PURCHASE' | 'SALES' | 'PURCHASE_RETURN' | 'SALES_RETURN' | 'ADJUSTMENT';

// A single stock movement row (inventory_transaction). Insert-only — the
// update_material_stock() DB trigger applies `quantity` (signed) to
// material.quantity or product.quantity on INSERT, so there is no
// update/delete path for this type.
export interface InventoryTransaction {
  id: string;
  transactionType: InventoryTransactionType;
  quantity: number; // signed: + increases stock, - decreases stock
  unitCost?: number;
  remark?: string;
  materialId?: string; // exactly one of materialId/productId is set
  materialName?: string; // joined, display only
  productId?: string;
  productName?: string; // joined, display only
  purchaseDetailId?: string; // FK -> purchase_detail.detail_id, set when a PO receipt generated this row
  productionMaterialUsageId?: string; // FK -> production_material_usage.id, set when a production reservation/reconciliation generated this row
  transactionDate: string;
  createdAt?: string;
}

// Unified row for MaterialDetailView's/ProductDetailView's "Inventory List":
// order-level rows (purchase_detail for materials, sales_detail for products)
// merged with any other inventory_transaction movements against the same
// item (e.g. a material consumed in production against a sales order, or a
// product's extra-produced adjustment). ADJUSTMENT rows have no order header
// to join, so refNo/counterpartyName/status/*HeaderId stay unset for them.
export interface InventoryListItem {
  id: string;
  transactionType: InventoryTransactionType;
  refNo?: string; // purchase_no or sales_no
  counterpartyName?: string; // vendor (purchase) or client (sales) company name
  orderDate?: string;
  quantity: number;
  unitCost?: number;
  totalPrice?: number;
  status?: string;
  purchaseHeaderId?: string; // set for PURCHASE/PURCHASE_RETURN rows -> Purchases tab
  salesHeaderId?: string; // set for SALES/SALES_RETURN rows -> Orders tab
}

export interface SystemAdminData {
  job_positions: JobPosition[];
  material_categories: MaterialCategory[];
  product_categories: ProductCategory[];
}