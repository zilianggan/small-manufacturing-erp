/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  getMaterials, getMaterialsPage, saveMaterial, deleteMaterial, generateId, getMaterialCategories, getMaterialById,
  getMaterialInventoryList, MaterialSortField, SortDir
} from '../services/MaterialService';
import { Material, MaterialCategory, MaterialType, ConsumptionMode, Attachment, InventoryListItem } from '../types';
import {
  Plus, Edit, Trash2, Copy, Archive, ArchiveRestore, Boxes, AlertTriangle, Paperclip, ShoppingBag,
} from 'lucide-react';
import MaterialFormFields from './MaterialFormFields';
import FilterDialog from './FilterDialog';
import SortMenu, { SortOption } from './SortMenu';
import InfiniteScrollSentinel from './InfiniteScrollSentinel';
import { InventoryHistoryTable } from './InventoryListShared';
import {
  PageHeader, SectionCard, SplitView, DetailPanel, FilterBar, DataTable, MetricCard, ColumnsMenu,
} from './shell';
import type { DataTableColumn, FilterChip } from './shell';
import { Button, Badge, ActionsMenu, Sheet, useToast, useConfirm } from './ui';
import type { ActionMenuItem } from './ui';
import { CallAPI } from './UIHelper';
import { useFadeInOnMount } from '../hooks/useFadeInOnMount';
import { useColumnVisibility } from '../hooks/useColumnVisibility';
import { openDataUrlInNewTab } from '../lib/utils';
import { formatDateTime } from '../utils/date';
import { debounce } from 'lodash';

const PAGE_SIZE = 20;

const SORT_OPTIONS: SortOption[] = [
  { value: 'name', label: 'Name' },
  { value: 'code', label: 'Code' },
  { value: 'stock', label: 'Stock Qty' },
  { value: 'restock', label: 'Restock Urgency' },
  { value: 'latestPurchase', label: 'Latest Purchase Date' },
  { value: 'oldestPurchase', label: 'Oldest Purchase Date' },
  { value: 'createdAt', label: 'Created Date' },
  { value: 'updatedAt', label: 'Modified Date' },
];

const MATERIAL_TYPE_LABEL: Record<MaterialType, string> = {
  RAW_MATERIAL: 'Raw Material',
  CONSUMABLE_MATERIAL: 'Consumable Material',
  CUSTOMER_STOCK: 'Customer Stock',
};

interface MaterialViewProps {
  // Cross-tab drill-in: passed through to the detail panel's inventory list
  // links so they can jump to the Purchases tab. fromMaterialId lets
  // the destination detail page's Back button return here instead of its list.
  onViewPurchaseOrder?: (purchaseHeaderId: string, fromMaterialId?: string) => void;
  // Cross-tab drill-in: same as above but for rows where this material was
  // consumed in production against a sales order — jumps to the Orders tab.
  onViewSalesOrder?: (salesHeaderId: string, fromProductId?: string, fromMaterialId?: string) => void;
  // Cross-tab drill-in: Usage History's employee link jumps to the Employees tab.
  onViewEmployee?: (employeeId: string, fromMaterialId?: string) => void;
  // Cross-tab return trip: reselects this material's detail panel after a
  // PurchaseOrderDetailView opened from here navigates back. Since switching
  // App.tsx tabs unmounts this view, local selectedMaterial state can't
  // survive the round trip on its own.
  initialMaterialId?: string | null;
  onInitialMaterialHandled?: () => void;
}

/**
 * Material catalog: Split Workspace layout — filterable/sortable table on
 * the left, a persistent detail panel for the selected row on the right.
 * Create/edit happens in a tabbed slide-over drawer instead of a modal so
 * the list and detail stay visible underneath.
 */
export default function MaterialView({ onViewPurchaseOrder, onViewSalesOrder, onViewEmployee, initialMaterialId, onInitialMaterialHandled }: MaterialViewProps = {}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [searchQuery, setSearchQuery] = useState('');
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const tableScrollRef = useRef<HTMLDivElement>(null);

  // ─── Material categories + a full unpaginated snapshot (for the category
  // quick-filter chips and the "Low Stock" smart chip — both resolve to a
  // set of ids fed into the same p_ids param getMaterialsPage already takes
  // for the advanced filter dialog, so no new RPC/schema is needed) ────────
  const [materialCategories, setMaterialCategories] = useState<MaterialCategory[]>([]);
  const [allMaterials, setAllMaterials] = useState<Material[]>([]);
  useEffect(() => {
    CallAPI(getMaterialCategories, { onCompleted: setMaterialCategories, onError: console.error });
    CallAPI(() => getMaterials(''), { onCompleted: setAllMaterials, onError: console.error });
  }, []);
  const materialCategoryMap = useMemo(
    () => new Map(materialCategories.map(c => [c.id, c.name])),
    [materialCategories]
  );

  // ─── Advanced filter dialog (tick specific materials by name/code) ───────
  const [appliedMaterialIds, setAppliedMaterialIds] = useState<string[]>([]);
  const [showFilterDialog, setShowFilterDialog] = useState(false);
  const [filterDraftIds, setFilterDraftIds] = useState<string[]>([]);
  const [filterSearchQuery, setFilterSearchQuery] = useState('');
  const [filterOptions, setFilterOptions] = useState<Material[]>([]);
  const [filterOptionsLoading, setFilterOptionsLoading] = useState(false);

  // ─── Quick chips: category + low stock ───────────────────────────────────
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [lowStockOnly, setLowStockOnly] = useState(false);

  const categoryMaterialIds = useMemo(
    () => (categoryFilter ? allMaterials.filter(m => m.materialCategoryId === categoryFilter).map(m => m.id) : null),
    [categoryFilter, allMaterials]
  );
  const lowStockMaterialIds = useMemo(
    () => (lowStockOnly ? allMaterials.filter(m => m.quantity < m.minimumStock).map(m => m.id) : null),
    [lowStockOnly, allMaterials]
  );

  // Every active id-based filter (advanced picker, category chip, low-stock
  // chip) is intersected client-side, then handed to getMaterialsPage as a
  // single p_ids array.
  const effectiveMaterialIds = useMemo(() => {
    const idSets = [appliedMaterialIds.length > 0 ? appliedMaterialIds : null, categoryMaterialIds, lowStockMaterialIds].filter(
      (s): s is string[] => s !== null
    );
    if (idSets.length === 0) return undefined;
    const [first, ...rest] = idSets;
    return rest.reduce((acc, ids) => { const set = new Set(ids); return acc.filter(id => set.has(id)); }, first);
  }, [appliedMaterialIds, categoryMaterialIds, lowStockMaterialIds]);

  // ─── Sort ─────────────────────────────────────────────────────────────
  const [sortField, setSortField] = useState<MaterialSortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const changeSort = (field: string, dir: SortDir) => { setSortField(field as MaterialSortField); setSortDir(dir); };
  const toggleColumnSort = (key: string) => {
    changeSort(key, key === sortField ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc');
  };

  const loadMaterials = useCallback((nextOffset: number, append: boolean, search: string) => {
    const setBusy = append ? setLoadingMore : setLoading;
    setBusy(true);

    CallAPI(
      () => getMaterialsPage({ search, materialIds: effectiveMaterialIds, sortField, sortDir, offset: nextOffset, limit: PAGE_SIZE }),
      {
        onCompleted: ({ rows, hasMore: more }) => {
          setMaterials(prev => (append ? [...prev, ...rows] : rows));
          setHasMore(more);
          setOffset(nextOffset + rows.length);
          setBusy(false);
        },
        onError: (err) => { console.error(err); setBusy(false); },
      }
    );
  }, [effectiveMaterialIds, sortField, sortDir]);

  useEffect(() => { loadMaterials(0, false, searchQuery); }, []);

  // Filters or sort changing both restart from page 1
  useEffect(() => {
    loadMaterials(0, false, searchQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveMaterialIds, sortField, sortDir]);

  const search = useMemo(
    () => debounce((text: string) => loadMaterials(0, false, text), 500),
    [loadMaterials]
  );

  const handleLoadMore = () => {
    if (loadingMore || !hasMore) return;
    loadMaterials(offset, true, searchQuery);
  };

  const loadFilterOptions = useMemo(
    () =>
      debounce((query: string) => {
        setFilterOptionsLoading(true);
        CallAPI(() => getMaterials(query), {
          onCompleted: (data) => { setFilterOptions(data); setFilterOptionsLoading(false); },
          onError: (err) => { console.error(err); setFilterOptionsLoading(false); },
        });
      }, 300),
    []
  );

  const openFilterDialog = () => {
    setFilterDraftIds(appliedMaterialIds);
    setFilterSearchQuery('');
    setFilterOptions([]);
    setShowFilterDialog(true);
    loadFilterOptions('');
  };
  const toggleFilterDraftId = (id: string) => {
    setFilterDraftIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const filterChips: FilterChip[] = [
    ...(categoryFilter ? [{ key: 'category', label: `Category: ${materialCategoryMap.get(categoryFilter) || ''}`, onRemove: () => setCategoryFilter('') }] : []),
    ...(lowStockOnly ? [{ key: 'lowstock', label: 'Low stock only', onRemove: () => setLowStockOnly(false) }] : []),
    ...(appliedMaterialIds.length > 0 ? [{ key: 'picked', label: `${appliedMaterialIds.length} material${appliedMaterialIds.length === 1 ? '' : 's'} picked`, onRemove: () => setAppliedMaterialIds([]) }] : []),
  ];

  // ─── Selected row -> detail panel ────────────────────────────────────────
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null);
  const [purchaseHistory, setPurchaseHistory] = useState<InventoryListItem[]>([]);
  const [purchaseHistoryLoading, setPurchaseHistoryLoading] = useState(false);

  useEffect(() => {
    if (!selectedMaterial) { setPurchaseHistory([]); return; }
    setPurchaseHistoryLoading(true);
    CallAPI(() => getMaterialInventoryList(selectedMaterial.id), {
      onCompleted: (data) => { setPurchaseHistory(data); setPurchaseHistoryLoading(false); },
      onError: (err) => { console.error(err); setPurchaseHistoryLoading(false); },
    });
  }, [selectedMaterial?.id]);

  // Cross-tab return trip: re-fetch and reselect the material this view was
  // last showing before a drill-in navigated away to another tab.
  useEffect(() => {
    if (!initialMaterialId) return;
    CallAPI(() => getMaterialById(initialMaterialId), {
      onCompleted: (material) => {
        if (material) setSelectedMaterial(material);
        onInitialMaterialHandled?.();
      },
      onError: (err) => { console.error(err); onInitialMaterialHandled?.(); },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMaterialId]);

  // ─── Material create/edit slide-over ─────────────────────────────────────
  const [showMaterialForm, setShowMaterialForm] = useState(false);
  const [editMaterialId, setEditMaterialId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [materialType, setMaterialType] = useState<MaterialType>('RAW_MATERIAL');
  const [consumptionMode, setConsumptionMode] = useState<ConsumptionMode>('AUTOMATIC');
  const [dimension, setDimension] = useState('');
  const [materialCategoryId, setMaterialCategoryId] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [minimumStock, setMinimumStock] = useState(0);
  const [description, setDescription] = useState('');
  const [attachment, setAttachment] = useState<Attachment | undefined>(undefined);
  const [editQuantity, setEditQuantity] = useState(0);
  const formRef = useFadeInOnMount<HTMLDivElement>([showMaterialForm], { duration: 0.7, stagger: 0.18, y: 16 });

  const resetForm = () => {
    setEditMaterialId(null);
    setName('');
    setCode('');
    setMaterialType('RAW_MATERIAL');
    setConsumptionMode('AUTOMATIC');
    setDimension('');
    setMaterialCategoryId('');
    setStatus('ACTIVE');
    setMinimumStock(0);
    setDescription('');
    setAttachment(undefined);
    setEditQuantity(0);
  };

  const openAddMaterial = () => {
    resetForm();
    setShowMaterialForm(true);
  };

  const openEditMaterial = (item: Material, { duplicate = false }: { duplicate?: boolean } = {}) => {
    setEditMaterialId(duplicate ? null : item.id);
    setName(duplicate ? `${item.name} (Copy)` : item.name);
    setCode(duplicate ? '' : (item.code || ''));
    setMaterialType(item.materialType || 'RAW_MATERIAL');
    setConsumptionMode(item.consumptionMode || 'AUTOMATIC');
    setDimension(item.dimension || '');
    setMaterialCategoryId(item.materialCategoryId || '');
    setStatus(duplicate ? 'ACTIVE' : (item.status || 'ACTIVE'));
    setMinimumStock(item.minimumStock);
    setDescription(item.description || '');
    setAttachment(duplicate ? undefined : item.attachments?.[0]);
    setEditQuantity(duplicate ? 0 : item.quantity);
    setShowMaterialForm(true);
  };

  const refreshAfterMutation = () => {
    loadMaterials(0, false, searchQuery);
    CallAPI(() => getMaterials(''), { onCompleted: setAllMaterials, onError: console.error });
  };

  const handleSaveMaterial = async () => {
    if (!name.trim()) return;

    const record: Material = {
      id: editMaterialId || generateId(),
      name: name.trim(),
      code,
      materialType,
      consumptionMode: materialType === 'CONSUMABLE_MATERIAL' ? consumptionMode : undefined,
      dimension,
      quantity: editQuantity,
      description,
      attachments: attachment ? [attachment] : [],
      status,
      minimumStock,
      materialCategoryId: materialCategoryId || undefined,
    };

    await CallAPI(() => saveMaterial(record), {
      onCompleted: () => {
        refreshAfterMutation();
        toast.success(editMaterialId ? 'Material updated.' : 'Material added.');
        if (selectedMaterial?.id === record.id) setSelectedMaterial(record);
      },
      onError: (err) => { console.error(err); toast.error('Failed to save material.'); },
    });

    resetForm();
    setShowMaterialForm(false);
  };

  const handleDeleteMaterial = async (item: Material) => {
    if (!(await confirm(`Delete ${item.name}? This cannot be undone.`))) return;

    await CallAPI(() => deleteMaterial(item.id), {
      onCompleted: () => {
        refreshAfterMutation();
        toast.success(`${item.name} deleted.`);
        if (selectedMaterial?.id === item.id) setSelectedMaterial(null);
      },
      onError: (err) => { console.error(err); toast.error('Failed to delete material.'); },
    });
  };

  const handleToggleArchive = async (item: Material) => {
    const nextStatus = item.status === 'INACTIVE' ? 'ACTIVE' : 'INACTIVE';
    await CallAPI(() => saveMaterial({ ...item, status: nextStatus }), {
      onCompleted: () => {
        refreshAfterMutation();
        toast.success(nextStatus === 'INACTIVE' ? `${item.name} archived.` : `${item.name} restored.`);
        if (selectedMaterial?.id === item.id) setSelectedMaterial({ ...item, status: nextStatus });
      },
      onError: (err) => { console.error(err); toast.error('Failed to update material.'); },
    });
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedKeys);
    if (ids.length === 0) return;
    if (!(await confirm(`Delete ${ids.length} selected material${ids.length === 1 ? '' : 's'}? This cannot be undone.`))) return;

    await CallAPI(() => Promise.all(ids.map(id => deleteMaterial(id))), {
      onCompleted: () => {
        refreshAfterMutation();
        toast.success(`${ids.length} material${ids.length === 1 ? '' : 's'} deleted.`);
        if (selectedMaterial && ids.includes(selectedMaterial.id)) setSelectedMaterial(null);
        setSelectedKeys(new Set());
      },
      onError: (err) => { console.error(err); toast.error('Failed to delete selected materials.'); },
    });
  };

  const buildActionItems = (item: Material, includeEdit: boolean): ActionMenuItem[] => [
    ...(includeEdit ? [{ label: 'Edit', icon: <Edit className="w-3.5 h-3.5" />, onClick: () => openEditMaterial(item) }] : []),
    { label: 'Duplicate', icon: <Copy className="w-3.5 h-3.5" />, onClick: () => openEditMaterial(item, { duplicate: true }) },
    item.status === 'INACTIVE'
      ? { label: 'Restore', icon: <ArchiveRestore className="w-3.5 h-3.5" />, onClick: () => handleToggleArchive(item) }
      : { label: 'Archive', icon: <Archive className="w-3.5 h-3.5" />, onClick: () => handleToggleArchive(item) },
    { label: 'Delete', icon: <Trash2 className="w-3.5 h-3.5" />, onClick: () => handleDeleteMaterial(item), danger: true },
  ];

  // ─── Table columns ────────────────────────────────────────────────────────
  const showPurchaseDateColumn = sortField === 'latestPurchase' || sortField === 'oldestPurchase';
  const columns: DataTableColumn<Material>[] = [
    {
      key: 'name', header: 'Material', sortable: true, className: 'w-48',
      render: (m) => (
        <div className="max-w-[220px]">
          <div className="font-medium text-card-foreground truncate">{m.name}</div>
          {m.code && <div className="text-[11px] font-mono text-muted-foreground truncate">{m.code}</div>}
        </div>
      ),
    },
    {
      key: 'category', header: 'Category', className: 'w-32',
      render: (m) => <span className="block max-w-[120px] truncate">{m.materialCategoryId ? (materialCategoryMap.get(m.materialCategoryId) || '—') : '—'}</span>,
    },
    {
      key: 'stock', header: 'Stock', sortable: true, align: 'right', className: 'w-28',
      render: (m) => (
        <span className={`inline-flex items-center gap-1 whitespace-nowrap ${m.quantity < m.minimumStock ? 'text-destructive font-medium' : ''}`}>
          {m.quantity < m.minimumStock && <AlertTriangle className="w-3 h-3 shrink-0" />}
          {m.quantity}
          <span className="text-muted-foreground">/ {m.minimumStock}</span>
        </span>
      ),
    },
    ...(showPurchaseDateColumn ? [{
      key: 'purchaseDate', header: sortField === 'latestPurchase' ? 'Last Purchased' : 'First Purchased', className: 'w-28',
      render: (m: Material) => (sortField === 'latestPurchase' ? m.latestPurchaseDate : m.oldestPurchaseDate) || '—',
    }] : []),
    {
      key: 'status', header: 'Status', className: 'w-[1%] whitespace-nowrap',
      render: (m) => <Badge variant={m.status === 'INACTIVE' ? 'secondary' : 'success'}>{m.status || 'ACTIVE'}</Badge>,
    },
    { key: 'createdAt', header: 'Created', sortable: true, className: 'w-32', render: (m) => <span className="text-muted-foreground font-mono text-[11px]">{formatDateTime(m.createdAt)}</span> },
    { key: 'updatedAt', header: 'Modified', sortable: true, className: 'w-32', render: (m) => <span className="text-muted-foreground font-mono text-[11px]">{formatDateTime(m.updatedAt)}</span> },
  ];

  const { hidden: hiddenColumns, toggle: toggleColumn, reset: resetColumns } = useColumnVisibility('columns:materials');
  const visibleColumns = columns.filter(c => !hiddenColumns.has(c.key));

  const belowMinimum = selectedMaterial ? selectedMaterial.quantity < selectedMaterial.minimumStock : false;
  const selectedCategoryName = selectedMaterial?.materialCategoryId ? materialCategoryMap.get(selectedMaterial.materialCategoryId) : undefined;

  return (
    <div className="flex flex-col gap-4 sm:gap-5 min-[1440px]:h-full min-[1440px]:min-h-0" id="material-view">
      <PageHeader
        title="Material Catalog"
        description="Search, filter, and manage every raw material, consumable, and customer-supplied stock item."
        actions={<Button onClick={openAddMaterial}><Plus className="w-4 h-4" />Add Material</Button>}
      />

      {/* Filter dialog (advanced: tick specific materials by name/code) */}
      <FilterDialog
        open={showFilterDialog}
        onClose={() => setShowFilterDialog(false)}
        title="Filter Materials"
        sections={[{
          type: 'checklist',
          key: 'materials',
          label: 'Materials',
          searchPlaceholder: 'Search by name or code...',
          searchQuery: filterSearchQuery,
          onSearchChange: (q) => { setFilterSearchQuery(q); loadFilterOptions(q); },
          items: filterOptions.map(m => ({ id: m.id, label: m.name, sublabel: m.code })),
          loading: filterOptionsLoading,
          selectedIds: filterDraftIds,
          onToggle: toggleFilterDraftId,
        }]}
        onApply={() => setAppliedMaterialIds(filterDraftIds)}
        onClear={() => { setFilterDraftIds([]); setAppliedMaterialIds([]); }}
      />

      {/* Edit/create slide-over drawer — every field listed flat (no tabs):
          history is read-only and stays in the detail panel, since it can't
          be created or edited from this form. */}
      <Sheet
        open={showMaterialForm}
        onClose={() => setShowMaterialForm(false)}
        title={editMaterialId ? 'Edit Material' : 'Add Material'}
        description={editMaterialId ? code || undefined : 'Create a new catalog item'}
        width="w-full sm:max-w-xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setShowMaterialForm(false)}>Cancel</Button>
            <Button onClick={handleSaveMaterial}>{editMaterialId ? 'Save Changes' : 'Add Material'}</Button>
          </div>
        }
      >
        <div ref={formRef} className="p-5 space-y-6">
          <div data-fade-item>
            <MaterialFormFields
              section="general"
              name={name} setName={setName}
              code={code} setCode={setCode}
              materialType={materialType} setMaterialType={setMaterialType}
              consumptionMode={consumptionMode} setConsumptionMode={setConsumptionMode}
              dimension={dimension} setDimension={setDimension}
              materialCategoryId={materialCategoryId} setMaterialCategoryId={setMaterialCategoryId}
              materialCategories={materialCategories}
              status={status} setStatus={setStatus}
              minimumStock={minimumStock} setMinimumStock={setMinimumStock}
              description={description} setDescription={setDescription}
              attachment={attachment} setAttachment={setAttachment}
            />
          </div>

          <div data-fade-item className="pt-6 border-t border-border space-y-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Inventory</h4>
            {editMaterialId && (
              <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-secondary/50">
                <MetricCard label="Current Stock" value={editQuantity} />
                <MetricCard label="Stock Health" value={editQuantity < minimumStock ? 'Below minimum' : 'Healthy'} />
              </div>
            )}
            <MaterialFormFields
              section="inventory"
              name={name} setName={setName}
              code={code} setCode={setCode}
              materialType={materialType} setMaterialType={setMaterialType}
              consumptionMode={consumptionMode} setConsumptionMode={setConsumptionMode}
              dimension={dimension} setDimension={setDimension}
              materialCategoryId={materialCategoryId} setMaterialCategoryId={setMaterialCategoryId}
              materialCategories={materialCategories}
              status={status} setStatus={setStatus}
              minimumStock={minimumStock} setMinimumStock={setMinimumStock}
              description={description} setDescription={setDescription}
              attachment={attachment} setAttachment={setAttachment}
            />
          </div>

          <div data-fade-item className="pt-6 border-t border-border space-y-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Attachment</h4>
            <MaterialFormFields
              section="attachment"
              name={name} setName={setName}
              code={code} setCode={setCode}
              materialType={materialType} setMaterialType={setMaterialType}
              consumptionMode={consumptionMode} setConsumptionMode={setConsumptionMode}
              dimension={dimension} setDimension={setDimension}
              materialCategoryId={materialCategoryId} setMaterialCategoryId={setMaterialCategoryId}
              materialCategories={materialCategories}
              status={status} setStatus={setStatus}
              minimumStock={minimumStock} setMinimumStock={setMinimumStock}
              description={description} setDescription={setDescription}
              attachment={attachment} setAttachment={setAttachment}
            />
          </div>
        </div>
      </Sheet>

      <SplitView
        leftWidth="min-[1440px]:w-[45%]"
        leftClassName="h-[560px] min-[1440px]:h-auto"
        rightClassName="h-[480px] min-[1440px]:h-auto"
        left={
          <SectionCard
            title="Materials"
            description={`${materials.length} loaded${hasMore ? '+' : ''}`}
            contentClassName="p-0 flex-1 min-h-0 flex flex-col"
            className="flex-1 min-h-0"
          >
            <div className="p-5 border-b border-border space-y-4 shrink-0">
              <FilterBar
                search={searchQuery}
                onSearchChange={(v) => { setSearchQuery(v); search(v); }}
                searchPlaceholder="Search materials..."
                chips={filterChips}
                onOpenFilters={openFilterDialog}
                filterCount={appliedMaterialIds.length}
                selectedCount={selectedKeys.size}
                bulkActions={
                  <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
                    <Trash2 className="w-3.5 h-3.5" /> Delete {selectedKeys.size}
                  </Button>
                }
                right={
                  <>
                    <SortMenu options={SORT_OPTIONS} sortField={sortField} sortDir={sortDir} onChange={changeSort} />
                    <ColumnsMenu columns={columns.map(c => ({ key: c.key, label: String(c.header) }))} hidden={hiddenColumns} onToggle={toggleColumn} onSelectAll={resetColumns} />
                  </>
                }
              />
              <div className="flex items-center gap-2 flex-wrap">
                {materialCategories.filter(c => c.is_active).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCategoryFilter(prev => (prev === c.id ? '' : c.id))}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${categoryFilter === c.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary/50 text-secondary-foreground border-transparent hover:bg-secondary'}`}
                  >
                    {c.name}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setLowStockOnly(v => !v)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${lowStockOnly ? 'bg-destructive text-destructive-foreground border-destructive' : 'bg-secondary/50 text-secondary-foreground border-transparent hover:bg-secondary'}`}
                >
                  <AlertTriangle className="w-3 h-3" /> Low Stock
                </button>
              </div>
            </div>

            <div ref={tableScrollRef} className="flex-1 min-h-0 overflow-auto">
              <DataTable
                columns={visibleColumns}
                rows={materials}
                rowKey={(m) => m.id}
                sortField={sortField}
                sortDir={sortDir}
                onSort={toggleColumnSort}
                selectable
                selectedKeys={selectedKeys}
                onToggleSelect={(key) => setSelectedKeys(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; })}
                onToggleSelectAll={() => setSelectedKeys(prev => (prev.size === materials.length ? new Set() : new Set(materials.map(m => m.id))))}
                onRowClick={(m) => setSelectedMaterial(m)}
                activeKey={selectedMaterial?.id}
                rowActions={(m) => <ActionsMenu items={buildActionItems(m, true)} />}
                loading={loading}
                emptyState="No materials found matching your filters."
              />
              <InfiniteScrollSentinel onLoadMore={handleLoadMore} hasMore={hasMore} loading={loadingMore} rootRef={tableScrollRef} />
            </div>
          </SectionCard>
        }
        right={
          <DetailPanel
            title={selectedMaterial?.name}
            subtitle={selectedMaterial ? [selectedMaterial.code, selectedCategoryName, selectedMaterial.materialType && MATERIAL_TYPE_LABEL[selectedMaterial.materialType]].filter(Boolean).join(' • ') : undefined}
            badges={selectedMaterial && (
              <>
                <Badge variant={selectedMaterial.status === 'INACTIVE' ? 'secondary' : 'success'}>{selectedMaterial.status || 'ACTIVE'}</Badge>
                {belowMinimum && <Badge variant="destructive">Below Minimum</Badge>}
              </>
            )}
            actions={selectedMaterial && (
              <>
                <Button variant="outline" size="sm" onClick={() => openEditMaterial(selectedMaterial)}>
                  <Edit className="w-3.5 h-3.5" /> Edit
                </Button>
                <ActionsMenu items={buildActionItems(selectedMaterial, false)} />
              </>
            )}
            emptyState={!selectedMaterial && (
              <div className="text-center py-12 text-muted-foreground">
                <Boxes className="w-8 h-8 mx-auto mb-3 opacity-40" />
                <p className="text-xs">Select a material from the list to see its full profile.</p>
              </div>
            )}
          >
            {selectedMaterial && (
              <>
                {selectedMaterial.attachments?.[0] && (
                  selectedMaterial.attachments[0].type.startsWith('image/') ? (
                    <img
                      src={selectedMaterial.attachments[0].dataUrl}
                      alt={selectedMaterial.attachments[0].name}
                      onClick={() => openDataUrlInNewTab(selectedMaterial.attachments![0].dataUrl)}
                      className="max-h-48 max-w-full rounded-xl border border-border object-cover hover:opacity-90 transition-opacity cursor-pointer"
                    />
                  ) : (
                    <a
                      href={selectedMaterial.attachments[0].dataUrl}
                      download={selectedMaterial.attachments[0].name}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 hover:bg-primary/15 text-primary rounded-lg text-xs font-medium transition-colors"
                    >
                      <Paperclip className="w-3.5 h-3.5" />
                      <span className="truncate max-w-[220px]">{selectedMaterial.attachments[0].name}</span>
                    </a>
                  )
                )}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <MetricCard label="Stock" value={selectedMaterial.quantity} />
                  <MetricCard label="Minimum Stock" value={selectedMaterial.minimumStock} />
                  <MetricCard label="Dimension" value={selectedMaterial.dimension || '—'} />
                  <MetricCard label="Description" value={selectedMaterial.description || '—'} />
                </div>
                <div className="pt-2 border-t border-border space-y-3">
                  <div className="flex items-center gap-2">
                    <ShoppingBag className="w-4 h-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold text-card-foreground">Inventory List</h3>
                  </div>
                  <InventoryHistoryTable
                    items={purchaseHistory}
                    loading={purchaseHistoryLoading}
                    onViewPurchaseOrder={onViewPurchaseOrder ? (id) => onViewPurchaseOrder(id, selectedMaterial.id) : undefined}
                    onViewSalesOrder={onViewSalesOrder ? (id) => onViewSalesOrder(id, undefined, selectedMaterial.id) : undefined}
                    showEmployee
                    onViewEmployee={onViewEmployee ? (id) => onViewEmployee(id, selectedMaterial.id) : undefined}
                  />
                </div>
              </>
            )}
          </DetailPanel>
        }
      />
    </div>
  );
}
