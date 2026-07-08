/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  getMaterials, getMaterialsPage, saveMaterial, deleteMaterial, generateId, getMaterialCategories, getMaterialById,
  MaterialSortField, SortDir
} from '../services/MaterialService';
import { Material, MaterialCategory, MaterialType, Attachment } from '../types';
import { Plus, Paperclip, Edit, Trash2, ChevronRight, FileText, Boxes, AlertTriangle, Filter, CalendarClock } from 'lucide-react';
import LoadingSpinner from './LoadingSpinner';
import MaterialFormFields from './MaterialFormFields';
import MaterialDetailView from './MaterialDetailView';
import FilterDialog from './FilterDialog';
import SortMenu, { SortOption } from './SortMenu';
import InfiniteScrollSentinel from './InfiniteScrollSentinel';
import { Dialog, DialogFooter, DialogCancelButton, DialogSubmitButton, Card, SearchInput, useToast, useConfirm } from './ui';
import { CallAPI } from './UIHelper';
import { debounce } from 'lodash'

const PAGE_SIZE = 24;

const SORT_OPTIONS: SortOption[] = [
  { value: 'name', label: 'Name' },
  { value: 'code', label: 'Code' },
  { value: 'stock', label: 'Stock Qty' },
  { value: 'restock', label: 'Restock Urgency' },
  { value: 'latestPurchase', label: 'Latest Purchase Date' },
  { value: 'oldestPurchase', label: 'Oldest Purchase Date' },
];

interface MaterialViewProps {
  // Cross-tab drill-in: passed through to MaterialDetailView's inventory list
  // links so they can jump to the Purchases tab. fromMaterialId lets
  // the destination detail page's Back button return here instead of its list.
  onViewPurchaseOrder?: (purchaseHeaderId: string, fromMaterialId?: string) => void;
  // Cross-tab drill-in: same as above but for rows where this material was
  // consumed in production against a sales order — jumps to the Orders tab.
  onViewSalesOrder?: (salesHeaderId: string, fromProductId?: string, fromMaterialId?: string) => void;
  // Cross-tab return trip: reopens this material's detail page after a
  // PurchaseOrderDetailView opened from here navigates back. Since switching
  // App.tsx tabs unmounts this view, local selectedMaterial state can't
  // survive the round trip on its own.
  initialMaterialId?: string | null;
  onInitialMaterialHandled?: () => void;
}

/**
 * Material catalog listing: search, create/edit/delete, and the entry point
 * into MaterialDetailView (material summary + purchase history).
 */
export default function MaterialView({ onViewPurchaseOrder, onViewSalesOrder, initialMaterialId, onInitialMaterialHandled }: MaterialViewProps = {}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [searchQuery, setSearchQuery] = useState('');
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  // ─── Filter dialog: search by name/code keyword, tick multiple materials ──
  const [appliedMaterialIds, setAppliedMaterialIds] = useState<string[]>([]);
  const [showFilterDialog, setShowFilterDialog] = useState(false);
  const [filterDraftIds, setFilterDraftIds] = useState<string[]>([]);
  const [filterSearchQuery, setFilterSearchQuery] = useState('');
  const [filterOptions, setFilterOptions] = useState<Material[]>([]);
  const [filterOptionsLoading, setFilterOptionsLoading] = useState(false);

  // ─── Sort ─────────────────────────────────────────────────────────────
  const [sortField, setSortField] = useState<MaterialSortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const loadMaterials = useCallback((nextOffset: number, append: boolean, search: string) => {
    const setBusy = append ? setLoadingMore : setLoading;
    setBusy(true);

    CallAPI(
      () => getMaterialsPage({ search, materialIds: appliedMaterialIds, sortField, sortDir, offset: nextOffset, limit: PAGE_SIZE }),
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
  }, [appliedMaterialIds, sortField, sortDir]);

  useEffect(() => { loadMaterials(0, false, searchQuery); }, []);

  // Filters or sort changing both restart from page 1
  useEffect(() => {
    loadMaterials(0, false, searchQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedMaterialIds, sortField, sortDir]);

  const search = useMemo(
    () =>
      debounce((text: string) => {
        loadMaterials(0, false, text);
      }, 500),
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

  const hasActiveFilters = appliedMaterialIds.length > 0;

  // ─── Material categories (reference data for the form) ──────────────────
  const [materialCategories, setMaterialCategories] = useState<MaterialCategory[]>([]);
  useEffect(() => {
    CallAPI(getMaterialCategories, { onCompleted: setMaterialCategories, onError: console.error });
  }, []);
  const materialCategoryMap = useMemo(
    () => new Map(materialCategories.map(c => [c.id, c.name])),
    [materialCategories]
  );

  // Drill-down: selected material (shows MaterialDetailView instead of the grid)
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null);

  // Cross-tab return trip: re-fetch and reopen the material this view was
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

  // ─── Material create/edit form ───────────────────────────────────────────
  const [showMaterialForm, setShowMaterialForm] = useState(false);
  const [editMaterialId, setEditMaterialId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [materialType, setMaterialType] = useState<MaterialType>('RAW_MATERIAL');
  const [dimension, setDimension] = useState('');
  const [materialCategoryId, setMaterialCategoryId] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [minimumStock, setMinimumStock] = useState(0);
  const [reorderQuantity, setReorderQuantity] = useState(0);
  const [description, setDescription] = useState('');
  const [attachment, setAttachment] = useState<Attachment | undefined>(undefined);

  const resetForm = () => {
    setEditMaterialId(null);
    setName('');
    setCode('');
    setMaterialType('RAW_MATERIAL');
    setDimension('');
    setMaterialCategoryId('');
    setStatus('ACTIVE');
    setMinimumStock(0);
    setReorderQuantity(0);
    setDescription('');
    setAttachment(undefined);
  };

  const openAddMaterial = () => {
    resetForm();
    setShowMaterialForm(true);
  };

  const openEditMaterial = (item: Material) => {
    setEditMaterialId(item.id);
    setName(item.name);
    setCode(item.code || '');
    setMaterialType(item.materialType || 'RAW_MATERIAL');
    setDimension(item.dimension || '');
    setMaterialCategoryId(item.materialCategoryId || '');
    setStatus(item.status || 'ACTIVE');
    setMinimumStock(item.minimumStock);
    setReorderQuantity(item.reorderQuantity);
    setDescription(item.description || '');
    setAttachment(item.attachments?.[0]);
    setShowMaterialForm(true);
  };

  const handleSaveMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const record: Material = {
      id: editMaterialId || generateId(),
      name: name.trim(),
      code,
      materialType,
      dimension,
      quantity: materials.find(m => m.id === editMaterialId)?.quantity ?? 0,
      description,
      attachments: attachment ? [attachment] : [],
      status,
      minimumStock,
      reorderQuantity,
      materialCategoryId: materialCategoryId || undefined,
    };

    await CallAPI(() => saveMaterial(record), {
      onCompleted: () => { loadMaterials(0, false, searchQuery); toast.success(editMaterialId ? 'Material updated.' : 'Material added.'); },
      onError: (err) => { console.error(err); toast.error('Failed to save material.'); },
    });

    resetForm();
    setShowMaterialForm(false);
  };

  const handleDeleteMaterial = async (item: Material) => {
    if (!(await confirm(`Delete ${item.name}? This cannot be undone.`))) return;

    await CallAPI(() => deleteMaterial(item.id), {
      onCompleted: () => { loadMaterials(0, false, searchQuery); toast.success(`${item.name} deleted.`); },
      onError: (err) => { console.error(err); toast.error('Failed to delete material.'); },
    });
  };

  // ─── Drill-down detail page ───────────────────────────────────────────────
  if (selectedMaterial) {
    return (
      <MaterialDetailView
        material={selectedMaterial}
        onBack={() => { setSelectedMaterial(null); loadMaterials(0, false, searchQuery); }}
        onMaterialUpdated={(updated) => setSelectedMaterial(updated)}
        onMaterialDeleted={() => { setSelectedMaterial(null); loadMaterials(0, false, searchQuery); }}
        onViewPurchaseOrder={(purchaseHeaderId) => onViewPurchaseOrder?.(purchaseHeaderId, selectedMaterial.id)}
        onViewSalesOrder={(salesHeaderId) => onViewSalesOrder?.(salesHeaderId, undefined, selectedMaterial.id)}
      />
    );
  }

  return (
    <div className="space-y-6" id="material-view">
      {loading && <LoadingSpinner message="Retrieving material catalog..." subtitle="MATERIAL_LOAD" />}
      {/* Top Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h3 className="font-sans font-bold text-slate-900 text-sm flex items-center space-x-2">
          <Boxes className="w-4 h-4 text-slate-500" />
          <span>Material Catalog</span>
        </h3>

        <div className="flex items-center space-x-2">
          <SearchInput
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e)
              search(e)
            }}
            placeholder="Search materials..."
            className="relative flex-1 sm:w-64"
          />
          <button
            onClick={openFilterDialog}
            className={`relative flex items-center space-x-1.5 px-3 py-2 border rounded-lg text-xs font-medium transition-colors ${hasActiveFilters ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-600'}`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>Filter</span>
            {hasActiveFilters && <span className="absolute -top-1 -right-1 w-2 h-2 bg-blue-600 rounded-full" />}
          </button>
          <SortMenu options={SORT_OPTIONS} sortField={sortField} sortDir={sortDir} onChange={(f, d) => { setSortField(f as MaterialSortField); setSortDir(d); }} />
          <button
            onClick={openAddMaterial}
            className="flex items-center space-x-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors font-sans shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Add Material</span>
          </button>
        </div>
      </div>

      {/* Filter dialog */}
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

      {/* Creation/Edit form as Dialog Modal */}
      <Dialog
        open={showMaterialForm}
        onClose={() => setShowMaterialForm(false)}
        title={editMaterialId ? 'Edit Material' : 'Add Material'}
      >
        <form onSubmit={handleSaveMaterial} className="p-5 space-y-4">
          <MaterialFormFields
            name={name} setName={setName}
            code={code} setCode={setCode}
            materialType={materialType} setMaterialType={setMaterialType}
            dimension={dimension} setDimension={setDimension}
            materialCategoryId={materialCategoryId} setMaterialCategoryId={setMaterialCategoryId}
            materialCategories={materialCategories}
            status={status} setStatus={setStatus}
            minimumStock={minimumStock} setMinimumStock={setMinimumStock}
            reorderQuantity={reorderQuantity} setReorderQuantity={setReorderQuantity}
            description={description} setDescription={setDescription}
            attachment={attachment} setAttachment={setAttachment}
          />
          <DialogFooter>
            <DialogCancelButton onClick={() => setShowMaterialForm(false)} />
            <DialogSubmitButton>{editMaterialId ? 'Save Material' : 'Add Material'}</DialogSubmitButton>
          </DialogFooter>
        </form>
      </Dialog>

      {/* Material grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {materials.length === 0 ? (
          <Card className="col-span-full text-center py-12 text-xs text-slate-400">
            No materials found matching your query.
          </Card>
        ) : (
          materials.map((material) => (
            <MaterialCard
              key={material.id}
              material={material}
              categoryName={material.materialCategoryId ? materialCategoryMap.get(material.materialCategoryId) : undefined}
              sortField={sortField}
              onOpen={() => setSelectedMaterial(material)}
              onEdit={() => openEditMaterial(material)}
              onDelete={() => handleDeleteMaterial(material)}
            />
          ))
        )}
      </div>
      <InfiniteScrollSentinel onLoadMore={handleLoadMore} hasMore={hasMore} loading={loadingMore} />

    </div>
  );
}

// Material summary card used in the catalog grid
function MaterialCard({
  material, categoryName, sortField, onOpen, onEdit, onDelete
}: {
  material: Material;
  categoryName?: string;
  sortField?: MaterialSortField;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const belowMinimum = material.quantity < material.minimumStock;
  const purchaseDateLabel = sortField === 'latestPurchase'
    ? { label: 'Last purchased:', date: material.latestPurchaseDate }
    : sortField === 'oldestPurchase'
      ? { label: 'First purchased:', date: material.oldestPurchaseDate }
      : null;

  return (
    <Card className="group p-5 hover:shadow-md transition-shadow flex flex-col justify-between space-y-4 cursor-pointer">
      <div className="space-y-2.5" onClick={onOpen}>
        <div className="flex items-start justify-between gap-2">
          <h4 className="font-sans font-semibold text-slate-900 text-sm leading-snug">{material.name}</h4>
          <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors shrink-0" />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {material.code && (
            <span className="px-1.5 py-0.5 bg-slate-50 text-slate-600 border border-slate-200 rounded text-[10px] font-mono">
              {material.code}
            </span>
          )}
          {categoryName && (
            <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-100 rounded text-[10px] font-mono">
              {categoryName}
            </span>
          )}
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${material.status === 'INACTIVE' ? 'bg-slate-50 text-slate-500 border-slate-200' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}`}>
            {material.status || 'ACTIVE'}
          </span>
        </div>

        <div className="space-y-1.5 text-xs text-slate-500">
          {material.dimension && (
            <div className="flex items-center space-x-2">
              <span className="text-slate-400 shrink-0">Dimension:</span>
              <span className="truncate">{material.dimension}</span>
            </div>
          )}
          <div className="flex items-center space-x-2">
            <span className="text-slate-400 shrink-0">Stock:</span>
            <span className={belowMinimum ? 'text-red-600 font-semibold flex items-center gap-1' : ''}>
              {belowMinimum && <AlertTriangle className="w-3 h-3" />}
              {material.quantity} (min {material.minimumStock})
            </span>
          </div>
          {purchaseDateLabel && (
            <div className="flex items-center space-x-2">
              <CalendarClock className="w-3.5 h-3.5 shrink-0 text-slate-400" />
              <span className="text-slate-400 shrink-0">{purchaseDateLabel.label}</span>
              <span>{purchaseDateLabel.date || '—'}</span>
            </div>
          )}
          {material.description && (
            <div className="flex items-start space-x-2">
              <FileText className="w-3.5 h-3.5 shrink-0 text-slate-400 mt-0.5" />
              <span className="line-clamp-2">{material.description}</span>
            </div>
          )}
          {material.attachments?.[0] && (
            <div className="pt-1 flex items-center">
              <a
                href={material.attachments[0].dataUrl}
                download={material.attachments[0].name}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-[10px] font-mono transition-colors"
                title="Download attachment"
              >
                <Paperclip className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                <span className="truncate max-w-[150px]">{material.attachments[0].name}</span>
              </a>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-slate-100 pt-3 flex items-center justify-between text-xs">
        <button
          onClick={onOpen}
          className="flex items-center space-x-1 text-[11px] font-medium text-blue-600 hover:text-blue-800"
        >
          <span>View Inventory List</span>
        </button>

        <div className="flex items-center space-x-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded transition-colors"
            title="Edit"
          >
            <Edit className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded transition-colors"
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </Card>
  );
}
