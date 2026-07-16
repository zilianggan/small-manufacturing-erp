/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import {
  getPurchases, createPurchaseQuotation, updatePurchase, convertToPurchaseOrder,
  receivePurchaseOrder, cancelPurchaseOrder, deletePurchase, getMaterialCategories,
  getPurchaseById, getLatestUnitCost, returnPurchaseOrder,
  PurchaseDetailInput, PurchaseFilters, PurchaseSortField, SortDir, PurchaseReturnLine, ReceiveLine,
} from '../services/PurchasesService';
import { getMaterials, getMaterialsPage } from '../services/MaterialService';
import { getVendors } from '../services/ContactsService';
import { getSalesOrdersForLinking, SalesOrderLinkOption, getSalesOrderMaterialRequirements, SalesOrderMaterialRequirement } from '../services/OrdersService';
import { PurchaseHeader, Vendor, Material, Attachment, MaterialCategory } from '../types';
import { Plus, Calendar, Check, Paperclip, Trash2, Edit, ArrowRightCircle, Eye, RotateCcw, FileText, Undo2 } from 'lucide-react';
import AttachmentSection from './AttachmentSection';
import PurchaseOrderDetailView from './PurchaseOrderDetailView';
import PurchaseInvoiceModal from './PurchaseInvoiceModal';
import LineQuantityModal, { LineQuantityModalLine } from './LineQuantityModal';
import ComboBox from './ComboBox';
import DateTimePicker from './DateTimePicker';
import FilterDialog from './FilterDialog';
import { formatDateTime, toDateTimeLocal, fromDateTimeLocal, monthStart, monthEnd } from '../utils/date';
import { QUICK_RANGES } from '../utils/dateRanges';
import QuickRangePills from './QuickRangePills';
import { PageHeader, SectionCard, FilterBar, DataTable } from './shell';
import type { DataTableColumn, FilterChip } from './shell';
import {
  Button, Badge, Sheet, FormField, fieldInputClassName, ActionsMenu,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
  Tabs, TabsList, TabsTrigger, useToast, useConfirm,
} from './ui';
import type { ActionMenuItem } from './ui';
import { useFadeInOnMount } from '../hooks/useFadeInOnMount';
import { useAndroidBackButton } from '../hooks/useAndroidBackButton';
import { CallAPI } from './UIHelper';
import { debounce } from 'lodash';

type PurchaseTab = 'QUOTATION' | 'PO';
type FormMode = 'CREATE' | 'EDIT' | 'CONVERT';

// 'items' (Material Details) has no single backing column — purchase_detail
// is a joined child list, so PostgREST can't order by it. Sorted client-side
// over whatever's currently loaded instead, same trick InventoryView uses
// for its joined/derived columns.
type DisplaySortField = PurchaseSortField | 'items';
// 'supplier'/'salesNo' are joined columns (vendors.company_name,
// sales_header.sales_no) — PostgREST's order(col, {foreignTable}) doesn't
// reliably sort by a nullable/embedded relation, so they're sorted
// client-side below, same trick as 'items'.
const SERVER_SORT_FIELDS: readonly string[] = ['reference', 'date', 'totalCost', 'status'];

// PO-tab-only statuses (QUOTATION tab is always a single status, filtering it is a no-op).
const PO_STATUSES: PurchaseHeader['status'][] = ['ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'PARTIALLY_RETURNED', 'RETURNED', 'CANCELLED'];

const STATUS_META: Record<PurchaseHeader['status'], { label: string; variant: 'default' | 'warning' | 'success' | 'destructive' | 'secondary' }> = {
  QUOTATION: { label: 'Quotation', variant: 'default' },
  ORDERED: { label: 'Pending Stock', variant: 'warning' },
  PARTIALLY_RECEIVED: { label: 'Partially Received', variant: 'warning' },
  RECEIVED: { label: 'Received', variant: 'success' },
  PARTIALLY_RETURNED: { label: 'Partially Returned', variant: 'warning' },
  RETURNED: { label: 'Returned', variant: 'secondary' },
  CANCELLED: { label: 'Cancelled', variant: 'destructive' },
};

interface PurchasesViewProps {
  // Cross-tab drill-in: MaterialView.tsx's purchase history links here via
  // App.tsx passing a pending purchase header id, since Purchases/Material
  // are separate top-level tabs with no shared router.
  initialPurchaseId?: string | null;
  onInitialPurchaseHandled?: () => void;
  // Which page the cross-tab drill-in came from — used only to word the
  // detail page's Back button correctly.
  initialPurchaseOrigin?: 'MATERIAL' | 'INVENTORY';
  // Called instead of closing locally when the currently open detail page
  // was reached via that cross-tab drill-in — lets App.tsx send the user
  // back to the originating Material detail page (or Inventory tab) rather
  // than this list.
  onReturnToOrigin?: () => void;
  // Detail page's "View Sales Order" link (shown when this purchase was
  // created against a linked sales order) — carries this purchase's own id
  // so the Sales detail page's Back button can return to it specifically.
  onViewSalesOrder?: (salesHeaderId: string, purchaseHeaderId: string) => void;
}

/**
 * Purchases — table-first ledger (Pattern C) with a Quotation/Purchase Order
 * tab switch. Selecting a row swaps the whole page for
 * PurchaseOrderDetailView instead of a Sheet drawer: the detail has
 * status-driven lifecycle actions and is also a cross-tab navigation target
 * (Material/Inventory link straight into it), so a full page keeps the Back
 * button and origin-return behavior simple.
 */
export default function PurchasesView({ initialPurchaseId, onInitialPurchaseHandled, initialPurchaseOrigin, onReturnToOrigin, onViewSalesOrder }: PurchasesViewProps = {}) {
  const toast = useToast();
  const confirm = useConfirm();
  const contentRef = useFadeInOnMount<HTMLDivElement>([]);

  const [activeTab, setActiveTab] = useState<PurchaseTab>('QUOTATION');
  const [searchQuery, setSearchQuery] = useState<Record<PurchaseTab, string>>({ QUOTATION: '', PO: '' });
  const [purchases, setPurchases] = useState<PurchaseHeader[]>([]);
  const [loading, setLoading] = useState(true);

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialCategories, setMaterialCategories] = useState<MaterialCategory[]>([]);
  const [salesLinkOptions, setSalesLinkOptions] = useState<SalesOrderLinkOption[]>([]);
  const [receivingPurchase, setReceivingPurchase] = useState<PurchaseHeader | null>(null);
  const [returningPurchase, setReturningPurchase] = useState<PurchaseHeader | null>(null);

  // Drill-down: selected purchase (shows PurchaseOrderDetailView instead of the table)
  const [selectedPurchase, setSelectedPurchase] = useState<PurchaseHeader | null>(null);
  // Tracks whether the open detail page was reached via the cross-tab
  // initialPurchaseId drill-in (Back should return to that origin) or a
  // plain click on a row in this view's own list (Back should just close).
  const [detailOpenedExternally, setDetailOpenedExternally] = useState(false);
  // Re-fetch the open detail page after a mutation. No-op when no detail is
  // open (edit/cancel from the listing row menu) — otherwise it would pop the
  // detail page open and yank the user off the list.
  const refreshSelectedPurchase = (id: string) => {
    if (!selectedPurchase) return;
    getPurchaseById(id).then((purchase) => { if (purchase) setSelectedPurchase(purchase); }).catch(console.error);
  };

  const openPurchaseDetail = (purchase: PurchaseHeader) => {
    setDetailOpenedExternally(false);
    setSelectedPurchase(purchase);
  };

  const handlePurchaseDetailBack = () => {
    // Always close the detail locally first — a Dashboard-opened drill-in
    // (no material/inventory origin) has nothing for onReturnToOrigin to do,
    // so without this the Back button silently no-op'd and the detail stuck.
    setSelectedPurchase(null);
    if (detailOpenedExternally) onReturnToOrigin?.();
  };
  useAndroidBackButton(!!selectedPurchase, handlePurchaseDetailBack);

  // Cross-tab drill-in: fetch and open the purchase directly by id
  // (independent of whatever tab/search filter is currently active), then
  // tell the parent it's been handled so switching tabs again doesn't
  // re-trigger it.
  useEffect(() => {
    if (!initialPurchaseId) return;
    CallAPI(() => getPurchaseById(initialPurchaseId), {
      onCompleted: (purchase) => {
        if (purchase) {
          setSelectedPurchase(purchase);
          setDetailOpenedExternally(true);
        }
        onInitialPurchaseHandled?.();
      },
      onError: (err) => { console.error(err); onInitialPurchaseHandled?.(); },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPurchaseId]);

  useEffect(() => {
    getVendors().then(setVendors).catch(console.error);
    getMaterials().then(setMaterials).catch(console.error);
    CallAPI(getMaterialCategories, { onCompleted: setMaterialCategories, onError: console.error });
    getSalesOrdersForLinking().then(setSalesLinkOptions).catch(console.error);
  }, []);

  // Purchasable = raw materials + consumables (paint/glue/etc.); customer stock
  // is customer-supplied so it's never bought.
  const purchasableMaterials = useMemo(
    () => materials.filter(m => (m.materialType === 'RAW_MATERIAL' || m.materialType === 'CONSUMABLE_MATERIAL') && m.status !== 'INACTIVE'),
    [materials]
  );

  const materialCategoryMap = useMemo(
    () => new Map(materialCategories.map(c => [c.id, c])),
    [materialCategories]
  );

  // ─── Filter dialog: vendor + material record pickers, date range ────────
  // Defaults to the current month (like Inventory) — avoids pulling every
  // order ever placed on first load.
  const [appliedFilters, setAppliedFilters] = useState<PurchaseFilters>({ dateFrom: monthStart(0), dateTo: monthEnd(0) });
  const [showFilterDialog, setShowFilterDialog] = useState(false);
  const [filterDraftVendorIds, setFilterDraftVendorIds] = useState<string[]>([]);
  const [filterDraftMaterialIds, setFilterDraftMaterialIds] = useState<string[]>([]);
  const [filterDraftStatuses, setFilterDraftStatuses] = useState<PurchaseHeader['status'][]>([]);
  const [filterDraftDateFrom, setFilterDraftDateFrom] = useState(monthStart(0));
  const [filterDraftDateTo, setFilterDraftDateTo] = useState(monthEnd(0));
  const [filterVendorSearch, setFilterVendorSearch] = useState('');
  const [filterMaterialSearch, setFilterMaterialSearch] = useState('');
  const [filterVendorVisibleCount, setFilterVendorVisibleCount] = useState(20);
  const [filterMaterialOptions, setFilterMaterialOptions] = useState<Material[]>([]);
  const [filterMaterialOptionsLoading, setFilterMaterialOptionsLoading] = useState(false);
  const [filterMaterialOffset, setFilterMaterialOffset] = useState(0);
  const [filterMaterialHasMore, setFilterMaterialHasMore] = useState(false);
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
  const [sortField, setSortField] = useState<DisplaySortField>('reference');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const isServerSort = SERVER_SORT_FIELDS.includes(sortField);

  // Guards against out-of-order responses: switching tabs (or typing a new
  // search) quickly fires a new request before the previous one resolves —
  // without this, an older response landing last overwrites the table with
  // the wrong tab's data.
  const requestIdRef = useRef(0);

  const loadPurchases = (tab: PurchaseTab, search: string = '') => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    CallAPI(() => getPurchases(tab, search, { filters: appliedFilters, sortField: (isServerSort ? sortField : 'date') as PurchaseSortField, sortDir: isServerSort ? sortDir : 'desc' }), {
      onCompleted: (data) => {
        if (requestId !== requestIdRef.current) return;
        setPurchases(data);
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
    loadPurchases(activeTab, searchQuery[activeTab]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, appliedFilters, sortField, sortDir]);

  // Debounced search-as-you-type
  const search = useMemo(
    () => debounce((text: string) => loadPurchases(activeTab, text), 500),
    [activeTab, appliedFilters, sortField, sortDir]
  );

  const loadFilterMaterialOptions = useMemo(() => debounce((q: string) => {
    setFilterMaterialOptionsLoading(true);
    CallAPI(() => getMaterialsPage({ search: q, offset: 0, limit: 20 }), {
      onCompleted: ({ rows, hasMore }) => {
        setFilterMaterialOptions(rows); setFilterMaterialHasMore(hasMore); setFilterMaterialOffset(rows.length); setFilterMaterialOptionsLoading(false);
      },
      onError: () => setFilterMaterialOptionsLoading(false),
    });
  }, 300), []);
  const loadMoreFilterMaterialOptions = () => {
    if (filterMaterialOptionsLoading || !filterMaterialHasMore) return;
    setFilterMaterialOptionsLoading(true);
    CallAPI(() => getMaterialsPage({ search: filterMaterialSearch, offset: filterMaterialOffset, limit: 20 }), {
      onCompleted: ({ rows, hasMore }) => {
        setFilterMaterialOptions(prev => [...prev, ...rows]); setFilterMaterialHasMore(hasMore); setFilterMaterialOffset(o => o + rows.length); setFilterMaterialOptionsLoading(false);
      },
      onError: () => setFilterMaterialOptionsLoading(false),
    });
  };

  const openFilterDialog = () => {
    setFilterDraftVendorIds(appliedFilters.vendorIds || []);
    setFilterDraftMaterialIds(appliedFilters.materialIds || []);
    setFilterDraftStatuses(appliedFilters.statuses || []);
    setFilterDraftDateFrom(appliedFilters.dateFrom || '');
    setFilterDraftDateTo(appliedFilters.dateTo || '');
    setFilterVendorSearch('');
    setFilterMaterialSearch('');
    setFilterVendorVisibleCount(20);
    setFilterMaterialOptions([]); setFilterMaterialOffset(0); setFilterMaterialHasMore(false);
    setShowFilterDialog(true);
    loadFilterMaterialOptions('');
  };

  const toggleFilterDraftVendor = (id: string) => {
    setFilterDraftVendorIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };
  const toggleFilterDraftMaterial = (id: string) => {
    setFilterDraftMaterialIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };
  const toggleFilterDraftStatus = (id: string) => {
    const status = id as PurchaseHeader['status'];
    setFilterDraftStatuses(prev => (prev.includes(status) ? prev.filter(x => x !== status) : [...prev, status]));
  };

  const filterVendorMatches = useMemo(() => {
    const q = filterVendorSearch.trim().toLowerCase();
    return vendors.filter(v => !q || v.companyName.toLowerCase().includes(q));
  }, [vendors, filterVendorSearch]);
  const filterVendorItems = useMemo(
    () => filterVendorMatches.slice(0, filterVendorVisibleCount).map(v => ({ id: v.id, label: v.companyName })),
    [filterVendorMatches, filterVendorVisibleCount]
  );

  const filterMaterialItems = useMemo(
    () => filterMaterialOptions.map(m => ({ id: m.id, label: m.name, sublabel: m.code })),
    [filterMaterialOptions]
  );

  const filterChips: FilterChip[] = [
    ...(appliedFilters.vendorIds?.length ? [{ key: 'vendors', label: `${appliedFilters.vendorIds.length} supplier${appliedFilters.vendorIds.length === 1 ? '' : 's'}`, onRemove: () => setAppliedFilters(f => ({ ...f, vendorIds: [] })) }] : []),
    ...(appliedFilters.materialIds?.length ? [{ key: 'materials', label: `${appliedFilters.materialIds.length} material${appliedFilters.materialIds.length === 1 ? '' : 's'}`, onRemove: () => setAppliedFilters(f => ({ ...f, materialIds: [] })) }] : []),
    ...(appliedFilters.statuses?.length ? [{ key: 'statuses', label: `${appliedFilters.statuses.length} status${appliedFilters.statuses.length === 1 ? '' : 'es'}`, onRemove: () => setAppliedFilters(f => ({ ...f, statuses: [] })) }] : []),
    ...(appliedFilters.dateFrom || appliedFilters.dateTo ? [{ key: 'date', label: `${appliedFilters.dateFrom || '…'} → ${appliedFilters.dateTo || '…'}`, onRemove: () => { setActiveQuickRange('thisMonth'); setAppliedFilters(f => ({ ...f, dateFrom: monthStart(0), dateTo: monthEnd(0) })); } }] : []),
  ];
  const activeFilterCount = (appliedFilters.vendorIds?.length || 0) + (appliedFilters.materialIds?.length || 0) + (appliedFilters.statuses?.length || 0) + (appliedFilters.dateFrom || appliedFilters.dateTo ? 1 : 0);

  const toggleSort = (key: string) => {
    const field = key as DisplaySortField;
    if (field === sortField) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
  };

  // Client-side re-sort for 'items'/'supplier'/'salesNo' — applied over
  // whatever's currently loaded (server-sorted columns skip this and pass
  // through).
  const displayedPurchases = useMemo(() => {
    if (isServerSort) return purchases;
    const getValue = (p: PurchaseHeader): string => {
      if (sortField === 'supplier') return p.vendorName || '';
      if (sortField === 'salesNo') return p.salesNo || '';
      return p.details[0]?.materialName || '';
    };
    return [...purchases].sort((a, b) => {
      const cmp = getValue(a).localeCompare(getValue(b));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [purchases, sortField, sortDir, isServerSort]);

  // Form drawer state
  const [showFormSheet, setShowFormSheet] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>('CREATE');
  const [editHeaderId, setEditHeaderId] = useState<string | null>(null);
  const [editHeaderStatus, setEditHeaderStatus] = useState<PurchaseHeader['status'] | null>(null);
  const [formVendorId, setFormVendorId] = useState('');
  const [formOrderDate, setFormOrderDate] = useState('');
  const [formSalesHeaderId, setFormSalesHeaderId] = useState('');
  const [formDetails, setFormDetails] = useState<PurchaseDetailInput[]>([]);
  const [tempMaterialId, setTempMaterialId] = useState('');
  const [tempQuantity, setTempQuantity] = useState(10);
  const [tempUnitCost, setTempUnitCost] = useState(0);
  const [formAttachment, setFormAttachment] = useState<Attachment | undefined>(undefined);
  const [requiredMaterials, setRequiredMaterials] = useState<SalesOrderMaterialRequirement[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Invoice print modal — only meaningful once a quotation has become a PO.
  const [selectedInvoice, setSelectedInvoice] = useState<PurchaseHeader | null>(null);
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
  const openInvoiceDoc = (purchase: PurchaseHeader) => {
    setSelectedInvoice(purchase);
    setIsInvoiceModalOpen(true);
  };

  useEffect(() => {
    if (!formSalesHeaderId) { setRequiredMaterials([]); return; }
    getSalesOrderMaterialRequirements(formSalesHeaderId).then(setRequiredMaterials).catch(console.error);
  }, [formSalesHeaderId]);

  const resetForm = () => {
    setEditHeaderId(null);
    setFormVendorId('');
    setFormOrderDate('');
    setFormSalesHeaderId('');
    setFormDetails([]);
    setTempMaterialId('');
    setTempQuantity(10);
    setTempUnitCost(0);
    setFormAttachment(undefined);
  };

  const clearTempMaterials = () => {
    setTempMaterialId('');
    setTempQuantity(10);
    setTempUnitCost(0);
  };

  // Purchase order date is a datetime now: form holds a "yyyy-MM-ddThh:mm"
  // local value; convertToPurchaseOrder gets it back as an ISO string.
  const nowLocal = () => toDateTimeLocal(new Date().toISOString());

  const openCreateForm = () => {
    resetForm();
    setFormMode('CREATE');
    setShowFormSheet(true);
  };

  const detailsFromHeader = (purchase: PurchaseHeader): PurchaseDetailInput[] =>
    purchase.details.map(d => ({
      materialId: d.materialId,
      materialName: d.materialName,
      materialCode: d.materialCode,
      quantity: d.quantity,
      unitCost: d.unitCost,
      totalPrice: d.totalPrice,
    }));

  const openEditForm = (purchase: PurchaseHeader) => {
    clearTempMaterials();
    setFormMode('EDIT');
    setEditHeaderId(purchase.id);
    setEditHeaderStatus(purchase.status);
    setFormVendorId(purchase.vendorId);
    setFormSalesHeaderId(purchase.salesHeaderId || '');
    setFormAttachment(purchase.attachments?.[0]);
    setFormDetails(detailsFromHeader(purchase));
    setShowFormSheet(true);
  };

  const openConvertForm = (purchase: PurchaseHeader) => {
    clearTempMaterials();
    setFormMode('CONVERT');
    setEditHeaderId(purchase.id);
    setFormVendorId(purchase.vendorId);
    setFormSalesHeaderId(purchase.salesHeaderId || '');
    setFormAttachment(purchase.attachments?.[0]);
    setFormDetails(detailsFromHeader(purchase));
    setFormOrderDate(nowLocal());
    setShowFormSheet(true);
  };

  // Material catalog rows carry no per-vendor unit cost, so prefill from
  // whatever was last paid for this material instead (0 if never purchased)
  // — the buyer can still override the quoted cost.
  const handleMaterialSelect = (materialId: string) => {
    setTempMaterialId(materialId);
    getLatestUnitCost(materialId).then((cost) => setTempUnitCost(cost ?? 0)).catch(console.error);
  };

  const handleAddTempItem = () => {
    if (!tempMaterialId || tempQuantity <= 0) return;
    const material = purchasableMaterials.find(m => m.id === tempMaterialId);
    if (!material) return;

    const existingIdx = formDetails.findIndex(d => d.materialId === tempMaterialId);
    if (existingIdx !== -1) {
      const updated = [...formDetails];
      updated[existingIdx].quantity += tempQuantity;
      updated[existingIdx].totalPrice = updated[existingIdx].quantity * updated[existingIdx].unitCost;
      setFormDetails(updated);
    } else {
      setFormDetails([...formDetails, {
        materialId: tempMaterialId,
        materialName: material.name,
        materialCode: material.code,
        quantity: tempQuantity,
        unitCost: tempUnitCost,
        totalPrice: tempQuantity * tempUnitCost,
      }]);
    }

    setTempMaterialId('');
    setTempQuantity(10);
    setTempUnitCost(0);
  };

  const handleRemoveFormItem = (index: number) => {
    setFormDetails(formDetails.filter((_, idx) => idx !== index));
  };

  const handleUpdateFormItemQuantity = (index: number, quantity: number) => {
    setFormDetails(formDetails.map((d, idx) => idx === index ? { ...d, quantity, totalPrice: quantity * d.unitCost } : d));
  };

  const handleUpdateFormItemUnitCost = (index: number, unitCost: number) => {
    setFormDetails(formDetails.map((d, idx) => idx === index ? { ...d, unitCost, totalPrice: d.quantity * unitCost } : d));
  };

  const handleSubmit = async () => {
    if (!formVendorId) return;

    let finalDetails = [...formDetails];
    if (tempMaterialId && tempQuantity > 0) {
      const material = purchasableMaterials.find(m => m.id === tempMaterialId);
      if (material) {
        const existingIdx = finalDetails.findIndex(d => d.materialId === tempMaterialId);
        if (existingIdx !== -1) {
          finalDetails[existingIdx].quantity += tempQuantity;
          finalDetails[existingIdx].totalPrice = finalDetails[existingIdx].quantity * finalDetails[existingIdx].unitCost;
        } else {
          finalDetails.push({
            materialId: tempMaterialId,
            materialName: material.name,
            materialCode: material.code,
            quantity: tempQuantity,
            unitCost: tempUnitCost,
            totalPrice: tempQuantity * tempUnitCost,
          });
        }
      }
    }

    if (finalDetails.length === 0) {
      toast.warning('Please add at least one material item to this purchase.');
      return;
    }

    const input = {
      vendorId: formVendorId,
      salesHeaderId: formSalesHeaderId || undefined,
      attachments: formAttachment ? [formAttachment] : [],
      details: finalDetails,
    };

    setSubmitting(true);
    if (formMode === 'CREATE') {
      await CallAPI(() => createPurchaseQuotation(input), {
        onCompleted: () => { loadPurchases(activeTab); toast.success('Purchase quotation created.'); },
        onError: (err) => { console.error(err); toast.error('Failed to create purchase quotation.'); },
      });
    } else if (formMode === 'EDIT' && editHeaderId) {
      await CallAPI(() => updatePurchase(editHeaderId, input), {
        onCompleted: () => { loadPurchases(activeTab); refreshSelectedPurchase(editHeaderId); toast.success('Purchase updated.'); },
        onError: (err) => { console.error(err); toast.error('Failed to update purchase.'); },
      });
    } else if (formMode === 'CONVERT' && editHeaderId) {
      await CallAPI(() => convertToPurchaseOrder(editHeaderId, input, fromDateTimeLocal(formOrderDate || nowLocal())), {
        onCompleted: () => { loadPurchases(activeTab); setSelectedPurchase(null); toast.success('Purchase order confirmed.'); },
        onError: (err) => { console.error(err); toast.error('Failed to confirm purchase order.'); },
      });
    }

    setSubmitting(false);
    setShowFormSheet(false);
    resetForm();
  };

  const handleDelete = async (id: string) => {
    if (!(await confirm('Are you sure you want to delete this purchase?'))) return;
    await CallAPI(() => deletePurchase(id), {
      onCompleted: () => {
        loadPurchases(activeTab);
        setSelectedPurchase((prev) => (prev?.id === id ? null : prev));
        toast.success('Purchase deleted.');
      },
      onError: (err) => { console.error(err); toast.error('Failed to delete purchase.'); },
    });
  };

  // Receiving is partial now: the modal takes a quantity per line, so a PO can be booked in over
  // several deliveries and only reaches RECEIVED once every line is fully in.
  const openReceive = (purchase: PurchaseHeader) => setReceivingPurchase(purchase);

  const handleReceive = async (quantities: Record<string, number>, remark: string) => {
    if (!receivingPurchase) return;
    const lines: ReceiveLine[] = receivingPurchase.details
      .map(d => ({ detailId: d.detailId, quantity: quantities[d.detailId] || 0 }))
      .filter(l => l.quantity > 0);

    await CallAPI(() => receivePurchaseOrder(receivingPurchase, lines, remark), {
      onCompleted: () => {
        setReceivingPurchase(null);
        loadPurchases(activeTab);
        refreshSelectedPurchase(receivingPurchase.id);
        toast.success('Goods received into inventory.');
      },
      onError: (err) => {
        console.error(err);
        toast.error('Failed to receive goods.');
        // A partial failure may have committed some lines. Close the modal (it doesn't reset its
        // draft while open) and reload, so the user sees what actually landed.
        setReceivingPurchase(null);
        loadPurchases(activeTab);
        refreshSelectedPurchase(receivingPurchase.id);
      },
    });
  };

  const handleCancel = async (id: string) => {
    if (!(await confirm('Cancel this Purchase Order?', { title: 'Cancel Purchase Order' }))) return;
    await CallAPI(() => cancelPurchaseOrder(id), {
      onCompleted: () => { loadPurchases(activeTab); refreshSelectedPurchase(id); toast.success('Purchase order cancelled.'); },
      onError: (err) => { console.error(err); toast.error('Failed to cancel purchase order.'); },
    });
  };

  const openReturn = (purchase: PurchaseHeader) => setReturningPurchase(purchase);

  const handleReturn = async (quantities: Record<string, number>, remark: string) => {
    if (!returningPurchase) return;
    const lines: PurchaseReturnLine[] = returningPurchase.details
      .map(d => ({ detailId: d.detailId, quantity: quantities[d.detailId] || 0 }))
      .filter(l => l.quantity > 0);

    await CallAPI(() => returnPurchaseOrder(returningPurchase, lines, remark), {
      onCompleted: () => {
        setReturningPurchase(null);
        loadPurchases(activeTab);
        refreshSelectedPurchase(returningPurchase.id);
        toast.success('Material returned to vendor.');
      },
      onError: (err) => {
        console.error(err);
        // returnPurchaseOrder's already-consumed-material check throws before writing anything, and
        // its message names the materials that are short — surface it rather than the generic failure.
        toast.error(err instanceof Error && err.message ? err.message : 'Failed to return material.');
        // A partial failure may have committed some lines. Close the modal (it doesn't reset its
        // typed quantities except on open) and refresh so a reopen starts from true remaining
        // quantities instead of resubmitting the same amounts a second time.
        setReturningPurchase(null);
        loadPurchases(activeTab);
        refreshSelectedPurchase(returningPurchase.id);
      },
    });
  };

  const editingQuotation = formMode === 'EDIT' && editHeaderStatus === 'QUOTATION';

  const sheetTitle = formMode === 'CREATE' ? 'Create Purchase Quotation'
    : formMode === 'EDIT' ? (editingQuotation ? 'Edit Purchase Quotation' : 'Edit Purchase Order')
      : 'Confirm Purchase Order';

  const submitLabel = formMode === 'CREATE' ? 'Save Quotation'
    : formMode === 'EDIT' ? (editingQuotation ? 'Update Quotation' : 'Update Purchase Order')
      : 'Confirm Purchase Order';

  const buildRowActions = (p: PurchaseHeader): ActionMenuItem[] => [
    { label: 'View', icon: <Eye className="w-3.5 h-3.5" />, onClick: () => openPurchaseDetail(p) },
    { label: 'Edit', icon: <Edit className="w-3.5 h-3.5" />, onClick: () => openEditForm(p), hidden: !['QUOTATION', 'ORDERED'].includes(p.status) },
    { label: 'Delete', icon: <Trash2 className="w-3.5 h-3.5" />, onClick: () => handleDelete(p.id), danger: true, hidden: !['QUOTATION', 'CANCELLED'].includes(p.status) },
    { label: 'Proceed to Purchase Order', icon: <ArrowRightCircle className="w-3.5 h-3.5" />, onClick: () => openConvertForm(p), hidden: p.status !== 'QUOTATION' },
    // Receive while anything is still outstanding; return once anything has arrived. Cancel stays on
    // ORDERED alone — the one status where no goods have moved — so it never sits next to Return.
    { label: 'Receive Goods', icon: <Check className="w-3.5 h-3.5" />, onClick: () => openReceive(p), hidden: !['ORDERED', 'PARTIALLY_RECEIVED'].includes(p.status) },
    { label: 'Cancel Order', icon: <Trash2 className="w-3.5 h-3.5" />, onClick: () => handleCancel(p.id), danger: true, hidden: p.status !== 'ORDERED' },
    { label: 'Return to Vendor', icon: <Undo2 className="w-3.5 h-3.5" />, onClick: () => openReturn(p), hidden: !['PARTIALLY_RECEIVED', 'RECEIVED', 'PARTIALLY_RETURNED'].includes(p.status) },
    { label: 'Generate Invoice', icon: <FileText className="w-3.5 h-3.5" />, onClick: () => openInvoiceDoc(p), hidden: !['ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(p.status) },
  ];

  const columns: DataTableColumn<PurchaseHeader>[] = [
    { key: 'reference', header: 'Reference', sortable: true, className: 'w-32', render: (p) => <span className="font-mono font-medium text-foreground">{p.purchaseNo}</span> },
    { key: 'supplier', header: 'Supplier', sortable: true, className: 'w-40', render: (p) => <span className="font-medium text-card-foreground truncate">{p.vendorName}</span> },
    {
      key: 'salesNo', header: 'Sales Ref No', sortable: true, className: 'w-32',
      render: (p) => p.salesNo && p.salesHeaderId ? (
        <button type="button" onClick={(e) => { e.stopPropagation(); onViewSalesOrder?.(p.salesHeaderId!, p.id); }} className="font-mono text-primary hover:underline">
          {p.salesNo}
        </button>
      ) : <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'items', header: 'Material Details', sortable: true,
      render: (p) => (
        <div className="min-w-0 max-w-xs space-y-1.5">
          <div className="divide-y divide-border">
            {p.details.map((item, idx) => (
              <div key={item.detailId || idx} className="py-1 first:pt-0 last:pb-0 min-w-0">
                <div className="font-medium text-card-foreground truncate">{item.materialName}</div>
                <div className="text-[11px] text-muted-foreground font-mono">Qty {item.quantity} @ RM {item.unitCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </div>
            ))}
          </div>
          {p.attachments?.[0] && (
            <a
              href={p.attachments[0].dataUrl}
              download={p.attachments[0].name}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-primary/10 hover:bg-primary/20 text-primary rounded text-[10px] font-mono transition-colors"
              title="Download attachment"
            >
              <Paperclip className="w-2.5 h-2.5 shrink-0" />
              <span className="truncate max-w-[120px]">{p.attachments[0].name}</span>
            </a>
          )}
        </div>
      )
    },
    {
      key: 'date', header: activeTab === 'QUOTATION' ? 'Quotation Date' : 'Order Date', sortable: true, className: 'w-32',
      render: (p) => (
        <div className="inline-flex items-center gap-1.5 text-muted-foreground font-mono text-[11px]">
          <Calendar className="w-3.5 h-3.5" />
          <span>{formatDateTime(activeTab === 'QUOTATION' ? p.quotationDate : p.orderDate)}</span>
        </div>
      )
    },
    { key: 'totalCost', header: 'Total Cost', sortable: true, align: 'right', className: 'w-32', render: (p) => <span className="font-mono font-medium text-foreground">RM {p.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> },
    ...(activeTab === 'PO' ? [{
      key: 'status', header: 'Status', sortable: true, className: 'w-[1%] whitespace-nowrap',
      render: (p: PurchaseHeader) => <Badge variant={STATUS_META[p.status].variant}>{STATUS_META[p.status].label}</Badge>,
    } as DataTableColumn<PurchaseHeader>] : []),
  ];

  return (
    <div ref={contentRef} className="flex flex-col gap-5 min-[1440px]:h-full min-[1440px]:min-h-0" id="purchases-view">
      {selectedPurchase ? (
        <PurchaseOrderDetailView
          purchase={selectedPurchase}
          onBack={handlePurchaseDetailBack}
          backLabel={initialPurchaseOrigin === 'INVENTORY' ? 'Back to Inventory' : initialPurchaseOrigin === 'MATERIAL' ? 'Back to Material' : 'Back to Purchases'}
          onEdit={openEditForm}
          onConvert={openConvertForm}
          onDelete={handleDelete}
          onReceive={openReceive}
          onCancel={handleCancel}
          onReturn={openReturn}
          onOpenInvoiceDoc={openInvoiceDoc}
          onViewSalesOrder={onViewSalesOrder ? (salesHeaderId) => onViewSalesOrder(salesHeaderId, selectedPurchase.id) : undefined}
        />
      ) : (
        <>
          <PageHeader
            title="Purchases"
            description="Manage supplier quotations and purchase orders."
            actions={activeTab === 'QUOTATION' && <Button onClick={openCreateForm}><Plus className="w-4 h-4" /> New Quotation</Button>}
          />

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as PurchaseTab)}>
            <TabsList>
              <TabsTrigger value="QUOTATION">Quotation</TabsTrigger>
              <TabsTrigger value="PO">Purchase Order</TabsTrigger>
            </TabsList>
          </Tabs>

          <SectionCard title="Filters" className="shrink-0" contentClassName="p-4 space-y-2.5">
            <FilterBar
              search={searchQuery[activeTab]}
              onSearchChange={(v) => { setSearchQuery(prev => ({ ...prev, [activeTab]: v })); search(v); }}
              searchPlaceholder="Search by supplier or reference no..."
              chips={filterChips}
              onOpenFilters={openFilterDialog}
              filterCount={activeFilterCount}
              right={<Button variant="outline" size="sm" onClick={resetFilters}><RotateCcw className="w-3.5 h-3.5" /> Reset</Button>}
            />
            <QuickRangePills activeKey={activeQuickRange} onSelect={applyQuickRange} />
          </SectionCard>

          <SectionCard title={activeTab === 'QUOTATION' ? 'Quotations' : 'Purchase Orders'} description={`${purchases.length} record${purchases.length === 1 ? '' : 's'}`} className="flex-1 min-h-0" contentClassName="p-0 flex-1 min-h-0 flex flex-col">
            <div className="flex-1 min-h-0 overflow-auto">
              <DataTable
                columns={columns}
                rows={displayedPurchases}
                rowKey={(p) => p.id}
                sortField={sortField}
                sortDir={sortDir}
                onSort={toggleSort}
                onRowClick={openPurchaseDetail}
                rowActions={(p) => <ActionsMenu items={buildRowActions(p)} />}
                loading={loading}
                emptyState={`No ${activeTab === 'QUOTATION' ? 'quotations' : 'purchase orders'} logged yet.`}
              />
            </div>
          </SectionCard>

          {/* Advanced filter dialog */}
          <FilterDialog
            open={showFilterDialog}
            onClose={() => setShowFilterDialog(false)}
            title="Filter Purchases"
            sections={[
              {
                type: 'dateRange',
                key: 'dateRange',
                label: activeTab === 'QUOTATION' ? 'Quotation Date Range' : 'Order Date Range',
                from: filterDraftDateFrom,
                to: filterDraftDateTo,
                onFromChange: setFilterDraftDateFrom,
                onToChange: setFilterDraftDateTo,
              },
              {
                type: 'checklist',
                key: 'vendors',
                label: 'Supplier',
                searchPlaceholder: 'Search suppliers...',
                searchQuery: filterVendorSearch,
                onSearchChange: (q) => { setFilterVendorSearch(q); setFilterVendorVisibleCount(20); },
                items: filterVendorItems,
                hasMore: filterVendorMatches.length > filterVendorVisibleCount,
                onLoadMore: () => setFilterVendorVisibleCount(c => c + 20),
                selectedIds: filterDraftVendorIds,
                onToggle: toggleFilterDraftVendor,
              },
              {
                type: 'checklist',
                key: 'materials',
                label: 'Material',
                searchPlaceholder: 'Search materials...',
                searchQuery: filterMaterialSearch,
                onSearchChange: (q) => { setFilterMaterialSearch(q); loadFilterMaterialOptions(q); },
                items: filterMaterialItems,
                loading: filterMaterialOptionsLoading,
                hasMore: filterMaterialHasMore,
                onLoadMore: loadMoreFilterMaterialOptions,
                selectedIds: filterDraftMaterialIds,
                onToggle: toggleFilterDraftMaterial,
              },
              // QUOTATION tab is always a single status — a status filter there is a no-op.
              ...(activeTab === 'PO' ? [{
                type: 'checklist' as const,
                key: 'statuses',
                label: 'Status',
                hideSearch: true,
                searchQuery: '',
                onSearchChange: () => {},
                items: PO_STATUSES.map(s => ({ id: s, label: STATUS_META[s].label })),
                selectedIds: filterDraftStatuses,
                onToggle: toggleFilterDraftStatus,
              }] : []),
            ]}
            onApply={() => {
              setActiveQuickRange(null);
              setAppliedFilters({
                vendorIds: filterDraftVendorIds,
                materialIds: filterDraftMaterialIds,
                statuses: filterDraftStatuses,
                dateFrom: filterDraftDateFrom || undefined,
                dateTo: filterDraftDateTo || undefined,
              });
            }}
            onClear={() => {
              setFilterDraftVendorIds([]); setFilterDraftMaterialIds([]); setFilterDraftStatuses([]);
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
            onClose={() => { clearTempMaterials(); setShowFormSheet(false); }}
            title={sheetTitle}
            width="w-full sm:max-w-2xl"
            footer={
              <div className="flex items-center justify-end gap-2">
                <Button variant="outline" onClick={() => { clearTempMaterials(); setShowFormSheet(false); }}>Cancel</Button>
                <Button onClick={handleSubmit} disabled={submitting || !formVendorId}>{submitting ? 'Saving...' : submitLabel}</Button>
              </div>
            }
          >
            <div className="p-5 space-y-5">
              <div data-fade-item className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField label="Select Vendor *" colSpan="sm:col-span-2">
                  <ComboBox
                    required
                    value={formVendorId}
                    onChange={setFormVendorId}
                    noneLabel="-- Select Vendor --"
                    options={vendors.map(v => ({ value: v.id, label: v.companyName, sublabel: v.officeNo || v.email }))}
                  />
                </FormField>

                <FormField label="Linked Sales Order (Optional)" colSpan="sm:col-span-2">
                  <ComboBox
                    value={formSalesHeaderId}
                    onChange={setFormSalesHeaderId}
                    noneLabel="-- No Linked Sales Order --"
                    options={salesLinkOptions.map(s => ({ value: s.id, label: s.salesNo, sublabel: s.clientName }))}
                  />
                </FormField>

                {formMode === 'CONVERT' && (
                  <FormField label="Order Date & Time *" colSpan="sm:col-span-2">
                    <DateTimePicker required value={formOrderDate} onChange={setFormOrderDate} />
                  </FormField>
                )}
              </div>

              {formSalesHeaderId && requiredMaterials.length > 0 && (
                <div data-fade-item className="border border-primary/20 rounded-xl p-3 bg-primary/5 space-y-1.5">
                  <span className="font-semibold block text-[11px] text-primary">Required Materials for Linked Sales Order</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
                    {requiredMaterials.map(r => (
                      <div key={r.materialId} className="flex justify-between text-[11px] text-foreground font-mono bg-card/60 rounded px-2 py-1">
                        <span>{r.materialName}</span>
                        <span>{r.requiredQuantity}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div data-fade-item className="border border-border rounded-xl p-3 bg-secondary/30 space-y-2">
                <span className="font-semibold block text-foreground text-xs">Materials to Procure ({formDetails.length})</span>
                {formDetails.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground border border-dashed border-border rounded-lg bg-card text-[11px]">
                    No materials added yet. Specify material details below to add items.
                  </div>
                ) : (
                  <div className="border border-border rounded-lg bg-card overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Material</TableHead>
                          <TableHead className="text-right">Quantity</TableHead>
                          <TableHead className="text-right">Unit Cost</TableHead>
                          <TableHead className="text-right">Total (RM)</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {formDetails.map((item, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="font-medium text-card-foreground">{item.materialName}</TableCell>
                            <TableCell className="text-right">
                              <input
                                type="number" min="1" value={item.quantity}
                                onChange={(e) => handleUpdateFormItemQuantity(idx, Number(e.target.value))}
                                className="w-20 px-1.5 py-1 bg-background border border-input rounded text-right font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring"
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <input
                                type="number" min="0" step="0.01" value={item.unitCost}
                                onChange={(e) => handleUpdateFormItemUnitCost(idx, Number(e.target.value))}
                                className="w-24 px-1.5 py-1 bg-background border border-input rounded text-right font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring"
                              />
                            </TableCell>
                            <TableCell className="text-right font-mono font-medium text-foreground">RM {item.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                            <TableCell>
                              <button type="button" onClick={() => handleRemoveFormItem(idx)} className="text-destructive hover:text-destructive/80 p-1" title="Remove item">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              <div data-fade-item className="border border-border rounded-xl p-4 bg-secondary/30 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                <FormField label="Material Selection" labelClassName="font-semibold block text-muted-foreground text-[10px] uppercase tracking-wider" colSpan="sm:col-span-6">
                  <ComboBox
                    value={tempMaterialId}
                    onChange={handleMaterialSelect}
                    noneLabel="-- Choose Material --"
                    options={purchasableMaterials.map(m => {
                      const category = materialCategoryMap.get(m.materialCategoryId || '');
                      return { value: m.id, label: m.name, sublabel: category ? category.name : `Stock: ${m.quantity}` };
                    })}
                  />
                </FormField>

                <FormField label="Quantity" labelClassName="font-semibold block text-muted-foreground text-[10px] uppercase tracking-wider" colSpan="sm:col-span-2">
                  <input
                    type="number" min="1" value={tempQuantity}
                    onChange={(e) => setTempQuantity(Number(e.target.value))}
                    disabled={!formVendorId}
                    className={fieldInputClassName + ' disabled:bg-secondary/50'}
                  />
                </FormField>

                <FormField label="Unit Cost (RM)" labelClassName="font-semibold block text-muted-foreground text-[10px] uppercase tracking-wider" colSpan="sm:col-span-2">
                  <input
                    type="number" min="0" step="0.01" value={tempUnitCost}
                    onChange={(e) => setTempUnitCost(Number(e.target.value))}
                    disabled={!formVendorId}
                    className={fieldInputClassName + ' disabled:bg-secondary/50'}
                  />
                </FormField>

                <div className="sm:col-span-2">
                  <Button type="button" className="w-full" onClick={handleAddTempItem} disabled={!formVendorId || !tempMaterialId || tempQuantity <= 0}>
                    + Add Item
                  </Button>
                </div>
              </div>

              <div data-fade-item className="bg-warning/10 border border-warning/20 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <span className="font-semibold block text-[11px] text-foreground">Total Purchase Cost:</span>
                  <span className="text-[10px] text-muted-foreground">Payment will be logged under company material costs.</span>
                </div>
                <div className="font-mono text-base font-bold text-foreground">
                  RM {Math.max(0, formDetails.reduce((sum, item) => sum + item.totalPrice, 0) + (tempMaterialId && tempQuantity > 0 ? tempQuantity * tempUnitCost : 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>

              <div data-fade-item>
                <AttachmentSection
                  attachment={formAttachment}
                  onAttachmentChange={setFormAttachment}
                  label="Quotation or Invoice Document (Optional)"
                  helperText="Upload any supplier quotation, invoice, specification, or receipt (Max 1MB)"
                />
              </div>
            </div>
      </Sheet>

      {/* Invoice print modal — outside the list/detail split so both can open it */}
      <PurchaseInvoiceModal
        purchase={selectedInvoice}
        isOpen={isInvoiceModalOpen}
        onClose={() => { setIsInvoiceModalOpen(false); setSelectedInvoice(null); }}
      />

      <LineQuantityModal
        isOpen={!!receivingPurchase}
        title={`Receive Goods — ${receivingPurchase?.purchaseNo ?? ''}`}
        itemHeader="Material"
        totalHeader="Ordered"
        doneHeader="Received"
        actionLabel="Receive"
        doneLabel="fully received"
        remarkPlaceholder="e.g. delivery note DN-2291"
        lines={(receivingPurchase?.details ?? []).map((d): LineQuantityModalLine => ({
          id: d.detailId,
          name: d.materialName,
          totalQty: d.quantity,
          doneQty: d.receivedQuantity,
        }))}
        onClose={() => setReceivingPurchase(null)}
        onSubmit={handleReceive}
      />

      <LineQuantityModal
        isOpen={!!returningPurchase}
        title={`Return to Vendor — ${returningPurchase?.purchaseNo ?? ''}`}
        itemHeader="Material"
        totalHeader="Received"
        doneHeader="Returned"
        actionLabel="Return"
        doneLabel="fully returned"
        remarkPlaceholder="e.g. wrong gauge, damaged in transit"
        lines={(returningPurchase?.details ?? []).map((d): LineQuantityModalLine => ({
          id: d.detailId,
          name: d.materialName,
          totalQty: d.receivedQuantity,
          doneQty: d.returnedQuantity,
        }))}
        onClose={() => setReturningPurchase(null)}
        onSubmit={handleReturn}
      />
    </div>
  );
}
