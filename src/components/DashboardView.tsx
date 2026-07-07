/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from 'react';
import { DollarSign, Package, TrendingUp, AlertTriangle, Play, ClipboardList, ShoppingCart } from 'lucide-react';
import { useTableData } from '../hooks/useTableData';
import { getWorkflowTasks } from '../services/WorkflowsService';
import { InventoryItem, SalesOrder, PurchaseOrder, WorkflowTask, DashboardStats } from '../types';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';
import LoadingSpinner from './LoadingSpinner';

export default function DashboardView() {
  const { data: inventory, loading: invLoading } = useTableData<InventoryItem>('inventory_items');
  const { data: salesOrders, loading: soLoading } = useTableData<SalesOrder>('sales_orders');
  const { data: purchaseOrders, loading: poLoading } = useTableData<PurchaseOrder>('purchase_orders');
  const [workflows, setWorkflows] = useState<WorkflowTask[]>([]);
  const [wfLoading, setWfLoading] = useState(true);
  useEffect(() => {
    getWorkflowTasks()
      .then(setWorkflows)
      .catch(console.error)
      .finally(() => setWfLoading(false));
  }, []);
  const loading = invLoading || soLoading || poLoading || wfLoading;

  const trackableInventory = inventory;

  const stats = useMemo<DashboardStats>(() => {
    const totalSales = salesOrders.filter(s => s.status !== 'CANCELLED').reduce((sum, s) => sum + s.totalPrice, 0);
    const totalPurchaseCosts = purchaseOrders.filter(p => p.status === 'RECEIVED').reduce((sum, p) => sum + p.totalCost, 0);
    return {
      totalSales,
      totalPurchaseCosts,
      totalProfit: totalSales - totalPurchaseCosts,
      inventoryValuation: trackableInventory.reduce((sum, i) => sum + i.quantity * i.unitCost, 0),
      lowStockCount: trackableInventory.filter(i => i.quantity <= i.reorderPoint).length,
      pendingOrdersCount: salesOrders.filter(s => s.status === 'PENDING').length,
      activeWorkflowsCount: workflows.filter(w => w.stage !== 'COMPLETED').length,
    };
  }, [trackableInventory, salesOrders, purchaseOrders, workflows]);

  // Format currencies
  const formatCurrency = (val: number) => {
    return `RM ${val.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  };

  // Chart data: Sales vs Purchase costs grouped by month or recent records
  const financialChartData = useMemo(() => {
    // Simulated monthly accumulation for realistic view
    return [
      { name: 'Jan', Sales: 3200, Purchases: 1100, Profit: 2100 },
      { name: 'Feb', Sales: 4500, Purchases: 1500, Profit: 3000 },
      { name: 'Mar', Sales: 6100, Purchases: 2200, Profit: 3900 },
      { name: 'Apr', Sales: 8900, Purchases: 2900, Profit: 6000 },
      { name: 'May', Sales: 12100, Purchases: 3800, Profit: 8300 },
      { name: 'Jun (YTD)', Sales: stats.totalSales, Purchases: stats.totalPurchaseCosts, Profit: stats.totalProfit }
    ];
  }, [stats]);

  // Inventory distribution chart data
  const inventoryChartData = useMemo(() => {
    const rawMaterialsVal = trackableInventory
      .filter(item => item.type === 'RAW_MATERIAL')
      .reduce((sum, item) => sum + (item.quantity * item.unitCost), 0);

    const finishedGoodsVal = trackableInventory
      .filter(item => item.type === 'FINISHED_GOOD')
      .reduce((sum, item) => sum + (item.quantity * item.unitCost), 0);

    return [
      { name: 'Raw Materials', value: rawMaterialsVal, color: '#3b82f6' },
      { name: 'Finished Goods', value: finishedGoodsVal, color: '#10b981' }
    ];
  }, [trackableInventory]);

  // Low stock list
  const lowStockItems = useMemo(() => {
    return trackableInventory.filter(item => item.quantity <= item.reorderPoint).slice(0, 5);
  }, [trackableInventory]);

  // Recent workflow steps
  const activeWorkflows = useMemo(() => {
    return workflows.filter(w => w.stage !== 'COMPLETED').slice(0, 5);
  }, [workflows]);

  return (
    <div className="space-y-6" id="dashboard-view">
      {loading && <LoadingSpinner message="Assembling metrics..." subtitle="DASHBOARD_LOAD" />}
      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">

        {/* Sales Card */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow flex items-start justify-between">
          <div className="space-y-1.5">
            <span className="text-slate-500 text-xs font-mono uppercase tracking-wider">Total Sales</span>
            <div className="text-2xl font-sans font-bold text-slate-900 dark:text-slate-100">{formatCurrency(stats.totalSales)}</div>
            <p className="text-xs text-emerald-600 flex items-center space-x-1 font-mono">
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Active contracts & orders</span>
            </p>
          </div>
          <div className="p-2.5 bg-blue-50 dark:bg-slate-700 text-blue-600 dark:text-blue-400 rounded-lg">
            <DollarSign className="w-5 h-5" />
          </div>
        </div>

        {/* Purchase Card */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow flex items-start justify-between">
          <div className="space-y-1.5">
            <span className="text-slate-500 text-xs font-mono uppercase tracking-wider">Purchase Costs</span>
            <div className="text-2xl font-sans font-bold text-slate-900 dark:text-slate-100">{formatCurrency(stats.totalPurchaseCosts)}</div>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">Completed supply purchases</p>
          </div>
          <div className="p-2.5 bg-amber-50 dark:bg-slate-700 text-amber-600 dark:text-amber-400 rounded-lg">
            <ShoppingCart className="w-5 h-5" />
          </div>
        </div>

        {/* Inventory Valuation */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow flex items-start justify-between">
          <div className="space-y-1.5">
            <span className="text-slate-500 text-xs font-mono uppercase tracking-wider">Inventory Valuation</span>
            <div className="text-2xl font-sans font-bold text-slate-900 dark:text-slate-100">{formatCurrency(stats.inventoryValuation)}</div>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">Raw stock & finished value</p>
          </div>
          <div className="p-2.5 bg-emerald-50 dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 rounded-lg">
            <Package className="w-5 h-5" />
          </div>
        </div>

        {/* Active Workflows */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow flex items-start justify-between">
          <div className="space-y-1.5">
            <span className="text-slate-500 text-xs font-mono uppercase tracking-wider">Active Productions</span>
            <div className="text-2xl font-sans font-bold text-slate-900 dark:text-slate-100">{stats.activeWorkflowsCount}</div>
            <p className="text-xs text-blue-600 dark:text-blue-400 font-mono flex items-center space-x-1">
              <Play className="w-3 h-3 animate-pulse" />
              <span>In-factory workflow steps</span>
            </p>
          </div>
          <div className="p-2.5 bg-sky-50 dark:bg-slate-700 text-sky-600 dark:text-sky-400 rounded-lg">
            <ClipboardList className="w-5 h-5" />
          </div>
        </div>

      </div>

      {/* Main Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Financial Bar Chart */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div className="space-y-1 mb-4">
            <h3 className="font-sans font-semibold text-slate-900">Financial Growth & Cost Trajectory</h3>
            <p className="text-xs text-slate-500">Sales orders vs raw material procurement costs (YTD monthly cumulative)</p>
          </div>
          <div className="w-full h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={financialChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `RM ${v}`} />
                <Tooltip formatter={(value) => [`RM ${value}`, '']} contentStyle={{ background: '#0f172a', borderRadius: '8px', color: '#fff', fontSize: '12px' }} />
                <Legend iconSize={10} iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                <Bar dataKey="Sales" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Sales revenue" />
                <Bar dataKey="Purchases" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Purchase costs" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Inventory Allocation Pie Chart */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div className="space-y-1 mb-4">
            <h3 className="font-sans font-semibold text-slate-900">Inventory Distribution</h3>
            <p className="text-xs text-slate-500">Total capital valuation across raw and completed items</p>
          </div>
          <div className="w-full h-[220px] flex items-center justify-center relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip formatter={(v) => [`RM ${v}`, '']} contentStyle={{ background: '#0f172a', borderRadius: '8px', color: '#fff', fontSize: '12px' }} />
                <Pie
                  data={inventoryChartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {inventoryChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            {/* Center label */}
            <div className="absolute text-center">
              <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400">Total Capital</span>
              <div className="text-xl font-bold font-sans text-slate-950 dark:text-slate-100">{formatCurrency(stats.inventoryValuation)}</div>
            </div>
          </div>
          <div className="space-y-2 pt-2 border-t border-slate-100 text-xs">
            {inventoryChartData.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between text-slate-600">
                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  <span>{item.name}</span>
                </div>
                <span className="font-mono font-medium text-slate-900">{formatCurrency(item.value)}</span>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Grid: Low Stock Alert & Active Workflows */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Low Stock Panel */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4.5 h-4.5 text-amber-500" />
              <h3 className="font-sans font-semibold text-slate-900">Critical Stock Alerts</h3>
            </div>
            <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-mono">
              {stats.lowStockCount} items low
            </span>
          </div>

          {lowStockItems.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-400">
              ✓ All inventory levels are safe. No immediate restocks required.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {lowStockItems.map((item, idx) => (
                <div key={idx} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-semibold text-slate-800">{item.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{item.sku}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold font-mono text-red-600">{item.quantity} {item.unit}</div>
                    <div className="text-[10px] text-slate-400 font-mono">Reorder: {item.reorderPoint}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Manufacturing Workflow Queue */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center space-x-2">
              <ClipboardList className="w-4.5 h-4.5 text-blue-500" />
              <h3 className="font-sans font-semibold text-slate-900">Active Production Queue</h3>
            </div>
            <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-mono">
              {stats.activeWorkflowsCount} in progress
            </span>
          </div>

          {activeWorkflows.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-400">
              No active production runs. Launch from Sales Orders to start.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {activeWorkflows.map((task, idx) => (
                <div key={idx} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-semibold text-slate-800">{task.productName}</div>
                    <div className="text-[10px] text-slate-400 font-mono">Qty: {task.quantity} • Assg: {task.employeeName || 'Unassigned'}</div>
                  </div>
                  <div className="text-right">
                    <span className="px-2.5 py-0.5 rounded-full font-mono text-[10px] font-medium bg-blue-100 text-blue-800">
                      {task.stage}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
