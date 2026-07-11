/**
 * Dashboard module service layer.
 *
 * Talks to Supabase directly via a single RPC call (get_dashboard_data,
 * defined in supabase/function_trigger.sql), mirroring how
 * SystemAdminService.loadSystemAdminData calls get_system_admin_data.
 * No db.ts, no server.ts REST hop, no useTableData.
 */
import { supabase } from "./supabase";
import { DashboardData, SalesHeader, PurchaseHeader } from "../types";

export const getDashboardData = async (): Promise<DashboardData> => {
  const { data, error } = await supabase.rpc('get_dashboard_data').single<{
    monthly_totals: { month: string; sales: number; purchases: number }[] | null;
    raw_material_qty: number | string | null;
    finished_goods_qty: number | string | null;
    low_stock_items: { id: string; name: string; code: string | null; quantity: number | string; minimum_stock: number | string }[] | null;
    low_stock_count: number | null;
  }>();
  if (error) {
    console.error('getDashboardData', error);
    throw error;
  }

  return {
    monthlyTotals: (data.monthly_totals || []).map(m => ({
      month: m.month,
      sales: Number(m.sales) || 0,
      purchases: Number(m.purchases) || 0,
    })),
    rawMaterialQty: Number(data.raw_material_qty) || 0,
    finishedGoodsQty: Number(data.finished_goods_qty) || 0,
    lowStockItems: (data.low_stock_items || []).map(r => ({
      id: r.id,
      name: r.name,
      code: r.code || undefined,
      quantity: Number(r.quantity) || 0,
      minimumStock: Number(r.minimum_stock) || 0,
    })),
    lowStockCount: Number(data.low_stock_count) || 0,
  };
};

const OUTSTANDING_SALES_STATUSES = ['ORDERED', 'IN_PRODUCTION', 'DONE_IN_PRODUCTION'] as const;

/** Count of sales orders confirmed but not yet delivered/cancelled — direct Supabase read, no RPC. */
export const getOutstandingOrdersCount = async (): Promise<number> => {
  const { count, error } = await supabase
    .from('sales_header')
    .select('*', { count: 'exact', head: true })
    .in('status', OUTSTANDING_SALES_STATUSES);
  if (error) {
    console.error('getOutstandingOrdersCount', error);
    throw error;
  }
  return count || 0;
};

/** Total active material SKU count — used alongside lowStockCount for an "inventory health" ratio. */
export const getMaterialCount = async (): Promise<number> => {
  const { count, error } = await supabase.from('material').select('*', { count: 'exact', head: true });
  if (error) {
    console.error('getMaterialCount', error);
    throw error;
  }
  return count || 0;
};

export interface RecentSale {
  id: string;
  salesNo: string;
  clientName: string;
  totalAmount: number;
  status: SalesHeader['status'];
  orderDate: string;
}

export interface RecentPurchase {
  id: string;
  purchaseNo: string;
  vendorName: string;
  totalPrice: number;
  status: PurchaseHeader['status'];
  orderDate: string | null;
}

/** Latest N sales orders for the dashboard's "Recent Sales" widget — lightweight columns only. */
export const getRecentSales = async (limit = 5): Promise<RecentSale[]> => {
  const { data, error } = await supabase
    .from('sales_header')
    .select('id, sales_no, order_date, status, total_amount, clients(company_name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('getRecentSales', error);
    throw error;
  }
  return (data || []).map((row: any) => ({
    id: row.id,
    salesNo: row.sales_no,
    clientName: row.clients?.company_name || '',
    totalAmount: Number(row.total_amount) || 0,
    status: row.status,
    orderDate: row.order_date,
  }));
};

/** Latest N purchase orders for the dashboard's "Recent Purchases" widget — lightweight columns only. */
export const getRecentPurchases = async (limit = 5): Promise<RecentPurchase[]> => {
  const { data, error } = await supabase
    .from('purchase_header')
    .select('id, purchase_no, order_date, status, total_price, vendors(company_name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('getRecentPurchases', error);
    throw error;
  }
  return (data || []).map((row: any) => ({
    id: row.id,
    purchaseNo: row.purchase_no,
    vendorName: row.vendors?.company_name || '',
    totalPrice: Number(row.total_price) || 0,
    status: row.status,
    orderDate: row.order_date,
  }));
};
