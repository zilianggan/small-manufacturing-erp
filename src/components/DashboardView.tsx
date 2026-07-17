import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DollarSign, Package, AlertTriangle, ClipboardList, ShoppingCart, Wallet,
  FileSpreadsheet, ShoppingBag, Boxes, Tag, Shuffle, CheckCircle2, PackageCheck,
  Settings, Check, RotateCcw,
} from 'lucide-react';
import {
  getDashboardData, getOutstandingOrdersCount, getMaterialCount,
  getRecentSales, getRecentPurchases, RecentSale, RecentPurchase,
} from '../services/DashboardService';
import { getWorkflowTasks } from '../services/WorkflowsService';
import { getDashboardPreferences, saveDashboardPreferences } from '../services/DashboardPreferencesService';
import { WorkflowTask, DashboardData, DashboardPreferences, DashboardSectionKey } from '../types';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';
import { DashboardShell, PageHeader, StatCard, SectionCard, ChartCard, ActionCard, TimelineCard, NotificationCard } from './shell';
import type { TimelineEntry } from './shell';
import { Progress, Badge, Button } from './ui';
import type { BadgeProps } from './ui';
import { CardEmptyState } from './ui/Card';
import { PRIORITY_META } from '../utils/priority';
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { SortableSection, SPAN_CLASS } from './dashboard/SortableSection';

const EMPTY_DASHBOARD: DashboardData = {
  monthlyTotals: [],
  rawMaterialQty: 0,
  finishedGoodsQty: 0,
  lowStockItems: [],
  lowStockCount: 0,
};

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

const monthLabel = (month: string): string => {
  const [year, mon] = month.split('-').map(Number);
  return new Date(year, mon - 1, 1).toLocaleString('en-US', { month: 'short' });
};

const formatCurrency = (val: number) => `RM ${val.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const formatUnits = (val: number) => val.toLocaleString('en-US', { maximumFractionDigits: 0 });

const STAGE_LABEL: Record<WorkflowTask['stage'], string> = {
  PREPARATION: 'Preparation',
  ASSEMBLY: 'Assembly',
  QUALITY_CONTROL: 'Quality Control',
  PACKAGING: 'Packaging',
  COMPLETED: 'Completed',
};
const STAGE_ORDER: WorkflowTask['stage'][] = ['PREPARATION', 'ASSEMBLY', 'QUALITY_CONTROL', 'PACKAGING', 'COMPLETED'];

const SALES_STATUS_META: Record<RecentSale['status'], { label: string; variant: BadgeProps['variant'] }> = {
  QUOTATION: { label: 'Quotation', variant: 'secondary' },
  ORDERED: { label: 'Pending Production', variant: 'warning' },
  IN_PRODUCTION: { label: 'In Production', variant: 'default' },
  DONE_IN_PRODUCTION: { label: 'Done in Production', variant: 'default' },
  PARTIALLY_DELIVERED: { label: 'Partially Delivered', variant: 'warning' },
  DELIVERED: { label: 'Delivered', variant: 'success' },
  PARTIALLY_RETURNED: { label: 'Partially Returned', variant: 'warning' },
  RETURNED: { label: 'Returned', variant: 'destructive' },
  CANCELLED: { label: 'Cancelled', variant: 'destructive' },
};

const PURCHASE_STATUS_META: Record<RecentPurchase['status'], { label: string; variant: BadgeProps['variant'] }> = {
  QUOTATION: { label: 'Quotation', variant: 'secondary' },
  ORDERED: { label: 'Pending Stock', variant: 'warning' },
  PARTIALLY_RECEIVED: { label: 'Partially Received', variant: 'warning' },
  RECEIVED: { label: 'Received', variant: 'success' },
  PARTIALLY_RETURNED: { label: 'Partially Returned', variant: 'warning' },
  RETURNED: { label: 'Returned', variant: 'destructive' },
  CANCELLED: { label: 'Cancelled', variant: 'destructive' },
};

export type QuickActionTarget = 'MATERIAL' | 'PRODUCT' | 'INVENTORY' | 'ORDERS' | 'PURCHASES' | 'WORKFLOWS';

interface DashboardViewProps {
  onNavigate?: (tab: QuickActionTarget) => void;
  onViewSalesOrder?: (salesHeaderId: string) => void;
  onViewPurchaseOrder?: (purchaseHeaderId: string) => void;
}

export default function DashboardView({ onNavigate, onViewSalesOrder, onViewPurchaseOrder }: DashboardViewProps) {
  const [dashboard, setDashboard] = useState<DashboardData>(EMPTY_DASHBOARD);
  const [workflows, setWorkflows] = useState<WorkflowTask[]>([]);
  const [outstandingOrders, setOutstandingOrders] = useState(0);
  const [materialCount, setMaterialCount] = useState(0);
  const [recentSales, setRecentSales] = useState<RecentSale[]>([]);
  const [recentPurchases, setRecentPurchases] = useState<RecentPurchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [preferences, setPreferences] = useState<DashboardPreferences>(EMPTY_PREFERENCES);
  const [customizing, setCustomizing] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

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

  const totalSales = useMemo(() => dashboard.monthlyTotals.reduce((sum, m) => sum + m.sales, 0), [dashboard]);
  const totalPurchaseCosts = useMemo(() => dashboard.monthlyTotals.reduce((sum, m) => sum + m.purchases, 0), [dashboard]);
  const grossProfit = totalSales - totalPurchaseCosts;
  const totalInventoryUnits = dashboard.rawMaterialQty + dashboard.finishedGoodsQty;
  const healthyStockPct = materialCount > 0 ? Math.round(((materialCount - dashboard.lowStockCount) / materialCount) * 100) : 100;

  const activeWorkflowsList = useMemo(() => workflows.filter(w => w.stage !== 'COMPLETED'), [workflows]);

  const financialChartData = useMemo(() => dashboard.monthlyTotals.map(m => ({
    name: monthLabel(m.month),
    Sales: m.sales,
    Purchases: m.purchases,
  })), [dashboard]);

  const inventoryChartData = useMemo(() => [
    { name: 'Raw Materials', value: dashboard.rawMaterialQty, color: 'var(--chart-1)' },
    { name: 'Finished Goods', value: dashboard.finishedGoodsQty, color: 'var(--chart-2)' },
  ], [dashboard]);

  const stageCounts = useMemo(() => {
    const counts = new Map<WorkflowTask['stage'], number>();
    for (const stage of STAGE_ORDER) counts.set(stage, 0);
    for (const task of workflows) counts.set(task.stage, (counts.get(task.stage) || 0) + 1);
    return counts;
  }, [workflows]);
  const maxStageCount = Math.max(1, ...Array.from(stageCounts.values()));

  const activityTimeline = useMemo<TimelineEntry[]>(() => {
    const recentWorkflows = [...workflows]
      .sort((a, b) => (b.updatedAt || b.startDate).localeCompare(a.updatedAt || a.startDate))
      .slice(0, 5)
      .map<TimelineEntry>(task => ({
        id: task.id,
        icon: task.stage === 'COMPLETED' ? CheckCircle2 : Shuffle,
        title: `${task.productName} — ${STAGE_LABEL[task.stage]}`,
        timestamp: new Date(task.updatedAt || task.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        description: `Qty ${task.quantity} • ${task.employeeName || 'Unassigned'} • Order ${task.salesNo}`,
        tone: task.stage === 'COMPLETED' ? 'success' : 'default',
      }));
    const lowStockEntries = dashboard.lowStockItems.slice(0, 3).map<TimelineEntry>(item => ({
      id: `low-${item.id}`,
      icon: AlertTriangle,
      title: `${item.name} below reorder point`,
      timestamp: item.code || '—',
      description: `${formatUnits(item.quantity)} in stock, minimum ${formatUnits(item.minimumStock)}`,
      tone: 'warning',
    }));
    return [...recentWorkflows, ...lowStockEntries].slice(0, 8);
  }, [workflows, dashboard.lowStockItems]);

  const isVisible = (key: DashboardSectionKey) => preferences.visible_sections[key] !== false;

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

  const resetLayout = () => {
    setPreferences(EMPTY_PREFERENCES);
    saveDashboardPreferences(EMPTY_PREFERENCES).catch(console.error);
  };

  const quickActions: { label: string; icon: typeof Boxes; target: QuickActionTarget }[] = [
    { label: 'New Sales Order', icon: FileSpreadsheet, target: 'ORDERS' },
    { label: 'New Purchase', icon: ShoppingBag, target: 'PURCHASES' },
    { label: 'Add Material', icon: Boxes, target: 'MATERIAL' },
    { label: 'Add Product', icon: Tag, target: 'PRODUCT' },
    { label: 'Inventory Ledger', icon: Package, target: 'INVENTORY' },
    { label: 'Production Board', icon: Shuffle, target: 'WORKFLOWS' },
  ];

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
              <div key={key} className={`h-full [&>*]:h-full ${SPAN_CLASS[SECTION_SPAN[key]] || 'col-span-1'}`}>
                {sectionContent[key]}
              </div>
            ))}
          </div>
        )}
      </DashboardShell>

      {customizing && (
        <Button
          variant="outline"
          className="fixed bottom-6 right-24 z-50 shadow-lg bg-secondary hover:bg-secondary"
          onClick={resetLayout}
        >
          <RotateCcw className="w-4 h-4" /> Reset to Default
        </Button>
      )}
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
