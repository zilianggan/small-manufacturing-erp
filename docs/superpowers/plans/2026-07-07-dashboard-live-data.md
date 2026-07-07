# Dashboard Live Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `DashboardView.tsx`'s stale/broken data sources (`inventory_items`, `sales_orders`, `purchase_orders` — tables that no longer exist) and hardcoded chart numbers with live data from a new single-call `get_dashboard_data()` Postgres RPC, per `docs/superpowers/specs/2026-07-07-dashboard-live-data-design.md`.

**Architecture:** One Postgres RPC function (`get_dashboard_data()` in `supabase/function_trigger.sql`, same pattern as the existing `get_system_admin_data()`) aggregates 6-month sales/purchase totals, raw/finished material quantities, and low-stock items in one round trip. A new pattern-A `DashboardService.ts` wraps the RPC call. `DashboardView.tsx` is rewritten to consume it, keeping `WorkflowsService.getWorkflowTasks()` (already correct) for the production queue panel.

**Tech Stack:** React 19 + TypeScript, Supabase (`supabase-js`, Postgres RPC), Recharts, Tailwind v4. No automated test runner in this repo (`npm run lint` = `tsc --noEmit` is the only CI-style check) — per-task verification is a clean `tsc --noEmit`; the user applies the SQL function and does manual browser QA themselves (do not launch the dev server or drive the UI yourself).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-07-dashboard-live-data-design.md` — every task below implements a section of it.
- No commits are being made during this plan (user preference) — review each task's diff as uncommitted working-tree changes.
- `supabase/schema.sql` and `supabase/function_trigger.sql` are reference files only — nothing in this repo auto-applies them to the live Supabase project. Do not attempt to run the new SQL function against the DB yourself; the user applies it manually in the Supabase SQL editor (Task 5 has the exact instruction to give them).
- `ReportsView.tsx` / `db.ts`'s `getDashboardStats()`/`DashboardStats` type are untouched — separate legacy consumer, out of scope.
- Do not touch `WorkflowsService.ts`, `WorkflowsView.tsx`, or `WorkflowTask` — `getWorkflowTasks()` already reads live `workflow_tasks` correctly and is reused as-is.
- Do not run the dev server, open a browser, or otherwise self-test the UI — the user verifies manually. Verification command for every TS task: `npm run lint` (must exit 0, no new TypeScript errors).

---

### Task 1: SQL — `get_dashboard_data()` RPC function

**Files:**
- Modify: `supabase/function_trigger.sql` (append after `get_system_admin_data()`)

**Interfaces:**
- Produces: Postgres function `get_dashboard_data()` returning one row `(monthly_totals jsonb, raw_material_qty numeric, finished_goods_qty numeric, low_stock_items jsonb, low_stock_count integer)` — consumed by Task 3's `DashboardService.getDashboardData()` via `supabase.rpc('get_dashboard_data')`.

- [ ] **Step 1: Append the function**

At the end of `supabase/function_trigger.sql` (after the closing `$$;` of `get_system_admin_data`), add:

```sql

CREATE OR REPLACE FUNCTION get_dashboard_data()
RETURNS TABLE (
    monthly_totals jsonb,
    raw_material_qty numeric,
    finished_goods_qty numeric,
    low_stock_items jsonb,
    low_stock_count integer
)
LANGUAGE sql
AS $$
WITH months AS (
    SELECT generate_series(
        date_trunc('month', CURRENT_DATE) - interval '5 months',
        date_trunc('month', CURRENT_DATE),
        interval '1 month'
    ) AS month_start
),
sales_by_month AS (
    SELECT m.month_start, COALESCE(SUM(sh.total_amount), 0) AS sales_total
    FROM months m
    LEFT JOIN sales_header sh
        ON date_trunc('month', sh.order_date) = m.month_start
        AND sh.status NOT IN ('CANCELLED', 'QUOTATION')
    GROUP BY m.month_start
),
purchases_by_month AS (
    SELECT m.month_start, COALESCE(SUM(ph.total_price), 0) AS purchase_total
    FROM months m
    LEFT JOIN purchase_header ph
        ON date_trunc('month', ph.order_date) = m.month_start
        AND ph.status NOT IN ('CANCELLED', 'QUOTATION')
    GROUP BY m.month_start
),
low_stock AS (
    SELECT id, name, code, quantity, minimum_stock
    FROM material
    WHERE quantity <= minimum_stock
    ORDER BY (quantity - minimum_stock) ASC
    LIMIT 5
)
SELECT
    (
        SELECT jsonb_agg(jsonb_build_object(
            'month', to_char(s.month_start, 'YYYY-MM'),
            'sales', s.sales_total,
            'purchases', p.purchase_total
        ) ORDER BY s.month_start)
        FROM sales_by_month s
        JOIN purchases_by_month p ON p.month_start = s.month_start
    ),
    (SELECT COALESCE(SUM(quantity), 0) FROM material WHERE material_type = 'RAW_MATERIAL'),
    (SELECT COALESCE(SUM(quantity), 0) FROM material WHERE material_type = 'FINISHED_GOOD'),
    (SELECT jsonb_agg(t) FROM low_stock t),
    (SELECT COUNT(*)::int FROM material WHERE quantity <= minimum_stock);
$$;
```

- [ ] **Step 2: Self-check the SQL against the schema**

Re-read `supabase/schema.sql`'s `sales_header`, `purchase_header`, and `material` table definitions. Confirm every column referenced above exists exactly as named: `sales_header.total_amount`/`order_date`/`status`, `purchase_header.total_price`/`order_date`/`status`, `material.id`/`name`/`code`/`quantity`/`minimum_stock`/`material_type`. No code-level check is possible for SQL in this repo (no local Postgres, no migration runner) — this read-back is the verification for this task.

---

### Task 2: Types — `DashboardData` shapes

**Files:**
- Modify: `src/types.ts` (add near the existing `DashboardStats` interface, ~line 230)

**Interfaces:**
- Produces: `DashboardMonthlyTotal { month: string; sales: number; purchases: number }`, `DashboardLowStockItem { id: string; name: string; code?: string; quantity: number; minimumStock: number }`, `DashboardData { monthlyTotals: DashboardMonthlyTotal[]; rawMaterialQty: number; finishedGoodsQty: number; lowStockItems: DashboardLowStockItem[]; lowStockCount: number }` — consumed by Task 3's `DashboardService.ts` and Task 4's `DashboardView.tsx`.

- [ ] **Step 1: Add the new interfaces**

In `src/types.ts`, directly after the existing `DashboardStats` interface (the one ending `activeWorkflowsCount: number; }`), add:

```ts
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
```

Leave the existing `DashboardStats` interface untouched — `db.ts`/`ReportsView.tsx` still use it.

- [ ] **Step 2: Verify**

Run: `npm run lint`
Expected: exits 0, no new errors (this only adds unused-so-far types).

---

### Task 3: `DashboardService.ts` — RPC wrapper

**Files:**
- Create: `src/services/DashboardService.ts`

**Interfaces:**
- Consumes: `DashboardData` type from Task 2; `supabase` client from `./supabase`.
- Produces: `getDashboardData(): Promise<DashboardData>` — consumed by Task 4's `DashboardView.tsx`.

- [ ] **Step 1: Write the service**

Create `src/services/DashboardService.ts`:

```ts
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
```

- [ ] **Step 2: Verify**

Run: `npm run lint`
Expected: exits 0, no new errors.

---

### Task 4: `DashboardView.tsx` — rewrite to use live data

**Files:**
- Modify: `src/components/DashboardView.tsx` (full rewrite — every section reads from the new data shape)

**Interfaces:**
- Consumes: `getDashboardData()` from Task 3, `DashboardData`/`DashboardMonthlyTotal`/`DashboardLowStockItem` types from Task 2, `getWorkflowTasks()` (unchanged, from `WorkflowsService.ts`), `WorkflowTask` type (unchanged).
- Produces: nothing consumed elsewhere — this is the leaf UI component.

- [ ] **Step 1: Replace the full file contents**

Replace all of `src/components/DashboardView.tsx` with:

```tsx
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from 'react';
import { DollarSign, Package, TrendingUp, AlertTriangle, Play, ClipboardList, ShoppingCart } from 'lucide-react';
import { getDashboardData } from '../services/DashboardService';
import { getWorkflowTasks } from '../services/WorkflowsService';
import { WorkflowTask, DashboardData } from '../types';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';
import LoadingSpinner from './LoadingSpinner';

const EMPTY_DASHBOARD: DashboardData = {
  monthlyTotals: [],
  rawMaterialQty: 0,
  finishedGoodsQty: 0,
  lowStockItems: [],
  lowStockCount: 0,
};

const monthLabel = (month: string): string => {
  const [year, mon] = month.split('-').map(Number);
  return new Date(year, mon - 1, 1).toLocaleString('en-US', { month: 'short' });
};

export default function DashboardView() {
  const [dashboard, setDashboard] = useState<DashboardData>(EMPTY_DASHBOARD);
  const [dashLoading, setDashLoading] = useState(true);
  const [workflows, setWorkflows] = useState<WorkflowTask[]>([]);
  const [wfLoading, setWfLoading] = useState(true);

  useEffect(() => {
    getDashboardData()
      .then(setDashboard)
      .catch(console.error)
      .finally(() => setDashLoading(false));
    getWorkflowTasks()
      .then(setWorkflows)
      .catch(console.error)
      .finally(() => setWfLoading(false));
  }, []);

  const loading = dashLoading || wfLoading;

  const totalSales = useMemo(() => dashboard.monthlyTotals.reduce((sum, m) => sum + m.sales, 0), [dashboard]);
  const totalPurchaseCosts = useMemo(() => dashboard.monthlyTotals.reduce((sum, m) => sum + m.purchases, 0), [dashboard]);
  const totalInventoryUnits = dashboard.rawMaterialQty + dashboard.finishedGoodsQty;
  const activeWorkflowsCount = workflows.length;

  // Format currencies
  const formatCurrency = (val: number) => {
    return `RM ${val.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  };

  const formatUnits = (val: number) => {
    return val.toLocaleString('en-US', { maximumFractionDigits: 0 });
  };

  // Chart data: Sales vs Purchase costs by month (last 6 months, from get_dashboard_data)
  const financialChartData = useMemo(() => {
    return dashboard.monthlyTotals.map(m => ({
      name: monthLabel(m.month),
      Sales: m.sales,
      Purchases: m.purchases,
      Profit: m.sales - m.purchases,
    }));
  }, [dashboard]);

  // Inventory distribution chart data (unit quantities, not $ value — material has no per-unit cost)
  const inventoryChartData = useMemo(() => {
    return [
      { name: 'Raw Materials', value: dashboard.rawMaterialQty, color: '#3b82f6' },
      { name: 'Finished Goods', value: dashboard.finishedGoodsQty, color: '#10b981' }
    ];
  }, [dashboard]);

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
            <div className="text-2xl font-sans font-bold text-slate-900 dark:text-slate-100">{formatCurrency(totalSales)}</div>
            <p className="text-xs text-emerald-600 flex items-center space-x-1 font-mono">
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Last 6 months, confirmed orders</span>
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
            <div className="text-2xl font-sans font-bold text-slate-900 dark:text-slate-100">{formatCurrency(totalPurchaseCosts)}</div>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">Last 6 months, confirmed purchases</p>
          </div>
          <div className="p-2.5 bg-amber-50 dark:bg-slate-700 text-amber-600 dark:text-amber-400 rounded-lg">
            <ShoppingCart className="w-5 h-5" />
          </div>
        </div>

        {/* Inventory Levels */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow flex items-start justify-between">
          <div className="space-y-1.5">
            <span className="text-slate-500 text-xs font-mono uppercase tracking-wider">Inventory Levels</span>
            <div className="text-2xl font-sans font-bold text-slate-900 dark:text-slate-100">{formatUnits(totalInventoryUnits)}</div>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">Raw stock & finished units</p>
          </div>
          <div className="p-2.5 bg-emerald-50 dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 rounded-lg">
            <Package className="w-5 h-5" />
          </div>
        </div>

        {/* Active Workflows */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow flex items-start justify-between">
          <div className="space-y-1.5">
            <span className="text-slate-500 text-xs font-mono uppercase tracking-wider">Active Productions</span>
            <div className="text-2xl font-sans font-bold text-slate-900 dark:text-slate-100">{activeWorkflowsCount}</div>
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
            <p className="text-xs text-slate-500">Sales orders vs raw material procurement costs (last 6 months)</p>
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
            <p className="text-xs text-slate-500">Unit quantities across raw and finished stock</p>
          </div>
          <div className="w-full h-[220px] flex items-center justify-center relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip formatter={(v) => [formatUnits(Number(v)), '']} contentStyle={{ background: '#0f172a', borderRadius: '8px', color: '#fff', fontSize: '12px' }} />
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
              <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400">Total Units</span>
              <div className="text-xl font-bold font-sans text-slate-950 dark:text-slate-100">{formatUnits(totalInventoryUnits)}</div>
            </div>
          </div>
          <div className="space-y-2 pt-2 border-t border-slate-100 text-xs">
            {inventoryChartData.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between text-slate-600">
                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  <span>{item.name}</span>
                </div>
                <span className="font-mono font-medium text-slate-900">{formatUnits(item.value)}</span>
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
              {dashboard.lowStockCount} items low
            </span>
          </div>

          {dashboard.lowStockItems.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-400">
              ✓ All inventory levels are safe. No immediate restocks required.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {dashboard.lowStockItems.map((item, idx) => (
                <div key={idx} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-semibold text-slate-800">{item.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{item.code}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold font-mono text-red-600">{formatUnits(item.quantity)}</div>
                    <div className="text-[10px] text-slate-400 font-mono">Min: {formatUnits(item.minimumStock)}</div>
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
              {activeWorkflowsCount} in progress
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
```

- [ ] **Step 2: Verify**

Run: `npm run lint`
Expected: exits 0, no TypeScript errors. In particular confirm no remaining references to `InventoryItem`, `SalesOrder`, `PurchaseOrder`, or `useTableData` in this file.

---

### Task 5: Final check + manual QA handoff

**Files:** none (verification-only task)

**Interfaces:** none — this task confirms Tasks 1-4 integrate correctly.

- [ ] **Step 1: Full project type-check**

Run: `npm run lint`
Expected: exits 0, no TypeScript errors anywhere in the project.

- [ ] **Step 2: Grep for leftover legacy references**

Run: `grep -rn "inventory_items\|useTableData" src/components/DashboardView.tsx`
Expected: no matches (confirms the legacy hook/table names are fully gone from this file).

- [ ] **Step 3: Hand off to the user**

Tell the user:
1. Apply the new `get_dashboard_data()` function from `supabase/function_trigger.sql` (Task 1) in the Supabase SQL editor — it isn't auto-applied.
2. Manually open the app's Dashboard tab and confirm: KPI cards show real (non-fake) numbers, the bar chart shows up to 6 real months (not the old Jan-May hardcoded ones), the pie chart shows unit quantities, and the Critical Stock Alerts panel lists real low-stock materials.
