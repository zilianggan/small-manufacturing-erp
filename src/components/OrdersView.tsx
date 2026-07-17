/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import {
  getSalesOrders, createSalesQuotation, updateSalesOrder, convertToSalesOrder,
  startProduction, checkProductionStock, checkProductionCompletionStock, confirmProductionDone, markDelivered, cancelSalesOrder, deleteSalesOrder,
  getSalesOrderById, returnSalesOrder, getOutstandingDemand, getProductStock, canStartProduction, canDeliver, canDeleteSalesOrder,
  canAddMaterial, addMaterialUsage,
  SalesDetailInput, MaterialUsageInput, MaterialReconciliationInput, LeftoverMaterialInput, ProducedLine,
  SalesFilters, SalesSortField, SortDir, SalesReturnLine, ProduceLine, DeliveryLine, MaterialShortfall, DemandRow, NewMaterialUsage,
} from '../services/OrdersService';
import { getProducts, getProductsPage } from '../services/ProductService';
import { getMaterials } from '../services/MaterialService';
import { getMaterialCategories, getWhatsappTemplates } from '../services/SystemAdminService';
import { getClients, getContacts } from '../services/ContactsService';
import { SalesHeader, Client, Contact, Product, Material, MaterialCategory, Attachment, SalesPriority } from '../types';
import { buildWhatsappUrl, fillSalesTemplate } from '../utils/whatsapp';
import { PRIORITY_META, PRIORITY_OPTIONS, getDueUrgency } from '../utils/priority';
import { formatDateTime, formatDate, toDateTimeLocal, fromDateTimeLocal, monthStart, monthEnd } from '../utils/date';
import { QUICK_RANGES } from '../utils/dateRanges';
import QuickRangePills from './QuickRangePills';
import { Plus, Calendar, Check, CheckCheck, Factory, Paperclip, Trash2, Edit, FileText, ArrowRightCircle, Eye, RotateCcw, Undo2, AlertTriangle, MessageCircle } from 'lucide-react';
import AttachmentSection from './AttachmentSection';
import SalesQuotationModal from './SalesQuotationModal';
import ProductionCompletionModal from './ProductionCompletionModal';
import StartProductionModal from './StartProductionModal';
import AddMaterialModal from './AddMaterialModal';
import LineQuantityModal, { LineQuantityModalLine } from './LineQuantityModal';
import SalesOrderDetailView from './SalesOrderDetailView';
import ComboBox from './ComboBox';
import DatePicker from './DatePicker';
import DateTimePicker from './DateTimePicker';
import FilterDialog from './FilterDialog';
import { PageHeader, SectionCard, FilterBar, DataTable, ColumnsMenu } from './shell';
import { useAndroidBackButton } from '../hooks/useAndroidBackButton';
import { useColumnVisibility } from '../hooks/useColumnVisibility';
import type { DataTableColumn, FilterChip } from './shell';
import {
  Button, Badge, Sheet, FormField, fieldInputClassName, ActionsMenu,
  Tabs, TabsList, TabsTrigger, useToast, useConfirm,
} from './ui';
import type { ActionMenuItem } from './ui';
import { useFadeInOnMount } from '../hooks/useFadeInOnMount';
import { CallAPI } from './UIHelper';
import { debounce } from 'lodash';

type OrderTab = 'QUOTATION' | 'SO';
type FormMode = 'CREATE' | 'EDIT' | 'CONVERT';

// 'items' (Product & Quantity) has no single backing column — sales_detail is
// a joined child list, so PostgREST can't order by it. Sorted client-side
// over whatever's currently loaded, same trick PurchasesView.tsx uses for its
// joined/derived "Material Details" column.
type DisplaySortField = SalesSortField | 'items' | 'priority';
// 'client' is a joined column (clients.company_name) — PostgREST's
// order(col, {foreignTable}) doesn't reliably sort by it, so it's sorted
// client-side below, same trick as 'items'/'priority'.
const SERVER_SORT_FIELDS: readonly string[] = ['reference', 'date', 'totalAmount', 'productionDue', 'status', 'createdAt', 'updatedAt'];

// SO-tab-only statuses (QUOTATION tab is always a single status, filtering it is a no-op).
const SO_STATUSES: SalesHeader['status'][] = ['ORDERED', 'IN_PRODUCTION', 'DONE_IN_PRODUCTION', 'PARTIALLY_DELIVERED', 'DELIVERED', 'PARTIALLY_RETURNED', 'RETURNED', 'CANCELLED'];

const STATUS_META: Record<SalesHeader['status'], { label: string; variant: 'default' | 'warning' | 'success' | 'destructive' | 'secondary' }> = {
  QUOTATION: { label: 'Quotation', variant: 'default' },
  ORDERED: { label: 'Pending Production', variant: 'warning' },
  IN_PRODUCTION: { label: 'In Production', variant: 'default' },
  DONE_IN_PRODUCTION: { label: 'Done in Production', variant: 'secondary' },
  PARTIALLY_DELIVERED: { label: 'Partially Delivered', variant: 'warning' },
  DELIVERED: { label: 'Delivered', variant: 'success' },
  PARTIALLY_RETURNED: { label: 'Partially Returned', variant: 'warning' },
  RETURNED: { label: 'Returned', variant: 'secondary' },
  CANCELLED: { label: 'Cancelled', variant: 'destructive' },
};

// A row is short when what's available can't cover what it has to cover: for the product panel that's
// this order's own quantity, for the material panel (no `ordered`) it's simply "don't go negative".
export type DemandPanelRow = DemandRow & { ordered?: number };

// Read-only "can we actually cover this?" panel. Available to promise = stock − outstanding, i.e.
// physical stock minus what every OTHER open order already promises. It reserves nothing and gates
// nothing — it exists so the person typing can see whether this order needs a production run at all.
function DemandPanel({ title, itemHeader, outstandingHeader, orderedHeader, rows, shortfallHint, emptyHint }: {
  title: string;
  itemHeader: string;
  outstandingHeader: string;
  orderedHeader?: string; // when set, the row's own demand gets a column and becomes the shortfall bar
  rows: DemandPanelRow[];
  shortfallHint: string;
  emptyHint?: string;
}) {
  const cols = orderedHeader
    ? 'grid grid-cols-[1fr_5rem_6rem_6rem_6rem] gap-2'
    : 'grid grid-cols-[1fr_5rem_6rem_6rem] gap-2';
  const short = rows.some(r => r.inStock - r.outstanding < (r.ordered ?? 0));
  return (
    <div className="border border-border rounded-xl bg-secondary/30 overflow-hidden">
      <div className="px-3 py-2 font-semibold text-foreground text-xs">{title}</div>
      {rows.length === 0 ? (
        <div className="px-3 pb-3 text-[11px] text-muted-foreground">{emptyHint ?? 'No open demand.'}</div>
      ) : (
        <>
          <div className={`${cols} px-3 py-1.5 bg-secondary/40 font-semibold text-muted-foreground text-[10px] uppercase tracking-wider`}>
            <span>{itemHeader}</span>
            <span className="text-right">In Stock</span>
            <span className="text-right">{outstandingHeader}</span>
            <span className="text-right">Available</span>
            {orderedHeader && <span className="text-right">{orderedHeader}</span>}
          </div>
          {rows.map(r => {
            const available = r.inStock - r.outstanding;
            const covered = available >= (r.ordered ?? 0);
            return (
              <div key={r.id} className={`${cols} px-3 py-1.5 border-t border-border text-[11px]`}>
                <span className="text-card-foreground truncate">{r.name}</span>
                <span className="text-right font-mono text-muted-foreground">{r.inStock}</span>
                <span className="text-right font-mono text-muted-foreground">{r.outstanding}</span>
                <span className={`text-right font-mono font-semibold ${covered ? 'text-foreground' : 'text-destructive'}`}>{available}</span>
                {orderedHeader && <span className="text-right font-mono text-muted-foreground">{r.ordered ?? 0}</span>}
              </div>
            );
          })}
          {short && (
            <div className="px-3 py-2 border-t border-border bg-destructive/5 text-[10px] text-destructive flex items-start gap-1.5">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              <span>{shortfallHint} You can still save this order.</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface OrdersViewProps {
  // Cross-tab drill-in: ProductView.tsx's/MaterialView.tsx's inventory list
  // links here via App.tsx passing a pending sales header id,
  // since Orders/Product/Material are separate top-level tabs with no shared
  // router.
  initialOrderId?: string | null;
  onInitialOrderHandled?: () => void;
  // Which detail page the cross-tab drill-in came from — a material row can
  // link here too (production consumption against this sale) — used only to
  // word the detail page's Back button correctly.
  initialOrderOrigin?: 'PRODUCT' | 'MATERIAL' | 'INVENTORY' | 'PURCHASES';
  // Called instead of closing locally when the currently open detail page
  // was reached via that cross-tab drill-in — lets App.tsx send the user
  // back to the originating Product/Material detail page rather than this list.
  onReturnToOrigin?: () => void;
}

/**
 * Sales Contracts — table-first ledger (Pattern C) with a Quotation/Sales
 * Order tab switch, mirroring PurchasesView.tsx. Selecting a row swaps the
 * whole page for SalesOrderDetailView instead of a Sheet drawer: the detail
 * has a longer status-driven lifecycle (production stages) and is also a
 * cross-tab navigation target, so a full page keeps the Back button and
 * origin-return behavior simple.
 */
export default function OrdersView({ initialOrderId, onInitialOrderHandled, initialOrderOrigin, onReturnToOrigin }: OrdersViewProps = {}) {
  const toast = useToast();
  const confirm = useConfirm();
  const contentRef = useFadeInOnMount<HTMLDivElement>([]);

  const [activeTab, setActiveTab] = useState<OrderTab>('QUOTATION');
  const [searchQuery, setSearchQuery] = useState<Record<OrderTab, string>>({ QUOTATION: '', SO: '' });
  const [orders, setOrders] = useState<SalesHeader[]>([]);
  const [loading, setLoading] = useState(true);

  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialCategories, setMaterialCategories] = useState<MaterialCategory[]>([]);
  const [transitioningId, setTransitioningId] = useState<string | null>(null);
  const [completingOrder, setCompletingOrder] = useState<SalesHeader | null>(null);
  const [returningOrder, setReturningOrder] = useState<SalesHeader | null>(null);
  const [startingOrder, setStartingOrder] = useState<SalesHeader | null>(null);
  const [deliveringOrder, setDeliveringOrder] = useState<SalesHeader | null>(null);
  const [addingMaterialOrder, setAddingMaterialOrder] = useState<SalesHeader | null>(null);
  const [productStock, setProductStock] = useState<Record<string, number>>({});
  const [productionShortfalls, setProductionShortfalls] = useState<MaterialShortfall[]>([]);
  const [completionShortfalls, setCompletionShortfalls] = useState<MaterialShortfall[]>([]);
  // Outstanding demand across every OTHER open order — planning visibility on the form, never a
  // reservation and never a blocker.
  const [demand, setDemand] = useState<{ products: DemandRow[]; materials: DemandRow[] }>({ products: [], materials: [] });
  const [formProductStock, setFormProductStock] = useState<Record<string, number>>({});

  // Drill-down: selected order (shows SalesOrderDetailView instead of the table)
  const [selectedOrder, setSelectedOrder] = useState<SalesHeader | null>(null);
  // Tracks whether the open detail page was reached via the cross-tab
  // initialOrderId drill-in (Back should return to that origin) or a plain
  // click on a row in this view's own list (Back should just close locally).
  const [detailOpenedExternally, setDetailOpenedExternally] = useState(false);
  // Re-fetch the open detail page after a mutation. No-op when no detail is
  // open (e.g. edit/cancel triggered from the listing row menu) — otherwise it
  // would pop the detail page open and yank the user off the list.
  const refreshSelectedOrder = (id: string) => {
    if (!selectedOrder) return;
    getSalesOrderById(id).then((order) => { if (order) setSelectedOrder(order); }).catch(console.error);
  };

  const openOrderDetail = (order: SalesHeader) => {
    setDetailOpenedExternally(false);
    setSelectedOrder(order);
  };

  const handleDetailBack = () => {
    // Always close the detail locally first — a Dashboard-opened drill-in
    // (no material/inventory/product origin) has nothing for onReturnToOrigin
    // to do, so without this the Back button silently no-op'd and the detail stuck.
    setSelectedOrder(null);
    if (detailOpenedExternally) onReturnToOrigin?.();
  };
  useAndroidBackButton(!!selectedOrder, handleDetailBack);

  // Detail page needs live finished-goods stock to know whether Start Production has anything left
  // to do (see nothingToProduce in SalesOrderDetailView) — fetch it whenever a different order opens.
  useEffect(() => {
    if (!selectedOrder) return;
    getProductStock(selectedOrder.details.map(d => d.productId)).then(setProductStock).catch(console.error);
  }, [selectedOrder?.id]);

  // Cross-tab drill-in: fetch and open the order directly by id (independent
  // of whatever tab/search filter is currently active), then tell the parent
  // it's been handled so switching tabs again doesn't re-trigger it.
  useEffect(() => {
    if (!initialOrderId) return;
    CallAPI(() => getSalesOrderById(initialOrderId), {
      onCompleted: (order) => {
        if (order) {
          setSelectedOrder(order);
          setDetailOpenedExternally(true);
        }
        onInitialOrderHandled?.();
      },
      onError: (err) => { console.error(err); onInitialOrderHandled?.(); },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOrderId]);

  useEffect(() => {
    getClients().then(setClients).catch(console.error);
    getProducts().then(setProducts).catch(console.error);
    getMaterials().then(setMaterials).catch(console.error);
    CallAPI(getMaterialCategories, { onCompleted: setMaterialCategories, onError: console.error });
  }, []);

  const activeProducts = useMemo(
    () => products.filter(p => p.status !== 'INACTIVE'),
    [products]
  );

  const rawMaterials = useMemo(
    () => materials.filter(m => m.materialType === 'RAW_MATERIAL' && m.status !== 'INACTIVE'),
    [materials]
  );

  const materialCategoryMap = useMemo(
    () => new Map(materialCategories.map(c => [c.id, c])),
    [materialCategories]
  );

  // ─── Filter dialog: client + product record pickers, date range ─────────
  // Defaults to the current month (like Inventory) — avoids pulling every
  // order ever placed on first load.
  const [appliedFilters, setAppliedFilters] = useState<SalesFilters>({ dateFrom: monthStart(0), dateTo: monthEnd(0) });
  const [showFilterDialog, setShowFilterDialog] = useState(false);
  const [filterDraftClientIds, setFilterDraftClientIds] = useState<string[]>([]);
  const [filterDraftProductIds, setFilterDraftProductIds] = useState<string[]>([]);
  const [filterDraftStatuses, setFilterDraftStatuses] = useState<SalesHeader['status'][]>([]);
  const [filterDraftDateFrom, setFilterDraftDateFrom] = useState(monthStart(0));
  const [filterDraftDateTo, setFilterDraftDateTo] = useState(monthEnd(0));
  const [filterClientSearch, setFilterClientSearch] = useState('');
  const [filterProductSearch, setFilterProductSearch] = useState('');
  const [filterClientVisibleCount, setFilterClientVisibleCount] = useState(20);
  const [filterProductOptions, setFilterProductOptions] = useState<Product[]>([]);
  const [filterProductOptionsLoading, setFilterProductOptionsLoading] = useState(false);
  const [filterProductOffset, setFilterProductOffset] = useState(0);
  const [filterProductHasMore, setFilterProductHasMore] = useState(false);
  const [activeQuickRange, setActiveQuickRange] = useState<string | null>('thisMonth');
  // Quick tag filters — independent of the appliedFilters round trip since neither is a stored
  // column: priority is already loaded, and overdue is derived from productionDueDate vs today.
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);

  // Toggling the active pill off clears to all-time (matches Inventory);
  // the Reset button below falls back to the current month instead.
  const applyQuickRange = (key: string) => {
    if (activeQuickRange === key) {
      setActiveQuickRange(null);
      setAppliedFilters(f => ({ ...f, dateFrom: undefined, dateTo: undefined }));
      return;
    }
    const range = QUICK_RANGES.find(r => r.key === key);
    if (!range) return;
    setActiveQuickRange(key);
    setAppliedFilters(f => ({ ...f, dateFrom: range.from(), dateTo: range.to() }));
  };

  const resetFilters = () => {
    setAppliedFilters({ dateFrom: monthStart(0), dateTo: monthEnd(0) });
    setActiveQuickRange('thisMonth');
    setSearchQuery(prev => ({ ...prev, [activeTab]: '' }));
    resetColumns();
  };

  // ─── Sort ─────────────────────────────────────────────────────────────
  const [sortField, setSortField] = useState<DisplaySortField>('reference');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const isServerSort = SERVER_SORT_FIELDS.includes(sortField);

  // Guards against out-of-order responses: switching tabs (or typing a new
  // search) quickly fires a new request before the previous one resolves —
  // without this, an older response landing last overwrites the table with
  // the wrong tab's data.
  const requestIdRef = useRef(0);

  const loadOrders = (tab: OrderTab, search: string = '') => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    CallAPI(() => getSalesOrders(tab, search, { filters: appliedFilters, sortField: (isServerSort ? sortField : 'date') as SalesSortField, sortDir: isServerSort ? sortDir : 'desc' }), {
      onCompleted: (data) => {
        if (requestId !== requestIdRef.current) return;
        setOrders(data);
        setLoading(false);
      },
      onError: (err) => {
        if (requestId !== requestIdRef.current) return;
        console.error(err);
        setLoading(false);
      },
    });
  };

  useEffect(() => {
    loadOrders(activeTab, searchQuery[activeTab]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, appliedFilters, sortField, sortDir]);

  // Debounced search-as-you-type
  const search = useMemo(
    () => debounce((text: string) => loadOrders(activeTab, text), 500),
    [activeTab, appliedFilters, sortField, sortDir]
  );

  const loadFilterProductOptions = useMemo(() => debounce((q: string) => {
    setFilterProductOptionsLoading(true);
    CallAPI(() => getProductsPage({ search: q, offset: 0, limit: 20 }), {
      onCompleted: ({ rows, hasMore }) => {
        setFilterProductOptions(rows); setFilterProductHasMore(hasMore); setFilterProductOffset(rows.length); setFilterProductOptionsLoading(false);
      },
      onError: () => setFilterProductOptionsLoading(false),
    });
  }, 300), []);
  const loadMoreFilterProductOptions = () => {
    if (filterProductOptionsLoading || !filterProductHasMore) return;
    setFilterProductOptionsLoading(true);
    CallAPI(() => getProductsPage({ search: filterProductSearch, offset: filterProductOffset, limit: 20 }), {
      onCompleted: ({ rows, hasMore }) => {
        setFilterProductOptions(prev => [...prev, ...rows]); setFilterProductHasMore(hasMore); setFilterProductOffset(o => o + rows.length); setFilterProductOptionsLoading(false);
      },
      onError: () => setFilterProductOptionsLoading(false),
    });
  };

  const openFilterDialog = () => {
    setFilterDraftClientIds(appliedFilters.clientIds || []);
    setFilterDraftProductIds(appliedFilters.productIds || []);
    setFilterDraftStatuses(appliedFilters.statuses || []);
    setFilterDraftDateFrom(appliedFilters.dateFrom || '');
    setFilterDraftDateTo(appliedFilters.dateTo || '');
    setFilterClientSearch('');
    setFilterProductSearch('');
    setFilterClientVisibleCount(20);
    setFilterProductOptions([]); setFilterProductOffset(0); setFilterProductHasMore(false);
    setShowFilterDialog(true);
    loadFilterProductOptions('');
  };

  const toggleFilterDraftStatus = (id: string) => {
    const status = id as SalesHeader['status'];
    setFilterDraftStatuses(prev => (prev.includes(status) ? prev.filter(x => x !== status) : [...prev, status]));
  };

  const toggleFilterDraftClient = (id: string) => {
    setFilterDraftClientIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };
  const toggleFilterDraftProduct = (id: string) => {
    setFilterDraftProductIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const filterClientMatches = useMemo(() => {
    const q = filterClientSearch.trim().toLowerCase();
    return clients.filter(c => !q || c.companyName.toLowerCase().includes(q));
  }, [clients, filterClientSearch]);
  const filterClientItems = useMemo(
    () => filterClientMatches.slice(0, filterClientVisibleCount).map(c => ({ id: c.id, label: c.companyName })),
    [filterClientMatches, filterClientVisibleCount]
  );

  const filterProductItems = useMemo(
    () => filterProductOptions.map(p => ({ id: p.id, label: p.name, sublabel: p.code })),
    [filterProductOptions]
  );

  const filterChips: FilterChip[] = [
    ...(appliedFilters.clientIds?.length ? [{ key: 'clients', label: `${appliedFilters.clientIds.length} client${appliedFilters.clientIds.length === 1 ? '' : 's'}`, onRemove: () => setAppliedFilters(f => ({ ...f, clientIds: [] })) }] : []),
    ...(appliedFilters.productIds?.length ? [{ key: 'products', label: `${appliedFilters.productIds.length} product${appliedFilters.productIds.length === 1 ? '' : 's'}`, onRemove: () => setAppliedFilters(f => ({ ...f, productIds: [] })) }] : []),
    ...(appliedFilters.statuses?.length ? [{ key: 'statuses', label: `${appliedFilters.statuses.length} status${appliedFilters.statuses.length === 1 ? '' : 'es'}`, onRemove: () => setAppliedFilters(f => ({ ...f, statuses: [] })) }] : []),
    ...(appliedFilters.dateFrom || appliedFilters.dateTo ? [{ key: 'date', label: `${appliedFilters.dateFrom || '…'} → ${appliedFilters.dateTo || '…'}`, onRemove: () => { setActiveQuickRange('thisMonth'); setAppliedFilters(f => ({ ...f, dateFrom: monthStart(0), dateTo: monthEnd(0) })); } }] : []),
  ];
  const activeFilterCount = (appliedFilters.clientIds?.length || 0) + (appliedFilters.productIds?.length || 0) + (appliedFilters.statuses?.length || 0) + (appliedFilters.dateFrom || appliedFilters.dateTo ? 1 : 0);

  const toggleSort = (key: string) => {
    const field = key as DisplaySortField;
    if (field === sortField) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
  };

  // Urgent/Overdue quick tags narrow the already-loaded list — neither is a stored column
  // (priority is, but "quick tag" here means independent of the appliedFilters round trip).
  const tagFilteredOrders = useMemo(() => {
    let rows = orders;
    if (urgentOnly) rows = rows.filter(o => o.priority === 'URGENT');
    if (overdueOnly) rows = rows.filter(o => getDueUrgency(o.productionDueDate)?.label === 'Overdue');
    return rows;
  }, [orders, urgentOnly, overdueOnly]);

  // Client-side re-sort for the 'items'/'priority' columns — applied over
  // whatever's currently loaded (server-sorted columns skip this and pass
  // through). Priority can't be ordered via a plain SQL column sort since
  // it's ranked (Urgent > High > Medium > Low), not alphabetical.
  const displayedOrders = useMemo(() => {
    if (isServerSort) return tagFilteredOrders;
    if (sortField === 'priority') {
      return [...tagFilteredOrders].sort((a, b) => {
        const cmp = PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank;
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    if (sortField === 'client') {
      return [...tagFilteredOrders].sort((a, b) => {
        const cmp = (a.clientName || '').localeCompare(b.clientName || '');
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    const firstItemLabel = (o: SalesHeader) => o.details[0]?.productName || '';
    return [...tagFilteredOrders].sort((a, b) => {
      const cmp = firstItemLabel(a).localeCompare(firstItemLabel(b));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [tagFilteredOrders, sortField, sortDir, isServerSort]);

  // Quotation print modal
  const [selectedQuotation, setSelectedQuotation] = useState<SalesHeader | null>(null);
  const [isQuotationModalOpen, setIsQuotationModalOpen] = useState(false);

  // Form drawer state
  const [showFormSheet, setShowFormSheet] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>('CREATE');
  const [editHeaderId, setEditHeaderId] = useState<string | null>(null);
  const [editHeaderStatus, setEditHeaderStatus] = useState<SalesHeader['status'] | null>(null);
  const [formClientId, setFormClientId] = useState('');
  const [formContactId, setFormContactId] = useState('');
  const [formContacts, setFormContacts] = useState<Contact[]>([]);
  const [formDeliveryDate, setFormDeliveryDate] = useState('');
  const [formProductionDueDate, setFormProductionDueDate] = useState('');
  const [formPriority, setFormPriority] = useState<SalesPriority>('MEDIUM');
  const [formRemark, setFormRemark] = useState('');
  const [formDetails, setFormDetails] = useState<SalesDetailInput[]>([]);
  const [tempProductId, setTempProductId] = useState('');
  const [tempQuantity, setTempQuantity] = useState(1);
  const [tempUnitPrice, setTempUnitPrice] = useState(0);
  // The production-material add row. It targets a product line by index rather than staging
  // materials alongside a pending product — see handleAddMaterialRow.
  const [tempMaterialDetailIdx, setTempMaterialDetailIdx] = useState('0');
  const [tempMaterialId, setTempMaterialId] = useState('');
  const [tempMaterialQty, setTempMaterialQty] = useState(1);
  const [formAttachment, setFormAttachment] = useState<Attachment | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  // Clears the pending (not-yet-committed) add-row fields for both tables.
  // Mirrors PurchasesView.tsx's clearTempMaterials — without this, values
  // typed into an "add" row leak into the next form open.
  const clearTempStaging = () => {
    setTempProductId('');
    setTempQuantity(1);
    setTempUnitPrice(0);
    setTempMaterialDetailIdx('0');
    setTempMaterialId('');
    setTempMaterialQty(1);
  };

  // Contact picker is scoped to whichever client is currently selected —
  // switching clients clears any contact picked for the old one.
  useEffect(() => {
    if (!formClientId) { setFormContacts([]); setFormContactId(''); return; }
    getContacts({ clientId: formClientId }).then((contacts) => {
      setFormContacts(contacts);
      setFormContactId(prev => contacts.some(c => c.id === prev) ? prev : '');
    }).catch(console.error);
  }, [formClientId]);

  const resetForm = () => {
    setEditHeaderId(null);
    setFormClientId('');
    setFormContactId('');
    setFormDeliveryDate('');
    setFormProductionDueDate('');
    setFormPriority('MEDIUM');
    setFormRemark('');
    setFormDetails([]);
    setFormAttachment(undefined);
    clearTempStaging();
  };

  // Outstanding demand is a snapshot taken when the form opens, not a live subscription — it exists
  // to inform the person typing, and refetching it on every keystroke would be a query per keystroke
  // for a number that only moves when some *other* order does.
  useEffect(() => {
    if (!showFormSheet) return;
    let cancelled = false;
    getOutstandingDemand(editHeaderId ?? undefined).then(d => {
      if (!cancelled) setDemand(d);
    });
    return () => { cancelled = true; };
  }, [showFormSheet, editHeaderId]);

  // Finished-goods stock for the products on THIS form. getOutstandingDemand only knows about
  // products some other open order wants, so it can't answer "what's on the shelf for the product I
  // just picked" — a brand-new product with stock and no competing demand appears in neither map.
  // Keyed on the id list rather than formDetails so retyping a quantity doesn't refetch.
  const formProductIds = useMemo(
    () => Array.from(new Set(formDetails.map(d => d.productId).filter(Boolean))).sort().join(','),
    [formDetails]
  );

  useEffect(() => {
    if (!showFormSheet || !formProductIds) {
      setFormProductStock({});
      return;
    }
    let cancelled = false;
    getProductStock(formProductIds.split(',')).then(s => {
      if (!cancelled) setFormProductStock(s);
    });
    return () => { cancelled = true; };
  }, [showFormSheet, formProductIds]);

  // Available to promise, per product on this order. Outstanding already excludes the order being
  // edited, so ATP is "stock minus what everyone else is owed" — if it covers the line, this order
  // can ship from stock and skip production entirely.
  const atpRows = useMemo<DemandPanelRow[]>(() => {
    const outstandingByProduct = new Map(demand.products.map(p => [p.id, p.outstanding]));
    const byProduct = new Map<string, DemandPanelRow>();

    for (const d of formDetails) {
      if (!d.productId) continue;
      const row = byProduct.get(d.productId) ?? {
        id: d.productId,
        name: d.productName,
        inStock: formProductStock[d.productId] ?? 0,
        outstanding: outstandingByProduct.get(d.productId) ?? 0,
        ordered: 0,
      };
      // Two lines can carry the same product — they compete for the same shelf, so they're one row.
      row.ordered = (row.ordered ?? 0) + d.quantity;
      byProduct.set(d.productId, row);
    }
    return Array.from(byProduct.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [formDetails, formProductStock, demand.products]);

  // datetime-local default: 14 days out, as "yyyy-MM-ddThh:mm" local.
  const defaultDeliveryDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return toDateTimeLocal(d.toISOString());
  };

  const openCreateForm = () => {
    resetForm();
    setFormMode('CREATE');
    setShowFormSheet(true);
  };

  const detailsFromHeader = (order: SalesHeader): SalesDetailInput[] =>
    order.details.map(d => ({
      productId: d.productId,
      productName: d.productName,
      productCode: d.productCode,
      quantity: d.quantity,
      unitPrice: d.unitPrice,
      product: d.product,
      totalPrice: d.totalPrice,
      materials: d.materials.map(m => ({
        materialId: m.materialId,
        materialName: m.materialName,
        materialCode: m.materialCode,
        plannedQuantity: m.plannedQuantity,
      })),
    }));

  const openEditForm = (order: SalesHeader) => {
    clearTempStaging();
    setFormMode('EDIT');
    setEditHeaderId(order.id);
    setEditHeaderStatus(order.status);
    setFormClientId(order.clientId);
    setFormContactId(order.contactId || '');
    setFormProductionDueDate(order.productionDueDate || '');
    setFormPriority(order.priority || 'MEDIUM');
    setFormRemark(order.remark || '');
    setFormAttachment(order.attachments?.[0]);
    setFormDetails(detailsFromHeader(order));
    setShowFormSheet(true);
  };

  const openConvertForm = (order: SalesHeader) => {
    clearTempStaging();
    setFormMode('CONVERT');
    setEditHeaderId(order.id);
    setFormClientId(order.clientId);
    setFormContactId(order.contactId || '');
    setFormProductionDueDate(order.productionDueDate || '');
    setFormPriority(order.priority || 'MEDIUM');
    setFormRemark(order.remark || '');
    setFormAttachment(order.attachments?.[0]);
    setFormDetails(detailsFromHeader(order));
    setFormDeliveryDate(defaultDeliveryDate());
    setShowFormSheet(true);
  };

  // Product catalog rows carry a sellingPrice, so selecting a product
  // prefills the quoted unit price — the seller can still override it.
  const handleProductSelect = (productId: string) => {
    setTempProductId(productId);
    const product = activeProducts.find(p => p.id === productId);
    if (product) setTempUnitPrice(product.sellingPrice);
  };

  // The two tables are independent: a product line is added on its own, and a production material is
  // added on its own and points at one of the product lines by index. (They used to be one staging
  // area — you picked a product, stapled materials to it, and committed both together — which is why
  // a material added after "+ Add Item" had no line to attach to and got silently dropped. Splitting
  // them is what removes that failure mode, not a workaround for it.)
  //
  // The rows still land in SalesDetailInput.materials, because production_material_usage hangs off
  // sales_detail — the flat table is the presentation, the nesting is the storage.
  const materialRows = formDetails.flatMap((d, detailIdx) =>
    d.materials.map((m, materialIdx) => ({ detailIdx, materialIdx, material: m, productName: d.productName }))
  );

  // Two lines can hold the same product, so the picker labels by position when a name repeats —
  // otherwise the dropdown would show two identical options and the user couldn't tell them apart.
  const productLineLabel = (detail: SalesDetailInput, idx: number) => {
    const dupes = formDetails.filter(d => d.productId === detail.productId).length;
    return dupes > 1 ? `${detail.productName} (line ${idx + 1})` : detail.productName;
  };

  const handleAddMaterialRow = () => {
    const detailIdx = Number(tempMaterialDetailIdx);
    if (!tempMaterialId || tempMaterialQty <= 0 || !formDetails[detailIdx]) return;
    const material = rawMaterials.find(m => m.id === tempMaterialId);
    if (!material) return;

    const updated = [...formDetails];
    const materials = [...updated[detailIdx].materials];
    const existing = materials.findIndex(m => m.materialId === tempMaterialId);
    if (existing !== -1) {
      materials[existing] = { ...materials[existing], plannedQuantity: materials[existing].plannedQuantity + tempMaterialQty };
    } else {
      materials.push({
        materialId: tempMaterialId,
        materialName: material.name,
        materialCode: material.code,
        plannedQuantity: tempMaterialQty,
      });
    }
    updated[detailIdx] = { ...updated[detailIdx], materials };
    setFormDetails(updated);

    setTempMaterialId('');
    setTempMaterialQty(1);
  };

  const handleRemoveMaterialRow = (detailIdx: number, materialIdx: number) => {
    const updated = [...formDetails];
    updated[detailIdx] = {
      ...updated[detailIdx],
      materials: updated[detailIdx].materials.filter((_, i) => i !== materialIdx),
    };
    setFormDetails(updated);
  };

  const handleUpdateMaterialRow = (detailIdx: number, materialIdx: number, patch: Partial<MaterialUsageInput>) => {
    const updated = [...formDetails];
    const materials = [...updated[detailIdx].materials];
    materials[materialIdx] = { ...materials[materialIdx], ...patch };
    updated[detailIdx] = { ...updated[detailIdx], materials };
    setFormDetails(updated);
  };

  const handleAddTempItem = () => {
    if (!tempProductId || tempQuantity <= 0) return;
    const product = activeProducts.find(p => p.id === tempProductId);
    if (!product) return;

    setFormDetails([...formDetails, {
      productId: tempProductId,
      productName: product.name,
      productCode: product.code,
      quantity: tempQuantity,
      unitPrice: tempUnitPrice,
      totalPrice: tempQuantity * tempUnitPrice,
      materials: [],
    }]);

    clearTempStaging();
  };

  const handleRemoveFormItem = (index: number) => {
    setFormDetails(formDetails.filter((_, idx) => idx !== index));
  };

  const handleUpdateFormItemQuantity = (index: number, quantity: number) => {
    setFormDetails(formDetails.map((d, idx) => idx === index ? { ...d, quantity, totalPrice: quantity * d.unitPrice } : d));
  };

  const handleUpdateFormItemUnitPrice = (index: number, unitPrice: number) => {
    setFormDetails(formDetails.map((d, idx) => idx === index ? { ...d, unitPrice, totalPrice: d.quantity * unitPrice } : d));
  };

  const handleSubmit = async () => {
    if (!formClientId) return;

    // A product typed into the add row but not committed with "+ Add Item" still counts — same
    // convention as PurchasesView.tsx's material-add panel.
    //
    // There is no longer a matching recovery for staged materials: a material row is committed
    // straight onto a product line the moment it's added, so there is no half-staged state for it to
    // get lost in. That whole failure mode ("linked SO shows no required materials") went away with
    // the two-table split.
    const finalDetails = [...formDetails];
    if (tempProductId && tempQuantity > 0) {
      const product = activeProducts.find(p => p.id === tempProductId);
      if (product) {
        finalDetails.push({
          productId: tempProductId,
          productName: product.name,
          productCode: product.code,
          quantity: tempQuantity,
          unitPrice: tempUnitPrice,
          totalPrice: tempQuantity * tempUnitPrice,
          materials: [],
        });
      }
    }

    if (finalDetails.length === 0) {
      toast.warning('Please add at least one product item to this sales contract.');
      return;
    }

    const input = {
      clientId: formClientId,
      contactId: formContactId || undefined,
      remark: formRemark || undefined,
      attachments: formAttachment ? [formAttachment] : [],
      details: finalDetails,
      productionDueDate: formProductionDueDate || undefined,
      priority: formPriority,
    };

    setSubmitting(true);
    if (formMode === 'CREATE') {
      await CallAPI(() => createSalesQuotation(input), {
        onCompleted: () => { loadOrders(activeTab); toast.success('Sales quotation created.'); },
        onError: (err) => { console.error(err); toast.error('Failed to create sales quotation.'); },
      });
    } else if (formMode === 'EDIT' && editHeaderId) {
      await CallAPI(() => updateSalesOrder(editHeaderId, input), {
        onCompleted: () => { loadOrders(activeTab); refreshSelectedOrder(editHeaderId); toast.success('Sales order updated.'); },
        onError: (err) => { console.error(err); toast.error('Failed to update sales order.'); },
      });
    } else if (formMode === 'CONVERT' && editHeaderId) {
      await CallAPI(() => convertToSalesOrder(editHeaderId, input, fromDateTimeLocal(formDeliveryDate || defaultDeliveryDate())), {
        onCompleted: () => { loadOrders(activeTab); setSelectedOrder(null); toast.success('Sales order confirmed.'); },
        onError: (err) => { console.error(err); toast.error('Failed to confirm sales order.'); },
      });
    }

    setSubmitting(false);
    setShowFormSheet(false);
    resetForm();
  };

  const handleDelete = async (id: string) => {
    if (!(await confirm('Are you sure you want to delete this sales order?'))) return;
    await CallAPI(() => deleteSalesOrder(id), {
      onCompleted: () => {
        loadOrders(activeTab);
        setSelectedOrder((prev) => (prev?.id === id ? null : prev));
        toast.success('Sales order deleted.');
      },
      onError: (err) => { console.error(err); toast.error('Failed to delete sales order.'); },
    });
  };

  // Start Production is a dialog now, not a one-click action: the user picks how much of each
  // product to actually make (suggested = ordered − finished goods already in stock), and the
  // material check runs against THOSE quantities, not the ordered ones.
  const openStartProduction = async (order: SalesHeader) => {
    setProductionShortfalls([]);
    const stock = await CallAPI(() => getProductStock(order.details.map(d => d.productId)), {
      onError: (err) => console.error(err),
    });
    setProductStock(stock ?? {});
    setStartingOrder(order);
  };

  const handleCheckProduction = async (produce: ProduceLine[]) => {
    if (!startingOrder) return;
    const shortfalls = await CallAPI(() => checkProductionStock(startingOrder, produce), {
      onError: (err) => { console.error(err); toast.error('Failed to check material stock.'); },
    });
    setProductionShortfalls(shortfalls ?? []);
  };

  const handleStartProduction = async (produce: ProduceLine[]) => {
    if (!startingOrder) return;
    await CallAPI(() => startProduction(startingOrder, produce), {
      onCompleted: () => {
        setStartingOrder(null);
        loadOrders(activeTab);
        refreshSelectedOrder(startingOrder.id);
        toast.success('Production started — material deducted.');
      },
      onError: (err) => {
        console.error(err);
        toast.error('Failed to start production.');
        setStartingOrder(null);
        loadOrders(activeTab);
        refreshSelectedOrder(startingOrder.id);
      },
    });
  };

  const openProductionCompletion = (order: SalesHeader) => {
    setCompletionShortfalls([]);
    setCompletingOrder(order);
  };

  const handleCheckProductionCompletion = async (reconciliations: MaterialReconciliationInput[]) => {
    if (!completingOrder) return;
    const shortfalls = await CallAPI(() => checkProductionCompletionStock(completingOrder, reconciliations), {
      onError: (err) => { console.error(err); toast.error('Failed to check material stock.'); },
    });
    setCompletionShortfalls(shortfalls ?? []);
  };

  const handleConfirmProductionDone = async (
    reconciliations: MaterialReconciliationInput[],
    leftovers: LeftoverMaterialInput[],
    produced: ProducedLine[],
  ) => {
    if (!completingOrder) return;
    setTransitioningId(completingOrder.id);
    await CallAPI(() => confirmProductionDone(completingOrder, reconciliations, leftovers, produced), {
      onCompleted: () => {
        setTransitioningId(null);
        loadOrders(activeTab);
        setSelectedOrder(null);
        setCompletingOrder(null);
        toast.success('Production marked as done — finished goods credited.');
      },
      onError: (err) => {
        setTransitioningId(null);
        console.error(err);
        toast.error('Failed to complete production.');
      },
    });
  };

  // Delivery is partial now: a quantity per line, shippable over several trips, and the order only
  // reaches DELIVERED once every line is fully out. The modal's cap also needs live product stock —
  // producedQuantity alone can outrun what's actually still on the shelf.
  const openDelivery = async (order: SalesHeader) => {
    const stock = await CallAPI(() => getProductStock(order.details.map(d => d.productId)), {
      onError: (err) => console.error(err),
    });
    setProductStock(stock ?? {});
    setDeliveringOrder(order);
  };

  const handleMarkDelivered = async (quantities: Record<string, number>, remark: string) => {
    if (!deliveringOrder) return;
    const lines: DeliveryLine[] = deliveringOrder.details
      .map(d => ({ detailId: d.detailId, quantity: quantities[d.detailId] || 0 }))
      .filter(l => l.quantity > 0);

    await CallAPI(() => markDelivered(deliveringOrder, lines, remark), {
      onCompleted: () => {
        setDeliveringOrder(null);
        loadOrders(activeTab);
        refreshSelectedOrder(deliveringOrder.id);
        toast.success('Delivery recorded.');
      },
      onError: (err) => {
        console.error(err);
        // markDelivered's finished-goods check throws before writing anything, and its message names
        // the products that are short — surface it rather than the generic failure.
        toast.error(err instanceof Error && err.message ? err.message : 'Failed to record delivery.');
        // A partial failure may have committed some lines. Close and reload so a reopen starts from
        // true remaining quantities instead of resubmitting the same amounts a second time.
        setDeliveringOrder(null);
        loadOrders(activeTab);
        refreshSelectedOrder(deliveringOrder.id);
      },
    });
  };

  const openAddMaterial = (order: SalesHeader) => setAddingMaterialOrder(order);

  const handleAddMaterial = async (rows: NewMaterialUsage[]) => {
    if (!addingMaterialOrder) return;
    await CallAPI(() => addMaterialUsage(rows), {
      onCompleted: () => {
        setAddingMaterialOrder(null);
        loadOrders(activeTab);
        refreshSelectedOrder(addingMaterialOrder.id);
        toast.success('Material added.');
      },
      onError: (err) => { console.error(err); toast.error('Failed to add material.'); },
    });
  };

  const handleCancel = async (order: SalesHeader) => {
    if (!(await confirm('Cancel this Sales Order?', { title: 'Cancel Sales Order' }))) return;
    await CallAPI(() => cancelSalesOrder(order), {
      onCompleted: () => { loadOrders(activeTab); refreshSelectedOrder(order.id); toast.success('Sales order cancelled.'); },
      onError: (err) => { console.error(err); toast.error('Failed to cancel sales order.'); },
    });
  };

  const openReturn = (order: SalesHeader) => setReturningOrder(order);

  const handleReturn = async (quantities: Record<string, number>, remark: string) => {
    if (!returningOrder) return;
    const lines: SalesReturnLine[] = returningOrder.details
      .map(d => ({ detailId: d.detailId, quantity: quantities[d.detailId] || 0 }))
      .filter(l => l.quantity > 0);

    await CallAPI(() => returnSalesOrder(returningOrder, lines, remark), {
      onCompleted: () => {
        setReturningOrder(null);
        loadOrders(activeTab);
        refreshSelectedOrder(returningOrder.id);
        toast.success('Product returned by client.');
      },
      onError: (err) => {
        console.error(err);
        toast.error('Failed to record return.');
        // A partial failure may have committed some lines. Close the modal (it doesn't reset its
        // typed quantities except on open) and refresh so a reopen starts from true remaining
        // quantities instead of resubmitting the same amounts a second time.
        setReturningOrder(null);
        loadOrders(activeTab);
        refreshSelectedOrder(returningOrder.id);
      },
    });
  };

  const openQuotationDoc = (order: SalesHeader) => {
    setSelectedQuotation(order);
    setIsQuotationModalOpen(true);
  };

  // Fetches the current Sales template fresh each click (System Admin may have just edited it) and
  // opens wa.me with it filled in. No contact/phone → nothing to click (button isn't rendered).
  const handleWhatsappClick = async (order: SalesHeader) => {
    if (!order.contactPhone) return;
    const templates = await getWhatsappTemplates();
    const template = templates.find(t => t.type === 'SALES');
    if (!template) return;
    window.open(buildWhatsappUrl(order.contactPhone, fillSalesTemplate(template.content, order)), '_blank');
  };

  const editingQuotation = formMode === 'EDIT' && editHeaderStatus === 'QUOTATION';

  const sheetTitle = formMode === 'CREATE' ? 'Create Sales Quotation'
    : formMode === 'EDIT' ? (editingQuotation ? 'Edit Sales Quotation' : 'Edit Sales Order')
      : 'Confirm Sales Order';

  const submitLabel = formMode === 'CREATE' ? 'Save Quotation'
    : formMode === 'EDIT' ? (editingQuotation ? 'Update Quotation' : 'Update Sales Order')
      : 'Confirm Sales Order';

  const buildRowActions = (o: SalesHeader): ActionMenuItem[] => [
    { label: 'View', icon: <Eye className="w-3.5 h-3.5" />, onClick: () => openOrderDetail(o) },
    { label: 'Edit', icon: <Edit className="w-3.5 h-3.5" />, onClick: () => openEditForm(o), hidden: !['QUOTATION', 'ORDERED'].includes(o.status) },
    { label: 'Delete', icon: <Trash2 className="w-3.5 h-3.5" />, onClick: () => handleDelete(o.id), danger: true, hidden: !canDeleteSalesOrder(o) },
    { label: 'Generate Quotation', icon: <FileText className="w-3.5 h-3.5" />, onClick: () => openQuotationDoc(o), hidden: o.status !== 'QUOTATION' },
    { label: 'Proceed to Sales Order', icon: <ArrowRightCircle className="w-3.5 h-3.5" />, onClick: () => openConvertForm(o), hidden: o.status !== 'QUOTATION' },
    // Production is optional, not a mandatory stage, and it needs a BOM to run against — see
    // canStartProduction/canDeliver, which SalesOrderDetailView's button bar shares.
    { label: 'Add Material', icon: <Plus className="w-3.5 h-3.5" />, onClick: () => openAddMaterial(o), hidden: !canAddMaterial(o) },
    { label: 'Start Production', icon: <Factory className="w-3.5 h-3.5" />, onClick: () => openStartProduction(o), hidden: !canStartProduction(o) },
    { label: 'Mark Production Done', icon: <CheckCheck className="w-3.5 h-3.5" />, onClick: () => openProductionCompletion(o), disabled: transitioningId === o.id, hidden: o.status !== 'IN_PRODUCTION' },
    // Deliver while anything is still unshipped; return once anything has shipped. Cancel stays on
    // the pre-delivery statuses, so it never appears alongside Return.
    { label: 'Deliver', icon: <Check className="w-3.5 h-3.5" />, onClick: () => openDelivery(o), hidden: !canDeliver(o) },
    { label: 'Cancel Order', icon: <Trash2 className="w-3.5 h-3.5" />, onClick: () => handleCancel(o), danger: true, hidden: !['ORDERED', 'IN_PRODUCTION', 'DONE_IN_PRODUCTION'].includes(o.status) },
    { label: 'Return from Client', icon: <Undo2 className="w-3.5 h-3.5" />, onClick: () => openReturn(o), hidden: !['PARTIALLY_DELIVERED', 'DELIVERED', 'PARTIALLY_RETURNED'].includes(o.status) },
  ];

  const columns: DataTableColumn<SalesHeader>[] = [
    { key: 'reference', header: 'Contract ID', sortable: true, className: 'w-32', render: (o) => <span className="font-mono font-medium text-foreground">{o.salesNo}</span> },
    { key: 'client', header: 'Client', sortable: true, className: 'w-40', render: (o) => <span className="font-medium text-card-foreground truncate">{o.clientName}</span> },
    {
      key: 'contact', header: 'Contact', className: 'w-36',
      render: (o) => o.contactName && o.contactPhone ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleWhatsappClick(o); }}
          className="inline-flex items-center gap-1 text-primary hover:underline"
          title="Message on WhatsApp"
        >
          <MessageCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{o.contactName}</span>
        </button>
      ) : <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'items', header: 'Product & Quantity', sortable: true,
      render: (o) => (
        <div className="min-w-0 max-w-xs space-y-1.5">
          <div className="divide-y divide-border">
            {o.details.map((item, idx) => (
              <div key={item.detailId || idx} className="py-1 first:pt-0 last:pb-0 min-w-0">
                <div className="font-medium text-card-foreground truncate">{item.productName}</div>
                <div className="text-[11px] text-muted-foreground font-mono">Qty {item.quantity} @ RM {item.unitPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </div>
            ))}
          </div>
          {o.attachments?.[0] && (
            <a
              href={o.attachments[0].dataUrl}
              download={o.attachments[0].name}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-primary/10 hover:bg-primary/20 text-primary rounded text-[10px] font-mono transition-colors"
              title="Download attachment"
            >
              <Paperclip className="w-2.5 h-2.5 shrink-0" />
              <span className="truncate max-w-[120px]">{o.attachments[0].name}</span>
            </a>
          )}
        </div>
      )
    },
    {
      key: 'date', header: activeTab === 'QUOTATION' ? 'Order Date' : 'Delivery Due', sortable: true, className: 'w-32',
      render: (o) => (
        <div className="inline-flex items-center gap-1.5 text-muted-foreground font-mono text-[11px]">
          <Calendar className="w-3.5 h-3.5" />
          <span>{formatDateTime(activeTab === 'QUOTATION' ? o.orderDate : o.deliveryDate)}</span>
        </div>
      )
    },
    { key: 'totalAmount', header: 'Contract Total', sortable: true, align: 'right', className: 'w-32', render: (o) => <span className="font-mono font-medium text-foreground">RM {o.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> },
    {
      key: 'productionDue', header: 'Production Due', sortable: true, className: 'w-32',
      render: (o) => o.productionDueDate ? (
        <div className="inline-flex items-center gap-1.5 text-muted-foreground font-mono text-[11px]">
          <Calendar className="w-3.5 h-3.5" />
          <span>{formatDate(o.productionDueDate)}</span>
        </div>
      ) : <span className="text-muted-foreground text-[11px]">—</span>,
    },
    {
      key: 'priority', header: 'Priority', sortable: true, className: 'w-[1%] whitespace-nowrap',
      render: (o) => <Badge variant={PRIORITY_META[o.priority].variant}>{PRIORITY_META[o.priority].label}</Badge>,
    },
    { key: 'createdAt', header: 'Created', sortable: true, className: 'w-32', render: (o) => <span className="text-muted-foreground font-mono text-[11px]">{formatDateTime(o.createdAt)}</span> },
    { key: 'updatedAt', header: 'Modified', sortable: true, className: 'w-32', render: (o) => <span className="text-muted-foreground font-mono text-[11px]">{formatDateTime(o.updatedAt)}</span> },
    ...(activeTab === 'SO' ? [{
      key: 'status', header: 'Status', sortable: true, className: 'w-[1%] whitespace-nowrap',
      render: (o: SalesHeader) => <Badge variant={STATUS_META[o.status].variant}>{STATUS_META[o.status].label}</Badge>,
    } as DataTableColumn<SalesHeader>] : []),
  ];

  const { hidden: hiddenColumns, toggle: toggleColumn, reset: resetColumns } = useColumnVisibility('columns:sales-orders');
  const visibleColumns = columns.filter(c => !hiddenColumns.has(c.key));

  return (
    <div ref={contentRef} className="flex flex-col gap-5 min-[1440px]:h-full min-[1440px]:min-h-0" id="orders-view">
      {selectedOrder ? (
        <SalesOrderDetailView
          order={selectedOrder}
          onBack={handleDetailBack}
          backLabel={initialOrderOrigin === 'MATERIAL' ? 'Back to Material' : initialOrderOrigin === 'INVENTORY' ? 'Back to Inventory' : initialOrderOrigin === 'PRODUCT' ? 'Back to Product' : initialOrderOrigin === 'PURCHASES' ? 'Back to Purchases' : 'Back to Sales Contracts'}
          transitioningId={transitioningId}
          stockByProductId={productStock}
          onEdit={openEditForm}
          onConvert={openConvertForm}
          onDelete={handleDelete}
          onStartProduction={openStartProduction}
          onAddMaterial={openAddMaterial}
          onProductionCompletion={openProductionCompletion}
          onMarkDelivered={openDelivery}
          onCancel={handleCancel}
          onReturn={openReturn}
          onOpenQuotationDoc={openQuotationDoc}
          onWhatsapp={handleWhatsappClick}
        />
      ) : (
        <>
          <PageHeader
            title="Sales Contracts"
            description="Manage client quotations and sales orders."
            actions={activeTab === 'QUOTATION' && <Button onClick={openCreateForm}><Plus className="w-4 h-4" /> New Quotation</Button>}
          />

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as OrderTab)}>
            <TabsList>
              <TabsTrigger value="QUOTATION">Quotation</TabsTrigger>
              <TabsTrigger value="SO">Sales Order</TabsTrigger>
            </TabsList>
          </Tabs>

          <SectionCard title="Filters" className="shrink-0" contentClassName="p-4 space-y-2.5">
            <FilterBar
              search={searchQuery[activeTab]}
              onSearchChange={(v) => { setSearchQuery(prev => ({ ...prev, [activeTab]: v })); search(v); }}
              searchPlaceholder="Search by client or reference no..."
              chips={filterChips}
              onOpenFilters={openFilterDialog}
              filterCount={activeFilterCount}
              right={
                <>
                  <ColumnsMenu columns={columns.map(c => ({ key: c.key, label: String(c.header) }))} hidden={hiddenColumns} onToggle={toggleColumn} onSelectAll={resetColumns} />
                  <Button variant="outline" size="sm" onClick={resetFilters}><RotateCcw className="w-3.5 h-3.5" /> Reset</Button>
                </>
              }
            />
            <div className="flex items-center justify-between flex-wrap gap-2">
              <QuickRangePills activeKey={activeQuickRange} onSelect={applyQuickRange} />
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setUrgentOnly(v => !v)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${urgentOnly ? 'bg-destructive text-destructive-foreground border-destructive' : 'bg-secondary/50 text-secondary-foreground border-transparent hover:bg-secondary'}`}
                >
                  Urgent
                </button>
                <button
                  type="button"
                  onClick={() => setOverdueOnly(v => !v)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${overdueOnly ? 'bg-destructive text-destructive-foreground border-destructive' : 'bg-secondary/50 text-secondary-foreground border-transparent hover:bg-secondary'}`}
                >
                  Overdue
                </button>
              </div>
            </div>
          </SectionCard>

          <SectionCard title={activeTab === 'QUOTATION' ? 'Quotations' : 'Sales Orders'} description={`${displayedOrders.length} record${displayedOrders.length === 1 ? '' : 's'}`} className="flex-1 min-h-0" contentClassName="p-0 flex-1 min-h-0 flex flex-col">
            <div className="flex-1 min-h-0 overflow-auto">
              <DataTable
                columns={visibleColumns}
                rows={displayedOrders}
                rowKey={(o) => o.id}
                sortField={sortField}
                sortDir={sortDir}
                onSort={toggleSort}
                onRowClick={openOrderDetail}
                rowActions={(o) => <ActionsMenu items={buildRowActions(o)} />}
                loading={loading}
                emptyState={`No ${activeTab === 'QUOTATION' ? 'quotations' : 'sales orders'} found.`}
              />
            </div>
          </SectionCard>

          {/* Advanced filter dialog */}
          <FilterDialog
            open={showFilterDialog}
            onClose={() => setShowFilterDialog(false)}
            title="Filter Sales Contracts"
            sections={[
              {
                type: 'dateRange',
                key: 'dateRange',
                label: activeTab === 'QUOTATION' ? 'Order Date Range' : 'Delivery Date Range',
                from: filterDraftDateFrom,
                to: filterDraftDateTo,
                onFromChange: setFilterDraftDateFrom,
                onToChange: setFilterDraftDateTo,
              },
              {
                type: 'checklist',
                key: 'clients',
                label: 'Client',
                searchPlaceholder: 'Search clients...',
                searchQuery: filterClientSearch,
                onSearchChange: (q) => { setFilterClientSearch(q); setFilterClientVisibleCount(20); },
                items: filterClientItems,
                hasMore: filterClientMatches.length > filterClientVisibleCount,
                onLoadMore: () => setFilterClientVisibleCount(c => c + 20),
                selectedIds: filterDraftClientIds,
                onToggle: toggleFilterDraftClient,
              },
              {
                type: 'checklist',
                key: 'products',
                label: 'Product',
                searchPlaceholder: 'Search products...',
                searchQuery: filterProductSearch,
                onSearchChange: (q) => { setFilterProductSearch(q); loadFilterProductOptions(q); },
                items: filterProductItems,
                loading: filterProductOptionsLoading,
                hasMore: filterProductHasMore,
                onLoadMore: loadMoreFilterProductOptions,
                selectedIds: filterDraftProductIds,
                onToggle: toggleFilterDraftProduct,
              },
              // QUOTATION tab is always a single status — a status filter there is a no-op.
              ...(activeTab === 'SO' ? [{
                type: 'checklist' as const,
                key: 'statuses',
                label: 'Status',
                hideSearch: true,
                searchQuery: '',
                onSearchChange: () => {},
                items: SO_STATUSES.map(s => ({ id: s, label: STATUS_META[s].label })),
                selectedIds: filterDraftStatuses,
                onToggle: toggleFilterDraftStatus,
              }] : []),
            ]}
            onApply={() => {
              setActiveQuickRange(null);
              setAppliedFilters({
                clientIds: filterDraftClientIds,
                productIds: filterDraftProductIds,
                statuses: filterDraftStatuses,
                dateFrom: filterDraftDateFrom || undefined,
                dateTo: filterDraftDateTo || undefined,
              });
            }}
            onClear={() => {
              setFilterDraftClientIds([]); setFilterDraftProductIds([]); setFilterDraftStatuses([]);
              setFilterDraftDateFrom(monthStart(0)); setFilterDraftDateTo(monthEnd(0));
              setActiveQuickRange('thisMonth');
              setAppliedFilters({ dateFrom: monthStart(0), dateTo: monthEnd(0) });
            }}
          />
        </>
      )}

      {/* Create/Edit/Convert drawer — rendered unconditionally (not just on the listing branch) so
          Edit/Convert opened from the detail page actually shows the form instead of silently no-op'ing */}
      <Sheet
        open={showFormSheet}
            onClose={() => { clearTempStaging(); setShowFormSheet(false); }}
            title={sheetTitle}
            width="w-full sm:max-w-2xl"
            footer={
              <div className="flex items-center justify-end gap-2">
                <Button variant="outline" onClick={() => { clearTempStaging(); setShowFormSheet(false); }}>Cancel</Button>
                <Button onClick={handleSubmit} disabled={submitting || !formClientId}>{submitting ? 'Saving...' : submitLabel}</Button>
              </div>
            }
          >
            <div className="p-5 space-y-5">
              <div data-fade-item className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField label="Client Company *" colSpan="sm:col-span-2">
                  <ComboBox
                    required
                    value={formClientId}
                    onChange={setFormClientId}
                    noneLabel="-- Select Client --"
                    options={clients.map(c => ({ value: c.id, label: c.companyName, sublabel: c.officeNo || c.email }))}
                  />
                </FormField>

                <FormField label="Contact Person (Optional)" colSpan="sm:col-span-2">
                  <ComboBox
                    value={formContactId}
                    onChange={setFormContactId}
                    disabled={!formClientId}
                    noneLabel="-- No Contact Person --"
                    options={formContacts.map(c => ({ value: c.id, label: c.fullName, sublabel: c.contactNo || c.email }))}
                  />
                </FormField>

                {formMode === 'CONVERT' && (
                  <FormField label="Delivery Date & Time *" colSpan="sm:col-span-2">
                    <DateTimePicker required value={formDeliveryDate} onChange={setFormDeliveryDate} />
                  </FormField>
                )}

                <FormField label="Production Due Date">
                  <DatePicker value={formProductionDueDate} onChange={setFormProductionDueDate} />
                </FormField>

                <FormField label="Priority">
                  <ComboBox
                    required
                    value={formPriority}
                    onChange={(v) => setFormPriority(v as SalesPriority)}
                    options={PRIORITY_OPTIONS}
                  />
                </FormField>
              </div>

              {/* Planning visibility only: neither panel reserves stock and neither blocks the save —
                  a business can take an order it can't fill yet, it just needs to see that it implies
                  more production/purchasing. The product panel is scoped to the products on THIS
                  order (available to promise vs. what it asks for); the material panel is the wider
                  outstanding book. */}
              {(atpRows.length > 0 || demand.materials.length > 0) && (
                <div data-fade-item className="grid grid-cols-1 gap-3">
                  <DemandPanel
                    title="Finished Goods — Available to Promise"
                    itemHeader="Product"
                    outstandingHeader="Outstanding Orders"
                    orderedHeader="This Order"
                    rows={atpRows}
                    emptyHint="Add a product to see its available stock."
                    shortfallHint="Available to promise doesn't cover this order — produce the difference. Where it does, you can deliver from stock without a production run."
                  />
                  <DemandPanel
                    title="Material Demand"
                    itemHeader="Material"
                    outstandingHeader="Outstanding Required"
                    rows={demand.materials}
                    shortfallHint="Outstanding demand exceeds stock — additional purchasing may be required."
                  />
                </div>
              )}

              {/* TABLE 1 — Products the client ordered. Nothing about production lives here. */}
              <div data-fade-item className="border border-border rounded-xl p-3 bg-secondary/30 space-y-2">
                <span className="font-semibold block text-foreground text-xs">Products ({formDetails.length})</span>
                {formDetails.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground border border-dashed border-border rounded-lg bg-card text-[11px]">
                    No products yet. Add one below.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {formDetails.map((item, idx) => (
                      <div key={idx} className="border border-border rounded-lg bg-card p-2.5 flex items-center justify-between gap-3">
                        <span className="font-semibold text-card-foreground text-[11px] flex-1 truncate">{item.productName}</span>
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono">
                          <span>Qty:</span>
                          <input
                            type="number" min="1" value={item.quantity}
                            onChange={(e) => handleUpdateFormItemQuantity(idx, Number(e.target.value))}
                            className="w-14 px-1.5 py-1 bg-background border border-input rounded text-right font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring"
                          />
                          <span>@ RM</span>
                          <input
                            type="number" min="0" step="0.01" value={item.unitPrice}
                            onChange={(e) => handleUpdateFormItemUnitPrice(idx, Number(e.target.value))}
                            className="w-20 px-1.5 py-1 bg-background border border-input rounded text-right font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring"
                          />
                          <span>= RM {item.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        <button type="button" onClick={() => handleRemoveFormItem(idx)} className="text-destructive hover:text-destructive/80 p-1 shrink-0" title="Remove product">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end pt-1">
                  <FormField label="Product" labelClassName="font-semibold block text-muted-foreground text-[10px] uppercase tracking-wider" colSpan="sm:col-span-6">
                    <ComboBox
                      value={tempProductId}
                      onChange={handleProductSelect}
                      noneLabel="-- Choose Product --"
                      options={activeProducts.map(p => ({ value: p.id, label: p.name, sublabel: `RM ${p.sellingPrice.toLocaleString('en-US')}` }))}
                    />
                  </FormField>

                  <FormField label="Quantity" labelClassName="font-semibold block text-muted-foreground text-[10px] uppercase tracking-wider" colSpan="sm:col-span-2">
                    <input
                      type="number" min="1" value={tempQuantity}
                      onChange={(e) => setTempQuantity(Number(e.target.value))}
                      className={fieldInputClassName}
                    />
                  </FormField>

                  <FormField label="Unit Price (RM)" labelClassName="font-semibold block text-muted-foreground text-[10px] uppercase tracking-wider" colSpan="sm:col-span-2">
                    <input
                      type="number" min="0" step="1" value={tempUnitPrice}
                      onChange={(e) => setTempUnitPrice(Number(e.target.value))}
                      className={fieldInputClassName}
                    />
                  </FormField>

                  <div className="sm:col-span-2">
                    <Button type="button" className="w-full" onClick={handleAddTempItem} disabled={!tempProductId || tempQuantity <= 0}>
                      +
                    </Button>
                  </div>
                </div>
              </div>

              {/* TABLE 2 — Materials needed to manufacture those products. Independent of the table
                  above: each row names the product line it belongs to, so a material can be added at
                  any time without a half-staged product to hang off. */}
              <div data-fade-item className="border border-border rounded-xl p-3 bg-secondary/30 space-y-2">
                <span className="font-semibold block text-foreground text-xs">Production Materials ({materialRows.length})</span>
                {formDetails.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground border border-dashed border-border rounded-lg bg-card text-[11px]">
                    Add a product first — every material belongs to one.
                  </div>
                ) : (
                  <>
                    <div className="border border-border rounded-lg bg-card overflow-hidden">
                      <div className="grid grid-cols-[1fr_1fr_6rem_2rem] gap-2 px-2.5 py-1.5 bg-secondary/40 font-semibold text-muted-foreground text-[10px] uppercase tracking-wider">
                        <span>Product</span>
                        <span>Material</span>
                        <span className="text-right">Planned Qty</span>
                        <span />
                      </div>
                      {materialRows.length === 0 ? (
                        <div className="text-center py-3 text-muted-foreground text-[11px]">No production materials yet.</div>
                      ) : materialRows.map(({ detailIdx, materialIdx, material, productName }) => (
                        <div key={`${detailIdx}-${materialIdx}`} className="grid grid-cols-[1fr_1fr_6rem_2rem] gap-2 items-center px-2.5 py-1.5 border-t border-border">
                          <span className="text-[11px] text-muted-foreground truncate">{productName}</span>
                          <span className="text-[11px] text-card-foreground truncate">{material.materialName}</span>
                          <input
                            type="number" min="0" value={material.plannedQuantity}
                            onChange={(e) => handleUpdateMaterialRow(detailIdx, materialIdx, { plannedQuantity: Math.max(0, Number(e.target.value) || 0) })}
                            className="w-full px-1.5 py-1 bg-background border border-input rounded text-right font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring"
                          />
                          <button type="button" onClick={() => handleRemoveMaterialRow(detailIdx, materialIdx)} className="text-destructive hover:text-destructive/80 p-1" title="Remove material">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end pt-1">
                      <div className="sm:col-span-3">
                        <ComboBox
                          value={tempMaterialDetailIdx}
                          onChange={setTempMaterialDetailIdx}
                          options={formDetails.map((d, idx) => ({ value: String(idx), label: productLineLabel(d, idx) }))}
                        />
                      </div>
                      <div className="sm:col-span-5">
                        <ComboBox
                          value={tempMaterialId}
                          onChange={setTempMaterialId}
                          noneLabel="-- Choose Material --"
                          options={rawMaterials.map(m => {
                            const category = materialCategoryMap.get(m.materialCategoryId || '');
                            return { value: m.id, label: m.name, sublabel: category ? category.name : `Stock: ${m.quantity}` };
                          })}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <input
                          type="number" min="1" value={tempMaterialQty}
                          onChange={(e) => setTempMaterialQty(Number(e.target.value))}
                          className={fieldInputClassName}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Button type="button" className="w-full" onClick={handleAddMaterialRow} disabled={!tempMaterialId || tempMaterialQty <= 0}>
                          +
                        </Button>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Planned Qty is the material needed for the full ordered quantity. Start Production scales it
                      to whatever you actually decide to make.
                    </p>
                  </>
                )}
              </div>

              <div data-fade-item className="bg-primary/5 border border-primary/20 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <span className="font-semibold block text-[11px] text-foreground">Projected Sales Contract Value:</span>
                  <span className="text-[10px] text-muted-foreground">Calculated sum of all added items on this sales contract.</span>
                </div>
                <div className="font-mono text-base font-bold text-foreground">
                  RM {Math.max(0, formDetails.reduce((sum, item) => sum + item.totalPrice, 0) + (tempProductId && tempQuantity > 0 ? tempQuantity * tempUnitPrice : 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>

              <FormField label="Remark (Optional)">
                <textarea
                  value={formRemark}
                  onChange={(e) => setFormRemark(e.target.value)}
                  rows={2}
                  className={fieldInputClassName}
                />
              </FormField>

              <div data-fade-item>
                <AttachmentSection
                  attachment={formAttachment}
                  onAttachmentChange={setFormAttachment}
                  label="Signed Contract or Specifications Doc (Optional)"
                  helperText="Upload any business contract, product details, or custom design spec (Max 1MB)"
                />
              </div>
            </div>
      </Sheet>

      {/* Quotation print modal */}
      <SalesQuotationModal
        order={selectedQuotation}
        isOpen={isQuotationModalOpen}
        onClose={() => { setIsQuotationModalOpen(false); setSelectedQuotation(null); }}
      />

      {/* Start Production: pick how much to actually make, then a hard material check */}
      <StartProductionModal
        order={startingOrder}
        isOpen={!!startingOrder}
        stockByProductId={productStock}
        shortfalls={productionShortfalls}
        onClose={() => { setStartingOrder(null); setProductionShortfalls([]); }}
        onCheck={handleCheckProduction}
        onConfirm={handleStartProduction}
      />

      {/* Add Material: for a line ordered without a BOM — inserts usage rows without touching the
          order's own quantities/progress (see canAddMaterial in OrdersService.ts) */}
      <AddMaterialModal
        order={addingMaterialOrder}
        isOpen={!!addingMaterialOrder}
        rawMaterials={rawMaterials}
        onClose={() => setAddingMaterialOrder(null)}
        onSubmit={handleAddMaterial}
      />

      {/* Production-done: actual produced (credits finished goods) + material reconciliation, gated
          by the same Check-then-Confirm stock check as Start Production */}
      <ProductionCompletionModal
        order={completingOrder}
        isOpen={!!completingOrder}
        materials={rawMaterials}
        shortfalls={completionShortfalls}
        onClose={() => { setCompletingOrder(null); setCompletionShortfalls([]); }}
        onCheck={handleCheckProductionCompletion}
        onSubmit={handleConfirmProductionDone}
      />

      <LineQuantityModal
        isOpen={!!deliveringOrder}
        title={`Deliver — ${deliveringOrder?.salesNo ?? ''}`}
        itemHeader="Product"
        requiredHeader="Required"
        totalHeader="Available"
        doneHeader="Delivered"
        actionLabel="Deliver"
        doneLabel="fully delivered"
        remarkPlaceholder="e.g. DO-1043, collected by client"
        lines={(deliveringOrder?.details ?? []).map((d): LineQuantityModalLine => {
          const stock = productStock[d.productId] ?? 0;
          // Finished-goods stock is one shared shelf, not per-order — cap by total stock only, not
          // by what this line itself produced (an order can ship stock another line's run made).
          return {
            id: d.detailId,
            name: d.productName,
            requiredQty: d.quantity,
            totalQty: Math.min(d.quantity, stock),
            doneQty: d.deliveredQuantity,
          };
        })}
        onClose={() => setDeliveringOrder(null)}
        onSubmit={handleMarkDelivered}
      />

      <LineQuantityModal
        isOpen={!!returningOrder}
        title={`Return from Client — ${returningOrder?.salesNo ?? ''}`}
        itemHeader="Product"
        totalHeader="Delivered"
        doneHeader="Returned"
        actionLabel="Return"
        doneLabel="fully returned"
        remarkPlaceholder="e.g. damaged in transit"
        lines={(returningOrder?.details ?? []).map((d): LineQuantityModalLine => ({
          id: d.detailId,
          name: d.productName,
          // Cap on what SHIPPED, not what was ordered — you can't send back what hasn't left yet.
          totalQty: d.deliveredQuantity,
          doneQty: d.returnedQuantity,
        }))}
        onClose={() => setReturningOrder(null)}
        onSubmit={handleReturn}
      />
    </div>
  );
}
