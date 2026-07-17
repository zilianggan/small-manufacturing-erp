# Dashboard Widget Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user drag dashboard sections into any order directly on the live dashboard, inside an explicit "customize mode" entered via the existing gear button, with order persisted in Supabase.

**Architecture:** Add `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`. Extend the (not-yet-deployed) `dashboard_preferences` table and `DashboardPreferences` type with `section_order`. Replace the visibility feature's checkbox popover with a "customize mode" toggle: the gear button becomes a "Done" button, every section gets a drag handle + eye toggle overlay, and all 11 sections move into one unified `grid-cols-6` container (each keeping a fixed column span matching its current width) so any section can be dragged next to any other.

**Tech Stack:** React 19 + TypeScript, `@dnd-kit/core`/`@dnd-kit/sortable`/`@dnd-kit/utilities` (new dependency), existing Supabase service pattern.

## Global Constraints
- No test runner in this project — every task's verification is `npm run lint` (tsc --noEmit) plus a manual browser check description (the user tests, not self-tested).
- Schema changes go in `supabase/schema.sql`; since the `dashboard_preferences` table from the prior visibility feature has NOT been run against the real DB yet, edit that same `CREATE TABLE` block in place rather than adding an `ALTER TABLE`.
- No git commits during this plan — implement and stop, user commits everything themselves.
- Section keys (unchanged from the visibility feature): `KPI_ROW`, `SALES_TREND`, `INVENTORY_DISTRIBUTION`, `PURCHASE_VS_SALES`, `INVENTORY_HEALTH`, `QUICK_ACTIONS`, `RECENT_SALES`, `RECENT_PURCHASES`, `CRITICAL_STOCK_ALERTS`, `PRODUCTION_STATUS`, `ACTIVITY_TIMELINE`.
- Column-span mapping (base grid is `lg:grid-cols-6`), exact values — preserves today's visual proportions:
  `KPI_ROW`=6, `SALES_TREND`=4, `INVENTORY_DISTRIBUTION`=2, `PURCHASE_VS_SALES`=4, `INVENTORY_HEALTH`=2, `QUICK_ACTIONS`=2, `RECENT_SALES`=2, `RECENT_PURCHASES`=2, `CRITICAL_STOCK_ALERTS`=3, `PRODUCTION_STATUS`=3, `ACTIVITY_TIMELINE`=6.
- Missing/empty `section_order` = default order (the table order above, i.e. `DASHBOARD_SECTIONS` array order already in `DashboardView.tsx`). Any key present in `DASHBOARD_SECTIONS` but absent from a stored `section_order` (forward-compat for future new sections) is appended at the end.
- Customize mode: gear button toggles a `customizing` boolean. Off = normal read-only dashboard, only visible sections render, no drag affordances. On = gear button becomes "Done", every section (visible or hidden) renders with a drag handle (left) and eye/eye-off toggle (right) overlay; hidden sections render at reduced opacity with a dashed border so they can be re-shown.
- Existing visibility-feature code already in the working tree (uncommitted) that this plan builds on: `preferences`/`setPreferences` state, `isVisible(key)`, `DASHBOARD_SECTIONS` array, `EMPTY_PREFERENCES`, `getDashboardPreferences`/`saveDashboardPreferences` from `../services/DashboardPreferencesService`. The existing `toggleSection` and the `<Popover>...</Popover>` block at the end of `DashboardView.tsx`'s return are REMOVED by this plan (folded into the new customize-mode overlay).

---

### Task 1: Dependency + schema + types

**Files:**
- Modify: `package.json` (via `npm install`)
- Modify: `supabase/schema.sql` (edit the existing `dashboard_preferences` CREATE TABLE block, not yet run against the DB)
- Modify: `src/types.ts` (extend `DashboardPreferences`)

**Interfaces:**
- Produces: `DashboardPreferences.section_order?: DashboardSectionKey[]` — consumed by Task 3. `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` importable — consumed by Task 2 and Task 3.

- [ ] **Step 1: Install dnd-kit**

Run: `npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`
Expected: `package.json` dependencies gain all three packages; `node_modules` installs without errors.

- [ ] **Step 2: Edit the `dashboard_preferences` table block in `supabase/schema.sql`**

Find the block (appended by the prior visibility feature, look for `create table dashboard_preferences`):
```sql
create table dashboard_preferences (
  id uuid primary key default gen_random_uuid(),
  visible_sections jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
```
Replace it with:
```sql
create table dashboard_preferences (
  id uuid primary key default gen_random_uuid(),
  visible_sections jsonb not null default '{}'::jsonb,
  section_order jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
```

- [ ] **Step 3: Extend `DashboardPreferences` in `src/types.ts`**

Find:
```ts
export interface DashboardPreferences {
  id?: string;
  visible_sections: Partial<Record<DashboardSectionKey, boolean>>;
}
```
Replace with:
```ts
export interface DashboardPreferences {
  id?: string;
  visible_sections: Partial<Record<DashboardSectionKey, boolean>>;
  section_order?: DashboardSectionKey[];
}
```

- [ ] **Step 4: Verify**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 5: Tell the user to run the SQL**

Output the full updated `create table` block from Step 2 and note that if the user already ran the OLD version of this table (without `section_order`) in Supabase, they instead need `alter table dashboard_preferences add column section_order jsonb not null default '[]'::jsonb;` — ask which applies. Do not assume either has happened.

- [ ] **Step 6: Do NOT commit.** This project's convention is the user commits everything themselves once reviewed. Stop after the file changes.

---

### Task 2: SortableSection wrapper component

**Files:**
- Create: `src/components/dashboard/SortableSection.tsx`

**Interfaces:**
- Consumes: `useSortable` from `@dnd-kit/sortable`, `CSS` from `@dnd-kit/utilities`, `DashboardSectionKey` from `../../types`, `cn` from `../../lib/utils`, `GripVertical`/`Eye`/`EyeOff` icons from `lucide-react`.
- Produces: `SortableSection` component — consumed by Task 3.
  ```ts
  interface SortableSectionProps {
    id: DashboardSectionKey;
    span: number; // 1-6, CSS grid column span out of the 6-col base grid
    customizing: boolean;
    hidden: boolean;
    onToggleVisible: () => void;
    children: React.ReactNode;
  }
  export function SortableSection(props: SortableSectionProps): JSX.Element
  ```

- [ ] **Step 1: Write the component**

```tsx
import type { CSSProperties, ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Eye, EyeOff } from 'lucide-react';
import { DashboardSectionKey } from '../../types';
import { cn } from '../../lib/utils';

interface SortableSectionProps {
  id: DashboardSectionKey;
  span: number;
  customizing: boolean;
  hidden: boolean;
  onToggleVisible: () => void;
  children: ReactNode;
}

export function SortableSection({ id, span, customizing, hidden, onToggleVisible, children }: SortableSectionProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !customizing });

  const style: CSSProperties = {
    gridColumn: `span ${span} / span ${span}`,
    transform: CSS.Transform.toString(transform),
    transition,
  };

  if (hidden && !customizing) return null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'relative',
        isDragging && 'z-10 opacity-80',
        hidden && customizing && 'opacity-40 rounded-xl border-2 border-dashed border-border'
      )}
    >
      {customizing && (
        <div className="flex items-center justify-between mb-1 px-1">
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Drag to reorder ${id}`}
            className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-secondary/60 active:cursor-grabbing"
          >
            <GripVertical className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onToggleVisible}
            aria-label={hidden ? `Show ${id}` : `Hide ${id}`}
            className="rounded p-1 text-muted-foreground hover:bg-secondary/60"
          >
            {hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      )}
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 3: Do NOT commit.**

---

### Task 3: Wire reorder + customize mode into DashboardView

**Files:**
- Modify: `src/components/DashboardView.tsx`

**Interfaces:**
- Consumes: `SortableSection` from `./dashboard/SortableSection` (Task 2); `DashboardPreferences.section_order` (Task 1); `DndContext`, `closestCenter`, `PointerSensor`, `KeyboardSensor`, `useSensor`, `useSensors`, `DragEndEvent` from `@dnd-kit/core`; `SortableContext`, `rectSortingStrategy`, `arrayMove`, `sortableKeyboardCoordinates` from `@dnd-kit/sortable`.

This task replaces the current per-section `{isVisible('KEY') && (...)}` wrapping and the trailing `<Popover>` block with a unified, reorderable, customize-mode-aware layout. Read the current file first — it already has (from the prior visibility feature) `preferences`/`setPreferences` state, `isVisible`, `DASHBOARD_SECTIONS`, `EMPTY_PREFERENCES`, and imports for `getDashboardPreferences`/`saveDashboardPreferences`. This task modifies around that existing code; it does not redo it.

- [ ] **Step 1: Update imports**

Replace the `lucide-react` import block (add `GripVertical` isn't needed here — that's inside `SortableSection` — but keep `Settings`; no new lucide icons needed in `DashboardView.tsx` itself) — no change needed to the lucide-react import.

Replace:
```ts
import { Progress, Badge, Popover, PopoverTrigger, PopoverContent, Button } from './ui';
```
with:
```ts
import { Progress, Badge, Button } from './ui';
```
(Popover is no longer used in this file — customize mode replaces it.)

Add, after the existing imports:
```ts
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { SortableSection } from './dashboard/SortableSection';
```

- [ ] **Step 2: Add the column-span map**

After the existing `DASHBOARD_SECTIONS` array, add:
```ts
const SECTION_SPAN: Record<DashboardSectionKey, number> = {
  KPI_ROW: 6,
  SALES_TREND: 4,
  INVENTORY_DISTRIBUTION: 2,
  PURCHASE_VS_SALES: 4,
  INVENTORY_HEALTH: 2,
  QUICK_ACTIONS: 2,
  RECENT_SALES: 2,
  RECENT_PURCHASES: 2,
  CRITICAL_STOCK_ALERTS: 3,
  PRODUCTION_STATUS: 3,
  ACTIVITY_TIMELINE: 6,
};
```

- [ ] **Step 3: Add customize-mode state and ordered-keys derivation**

After the existing `const [preferences, setPreferences] = useState<DashboardPreferences>(EMPTY_PREFERENCES);` line, add:
```ts
const [customizing, setCustomizing] = useState(false);
const sensors = useSensors(
  useSensor(PointerSensor),
  useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
);
```

After the existing `isVisible` function, replace the existing `toggleSection` function with these two (order derivation + updated toggle + new drag handler):
```ts
const orderedKeys = useMemo(() => {
  const known = DASHBOARD_SECTIONS.map((s) => s.key);
  const stored = (preferences.section_order || []).filter((k) => known.includes(k));
  const missing = known.filter((k) => !stored.includes(k));
  return [...stored, ...missing];
}, [preferences.section_order]);

const toggleSection = (key: DashboardSectionKey) => {
  const next: DashboardPreferences = {
    ...preferences,
    visible_sections: { ...preferences.visible_sections, [key]: !isVisible(key) },
  };
  setPreferences(next);
  saveDashboardPreferences(next).catch(console.error);
};

const handleDragEnd = (event: DragEndEvent) => {
  const { active, over } = event;
  if (!over || active.id === over.id) return;
  const oldIndex = orderedKeys.indexOf(active.id as DashboardSectionKey);
  const newIndex = orderedKeys.indexOf(over.id as DashboardSectionKey);
  const next: DashboardPreferences = { ...preferences, section_order: arrayMove(orderedKeys, oldIndex, newIndex) };
  setPreferences(next);
  saveDashboardPreferences(next).catch(console.error);
};
```
(`toggleSection`'s body is unchanged from the existing code — only `orderedKeys` and `handleDragEnd` are new.)

- [ ] **Step 4: Convert each of the 11 section blocks into an unconditional `sectionContent` map entry**

Every section currently looks like:
```tsx
{isVisible('KEY') && (
  <SomeCard ...>...</SomeCard>
)}
```
possibly inside a parent `<div className="grid ...">`. Change this to a `sectionContent` object built once, right before the `return` statement, where every one of the 11 keys maps to its (unconditional — no `isVisible` check anymore, visibility is now handled by `SortableSection`/the render loop) JSX, and the wrapping `<div className="grid lg:grid-cols-3">` / `<div className="grid lg:grid-cols-2">` parent containers are REMOVED (their children move into the single unified grid built in Step 5):

```tsx
const sectionContent: Record<DashboardSectionKey, ReactNode> = {
  KPI_ROW: (
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
  ),

  SALES_TREND: (
    <ChartCard data-fade-item title="Sales Trend" description="Confirmed revenue by month (last 6 months)">
      <div className="w-full h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={financialChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
            <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `RM ${v}`} />
            <Tooltip formatter={(value) => [formatCurrency(Number(value)), 'Sales']} contentStyle={{ background: 'var(--popover)', borderColor: 'var(--border)', borderRadius: '12px', color: 'var(--popover-foreground)', fontSize: '12px' }} />
            <Area type="monotone" dataKey="Sales" stroke="var(--chart-1)" strokeWidth={2} fill="url(#salesFill)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  ),

  INVENTORY_DISTRIBUTION: (
    <ChartCard data-fade-item title="Inventory Distribution" description="Unit quantities across stock types">
      <div className="w-full h-[180px] flex items-center justify-center relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip formatter={(v) => [formatUnits(Number(v)), '']} contentStyle={{ background: 'var(--popover)', borderColor: 'var(--border)', borderRadius: '12px', color: 'var(--popover-foreground)', fontSize: '12px' }} />
            <Pie data={inventoryChartData} cx="50%" cy="50%" innerRadius={54} outerRadius={72} paddingAngle={5} dataKey="value">
              {inventoryChartData.map((entry, index) => <Cell key={index} fill={entry.color} stroke="transparent" />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute text-center">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Units</span>
          <div className="text-lg font-semibold text-card-foreground">{formatUnits(totalInventoryUnits)}</div>
        </div>
      </div>
      <div className="space-y-2 pt-3 mt-3 border-t border-border text-xs">
        {inventoryChartData.map((item) => (
          <div key={item.name} className="flex items-center justify-between text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
              <span>{item.name}</span>
            </div>
            <span className="font-medium text-card-foreground">{formatUnits(item.value)}</span>
          </div>
        ))}
      </div>
    </ChartCard>
  ),

  PURCHASE_VS_SALES: (
    <ChartCard data-fade-item title="Purchase vs Sales" description="Revenue against procurement cost, month over month">
      <div className="w-full h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={financialChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
            <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `RM ${v}`} />
            <Tooltip
              cursor={{ fill: 'var(--primary)', opacity: 0.08 }}
              formatter={(value) => [formatCurrency(Number(value)), '']}
              contentStyle={{ background: 'var(--popover)', borderColor: 'var(--border)', borderRadius: '12px', color: 'var(--popover-foreground)', fontSize: '12px' }}
            />
            <Legend iconSize={9} iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
            <Bar dataKey="Sales" fill="var(--chart-1)" radius={[6, 6, 0, 0]} name="Sales revenue" />
            <Bar dataKey="Purchases" fill="var(--chart-3)" radius={[6, 6, 0, 0]} name="Purchase costs" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  ),

  INVENTORY_HEALTH: (
    <SectionCard data-fade-item title="Inventory Health" description="Material SKUs at or above reorder level">
      <div className="space-y-4">
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-2xl font-semibold text-card-foreground">{healthyStockPct}%</span>
            <span className="text-xs text-muted-foreground">{materialCount - dashboard.lowStockCount}/{materialCount} SKUs healthy</span>
          </div>
          <Progress value={healthyStockPct} indicatorClassName={healthyStockPct < 70 ? 'bg-warning' : 'bg-success'} />
        </div>
        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border text-xs">
          <div>
            <div className="text-muted-foreground">Low stock</div>
            <div className="text-base font-semibold text-destructive">{dashboard.lowStockCount}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Healthy</div>
            <div className="text-base font-semibold text-success">{Math.max(0, materialCount - dashboard.lowStockCount)}</div>
          </div>
        </div>
      </div>
    </SectionCard>
  ),

  QUICK_ACTIONS: (
    <SectionCard data-fade-item title="Quick Actions" description="Jump straight into common tasks" contentClassName="p-4 grid grid-cols-2 gap-2.5">
      {quickActions.map((action) => (
        <ActionCard key={action.target} label={action.label} icon={action.icon} onClick={() => onNavigate?.(action.target)} />
      ))}
    </SectionCard>
  ),

  RECENT_SALES: (
    <SectionCard
      data-fade-item
      title="Recent Sales"
      description={`Last ${recentSales.length} order${recentSales.length === 1 ? '' : 's'}`}
      actions={<FileSpreadsheet className="w-4 h-4 text-primary" />}
    >
      {recentSales.length === 0 ? (
        <CardEmptyState>No sales orders yet.</CardEmptyState>
      ) : (
        <div className="divide-y divide-border">
          {recentSales.map((sale) => (
            <button
              key={sale.id}
              type="button"
              onClick={() => (onViewSalesOrder ? onViewSalesOrder(sale.id) : onNavigate?.('ORDERS'))}
              className="w-full flex items-center justify-between gap-3 py-2.5 text-left hover:bg-secondary/40 rounded-lg px-2 -mx-2 transition-colors"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <div className="text-sm font-medium text-card-foreground truncate">{sale.salesNo}</div>
                  <Badge variant={PRIORITY_META[sale.priority].variant} className="px-1.5 py-0 text-[10px] shrink-0">{PRIORITY_META[sale.priority].label}</Badge>
                </div>
                <div className="text-xs text-muted-foreground truncate">{sale.clientName || '—'}</div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="text-sm font-medium text-card-foreground">{formatCurrency(sale.totalAmount)}</span>
                <Badge variant={SALES_STATUS_META[sale.status].variant}>{SALES_STATUS_META[sale.status].label}</Badge>
              </div>
            </button>
          ))}
        </div>
      )}
    </SectionCard>
  ),

  RECENT_PURCHASES: (
    <SectionCard
      data-fade-item
      title="Recent Purchases"
      description={`Last ${recentPurchases.length} order${recentPurchases.length === 1 ? '' : 's'}`}
      actions={<ShoppingBag className="w-4 h-4 text-primary" />}
    >
      {recentPurchases.length === 0 ? (
        <CardEmptyState>No purchase orders yet.</CardEmptyState>
      ) : (
        <div className="divide-y divide-border">
          {recentPurchases.map((purchase) => (
            <button
              key={purchase.id}
              type="button"
              onClick={() => (onViewPurchaseOrder ? onViewPurchaseOrder(purchase.id) : onNavigate?.('PURCHASES'))}
              className="w-full flex items-center justify-between gap-3 py-2.5 text-left hover:bg-secondary/40 rounded-lg px-2 -mx-2 transition-colors"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-card-foreground truncate">{purchase.purchaseNo}</div>
                <div className="text-xs text-muted-foreground truncate">{purchase.vendorName || '—'}</div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="text-sm font-medium text-card-foreground">{formatCurrency(purchase.totalPrice)}</span>
                <Badge variant={PURCHASE_STATUS_META[purchase.status].variant}>{PURCHASE_STATUS_META[purchase.status].label}</Badge>
              </div>
            </button>
          ))}
        </div>
      )}
    </SectionCard>
  ),

  CRITICAL_STOCK_ALERTS: (
    <SectionCard
      data-fade-item
      title="Critical Stock Alerts"
      description={`${dashboard.lowStockCount} item${dashboard.lowStockCount === 1 ? '' : 's'} at or below reorder point`}
      actions={<AlertTriangle className="w-4 h-4 text-warning" />}
    >
      {dashboard.lowStockItems.length === 0 ? (
        <CardEmptyState>All inventory levels are healthy — no restocks required.</CardEmptyState>
      ) : (
        <div className="divide-y divide-border">
          {dashboard.lowStockItems.map((item) => (
            <NotificationCard
              key={item.id}
              title={item.name}
              description={`${item.code || '—'} • ${formatUnits(item.quantity)} in stock, min ${formatUnits(item.minimumStock)}`}
              severity="destructive"
            />
          ))}
        </div>
      )}
    </SectionCard>
  ),

  PRODUCTION_STATUS: (
    <SectionCard
      data-fade-item
      title="Production Status"
      description={`${activeWorkflowsList.length} active step${activeWorkflowsList.length === 1 ? '' : 's'} across the floor`}
      actions={<PackageCheck className="w-4 h-4 text-primary" />}
    >
      <div className="space-y-3">
        {STAGE_ORDER.map((stage) => {
          const count = stageCounts.get(stage) || 0;
          return (
            <div key={stage} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-foreground font-medium">{STAGE_LABEL[stage]}</span>
                <span className="text-muted-foreground">{count}</span>
              </div>
              <Progress value={(count / maxStageCount) * 100} indicatorClassName={stage === 'COMPLETED' ? 'bg-success' : 'bg-primary'} />
            </div>
          );
        })}
      </div>
    </SectionCard>
  ),

  ACTIVITY_TIMELINE: (
    <SectionCard data-fade-item title="Activity Timeline" description="Recent production movement and stock alerts">
      {activityTimeline.length === 0 ? (
        <CardEmptyState>No recent activity yet.</CardEmptyState>
      ) : (
        <TimelineCard entries={activityTimeline} />
      )}
    </SectionCard>
  ),
};
```
Every block's content is copied verbatim from the current file — only the `{isVisible('KEY') && (...)}` wrapper and the enclosing parent `<div className="grid ...">` containers are removed (the parent grid containers themselves, e.g. the one that held Sales Trend + Inventory Distribution, are deleted entirely — their children now live directly in `sectionContent`, and the single unified grid in Step 5 replaces all of them). Add `import type { ReactNode } from 'react';` alongside the existing `useEffect, useMemo, useState` import (change `import { useEffect, useMemo, useState } from 'react';` to `import { useEffect, useMemo, useState, type ReactNode } from 'react';`).

- [ ] **Step 5: Replace the return statement's body**

Replace everything from `return (` to the final `);` `}` with:
```tsx
  return (
    <>
      <DashboardShell deps={[loading]}>
        <PageHeader title="Executive Overview" description="Live snapshot of sales, procurement, stock health and factory throughput." />

        {customizing ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={orderedKeys} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-1 lg:grid-cols-6 gap-5" style={{ gridAutoFlow: 'row dense' }}>
                {orderedKeys.map((key) => (
                  <SortableSection
                    key={key}
                    id={key}
                    span={SECTION_SPAN[key]}
                    customizing={customizing}
                    hidden={!isVisible(key)}
                    onToggleVisible={() => toggleSection(key)}
                  >
                    {sectionContent[key]}
                  </SortableSection>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-6 gap-5" style={{ gridAutoFlow: 'row dense' }}>
            {orderedKeys.filter(isVisible).map((key) => (
              <div key={key} style={{ gridColumn: `span ${SECTION_SPAN[key]} / span ${SECTION_SPAN[key]}` }}>
                {sectionContent[key]}
              </div>
            ))}
          </div>
        )}
      </DashboardShell>

      <Button
        variant="default"
        size="icon"
        className="fixed bottom-6 right-6 z-50 h-12 w-12 rounded-full shadow-lg"
        aria-label={customizing ? 'Done customizing dashboard' : 'Customize dashboard widgets'}
        onClick={() => setCustomizing((c) => !c)}
      >
        {customizing ? <Check className="w-5 h-5" /> : <Settings className="w-5 h-5" />}
      </Button>
    </>
  );
}
```
Add `Check` to the existing `lucide-react` import list (alongside `Settings`).

- [ ] **Step 6: Verify**

Run: `npm run lint`
Expected: no errors. Also grep the file to confirm the old `<Popover` block is gone: `grep -n "Popover" src/components/DashboardView.tsx` should return nothing.

Manual check (for the user, not self-tested): open the Dashboard tab — sections render in their normal grid, gear button bottom-right. Click it: every section gets a drag-handle + eye icon, hidden sections show dashed/faded. Drag a section to a new position — it moves immediately and the layout reflows around it (e.g. dragging Activity Timeline up next to a chart). Click the eye icon on a section to hide it (dashed border appears). Click Done (checkmark) — hidden sections disappear, remaining sections keep the new order. Reload the app — both the new order and hidden sections persist (once Task 1's SQL has been run).

- [ ] **Step 7: Do NOT commit.**

---

## Self-Review Notes
- Spec coverage: dependency + schema/types (Task 1), drag/visibility card chrome (Task 2), unified reorderable grid + customize mode + persistence (Task 3) — all spec sections covered.
- No placeholders — every step has literal code, all 11 section JSX blocks reproduced verbatim from the current file.
- Type consistency: `DashboardPreferences.section_order` (Task 1) matches its usage in Task 3's `orderedKeys`/`handleDragEnd`; `SortableSectionProps` (Task 2) matches the props passed in Task 3's Step 5 (`id`, `span`, `customizing`, `hidden`, `onToggleVisible`, `children`).
- The prior visibility-feature's `Popover`/`toggleSection`-only UI is fully superseded — Task 3 Step 1 removes the `Popover` import, Step 5 removes the trailing `<Popover>` JSX block, matching the spec's "replaces the visibility popover" decision.
