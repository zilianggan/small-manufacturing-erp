/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  generateId, getInventoryTransactions, saveInventoryTransaction, getInventoryStatsSummary,
  InventoryLedgerSortField, SortDir, InventoryStatsSummary,
} from '../services/InventoryTransactionService';
import { getMaterials, getMaterialsPage } from '../services/MaterialService';
import { getProducts, getProductsPage } from '../services/ProductService';
import { getPurchaseById } from '../services/PurchasesService';
import { getSalesOrderById } from '../services/OrdersService';
import { getDashboardData } from '../services/DashboardService';
import { InventoryTransaction, InventoryTransactionType, Material, Product, PurchaseHeader, SalesHeader, DashboardLowStockItem } from '../types';
import {
  SlidersHorizontal, RotateCcw, BarChart3, ClipboardPlus, Eye, Copy,
  PackagePlus, PackageMinus, Factory, Undo2, ArrowUpCircle, ArrowDownCircle,
  Paperclip, AlertTriangle,
} from 'lucide-react';
import ComboBox from './ComboBox';
import SegmentedControl from './SegmentedControl';
import FilterDialog from './FilterDialog';
import InfiniteScrollSentinel from './InfiniteScrollSentinel';
import {
  PageHeader, SectionCard, FilterBar, DataTable, StatCard, ChartCard, MetricCard,
} from './shell';
import type { DataTableColumn, FilterChip } from './shell';
import {
  Button, Badge, ActionsMenu, Sheet, Dialog, FormField, fieldInputClassName,
  Tabs, TabsList, TabsTrigger, TabsContent, useToast,
} from './ui';
import type { ActionMenuItem } from './ui';
import { useFadeInOnMount } from '../hooks/useFadeInOnMount';
import { formatDateTime, toDateTimeLocal, fromDateTimeLocal, monthStart, monthEnd } from '../utils/date';
import { QUICK_RANGES } from '../utils/dateRanges';
import QuickRangePills from './QuickRangePills';
import { openDataUrlInNewTab } from '../lib/utils';
import { CallAPI } from './UIHelper';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { debounce } from 'lodash';

const PAGE_SIZE = 20;

interface InventoryViewProps {
  // Cross-tab drill-in: opens the linked purchase/sales order in its own tab.
  onViewPurchaseOrder?: (purchaseHeaderId: string) => void;
  onViewSalesOrder?: (salesHeaderId: string) => void;
}

// ─── Movement type display: the DB only ever produces 5 real transaction
// types (no Warehouse/Transfer concept exists in the schema). SALES/
// SALES_RETURN on this ledger are always material rows tied to production
// (see ProductService.getProductInventoryList's comment — products have no
// ledger entry for ordinary sales), so they're relabeled to what they
// actually represent instead of the generic DB name. ────────────────────────
const MOVEMENT_META: Record<InventoryTransactionType, { label: string; icon: typeof PackagePlus; badgeClassName: string }> = {
  PURCHASE: { label: 'Purchase', icon: PackagePlus, badgeClassName: 'bg-primary/10 text-primary border-primary/20' },
  PURCHASE_RETURN: { label: 'Purchase Return', icon: PackageMinus, badgeClassName: 'bg-warning/10 text-warning border-warning/20' },
  SALES: { label: 'Production Consumption', icon: Factory, badgeClassName: 'bg-orange-500/10 text-orange-600 border-orange-500/20 dark:text-orange-400' },
  SALES_RETURN: { label: 'Production Return', icon: Undo2, badgeClassName: 'bg-success/10 text-success border-success/20' },
  ADJUSTMENT: { label: 'Adjustment', icon: SlidersHorizontal, badgeClassName: 'bg-secondary text-secondary-foreground border-transparent' },
};

const TYPE_FILTER_OPTIONS: { value: InventoryTransactionType; label: string }[] =
  (Object.keys(MOVEMENT_META) as InventoryTransactionType[]).map(v => ({ value: v, label: MOVEMENT_META[v].label }));

/**
 * Inventory Transactions — table-first ledger, styled like the Material
 * catalog's table (same search/filter toolbar, same DataTable). No permanent
 * detail panel, no stat cards on the page: the transaction table is the hero.
 * Statistics live behind a dialog; stock entry lives behind slide-over
 * drawers instead of a generic "Add Inventory" button — this ledger is
 * insert-only and everything else (Purchase/Sales) already has its own module.
 */
export default function InventoryView({ onViewPurchaseOrder, onViewSalesOrder }: InventoryViewProps = {}) {
  const toast = useToast();
  const contentRef = useFadeInOnMount<HTMLDivElement>([]);

  // ─── Ledger list ──────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const tableScrollRef = useRef<HTMLDivElement>(null);

  // ─── Filters ──────────────────────────────────────────────────────────────
  const [appliedTypeFilters, setAppliedTypeFilters] = useState<InventoryTransactionType[]>([]);
  const [appliedMaterialIds, setAppliedMaterialIds] = useState<string[]>([]);
  const [appliedProductIds, setAppliedProductIds] = useState<string[]>([]);
  // Default to the current month — avoids pulling the whole ledger on load.
  const [dateFrom, setDateFrom] = useState(monthStart(0));
  const [dateTo, setDateTo] = useState(monthEnd(0));
  const [activeQuickRange, setActiveQuickRange] = useState<string | null>('thisMonth');

  const [showFilterDialog, setShowFilterDialog] = useState(false);
  const [filterDraftTypes, setFilterDraftTypes] = useState<InventoryTransactionType[]>([]);
  const [filterDraftMaterialIds, setFilterDraftMaterialIds] = useState<string[]>([]);
  const [filterDraftProductIds, setFilterDraftProductIds] = useState<string[]>([]);
  const [filterDraftDateFrom, setFilterDraftDateFrom] = useState('');
  const [filterDraftDateTo, setFilterDraftDateTo] = useState('');
  const [filterSearchQuery, setFilterSearchQuery] = useState('');
  const [filterMaterialSearch, setFilterMaterialSearch] = useState('');
  const [filterProductSearch, setFilterProductSearch] = useState('');
  const [filterMaterialOptions, setFilterMaterialOptions] = useState<Material[]>([]);
  const [filterProductOptions, setFilterProductOptions] = useState<Product[]>([]);
  const [filterMaterialOptionsLoading, setFilterMaterialOptionsLoading] = useState(false);
  const [filterProductOptionsLoading, setFilterProductOptionsLoading] = useState(false);
  const [filterMaterialOffset, setFilterMaterialOffset] = useState(0);
  const [filterProductOffset, setFilterProductOffset] = useState(0);
  const [filterMaterialHasMore, setFilterMaterialHasMore] = useState(false);
  const [filterProductHasMore, setFilterProductHasMore] = useState(false);

  // ─── Sort ─────────────────────────────────────────────────────────────
  // date/type/quantity are real columns — sorted server-side. reference/item/
  // status are joined/derived (refNo comes from purchase_header OR sales_header
  // depending on type; item is material.name OR product.name) — PostgREST has
  // no clean way to order by "whichever of two joined columns is set", so
  // those are sorted client-side over whatever's currently loaded instead.
  const SERVER_SORT_FIELDS: readonly string[] = ['date', 'type', 'quantity'];
  type DisplaySortField = InventoryLedgerSortField | 'reference' | 'item' | 'status';
  const [sortField, setSortField] = useState<DisplaySortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const isServerSort = SERVER_SORT_FIELDS.includes(sortField);
  const toggleSort = (key: string) => {
    const field = key as DisplaySortField;
    if (field === sortField) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
  };

  const loadTransactions = useCallback((nextOffset: number, append: boolean, search: string) => {
    const setBusy = append ? setLoadingMore : setLoading;
    setBusy(true);
    CallAPI(
      () => getInventoryTransactions({
        search, typeFilters: appliedTypeFilters, materialIds: appliedMaterialIds, productIds: appliedProductIds,
        dateFrom: dateFrom || undefined, dateTo: dateTo || undefined,
        sortField: (isServerSort ? sortField : 'date') as InventoryLedgerSortField,
        sortDir: isServerSort ? sortDir : 'desc',
        offset: nextOffset, limit: PAGE_SIZE,
      }),
      {
        onCompleted: ({ rows, hasMore: more }) => {
          setTransactions(prev => (append ? [...prev, ...rows] : rows));
          setHasMore(more);
          setOffset(nextOffset + rows.length);
          setBusy(false);
        },
        onError: (err) => { console.error(err); setBusy(false); },
      }
    );
  }, [appliedTypeFilters, appliedMaterialIds, appliedProductIds, dateFrom, dateTo, sortField, sortDir]);

  useEffect(() => { loadTransactions(0, false, searchQuery); }, []);
  useEffect(() => {
    loadTransactions(0, false, searchQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedTypeFilters, appliedMaterialIds, appliedProductIds, dateFrom, dateTo, sortField, sortDir]);

  const search = useMemo(() => debounce((text: string) => loadTransactions(0, false, text), 500), [loadTransactions]);

  const handleLoadMore = () => {
    if (loadingMore || !hasMore) return;
    loadTransactions(offset, true, searchQuery);
  };

  const applyQuickRange = (key: string) => {
    if (activeQuickRange === key) { setActiveQuickRange(null); setDateFrom(''); setDateTo(''); return; }
    const range = QUICK_RANGES.find(r => r.key === key);
    if (!range) return;
    setActiveQuickRange(key);
    setDateFrom(range.from());
    setDateTo(range.to());
  };

  const loadFilterMaterialOptions = useMemo(() => debounce((q: string) => {
    setFilterMaterialOptionsLoading(true);
    CallAPI(() => getMaterialsPage({ search: q, offset: 0, limit: PAGE_SIZE }), {
      onCompleted: ({ rows, hasMore }) => {
        setFilterMaterialOptions(rows); setFilterMaterialHasMore(hasMore); setFilterMaterialOffset(rows.length); setFilterMaterialOptionsLoading(false);
      },
      onError: () => setFilterMaterialOptionsLoading(false),
    });
  }, 300), []);
  const loadMoreFilterMaterialOptions = () => {
    if (filterMaterialOptionsLoading || !filterMaterialHasMore) return;
    setFilterMaterialOptionsLoading(true);
    CallAPI(() => getMaterialsPage({ search: filterMaterialSearch, offset: filterMaterialOffset, limit: PAGE_SIZE }), {
      onCompleted: ({ rows, hasMore }) => {
        setFilterMaterialOptions(prev => [...prev, ...rows]); setFilterMaterialHasMore(hasMore); setFilterMaterialOffset(o => o + rows.length); setFilterMaterialOptionsLoading(false);
      },
      onError: () => setFilterMaterialOptionsLoading(false),
    });
  };

  const loadFilterProductOptions = useMemo(() => debounce((q: string) => {
    setFilterProductOptionsLoading(true);
    CallAPI(() => getProductsPage({ search: q, offset: 0, limit: PAGE_SIZE }), {
      onCompleted: ({ rows, hasMore }) => {
        setFilterProductOptions(rows); setFilterProductHasMore(hasMore); setFilterProductOffset(rows.length); setFilterProductOptionsLoading(false);
      },
      onError: () => setFilterProductOptionsLoading(false),
    });
  }, 300), []);
  const loadMoreFilterProductOptions = () => {
    if (filterProductOptionsLoading || !filterProductHasMore) return;
    setFilterProductOptionsLoading(true);
    CallAPI(() => getProductsPage({ search: filterProductSearch, offset: filterProductOffset, limit: PAGE_SIZE }), {
      onCompleted: ({ rows, hasMore }) => {
        setFilterProductOptions(prev => [...prev, ...rows]); setFilterProductHasMore(hasMore); setFilterProductOffset(o => o + rows.length); setFilterProductOptionsLoading(false);
      },
      onError: () => setFilterProductOptionsLoading(false),
    });
  };

  const openFilterDialog = () => {
    setFilterDraftTypes(appliedTypeFilters);
    setFilterDraftMaterialIds(appliedMaterialIds);
    setFilterDraftProductIds(appliedProductIds);
    setFilterDraftDateFrom(dateFrom);
    setFilterDraftDateTo(dateTo);
    setFilterSearchQuery(''); setFilterMaterialSearch(''); setFilterProductSearch('');
    setFilterMaterialOptions([]); setFilterProductOptions([]);
    setFilterMaterialOffset(0); setFilterProductOffset(0);
    setFilterMaterialHasMore(false); setFilterProductHasMore(false);
    setShowFilterDialog(true);
    loadFilterMaterialOptions(''); loadFilterProductOptions('');
  };

  const toggleFilterDraftType = (id: string) => {
    const type = id as InventoryTransactionType;
    setFilterDraftTypes(prev => (prev.includes(type) ? prev.filter(x => x !== type) : [...prev, type]));
  };
  const toggleFilterDraftMaterial = (id: string) => setFilterDraftMaterialIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  const toggleFilterDraftProduct = (id: string) => setFilterDraftProductIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  // "Reset" lands back on the current month, not an unfiltered all-time view
  // — matches the page's own default instead of pulling the whole ledger.
  const resetFilters = () => {
    setAppliedTypeFilters([]); setAppliedMaterialIds([]); setAppliedProductIds([]);
    setDateFrom(monthStart(0)); setDateTo(monthEnd(0)); setActiveQuickRange('thisMonth'); setSearchQuery('');
  };

  const filterChips: FilterChip[] = [
    ...(dateFrom || dateTo ? [{ key: 'date', label: `${dateFrom || '…'} → ${dateTo || '…'}`, onRemove: () => { setDateFrom(monthStart(0)); setDateTo(monthEnd(0)); setActiveQuickRange('thisMonth'); } }] : []),
    ...(appliedTypeFilters.length > 0 ? [{ key: 'types', label: `${appliedTypeFilters.length} type${appliedTypeFilters.length === 1 ? '' : 's'}`, onRemove: () => setAppliedTypeFilters([]) }] : []),
    ...(appliedMaterialIds.length > 0 ? [{ key: 'materials', label: `${appliedMaterialIds.length} material${appliedMaterialIds.length === 1 ? '' : 's'}`, onRemove: () => setAppliedMaterialIds([]) }] : []),
    ...(appliedProductIds.length > 0 ? [{ key: 'products', label: `${appliedProductIds.length} product${appliedProductIds.length === 1 ? '' : 's'}`, onRemove: () => setAppliedProductIds([]) }] : []),
  ];
  const activeFilterCount = appliedTypeFilters.length + appliedMaterialIds.length + appliedProductIds.length + (dateFrom || dateTo ? 1 : 0);

  // ─── Reference drawer ────────────────────────────────────────────────────
  const [refDrawerTx, setRefDrawerTx] = useState<InventoryTransaction | null>(null);
  const [refPurchase, setRefPurchase] = useState<PurchaseHeader | null>(null);
  const [refSales, setRefSales] = useState<SalesHeader | null>(null);
  const [refLoading, setRefLoading] = useState(false);
  const [refTab, setRefTab] = useState('overview');

  const openRefDrawer = (tx: InventoryTransaction) => {
    setRefDrawerTx(tx);
    setRefPurchase(null);
    setRefSales(null);
    setRefTab('overview');
    if (tx.purchaseHeaderId) {
      setRefLoading(true);
      CallAPI(() => getPurchaseById(tx.purchaseHeaderId!), { onCompleted: (d) => { setRefPurchase(d); setRefLoading(false); }, onError: () => setRefLoading(false) });
    } else if (tx.salesHeaderId) {
      setRefLoading(true);
      CallAPI(() => getSalesOrderById(tx.salesHeaderId!), { onCompleted: (d) => { setRefSales(d); setRefLoading(false); }, onError: () => setRefLoading(false) });
    }
  };

  // ─── Stock Adjustment drawer (the only manual stock entry — Purchase/Sales
  // already flow through their own modules) ─────────────────────────────────
  const [showStockDrawer, setShowStockDrawer] = useState(false);
  const [stockTarget, setStockTarget] = useState<'MATERIAL' | 'PRODUCT'>('MATERIAL');
  const [stockItemId, setStockItemId] = useState('');
  const [stockItemQuery, setStockItemQuery] = useState('');
  const [stockMaterials, setStockMaterials] = useState<Material[]>([]);
  const [stockProducts, setStockProducts] = useState<Product[]>([]);
  const [stockItemsLoading, setStockItemsLoading] = useState(false);
  const [stockQuantity, setStockQuantity] = useState(0);
  const [stockDirection, setStockDirection] = useState<'INCREASE' | 'DECREASE'>('INCREASE');
  const [stockUnitCost, setStockUnitCost] = useState(0);
  const [stockDate, setStockDate] = useState(toDateTimeLocal(new Date().toISOString()));
  const [stockRemark, setStockRemark] = useState('');

  useEffect(() => {
    if (!showStockDrawer) return;
    setStockItemsLoading(true);
    if (stockTarget === 'MATERIAL') {
      CallAPI(() => getMaterials(stockItemQuery), { onCompleted: (d) => { setStockMaterials(d); setStockItemsLoading(false); }, onError: () => setStockItemsLoading(false) });
    } else {
      CallAPI(() => getProducts(stockItemQuery), { onCompleted: (d) => { setStockProducts(d); setStockItemsLoading(false); }, onError: () => setStockItemsLoading(false) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockItemQuery, stockTarget, showStockDrawer]);

  const selectedStockItem = stockTarget === 'MATERIAL' ? stockMaterials.find(m => m.id === stockItemId) : stockProducts.find(p => p.id === stockItemId);
  const currentQuantity = selectedStockItem ? (selectedStockItem as Material).quantity ?? (selectedStockItem as Product).quantity ?? 0 : 0;

  const resetStockForm = () => {
    setStockTarget('MATERIAL'); setStockItemId(''); setStockItemQuery('');
    setStockQuantity(0); setStockDirection('INCREASE');
    setStockUnitCost(0); setStockDate(toDateTimeLocal(new Date().toISOString())); setStockRemark('');
  };

  const openStockDrawer = () => { resetStockForm(); setShowStockDrawer(true); };

  const handleSaveStockEntry = async () => {
    if (!stockItemId || stockQuantity <= 0) return;
    const delta = stockDirection === 'INCREASE' ? stockQuantity : -stockQuantity;

    const record: InventoryTransaction = {
      id: generateId(),
      transactionType: 'ADJUSTMENT',
      quantity: delta,
      unitCost: stockUnitCost || undefined,
      remark: stockRemark.trim() || undefined,
      materialId: stockTarget === 'MATERIAL' ? stockItemId : undefined,
      productId: stockTarget === 'PRODUCT' ? stockItemId : undefined,
      transactionDate: fromDateTimeLocal(stockDate),
    };

    await CallAPI(() => saveInventoryTransaction(record), {
      onCompleted: () => {
        loadTransactions(0, false, searchQuery);
        toast.success('Stock adjustment recorded.');
        setShowStockDrawer(false);
        resetStockForm();
      },
      onError: (err) => { console.error(err); toast.error('Failed to record stock adjustment.'); },
    });
  };

  // ─── Statistics dialog ────────────────────────────────────────────────────
  const [showStats, setShowStats] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [stats, setStats] = useState<InventoryStatsSummary | null>(null);
  const [lowStockItems, setLowStockItems] = useState<DashboardLowStockItem[]>([]);

  const openStats = () => {
    setShowStats(true);
    if (stats) return;
    setStatsLoading(true);
    Promise.all([getInventoryStatsSummary(6), getDashboardData()])
      .then(([summary, dashboard]) => { setStats(summary); setLowStockItems(dashboard.lowStockItems); })
      .catch(console.error)
      .finally(() => setStatsLoading(false));
  };

  const monthlyChartData = useMemo(() => (stats?.monthlyInOut || []).map(m => {
    const [y, mo] = m.month.split('-').map(Number);
    return { name: new Date(y, mo - 1, 1).toLocaleString('en-US', { month: 'short' }), In: m.stockIn, Out: m.stockOut };
  }), [stats]);

  // Client-side re-sort for the 3 joined/derived columns the server can't
  // order by — applied over whatever's currently loaded (grows as more pages
  // load via infinite scroll).
  const displayedTransactions = useMemo(() => {
    if (isServerSort) return transactions;
    const getValue = (tx: InventoryTransaction): string => {
      if (sortField === 'reference') return tx.refNo || '';
      if (sortField === 'item') return tx.materialName || tx.productName || '';
      return tx.status || '';
    };
    return [...transactions].sort((a, b) => {
      const cmp = getValue(a).localeCompare(getValue(b));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [transactions, sortField, sortDir, isServerSort]);

  // ─── Row action helpers ──────────────────────────────────────────────────
  const buildRowActions = (tx: InventoryTransaction): ActionMenuItem[] => [
    ...(tx.refNo ? [{ label: 'View Details', icon: <Eye className="w-3.5 h-3.5" />, onClick: () => openRefDrawer(tx) }] : []),
    ...(tx.refNo ? [{ label: 'Copy Reference', icon: <Copy className="w-3.5 h-3.5" />, onClick: () => { navigator.clipboard.writeText(tx.refNo!); toast.success('Reference copied.'); } }] : []),
  ];

  // ─── Columns ──────────────────────────────────────────────────────────────
  const columns: DataTableColumn<InventoryTransaction>[] = [
    {
      key: 'date', header: 'Date', sortable: true, className: 'w-30',
      render: (tx) => <span className="text-muted-foreground">{formatDateTime(tx.transactionDate)}</span>
    },
    {
      key: 'reference', header: 'Reference', sortable: true, className: 'w-36',
      render: (tx) => tx.refNo ? (
        <button type="button" onClick={(e) => { e.stopPropagation(); openRefDrawer(tx); }} className="font-mono text-primary hover:underline">
          {tx.refNo}
        </button>
      ) : <span className="text-muted-foreground">—</span>
    },
    {
      key: 'type', header: 'Movement Type', sortable: true, className: 'w-[1%] whitespace-nowrap',
      render: (tx) => {
        const meta = MOVEMENT_META[tx.transactionType];
        const Icon = meta.icon;
        return <Badge className={meta.badgeClassName}><Icon className="w-3 h-3 mr-1" />{meta.label}</Badge>;
      }
    },
    {
      key: 'item', header: 'Material / Product', sortable: true,
      render: (tx) => (
        <div className="min-w-0">
          <div className="font-medium text-card-foreground truncate">{tx.materialName || tx.productName || '—'}</div>
          {tx.counterpartyName && <div className="text-[11px] text-muted-foreground truncate">{tx.counterpartyName}</div>}
        </div>
      )
    },
    {
      key: 'quantity', header: 'Quantity', sortable: true, align: 'right', className: 'w-24',
      render: (tx) => tx.quantity >= 0 ? (
        <span className="inline-flex items-center gap-1 text-success font-medium"><ArrowUpCircle className="w-3.5 h-3.5" />{tx.quantity}</span>
      ) : (
        <span className="inline-flex items-center gap-1 text-destructive font-medium"><ArrowDownCircle className="w-3.5 h-3.5" />{Math.abs(tx.quantity)}</span>
      )
    },
    {
      key: 'status', header: 'Status', sortable: true, className: 'w-[1%] whitespace-nowrap',
      render: (tx) => tx.status ? <Badge variant="secondary">{tx.status}</Badge> : <span className="text-muted-foreground">—</span>
    },
  ];

  return (
    <div ref={contentRef} className="flex flex-col gap-5 min-[1440px]:h-full min-[1440px]:min-h-0" id="inventory-view">
      <PageHeader
        title="Inventory Transactions"
        description="Track all inventory movements and stock changes."
        actions={
          <>
            <Button variant="outline" onClick={openStats}><BarChart3 className="w-4 h-4" /> Statistics</Button>
            <Button onClick={openStockDrawer}><ClipboardPlus className="w-4 h-4" /> Stock Adjustment</Button>
          </>
        }
      />

      {/* Toolbar */}
      <SectionCard title="Filters" className="shrink-0" contentClassName="p-4 space-y-3">
        <FilterBar
          search={searchQuery}
          onSearchChange={(v) => { setSearchQuery(v); search(v); }}
          searchPlaceholder="Search by material, product, or reference..."
          chips={filterChips}
          onOpenFilters={openFilterDialog}
          filterCount={activeFilterCount}
          right={<Button variant="outline" size="sm" onClick={resetFilters}><RotateCcw className="w-3.5 h-3.5" /> Reset</Button>}
        />
        <QuickRangePills activeKey={activeQuickRange} onSelect={applyQuickRange} />
      </SectionCard>

      {/* Transaction table — the hero, gets almost the entire page */}
      <SectionCard title="Transactions" description={`${transactions.length} loaded${hasMore ? '+' : ''}`} className="flex-1 min-h-0" contentClassName="p-0 flex-1 min-h-0 flex flex-col">
        <div ref={tableScrollRef} className="flex-1 min-h-0 overflow-auto">
          <DataTable
            columns={columns}
            rows={displayedTransactions}
            rowKey={(tx) => tx.id}
            sortField={sortField}
            sortDir={sortDir}
            onSort={toggleSort}
            onRowClick={(tx) => tx.refNo && openRefDrawer(tx)}
            rowActions={(tx) => <ActionsMenu items={buildRowActions(tx)} />}
            loading={loading}
            emptyState="No inventory transactions match your filters."
          />
          <InfiniteScrollSentinel onLoadMore={handleLoadMore} hasMore={hasMore} loading={loadingMore} rootRef={tableScrollRef} />
        </div>
      </SectionCard>

      {/* Advanced filter dialog */}
      <FilterDialog
        open={showFilterDialog}
        onClose={() => setShowFilterDialog(false)}
        title="Filter Transactions"
        sections={[
          { type: 'dateRange', key: 'dateRange', label: 'Date Range', from: filterDraftDateFrom, to: filterDraftDateTo, onFromChange: setFilterDraftDateFrom, onToChange: setFilterDraftDateTo },
          {
            type: 'checklist', key: 'types', label: 'Movement Type', searchPlaceholder: 'Search types...', searchQuery: filterSearchQuery, onSearchChange: setFilterSearchQuery,
            items: TYPE_FILTER_OPTIONS.filter(t => !filterSearchQuery.trim() || t.label.toLowerCase().includes(filterSearchQuery.trim().toLowerCase())).map(t => ({ id: t.value, label: t.label })),
            selectedIds: filterDraftTypes, onToggle: toggleFilterDraftType
          },
          {
            type: 'checklist', key: 'materials', label: 'Material', searchPlaceholder: 'Search materials...', searchQuery: filterMaterialSearch,
            onSearchChange: (q) => { setFilterMaterialSearch(q); loadFilterMaterialOptions(q); },
            items: filterMaterialOptions.map(m => ({ id: m.id, label: m.name, sublabel: m.code })), loading: filterMaterialOptionsLoading,
            hasMore: filterMaterialHasMore, onLoadMore: loadMoreFilterMaterialOptions,
            selectedIds: filterDraftMaterialIds, onToggle: toggleFilterDraftMaterial
          },
          {
            type: 'checklist', key: 'products', label: 'Product', searchPlaceholder: 'Search products...', searchQuery: filterProductSearch,
            onSearchChange: (q) => { setFilterProductSearch(q); loadFilterProductOptions(q); },
            items: filterProductOptions.map(p => ({ id: p.id, label: p.name, sublabel: p.code })), loading: filterProductOptionsLoading,
            hasMore: filterProductHasMore, onLoadMore: loadMoreFilterProductOptions,
            selectedIds: filterDraftProductIds, onToggle: toggleFilterDraftProduct
          },
        ]}
        onApply={() => {
          setAppliedTypeFilters(filterDraftTypes);
          setAppliedMaterialIds(filterDraftMaterialIds);
          setAppliedProductIds(filterDraftProductIds);
          setDateFrom(filterDraftDateFrom);
          setDateTo(filterDraftDateTo);
          setActiveQuickRange(null);
        }}
        onClear={() => {
          setFilterDraftTypes([]); setFilterDraftMaterialIds([]); setFilterDraftProductIds([]); setFilterDraftDateFrom(monthStart(0)); setFilterDraftDateTo(monthEnd(0));
          setAppliedTypeFilters([]); setAppliedMaterialIds([]); setAppliedProductIds([]); setDateFrom(monthStart(0)); setDateTo(monthEnd(0)); setActiveQuickRange('thisMonth');
        }}
      />

      {/* Reference drawer — Purchase/Sales/Adjustment detail, slides from the right */}
      <Sheet
        open={!!refDrawerTx}
        onClose={() => setRefDrawerTx(null)}
        title={refDrawerTx?.refNo || 'Transaction Detail'}
        description={refDrawerTx ? <Badge className={MOVEMENT_META[refDrawerTx.transactionType].badgeClassName}>{MOVEMENT_META[refDrawerTx.transactionType].label}</Badge> : undefined}
      >
        {refDrawerTx && (
          <Tabs value={refTab} onValueChange={setRefTab} className="p-5">
            <TabsList className="w-full grid" style={{ gridTemplateColumns: `repeat(${refPurchase || refSales ? 3 : 1}, minmax(0,1fr))` }}>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              {(refPurchase || refSales) && <TabsTrigger value="items">Items</TabsTrigger>}
              {(refPurchase || refSales) && <TabsTrigger value="attachments">Attachments</TabsTrigger>}
            </TabsList>

            <TabsContent value="overview">
              {refLoading ? (
                <div className="py-12 text-center text-xs text-muted-foreground">Loading...</div>
              ) : refPurchase ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <MetricCard label="Vendor" value={refPurchase.vendorName} />
                    <MetricCard label="Status" value={<Badge variant="secondary">{refPurchase.status}</Badge>} />
                    <MetricCard label="Order Date" value={formatDateTime(refPurchase.orderDate || refPurchase.quotationDate)} />
                    <MetricCard label="Total" value={`RM ${refPurchase.totalPrice.toLocaleString()}`} />
                  </div>
                  {onViewPurchaseOrder && <Button variant="outline" size="sm" onClick={() => onViewPurchaseOrder(refPurchase.id)}>Open Full Purchase Order</Button>}
                </div>
              ) : refSales ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <MetricCard label="Client" value={refSales.clientName} />
                    <MetricCard label="Status" value={<Badge variant="secondary">{refSales.status}</Badge>} />
                    <MetricCard label="Order Date" value={formatDateTime(refSales.orderDate)} />
                    <MetricCard label="Total" value={`RM ${refSales.totalAmount.toLocaleString()}`} />
                  </div>
                  {onViewSalesOrder && <Button variant="outline" size="sm" onClick={() => onViewSalesOrder(refSales.id)}>Open Full Sales Order</Button>}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <MetricCard label="Item" value={refDrawerTx.materialName || refDrawerTx.productName || '—'} />
                    <MetricCard label="Quantity" value={refDrawerTx.quantity} />
                    <MetricCard label="Unit Cost" value={refDrawerTx.unitCost != null ? `RM ${refDrawerTx.unitCost.toFixed(2)}` : '—'} />
                    <MetricCard label="Date" value={formatDateTime(refDrawerTx.transactionDate)} />
                  </div>
                  {refDrawerTx.remark && <p className="text-sm text-muted-foreground">{refDrawerTx.remark}</p>}
                </div>
              )}
            </TabsContent>

            {(refPurchase || refSales) && (
              <TabsContent value="items">
                <div className="divide-y divide-border">
                  {(refPurchase?.details || refSales?.details || []).map((d: any) => (
                    <div key={d.detailId} className="py-2.5 flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <div className="font-medium text-card-foreground truncate">{d.materialName || d.productName}</div>
                        <div className="text-xs text-muted-foreground">Qty {d.quantity} × RM {(d.unitCost ?? d.unitPrice ?? 0).toFixed(2)}</div>
                      </div>
                      <div className="font-medium text-card-foreground shrink-0">RM {d.totalPrice.toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              </TabsContent>
            )}

            {(refPurchase || refSales) && (
              <TabsContent value="attachments">
                {(refPurchase?.attachments || refSales?.attachments || []).length === 0 ? (
                  <p className="text-xs text-muted-foreground py-6 text-center">No attachments.</p>
                ) : (
                  <div className="space-y-2">
                    {(refPurchase?.attachments || refSales?.attachments || []).map((a, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => openDataUrlInNewTab(a.dataUrl)}
                        className="w-full flex items-center gap-2 p-2.5 bg-secondary/50 border border-border rounded-lg text-xs text-left hover:bg-secondary transition-colors"
                      >
                        <Paperclip className="w-3.5 h-3.5 text-primary shrink-0" />
                        <span className="truncate">{a.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </TabsContent>
            )}
          </Tabs>
        )}
      </Sheet>

      {/* Stock Adjustment drawer */}
      <Sheet
        open={showStockDrawer}
        onClose={() => setShowStockDrawer(false)}
        title="Stock Adjustment"
        description="Recorded as a stock adjustment on the ledger."
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setShowStockDrawer(false)}>Cancel</Button>
            <Button onClick={handleSaveStockEntry}>Save</Button>
          </div>
        }
      >
        <div className="p-5 space-y-4 text-xs text-muted-foreground">
          <FormField label="Adjust Stock For">
            <SegmentedControl options={[{ value: 'MATERIAL', label: 'Material' }, { value: 'PRODUCT', label: 'Product' }]} active={stockTarget} onChange={(v) => { setStockTarget(v); setStockItemId(''); }} />
          </FormField>
          <FormField label={stockTarget === 'MATERIAL' ? 'Material *' : 'Product *'}>
            <ComboBox
              required
              value={stockItemId}
              onChange={setStockItemId}
              noneLabel={stockTarget === 'MATERIAL' ? '-- Select Material --' : '-- Select Product --'}
              options={stockTarget === 'MATERIAL' ? stockMaterials.map(m => ({ value: m.id, label: m.name, sublabel: m.code })) : stockProducts.map(p => ({ value: p.id, label: p.name, sublabel: p.code }))}
              onSearch={setStockItemQuery}
              searchLoading={stockItemsLoading}
            />
          </FormField>

          {selectedStockItem && (
            <div className="p-3 rounded-xl bg-secondary/50">
              <MetricCard label="Current Stock" value={currentQuantity} />
            </div>
          )}

          <FormField label="Direction">
            <SegmentedControl options={[{ value: 'INCREASE', label: 'Increase (+)' }, { value: 'DECREASE', label: 'Decrease (-)' }]} active={stockDirection} onChange={(v) => setStockDirection(v as 'INCREASE' | 'DECREASE')} />
          </FormField>
          <FormField label="Quantity *">
            <input type="number" required min="0" step="any" value={stockQuantity} onChange={(e) => setStockQuantity(Number(e.target.value))} className={fieldInputClassName} />
          </FormField>
          <FormField label="Unit Cost (RM)">
            <input type="number" min="0" step="0.01" value={stockUnitCost} onChange={(e) => setStockUnitCost(Number(e.target.value))} className={fieldInputClassName} />
          </FormField>
          <FormField label="Date *">
            <input type="datetime-local" required value={stockDate} onChange={(e) => setStockDate(e.target.value)} className={fieldInputClassName} />
          </FormField>
          <FormField label="Remark">
            <textarea value={stockRemark} onChange={(e) => setStockRemark(e.target.value)} rows={2} placeholder="Optional note..." className={fieldInputClassName} />
          </FormField>
        </div>
      </Sheet>

      {/* Statistics dialog — extra large, opened on demand instead of cluttering the page */}
      <Dialog open={showStats} onClose={() => setShowStats(false)} title="Inventory Statistics" maxWidth="max-w-7xl">
        <div className="p-6 space-y-6">
          {statsLoading || !stats ? (
            <div className="py-24 text-center text-xs text-muted-foreground">Loading statistics...</div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <StatCard label="Stock In (6mo)" value={stats.totalIn} icon={ArrowUpCircle} />
                <StatCard label="Stock Out (6mo)" value={stats.totalOut} icon={ArrowDownCircle} />
                <StatCard label="Net Change" value={stats.totalIn - stats.totalOut} icon={SlidersHorizontal} />
                <StatCard label="Transactions (6mo)" value={stats.transactionCount} icon={ClipboardPlus} />
              </div>

              <ChartCard title="Monthly In vs Out" description="Stock movement over the last 6 months">
                <div className="w-full h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                      <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                      <Tooltip cursor={{ fill: 'var(--primary)', opacity: 0.08 }} contentStyle={{ background: 'var(--popover)', borderColor: 'var(--border)', borderRadius: '12px', color: 'var(--popover-foreground)', fontSize: '12px' }} />
                      <Bar dataKey="In" fill="var(--chart-2)" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="Out" fill="var(--chart-3)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <SectionCard title="Top Consumed Materials" description="Last 6 months, by quantity used in production">
                  {stats.topConsumed.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-6">No consumption recorded.</p>
                  ) : (
                    <div className="space-y-3">
                      {stats.topConsumed.map((m) => {
                        const max = stats.topConsumed[0].quantity || 1;
                        return (
                          <div key={m.materialId} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-foreground font-medium truncate">{m.materialName}</span>
                              <span className="text-muted-foreground">{m.quantity}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                              <div className="h-full bg-primary rounded-full" style={{ width: `${(m.quantity / max) * 100}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </SectionCard>

                <SectionCard title="Low Stock Summary" description={`${lowStockItems.length} item${lowStockItems.length === 1 ? '' : 's'} at or below reorder point`}>
                  {lowStockItems.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-6">All inventory levels are healthy.</p>
                  ) : (
                    <div className="divide-y divide-border">
                      {lowStockItems.map((item) => (
                        <div key={item.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
                            <span className="truncate text-foreground">{item.name}</span>
                          </div>
                          <span className="text-muted-foreground shrink-0">{item.quantity} / min {item.minimumStock}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>
              </div>
            </>
          )}
        </div>
      </Dialog>
    </div>
  );
}
