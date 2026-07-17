# Dashboard Widget Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user hide/show dashboard sections via a floating config button (bottom-right), with the preference persisted in Supabase.

**Architecture:** New `dashboard_preferences` table (single shared row, `visible_sections` jsonb) + `DashboardPreferencesService.ts` (cache-aside via localStorage, same shape as `CompanyProfileService.ts`). `DashboardView.tsx` loads the preference alongside its existing data fetch, gates each section's render on it, and renders a floating `Settings` button that opens a `Popover` with a checkbox per section.

**Tech Stack:** React 19 + TypeScript, Supabase JS client, Radix Popover (`components/ui/Popover.tsx`), lucide-react icons.

## Global Constraints
- No test runner in this project (frontend has none — `npm run lint` = `tsc --noEmit` is the only automated check). Every task's verification step is `tsc --noEmit` plus a manual description of what to check in the browser; the plan does NOT run the dev server or browser itself — the user tests visually.
- Schema changes go in `supabase/schema.sql` as an appended block; the user runs it manually in the Supabase SQL editor (no DB access from this environment). Never claim the table exists until the user confirms they ran it.
- Missing keys in `visible_sections` mean "visible" (default-on) — don't write a migration for old rows.
- Section keys (exact strings, used verbatim across all tasks):
  `KPI_ROW`, `SALES_TREND`, `INVENTORY_DISTRIBUTION`, `PURCHASE_VS_SALES`, `INVENTORY_HEALTH`, `QUICK_ACTIONS`, `RECENT_SALES`, `RECENT_PURCHASES`, `CRITICAL_STOCK_ALERTS`, `PRODUCTION_STATUS`, `ACTIVITY_TIMELINE`.

---

### Task 1: Schema + types

**Files:**
- Modify: `supabase/schema.sql` (append at end)
- Modify: `src/types.ts` (append near `CompanyProfile`, ~line 289)

**Interfaces:**
- Produces: `DashboardSectionKey` (union of the 11 keys above), `DashboardPreferences { id?: string; visible_sections: Partial<Record<DashboardSectionKey, boolean>> }` — consumed by Task 2 and Task 3.

- [ ] **Step 1: Append table DDL to `supabase/schema.sql`**

```sql
-- Dashboard widget visibility (single shared row, no per-user auth in this app)
create table dashboard_preferences (
  id uuid primary key default gen_random_uuid(),
  visible_sections jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
```

- [ ] **Step 2: Add types to `src/types.ts`**

Insert immediately before `export interface CompanyProfile {` (line 289):

```ts
export type DashboardSectionKey =
  | 'KPI_ROW' | 'SALES_TREND' | 'INVENTORY_DISTRIBUTION' | 'PURCHASE_VS_SALES'
  | 'INVENTORY_HEALTH' | 'QUICK_ACTIONS' | 'RECENT_SALES' | 'RECENT_PURCHASES'
  | 'CRITICAL_STOCK_ALERTS' | 'PRODUCTION_STATUS' | 'ACTIVITY_TIMELINE';

export interface DashboardPreferences {
  id?: string;
  visible_sections: Partial<Record<DashboardSectionKey, boolean>>;
}

```

- [ ] **Step 3: Verify**

Run: `npm run lint`
Expected: no new errors (types compile; nothing consumes them yet).

- [ ] **Step 4: Tell the user to run the SQL**

Output the exact `create table` block from Step 1 and ask the user to run it in the Supabase SQL editor before Task 2's service is exercised live. Do not proceed to claim the table exists — just note it in the task summary.

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql src/types.ts
git commit -m "feat: add dashboard_preferences schema and types"
```

---

### Task 2: DashboardPreferencesService

**Files:**
- Create: `src/services/DashboardPreferencesService.ts`

**Interfaces:**
- Consumes: `DashboardPreferences`, `DashboardSectionKey` from Task 1 (`../types`); `getStorageItem`/`setStorageItem`/`removeStorageItem` from `../helper`; `supabase` from `./supabase`.
- Produces: `getDashboardPreferences(): Promise<DashboardPreferences>`, `saveDashboardPreferences(prefs: DashboardPreferences): Promise<DashboardPreferences>` — consumed by Task 3.

- [ ] **Step 1: Write the service**

Follow `src/services/CompanyProfileService.ts` exactly (same cache-aside shape, no TTL — cache is invalidated on every save so staleness can't outlive a write):

```ts
import { supabase } from "./supabase";
import { getStorageItem, removeStorageItem, setStorageItem } from "../helper";
import { DashboardPreferences } from "../types";

const CACHE_KEY = "erp_dashboard_preferences";
const DEFAULT_PREFERENCES: DashboardPreferences = { visible_sections: {} };

export const getDashboardPreferences = async (): Promise<DashboardPreferences> => {
  const cached = getStorageItem<DashboardPreferences | null>(CACHE_KEY, null);
  if (cached) return cached;

  const { data, error } = await supabase
    .from("dashboard_preferences")
    .select("*")
    .maybeSingle();

  if (error) {
    console.error(error);
    return DEFAULT_PREFERENCES;
  }
  const prefs = data ?? DEFAULT_PREFERENCES;
  setStorageItem(CACHE_KEY, prefs);
  return prefs;
};

export const saveDashboardPreferences = async (prefs: DashboardPreferences): Promise<DashboardPreferences> => {
  let result;

  if (prefs.id) {
    result = await supabase
      .from("dashboard_preferences")
      .update({ visible_sections: prefs.visible_sections })
      .eq("id", prefs.id)
      .select()
      .single();
  } else {
    result = await supabase
      .from("dashboard_preferences")
      .insert({ visible_sections: prefs.visible_sections })
      .select()
      .single();
  }

  if (result.error) {
    throw result.error;
  }

  removeStorageItem(CACHE_KEY);
  setStorageItem(CACHE_KEY, result.data);
  return result.data;
};
```

- [ ] **Step 2: Verify**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/DashboardPreferencesService.ts
git commit -m "feat: add DashboardPreferencesService"
```

---

### Task 3: Wire visibility toggles into DashboardView

**Files:**
- Modify: `src/components/DashboardView.tsx`

**Interfaces:**
- Consumes: `getDashboardPreferences`, `saveDashboardPreferences` from `../services/DashboardPreferencesService` (Task 2); `DashboardPreferences`, `DashboardSectionKey` from `../types` (Task 1); `Popover`, `PopoverTrigger`, `PopoverContent`, `Button` from `./ui`; `Settings` icon from `lucide-react`.

- [ ] **Step 1: Add imports**

At the top of `src/components/DashboardView.tsx`, extend existing imports:

```ts
// add to the lucide-react import (line 3-5)
Settings,
```

```ts
// new imports, after the WorkflowsService import (line 10)
import { getDashboardPreferences, saveDashboardPreferences } from '../services/DashboardPreferencesService';
```

```ts
// extend the types import (line 11)
import { WorkflowTask, DashboardData, DashboardPreferences, DashboardSectionKey } from '../types';
```

```ts
// extend the ui import (line 15)
import { Progress, Badge, Popover, PopoverTrigger, PopoverContent, Button } from './ui';
```

- [ ] **Step 2: Add a section metadata list and default preferences constant**

After `EMPTY_DASHBOARD` (line 26), add:

```ts
const EMPTY_PREFERENCES: DashboardPreferences = { visible_sections: {} };

const DASHBOARD_SECTIONS: { key: DashboardSectionKey; label: string }[] = [
  { key: 'KPI_ROW', label: 'KPI Row' },
  { key: 'SALES_TREND', label: 'Sales Trend' },
  { key: 'INVENTORY_DISTRIBUTION', label: 'Inventory Distribution' },
  { key: 'PURCHASE_VS_SALES', label: 'Purchase vs Sales' },
  { key: 'INVENTORY_HEALTH', label: 'Inventory Health' },
  { key: 'QUICK_ACTIONS', label: 'Quick Actions' },
  { key: 'RECENT_SALES', label: 'Recent Sales' },
  { key: 'RECENT_PURCHASES', label: 'Recent Purchases' },
  { key: 'CRITICAL_STOCK_ALERTS', label: 'Critical Stock Alerts' },
  { key: 'PRODUCTION_STATUS', label: 'Production Status' },
  { key: 'ACTIVITY_TIMELINE', label: 'Activity Timeline' },
];
```

- [ ] **Step 3: Load preferences and add the visibility check + toggle handler**

In the component body, add state (after the existing `loading` state, line 82):

```ts
const [preferences, setPreferences] = useState<DashboardPreferences>(EMPTY_PREFERENCES);
```

In the existing `useEffect` (lines 84-99), add `getDashboardPreferences()` to the `Promise.all` array and destructure it:

```ts
useEffect(() => {
  Promise.all([
    getDashboardData(), getWorkflowTasks(), getOutstandingOrdersCount(), getMaterialCount(),
    getRecentSales(), getRecentPurchases(), getDashboardPreferences(),
  ])
    .then(([dash, wf, outstanding, matCount, sales, purchases, prefs]) => {
      setDashboard(dash);
      setWorkflows(wf);
      setOutstandingOrders(outstanding);
      setMaterialCount(matCount);
      setRecentSales(sales);
      setRecentPurchases(purchases);
      setPreferences(prefs);
    })
    .catch(console.error)
    .finally(() => setLoading(false));
}, []);
```

After the `activityTimeline` memo (ends line 149), add the visibility helper and toggle handler:

```ts
const isVisible = (key: DashboardSectionKey) => preferences.visible_sections[key] !== false;

const toggleSection = (key: DashboardSectionKey) => {
  const next: DashboardPreferences = {
    ...preferences,
    visible_sections: { ...preferences.visible_sections, [key]: !isVisible(key) },
  };
  setPreferences(next);
  saveDashboardPreferences(next).catch(console.error);
};
```

- [ ] **Step 4: Gate each section's render on `isVisible`**

Wrap each of the 11 blocks in the JSX return (lines 160-403) with `isVisible('KEY') && (...)`. Example for the KPI row (lines 165-176):

```tsx
{isVisible('KPI_ROW') && (
  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
    <StatCard data-fade-item label="Revenue" value={totalSales} formatter={formatCurrency} icon={DollarSign}
      trend={{ value: totalSales, label: 'Last 6 months', direction: 'up' }} />
    <StatCard data-fade-item label="Purchases" value={totalPurchaseCosts} formatter={formatCurrency} icon={ShoppingCart}
      trend={{ value: totalPurchaseCosts, label: 'Last 6 months', direction: 'down' }} />
    <StatCard data-fade-item label="Gross Profit" value={grossProfit} formatter={formatCurrency} icon={Wallet}
      trend={{ value: grossProfit, label: 'Revenue − purchases', direction: grossProfit >= 0 ? 'up' : 'down' }} />
    <StatCard data-fade-item label="Inventory Units" value={totalInventoryUnits} formatter={formatUnits} icon={Package}
      trend={{ value: totalInventoryUnits, label: 'Raw + finished stock', direction: 'up' }} />
    <StatCard data-fade-item label="Outstanding Orders" value={outstandingOrders} formatter={formatUnits} icon={ClipboardList}
      trend={{ value: outstandingOrders, label: 'Confirmed, not delivered', direction: 'up' }} />
  </div>
)}
```

Apply the same `{isVisible('KEY') && (...)}` wrap to the other 10 blocks, matching keys to blocks 1:1:
- `SALES_TREND` → the `ChartCard title="Sales Trend"` block (lines 180-198). Note this and `INVENTORY_DISTRIBUTION` currently share a parent `grid` div (lines 179-227) — split that wrapping div so each `ChartCard` is gated independently; keep the outer `grid grid-cols-1 lg:grid-cols-3 gap-5` div itself always rendered (it's just a layout container, empty grid cells collapse fine).
- `INVENTORY_DISTRIBUTION` → the `ChartCard title="Inventory Distribution"` block (lines 200-226).
- `PURCHASE_VS_SALES` → the `ChartCard title="Purchase vs Sales"` block (lines 231-249). Same split needed on its parent grid div (lines 230-272) as above.
- `INVENTORY_HEALTH` → the `SectionCard title="Inventory Health"` block (lines 251-271).
- `QUICK_ACTIONS` → the `SectionCard title="Quick Actions"` block (lines 276-280). Same split needed on its parent grid div (lines 275-346).
- `RECENT_SALES` → the `SectionCard title="Recent Sales"` block (lines 282-314).
- `RECENT_PURCHASES` → the `SectionCard title="Recent Purchases"` block (lines 316-345).
- `CRITICAL_STOCK_ALERTS` → the `SectionCard title="Critical Stock Alerts"` block (lines 350-370). Same split needed on its parent grid div (lines 349-393).
- `PRODUCTION_STATUS` → the `SectionCard title="Production Status"` block (lines 372-392).
- `ACTIVITY_TIMELINE` → the `SectionCard title="Activity Timeline"` block (lines 396-402), standalone, no parent grid to split.

- [ ] **Step 5: Add the floating config button + popover**

Immediately before the closing `</DashboardShell>` tag is wrong (button must float above the shell, not stagger-animate with `data-fade-item` content) — instead, wrap the return in a fragment and place the button as a sibling after `<DashboardShell>`:

```tsx
return (
  <>
    <DashboardShell deps={[loading]}>
      {/* ...unchanged existing content... */}
    </DashboardShell>

    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="default"
          size="icon"
          className="fixed bottom-6 right-6 z-50 rounded-full h-12 w-12 shadow-lg"
          aria-label="Configure dashboard widgets"
        >
          <Settings className="w-5 h-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <div className="text-xs font-medium text-muted-foreground mb-2 px-1">Show / hide sections</div>
        <div className="space-y-1 max-h-80 overflow-y-auto">
          {DASHBOARD_SECTIONS.map((section) => (
            <label
              key={section.key}
              className="flex items-center gap-2 px-1 py-1.5 rounded-md hover:bg-secondary/60 text-sm cursor-pointer"
            >
              <input
                type="checkbox"
                checked={isVisible(section.key)}
                onChange={() => toggleSection(section.key)}
                className="accent-primary"
              />
              {section.label}
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  </>
);
```

- [ ] **Step 6: Verify**

Run: `npm run lint`
Expected: no errors.

Manual check (for the user, not self-tested — describe what to look for): open the Dashboard tab, confirm the gear button appears bottom-right, opening it shows 11 labeled checkboxes all checked, unchecking one immediately hides that section, and reloading the app keeps the hidden section hidden (confirms the Supabase round-trip once Task 1's SQL has been run).

- [ ] **Step 7: Commit**

```bash
git add src/components/DashboardView.tsx
git commit -m "feat: add dashboard widget visibility toggles"
```

---

## Self-Review Notes
- Spec coverage: schema/types (Task 1), service (Task 2), UI gating + config button (Task 3) — all spec sections covered. KPI cards intentionally not individually toggleable, matches spec.
- No placeholders — every step has literal code.
- Type consistency checked: `DashboardSectionKey`/`DashboardPreferences` (Task 1) match usage in Task 2 and Task 3; `getDashboardPreferences`/`saveDashboardPreferences` signatures match between Task 2's definition and Task 3's usage.
