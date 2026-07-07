# Dashboard Live Data — Design Spec

## Problem

`DashboardView.tsx` is stale from before the ERP restructure. It reads `inventory_items`, `sales_orders`, `purchase_orders` via the legacy `useTableData` hook — none of these tables exist anymore (schema now has `material`, `product`, `sales_header`/`sales_detail`, `purchase_header`/`purchase_detail`). The financial chart also hardcodes 5 months of fake numbers (Jan–May) and only the last bar ("Jun (YTD)") uses real (currently broken) data.

`ReportsView.tsx` has the same live-data problem via `db.ts`'s `getDashboardStats()`, but is **out of scope** here — same scoping precedent as `OrdersService.ts`'s existing comment that leaves Dashboard/Reports/ImportExport on the legacy tables for a later pass.

## Architecture

One Postgres RPC function, `get_dashboard_data()`, added to `supabase/function_trigger.sql` next to the existing `get_system_admin_data()` — same `RETURNS TABLE (... jsonb ...)` + single SQL statement pattern, called via `supabase.rpc('get_dashboard_data').single<DashboardData>()`. This mirrors the one-call, DB-side-aggregation approach already established for admin data, and matches the CTE/UNION query style the user prototyped.

A new `src/services/DashboardService.ts` wraps the RPC call and maps the jsonb payload into typed camelCase objects, following the `MaterialService.ts`/`OrdersService.ts` pattern (talks to Supabase directly, no `db.ts`, no `server.ts`).

The existing "Active Production Queue" panel keeps using `WorkflowsService.getWorkflowTasks()` as-is — it already reads `workflow_tasks` correctly and returns the joined fields (product name, employee name, stage) the panel needs. No reason to duplicate that in the RPC.

## RPC: `get_dashboard_data()`

Returns one row:

| column | type | meaning |
|---|---|---|
| `monthly_totals` | jsonb | array of `{ month: 'YYYY-MM', sales: number, purchases: number }` for the last 6 months (current month inclusive) |
| `raw_material_qty` | numeric | `SUM(quantity)` from `material` where `material_type = 'RAW_MATERIAL'` |
| `finished_goods_qty` | numeric | `SUM(quantity)` from `material` where `material_type = 'FINISHED_GOOD'` |
| `low_stock_items` | jsonb | up to 5 `material` rows where `quantity <= minimum_stock`, ordered by most-deficient first: `{ id, name, code, quantity, unit: null, minimumStock }` |
| `low_stock_count` | integer | total count of `material` rows where `quantity <= minimum_stock` (not capped at 5) |

Filtering rules (confirmed with user):
- **Sales monthly total**: `sales_header.total_amount` summed where `status NOT IN ('CANCELLED', 'QUOTATION')`.
- **Purchase monthly total**: `purchase_header.total_price` summed where `status NOT IN ('CANCELLED', 'QUOTATION')` (applied symmetrically with sales — purchases also have a `QUOTATION` status per `PurchasesService.ts`).

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

This needs to be run manually in the Supabase SQL editor (no migration runner in this repo — same as how `get_system_admin_data` was applied).

## Types (`src/types.ts`)

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

The existing `DashboardStats` interface (used by `db.ts`/`ReportsView.tsx`) is untouched — separate, still-legacy consumer.

## `src/services/DashboardService.ts` (new)

```ts
export const getDashboardData = async (): Promise<DashboardData> => {
  const { data, error } = await supabase.rpc('get_dashboard_data').single();
  if (error) { console.error('getDashboardData', error); throw error; }
  return {
    monthlyTotals: data.monthly_totals || [],
    rawMaterialQty: Number(data.raw_material_qty) || 0,
    finishedGoodsQty: Number(data.finished_goods_qty) || 0,
    lowStockItems: (data.low_stock_items || []).map((r: any) => ({
      id: r.id, name: r.name, code: r.code || undefined,
      quantity: Number(r.quantity) || 0, minimumStock: Number(r.minimum_stock) || 0,
    })),
    lowStockCount: Number(data.low_stock_count) || 0,
  };
};
```

## `DashboardView.tsx` changes

- Drop `useTableData` for `inventory_items`/`sales_orders`/`purchase_orders`. Fetch via `getDashboardData()` (`useEffect` + `useState`, same shape as `getWorkflowTasks()` is already loaded) and keep `getWorkflowTasks()` for the production queue panel/count.
- Loading = dashboard data loading OR workflow loading.
- KPI cards (4, same grid):
  1. **Total Sales** — sum of `monthlyTotals[].sales` (equivalent to summed non-cancelled/non-quotation orders across the 6-month window). Keep `TrendingUp` icon/copy.
  2. **Purchase Costs** — sum of `monthlyTotals[].purchases`.
  3. **Inventory Levels** (replaces "Inventory Valuation") — shows `rawMaterialQty + finishedGoodsQty` as a unit count (no currency format — material has no per-unit cost anymore). Subtitle: "Raw stock & finished units".
  4. **Active Productions** — unchanged, `workflows.length` (already filtered to `IN_PRODUCTION` by `getWorkflowTasks`).
- Financial bar chart: `financialChartData` now maps directly from `monthlyTotals`: `{ name: monthLabel, Sales, Purchases, Profit: Sales - Purchases }`, `monthLabel` derived from `'YYYY-MM'` (e.g. `to short month name` client-side via `Date`). No more hardcoded array.
- Inventory pie chart: switch from $ value split to quantity split — `{ name: 'Raw Materials', value: rawMaterialQty }` / `{ name: 'Finished Goods', value: finishedGoodsQty }`. Center label switches from `formatCurrency` to a plain formatted number ("Total Units").
- Low Stock panel: sourced from `lowStockItems`/`lowStockCount` instead of client-side filtering of `trackableInventory`. Item row loses the `unit` field (not returned — `material` has no unit column) — show quantity/minimumStock as plain numbers.
- `pendingOrdersCount` (was computed but never rendered) is dropped entirely — dead code, not carried into the new data shape.

## Out of scope

- `ReportsView.tsx` / `db.ts`'s `getDashboardStats()` — separate legacy consumer, not touched.
- No changes to `ImportExportModal.tsx`.
