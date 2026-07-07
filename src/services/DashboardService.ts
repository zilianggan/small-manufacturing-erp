/**
 * Dashboard module service layer.
 *
 * Talks to Supabase directly via a single RPC call (get_dashboard_data,
 * defined in supabase/function_trigger.sql), mirroring how
 * SystemAdminService.loadSystemAdminData calls get_system_admin_data.
 * No db.ts, no server.ts REST hop, no useTableData.
 */
import { supabase } from "./supabase";
import { DashboardData } from "../types";

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
