/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import {
  getSalesOrders, createSalesQuotation, updateSalesOrder, convertToSalesOrder,
  startProduction, checkProductionStock, confirmProductionDone, markDelivered, cancelSalesOrder, deleteSalesOrder,
  getSalesOrderById,
  SalesDetailInput, MaterialUsageInput, MaterialReconciliationInput, LeftoverMaterialInput, ExtraProducedInput,
  SalesFilters, SalesSortField, SortDir,
} from '../services/OrdersService';
import { getProducts, getProductsPage } from '../services/ProductService';
import { getMaterials } from '../services/MaterialService';
import { getMaterialCategories } from '../services/SystemAdminService';
import { getClients } from '../services/ContactsService';
import { SalesHeader, Client, Product, Material, MaterialCategory, Attachment, SalesPriority } from '../types';
import { PRIORITY_META, PRIORITY_OPTIONS } from '../utils/priority';
import { formatDateTime, formatDate, toDateTimeLocal, fromDateTimeLocal, monthStart, monthEnd } from '../utils/date';
import { QUICK_RANGES } from '../utils/dateRanges';
import QuickRangePills from './QuickRangePills';
import { Plus, Calendar, Check, CheckCheck, Factory, Paperclip, Trash2, Edit, FileText, ArrowRightCircle, Eye, RotateCcw } from 'lucide-react';
import AttachmentSection from './AttachmentSection';
import SalesQuotationModal from './SalesQuotationModal';
import InvoiceModal from './InvoiceModal';
import ProductionCompletionModal from './ProductionCompletionModal';
import SalesOrderDetailView from './SalesOrderDetailView';
import ComboBox from './ComboBox';
import FilterDialog from './FilterDialog';
import { PageHeader, SectionCard, FilterBar, DataTable } from './shell';
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
const SERVER_SORT_FIELDS: readonly string[] = ['reference', 'date', 'totalAmount', 'productionDue'];

const STATUS_META: Record<SalesHeader['status'], { label: string; variant: 'default' | 'warning' | 'success' | 'destructive' | 'secondary' }> = {
  QUOTATION: { label: 'Quotation', variant: 'default' },
  ORDERED: { label: 'Pending Production', variant: 'warning' },
  IN_PRODUCTION: { label: 'In Production', variant: 'default' },
  DONE_IN_PRODUCTION: { label: 'Done in Production', variant: 'secondary' },
  DELIVERED: { label: 'Delivered', variant: 'success' },
  CANCELLED: { label: 'Cancelled', variant: 'destructive' },
};

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

  // Drill-down: selected order (shows SalesOrderDetailView instead of the table)
  const [selectedOrder, setSelectedOrder] = useState<SalesHeader | null>(null);
  // Tracks whether the open detail page was reached via the cross-tab
  // initialOrderId drill-in (Back should return to that origin) or a plain
  // click on a row in this view's own list (Back should just close locally).
  const [detailOpenedExternally, setDetailOpenedExternally] = useState(false);
  const refreshSelectedOrder = (id: string) => {
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
  };

  // ─── Sort ─────────────────────────────────────────────────────────────
  const [sortField, setSortField] = useState<DisplaySortField>('date');
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
    setFilterDraftDateFrom(appliedFilters.dateFrom || '');
    setFilterDraftDateTo(appliedFilters.dateTo || '');
    setFilterClientSearch('');
    setFilterProductSearch('');
    setFilterClientVisibleCount(20);
    setFilterProductOptions([]); setFilterProductOffset(0); setFilterProductHasMore(false);
    setShowFilterDialog(true);
    loadFilterProductOptions('');
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
    ...(appliedFilters.dateFrom || appliedFilters.dateTo ? [{ key: 'date', label: `${appliedFilters.dateFrom || '…'} → ${appliedFilters.dateTo || '…'}`, onRemove: () => { setActiveQuickRange('thisMonth'); setAppliedFilters(f => ({ ...f, dateFrom: monthStart(0), dateTo: monthEnd(0) })); } }] : []),
  ];
  const activeFilterCount = (appliedFilters.clientIds?.length || 0) + (appliedFilters.productIds?.length || 0) + (appliedFilters.dateFrom || appliedFilters.dateTo ? 1 : 0);

  const toggleSort = (key: string) => {
    const field = key as DisplaySortField;
    if (field === sortField) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
  };

  // Client-side re-sort for the 'items'/'priority' columns — applied over
  // whatever's currently loaded (server-sorted columns skip this and pass
  // through). Priority can't be ordered via a plain SQL column sort since
  // it's ranked (Urgent > High > Medium > Low), not alphabetical.
  const displayedOrders = useMemo(() => {
    if (isServerSort) return orders;
    if (sortField === 'priority') {
      return [...orders].sort((a, b) => {
        const cmp = PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank;
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    if (sortField === 'client') {
      return [...orders].sort((a, b) => {
        const cmp = (a.clientName || '').localeCompare(b.clientName || '');
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    const firstItemLabel = (o: SalesHeader) => o.details[0]?.productName || '';
    return [...orders].sort((a, b) => {
      const cmp = firstItemLabel(a).localeCompare(firstItemLabel(b));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [orders, sortField, sortDir, isServerSort]);

  // Quotation print modal
  const [selectedQuotation, setSelectedQuotation] = useState<SalesHeader | null>(null);
  const [isQuotationModalOpen, setIsQuotationModalOpen] = useState(false);

  // Tax invoice print modal
  const [selectedInvoiceOrder, setSelectedInvoiceOrder] = useState<SalesHeader | null>(null);
  const [isInvoiceOpen, setIsInvoiceOpen] = useState(false);

  // Form drawer state
  const [showFormSheet, setShowFormSheet] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>('CREATE');
  const [editHeaderId, setEditHeaderId] = useState<string | null>(null);
  const [formClientId, setFormClientId] = useState('');
  const [formDeliveryDate, setFormDeliveryDate] = useState('');
  const [formProductionDueDate, setFormProductionDueDate] = useState('');
  const [formPriority, setFormPriority] = useState<SalesPriority>('MEDIUM');
  const [formRemark, setFormRemark] = useState('');
  const [formDetails, setFormDetails] = useState<SalesDetailInput[]>([]);
  const [tempProductId, setTempProductId] = useState('');
  const [tempQuantity, setTempQuantity] = useState(1);
  const [tempUnitPrice, setTempUnitPrice] = useState(0);
  const [tempMaterials, setTempMaterials] = useState<MaterialUsageInput[]>([]);
  const [tempMaterialId, setTempMaterialId] = useState('');
  const [tempMaterialQty, setTempMaterialQty] = useState(1);
  const [formAttachment, setFormAttachment] = useState<Attachment | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  // Clears the pending (not-yet-committed) product+material staging fields.
  // Mirrors PurchasesView.tsx's clearTempMaterials — without this, values
  // typed into the "add item" panel leak into the next form open.
  const clearTempStaging = () => {
    setTempProductId('');
    setTempQuantity(1);
    setTempUnitPrice(0);
    setTempMaterials([]);
    setTempMaterialId('');
    setTempMaterialQty(1);
  };

  const resetForm = () => {
    setEditHeaderId(null);
    setFormClientId('');
    setFormDeliveryDate('');
    setFormProductionDueDate('');
    setFormPriority('MEDIUM');
    setFormRemark('');
    setFormDetails([]);
    setFormAttachment(undefined);
    clearTempStaging();
  };

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
    setFormClientId(order.clientId);
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

  const handleAddTempMaterial = () => {
    if (!tempMaterialId || tempMaterialQty <= 0) return;
    const material = rawMaterials.find(m => m.id === tempMaterialId);
    if (!material) return;

    const existingIdx = tempMaterials.findIndex(m => m.materialId === tempMaterialId);
    if (existingIdx !== -1) {
      const updated = [...tempMaterials];
      updated[existingIdx].plannedQuantity += tempMaterialQty;
      setTempMaterials(updated);
    } else {
      setTempMaterials([...tempMaterials, {
        materialId: tempMaterialId,
        materialName: material.name,
        materialCode: material.code,
        plannedQuantity: tempMaterialQty,
      }]);
    }

    setTempMaterialId('');
    setTempMaterialQty(1);
  };

  const handleRemoveTempMaterial = (index: number) => {
    setTempMaterials(tempMaterials.filter((_, idx) => idx !== index));
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
      materials: tempMaterials,
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

    // Check if there's a pending product line selected but not added yet, and
    // automatically add it (same convention as the material-add panel in
    // PurchasesView.tsx).
    let finalDetails = [...formDetails];
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
          materials: tempMaterials,
        });
      }
    }

    if (finalDetails.length === 0) {
      toast.warning('Please add at least one product item to this sales contract.');
      return;
    }

    const input = {
      clientId: formClientId,
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

  const handleStartProduction = async (order: SalesHeader) => {
    if (transitioningId === order.id) return;
    setTransitioningId(order.id);

    const shortfalls = await CallAPI(() => checkProductionStock(order), {
      onError: (err) => console.error(err),
    });
    if (shortfalls === null) {
      setTransitioningId(null);
      toast.error('Failed to check material stock.');
      return;
    }
    if (shortfalls.length > 0) {
      setTransitioningId(null);
      toast.error(`Insufficient stock — ${shortfalls.map(s => `${s.materialName} (need ${s.required}, have ${s.available})`).join(', ')}`);
      return;
    }

    await CallAPI(() => startProduction(order), {
      onCompleted: () => {
        setTransitioningId(null);
        loadOrders(activeTab);
        setSelectedOrder(null);
        toast.success('Production started.');
      },
      onError: (err) => {
        setTransitioningId(null);
        console.error(err);
        toast.error('Failed to start production.');
      },
    });
  };

  const openProductionCompletion = (order: SalesHeader) => {
    setCompletingOrder(order);
  };

  const handleConfirmProductionDone = async (
    reconciliations: MaterialReconciliationInput[],
    leftovers: LeftoverMaterialInput[],
    extraProduced: ExtraProducedInput[],
  ) => {
    if (!completingOrder) return;
    setTransitioningId(completingOrder.id);
    await CallAPI(() => confirmProductionDone(completingOrder, reconciliations, leftovers, extraProduced), {
      onCompleted: () => {
        setTransitioningId(null);
        loadOrders(activeTab);
        setSelectedOrder(null);
        setCompletingOrder(null);
        toast.success('Production marked as done.');
      },
      onError: (err) => {
        setTransitioningId(null);
        console.error(err);
        toast.error('Failed to complete production.');
      },
    });
  };

  const handleMarkDelivered = async (id: string) => {
    if (transitioningId === id) return;
    setTransitioningId(id);
    await CallAPI(() => markDelivered(id), {
      onCompleted: () => {
        setTransitioningId(null);
        loadOrders(activeTab);
        setSelectedOrder(null);
        toast.success('Order marked as delivered.');
      },
      onError: (err) => {
        setTransitioningId(null);
        console.error(err);
        toast.error('Failed to mark order as delivered.');
      },
    });
  };

  const handleCancel = async (order: SalesHeader) => {
    if (!(await confirm('Cancel this Sales Order?', { title: 'Cancel Sales Order' }))) return;
    await CallAPI(() => cancelSalesOrder(order), {
      onCompleted: () => { loadOrders(activeTab); refreshSelectedOrder(order.id); toast.success('Sales order cancelled.'); },
      onError: (err) => { console.error(err); toast.error('Failed to cancel sales order.'); },
    });
  };

  const openQuotationDoc = (order: SalesHeader) => {
    setSelectedQuotation(order);
    setIsQuotationModalOpen(true);
  };

  const openInvoiceDoc = (order: SalesHeader) => {
    setSelectedInvoiceOrder(order);
    setIsInvoiceOpen(true);
  };

  const sheetTitle = formMode === 'CREATE' ? 'Create Sales Quotation'
    : formMode === 'EDIT' ? 'Edit Sales Quotation'
      : 'Confirm Sales Order';

  const submitLabel = formMode === 'CREATE' ? 'Save Quotation'
    : formMode === 'EDIT' ? 'Update Quotation'
      : 'Confirm Sales Order';

  const buildRowActions = (o: SalesHeader): ActionMenuItem[] => [
    { label: 'View', icon: <Eye className="w-3.5 h-3.5" />, onClick: () => openOrderDetail(o) },
    { label: 'Edit', icon: <Edit className="w-3.5 h-3.5" />, onClick: () => openEditForm(o), hidden: !['QUOTATION', 'ORDERED'].includes(o.status) },
    { label: 'Delete', icon: <Trash2 className="w-3.5 h-3.5" />, onClick: () => handleDelete(o.id), danger: true, hidden: !['QUOTATION', 'CANCELLED'].includes(o.status) },
    { label: 'Generate Quotation', icon: <FileText className="w-3.5 h-3.5" />, onClick: () => openQuotationDoc(o), hidden: o.status !== 'QUOTATION' },
    { label: 'Proceed to Sales Order', icon: <ArrowRightCircle className="w-3.5 h-3.5" />, onClick: () => openConvertForm(o), hidden: o.status !== 'QUOTATION' },
    { label: 'Generate Tax Invoice', icon: <FileText className="w-3.5 h-3.5" />, onClick: () => openInvoiceDoc(o), hidden: !['ORDERED', 'IN_PRODUCTION', 'DONE_IN_PRODUCTION', 'DELIVERED'].includes(o.status) },
    { label: 'Proceed to Production', icon: <Factory className="w-3.5 h-3.5" />, onClick: () => handleStartProduction(o), disabled: transitioningId === o.id, hidden: o.status !== 'ORDERED' },
    { label: 'Mark Production Done', icon: <CheckCheck className="w-3.5 h-3.5" />, onClick: () => openProductionCompletion(o), disabled: transitioningId === o.id, hidden: o.status !== 'IN_PRODUCTION' },
    { label: 'Mark as Delivered', icon: <Check className="w-3.5 h-3.5" />, onClick: () => handleMarkDelivered(o.id), disabled: transitioningId === o.id, hidden: o.status !== 'DONE_IN_PRODUCTION' },
    { label: 'Cancel Order', icon: <Trash2 className="w-3.5 h-3.5" />, onClick: () => handleCancel(o), danger: true, hidden: !['ORDERED', 'IN_PRODUCTION'].includes(o.status) },
  ];

  const columns: DataTableColumn<SalesHeader>[] = [
    { key: 'reference', header: 'Contract ID', sortable: true, className: 'w-32', render: (o) => <span className="font-mono font-medium text-foreground">{o.salesNo}</span> },
    { key: 'client', header: 'Client', sortable: true, className: 'w-40', render: (o) => <span className="font-medium text-card-foreground truncate">{o.clientName}</span> },
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
    ...(activeTab === 'SO' ? [{
      key: 'status', header: 'Status', className: 'w-[1%] whitespace-nowrap',
      render: (o: SalesHeader) => <Badge variant={STATUS_META[o.status].variant}>{STATUS_META[o.status].label}</Badge>,
    } as DataTableColumn<SalesHeader>] : []),
  ];

  return (
    <div ref={contentRef} className="flex flex-col gap-5 min-[1440px]:h-full min-[1440px]:min-h-0" id="orders-view">
      {selectedOrder ? (
        <SalesOrderDetailView
          order={selectedOrder}
          onBack={handleDetailBack}
          backLabel={initialOrderOrigin === 'MATERIAL' ? 'Back to Material' : initialOrderOrigin === 'INVENTORY' ? 'Back to Inventory' : initialOrderOrigin === 'PRODUCT' ? 'Back to Product' : initialOrderOrigin === 'PURCHASES' ? 'Back to Purchases' : 'Back to Sales Contracts'}
          transitioningId={transitioningId}
          onEdit={openEditForm}
          onConvert={openConvertForm}
          onDelete={handleDelete}
          onStartProduction={handleStartProduction}
          onProductionCompletion={openProductionCompletion}
          onMarkDelivered={handleMarkDelivered}
          onCancel={handleCancel}
          onOpenQuotationDoc={openQuotationDoc}
          onOpenInvoiceDoc={openInvoiceDoc}
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
              right={<Button variant="outline" size="sm" onClick={resetFilters}><RotateCcw className="w-3.5 h-3.5" /> Reset</Button>}
            />
            <QuickRangePills activeKey={activeQuickRange} onSelect={applyQuickRange} />
          </SectionCard>

          <SectionCard title={activeTab === 'QUOTATION' ? 'Quotations' : 'Sales Orders'} description={`${orders.length} record${orders.length === 1 ? '' : 's'}`} className="flex-1 min-h-0" contentClassName="p-0 flex-1 min-h-0 flex flex-col">
            <div className="flex-1 min-h-0 overflow-auto">
              <DataTable
                columns={columns}
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
            ]}
            onApply={() => {
              setActiveQuickRange(null);
              setAppliedFilters({
                clientIds: filterDraftClientIds,
                productIds: filterDraftProductIds,
                dateFrom: filterDraftDateFrom || undefined,
                dateTo: filterDraftDateTo || undefined,
              });
            }}
            onClear={() => {
              setFilterDraftClientIds([]); setFilterDraftProductIds([]);
              setFilterDraftDateFrom(monthStart(0)); setFilterDraftDateTo(monthEnd(0));
              setActiveQuickRange('thisMonth');
              setAppliedFilters({ dateFrom: monthStart(0), dateTo: monthEnd(0) });
            }}
          />

          {/* Create/Edit/Convert drawer */}
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

                {formMode === 'CONVERT' && (
                  <FormField label="Delivery Date & Time *" colSpan="sm:col-span-2">
                    <input type="datetime-local" required value={formDeliveryDate} onChange={(e) => setFormDeliveryDate(e.target.value)} className={fieldInputClassName} />
                  </FormField>
                )}

                <FormField label="Production Due Date">
                  <input type="date" value={formProductionDueDate} onChange={(e) => setFormProductionDueDate(e.target.value)} className={fieldInputClassName} />
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

              <div data-fade-item className="border border-border rounded-xl p-3 bg-secondary/30 space-y-2">
                <span className="font-semibold block text-foreground text-xs">Contract Line Items ({formDetails.length})</span>
                {formDetails.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground border border-dashed border-border rounded-lg bg-card text-[11px]">
                    No items added yet. Specify product details below to add items to this contract.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {formDetails.map((item, idx) => (
                      <div key={idx} className="border border-border rounded-lg bg-card p-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold text-card-foreground text-[11px] flex-1">{item.productName}</span>
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
                          <button type="button" onClick={() => handleRemoveFormItem(idx)} className="text-destructive hover:text-destructive/80 p-1 shrink-0" title="Remove line item">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {item.materials.length > 0 && (
                          <div className="mt-2 pl-3 border-l-2 border-border space-y-0.5">
                            {item.materials.map((m, midx) => (
                              <div key={midx} className="text-[10px] text-muted-foreground font-mono">
                                {m.materialName} — planned {m.plannedQuantity}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div data-fade-item className="border border-border rounded-xl p-4 bg-secondary/30 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                <FormField label="Product Selection" labelClassName="font-semibold block text-muted-foreground text-[10px] uppercase tracking-wider" colSpan="sm:col-span-6">
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
                    + Add Item
                  </Button>
                </div>

                {/* Materials for this line — staged until "+ Add Item" commits the whole line */}
                <div className="sm:col-span-12 border border-border rounded-lg p-3 bg-card space-y-2">
                  <span className="font-semibold block text-muted-foreground text-[10px] uppercase tracking-wider">Materials for this line ({tempMaterials.length})</span>
                  {tempMaterials.length > 0 && (
                    <div className="space-y-1">
                      {tempMaterials.map((m, midx) => (
                        <div key={midx} className="flex items-center justify-between bg-secondary/30 border border-border rounded px-2 py-1">
                          <span className="text-[10px] text-card-foreground">{m.materialName} — planned {m.plannedQuantity}</span>
                          <button type="button" onClick={() => handleRemoveTempMaterial(midx)} className="text-destructive hover:text-destructive/80 p-0.5" title="Remove material">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                    <div className="sm:col-span-7">
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
                    <div className="sm:col-span-3">
                      <input
                        type="number" min="1" value={tempMaterialQty}
                        onChange={(e) => setTempMaterialQty(Number(e.target.value))}
                        className={fieldInputClassName}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Button type="button" variant="outline" className="w-full" onClick={handleAddTempMaterial} disabled={!tempMaterialId || tempMaterialQty <= 0}>
                        + Add
                      </Button>
                    </div>
                  </div>
                </div>
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
        </>
      )}

      {/* Quotation print modal */}
      <SalesQuotationModal
        order={selectedQuotation}
        isOpen={isQuotationModalOpen}
        onClose={() => { setIsQuotationModalOpen(false); setSelectedQuotation(null); }}
      />

      {/* Tax invoice print modal */}
      <InvoiceModal
        order={selectedInvoiceOrder}
        isOpen={isInvoiceOpen}
        onClose={() => {
          setIsInvoiceOpen(false);
          setSelectedInvoiceOrder(null);
        }}
      />

      {/* Production-done material reconciliation modal */}
      <ProductionCompletionModal
        order={completingOrder}
        isOpen={!!completingOrder}
        materials={rawMaterials}
        onClose={() => setCompletingOrder(null)}
        onSubmit={handleConfirmProductionDone}
      />
    </div>
  );
}
