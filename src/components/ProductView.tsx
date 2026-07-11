/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  getProducts, getProductsPage, saveProduct, deleteProduct, generateId, getProductCategories, getProductById,
  getProductInventoryList, ProductSortField, SortDir
} from '../services/ProductService';
import { Product, ProductCategory, Attachment, InventoryListItem } from '../types';
import { Plus, Edit, Trash2, Copy, Archive, ArchiveRestore, Package, Paperclip, ShoppingBag } from 'lucide-react';
import ProductFormFields from './ProductFormFields';
import FilterDialog from './FilterDialog';
import SortMenu, { SortOption } from './SortMenu';
import InfiniteScrollSentinel from './InfiniteScrollSentinel';
import { InventoryHistoryTable } from './InventoryListShared';
import {
  PageHeader, SectionCard, SplitView, DetailPanel, FilterBar, DataTable, MetricCard,
} from './shell';
import type { DataTableColumn, FilterChip } from './shell';
import { Button, Badge, ActionsMenu, Sheet, useToast, useConfirm } from './ui';
import type { ActionMenuItem } from './ui';
import { CallAPI } from './UIHelper';
import { useFadeInOnMount } from '../hooks/useFadeInOnMount';
import { openDataUrlInNewTab } from '../lib/utils';
import { debounce } from 'lodash';

const PAGE_SIZE = 20;

const SORT_OPTIONS: SortOption[] = [
  { value: 'name', label: 'Name' },
  { value: 'code', label: 'Code' },
  { value: 'stock', label: 'Stock Qty' },
  { value: 'latestSale', label: 'Latest Sale Date' },
  { value: 'oldestSale', label: 'Oldest Sale Date' },
];

interface ProductViewProps {
  // Cross-tab drill-in: passed through to the detail panel's inventory list
  // links so they can jump to the Orders tab. fromProductId lets the
  // destination detail page's Back button return here instead of its list.
  onViewSalesOrder?: (salesHeaderId: string, fromProductId?: string) => void;
  // Cross-tab return trip: reselects this product's detail panel after a
  // SalesOrderDetailView opened from here navigates back. Since switching
  // App.tsx tabs unmounts this view, local selectedProduct state can't
  // survive the round trip on its own.
  initialProductId?: string | null;
  onInitialProductHandled?: () => void;
}

/**
 * Product catalog: Split Workspace layout — filterable/sortable table on the
 * left, a persistent detail panel for the selected row (profile + inventory
 * list) on the right. Create/edit happens in a flat slide-over drawer.
 */
export default function ProductView({ onViewSalesOrder, initialProductId, onInitialProductHandled }: ProductViewProps = {}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [searchQuery, setSearchQuery] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const tableScrollRef = useRef<HTMLDivElement>(null);

  // ─── Product categories + a full unpaginated snapshot (for the category
  // quick-filter chips — resolves to a set of ids fed into the same p_ids
  // param getProductsPage already takes for the advanced filter dialog, so
  // no new RPC/schema is needed) ────────────────────────────────────────────
  const [productCategories, setProductCategories] = useState<ProductCategory[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  useEffect(() => {
    CallAPI(getProductCategories, { onCompleted: setProductCategories, onError: console.error });
    CallAPI(() => getProducts(''), { onCompleted: setAllProducts, onError: console.error });
  }, []);
  const productCategoryMap = useMemo(
    () => new Map(productCategories.map(c => [c.id, c.name])),
    [productCategories]
  );

  // ─── Advanced filter dialog (tick specific products by name/code) ────────
  const [appliedProductIds, setAppliedProductIds] = useState<string[]>([]);
  const [showFilterDialog, setShowFilterDialog] = useState(false);
  const [filterDraftIds, setFilterDraftIds] = useState<string[]>([]);
  const [filterSearchQuery, setFilterSearchQuery] = useState('');
  const [filterOptions, setFilterOptions] = useState<Product[]>([]);
  const [filterOptionsLoading, setFilterOptionsLoading] = useState(false);

  // ─── Quick chip: category ─────────────────────────────────────────────────
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const categoryProductIds = useMemo(
    () => (categoryFilter ? allProducts.filter(p => p.productCategoryId === categoryFilter).map(p => p.id) : null),
    [categoryFilter, allProducts]
  );

  // Every active id-based filter (advanced picker, category chip) is
  // intersected client-side, then handed to getProductsPage as a single
  // p_ids array.
  const effectiveProductIds = useMemo(() => {
    const idSets = [appliedProductIds.length > 0 ? appliedProductIds : null, categoryProductIds].filter(
      (s): s is string[] => s !== null
    );
    if (idSets.length === 0) return undefined;
    const [first, ...rest] = idSets;
    return rest.reduce((acc, ids) => { const set = new Set(ids); return acc.filter(id => set.has(id)); }, first);
  }, [appliedProductIds, categoryProductIds]);

  // ─── Sort ─────────────────────────────────────────────────────────────
  const [sortField, setSortField] = useState<ProductSortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const changeSort = (field: string, dir: SortDir) => { setSortField(field as ProductSortField); setSortDir(dir); };
  const toggleColumnSort = (key: string) => {
    changeSort(key, key === sortField ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc');
  };

  const loadProducts = useCallback((nextOffset: number, append: boolean, search: string) => {
    const setBusy = append ? setLoadingMore : setLoading;
    setBusy(true);

    CallAPI(
      () => getProductsPage({ search, productIds: effectiveProductIds, sortField, sortDir, offset: nextOffset, limit: PAGE_SIZE }),
      {
        onCompleted: ({ rows, hasMore: more }) => {
          setProducts(prev => (append ? [...prev, ...rows] : rows));
          setHasMore(more);
          setOffset(nextOffset + rows.length);
          setBusy(false);
        },
        onError: (err) => { console.error(err); setBusy(false); },
      }
    );
  }, [effectiveProductIds, sortField, sortDir]);

  useEffect(() => { loadProducts(0, false, searchQuery); }, []);

  // Filters or sort changing both restart from page 1
  useEffect(() => {
    loadProducts(0, false, searchQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveProductIds, sortField, sortDir]);

  const search = useMemo(
    () => debounce((text: string) => loadProducts(0, false, text), 500),
    [loadProducts]
  );

  const handleLoadMore = () => {
    if (loadingMore || !hasMore) return;
    loadProducts(offset, true, searchQuery);
  };

  const loadFilterOptions = useMemo(
    () =>
      debounce((query: string) => {
        setFilterOptionsLoading(true);
        CallAPI(() => getProducts(query), {
          onCompleted: (data) => { setFilterOptions(data); setFilterOptionsLoading(false); },
          onError: (err) => { console.error(err); setFilterOptionsLoading(false); },
        });
      }, 300),
    []
  );

  const openFilterDialog = () => {
    setFilterDraftIds(appliedProductIds);
    setFilterSearchQuery('');
    setFilterOptions([]);
    setShowFilterDialog(true);
    loadFilterOptions('');
  };
  const toggleFilterDraftId = (id: string) => {
    setFilterDraftIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const filterChips: FilterChip[] = [
    ...(categoryFilter ? [{ key: 'category', label: `Category: ${productCategoryMap.get(categoryFilter) || ''}`, onRemove: () => setCategoryFilter('') }] : []),
    ...(appliedProductIds.length > 0 ? [{ key: 'picked', label: `${appliedProductIds.length} product${appliedProductIds.length === 1 ? '' : 's'} picked`, onRemove: () => setAppliedProductIds([]) }] : []),
  ];

  // ─── Selected row -> detail panel ────────────────────────────────────────
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [salesHistory, setSalesHistory] = useState<InventoryListItem[]>([]);
  const [salesHistoryLoading, setSalesHistoryLoading] = useState(false);

  useEffect(() => {
    if (!selectedProduct) { setSalesHistory([]); return; }
    setSalesHistoryLoading(true);
    CallAPI(() => getProductInventoryList(selectedProduct.id), {
      onCompleted: (data) => { setSalesHistory(data); setSalesHistoryLoading(false); },
      onError: (err) => { console.error(err); setSalesHistoryLoading(false); },
    });
  }, [selectedProduct?.id]);

  // Cross-tab return trip: re-fetch and reselect the product this view was
  // last showing before a drill-in navigated away to another tab.
  useEffect(() => {
    if (!initialProductId) return;
    CallAPI(() => getProductById(initialProductId), {
      onCompleted: (product) => {
        if (product) setSelectedProduct(product);
        onInitialProductHandled?.();
      },
      onError: (err) => { console.error(err); onInitialProductHandled?.(); },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProductId]);

  // ─── Product create/edit slide-over ──────────────────────────────────────
  const [showProductForm, setShowProductForm] = useState(false);
  const [editProductId, setEditProductId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [dimension, setDimension] = useState('');
  const [productCategoryId, setProductCategoryId] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [sellingPrice, setSellingPrice] = useState(0);
  const [description, setDescription] = useState('');
  const [attachment, setAttachment] = useState<Attachment | undefined>(undefined);
  const formRef = useFadeInOnMount<HTMLDivElement>([showProductForm], { duration: 0.7, stagger: 0.18, y: 16 });

  const resetForm = () => {
    setEditProductId(null);
    setName('');
    setCode('');
    setDimension('');
    setProductCategoryId('');
    setStatus('ACTIVE');
    setSellingPrice(0);
    setDescription('');
    setAttachment(undefined);
  };

  const openAddProduct = () => {
    resetForm();
    setShowProductForm(true);
  };

  const openEditProduct = (item: Product, { duplicate = false }: { duplicate?: boolean } = {}) => {
    setEditProductId(duplicate ? null : item.id);
    setName(duplicate ? `${item.name} (Copy)` : item.name);
    setCode(duplicate ? '' : (item.code || ''));
    setDimension(item.dimension || '');
    setProductCategoryId(item.productCategoryId || '');
    setStatus(duplicate ? 'ACTIVE' : (item.status || 'ACTIVE'));
    setSellingPrice(item.sellingPrice);
    setDescription(item.description || '');
    setAttachment(duplicate ? undefined : item.attachments?.[0]);
    setShowProductForm(true);
  };

  const refreshAfterMutation = () => {
    loadProducts(0, false, searchQuery);
    CallAPI(() => getProducts(''), { onCompleted: setAllProducts, onError: console.error });
  };

  const handleSaveProduct = async () => {
    if (!name.trim()) return;

    const record: Product = {
      id: editProductId || generateId(),
      name: name.trim(),
      code,
      dimension,
      description,
      attachments: attachment ? [attachment] : [],
      status,
      sellingPrice,
      productCategoryId: productCategoryId || undefined,
    };

    await CallAPI(() => saveProduct(record), {
      onCompleted: () => {
        refreshAfterMutation();
        toast.success(editProductId ? 'Product updated.' : 'Product added.');
        if (selectedProduct?.id === record.id) setSelectedProduct({ ...selectedProduct, ...record });
      },
      onError: (err) => { console.error(err); toast.error('Failed to save product.'); },
    });

    resetForm();
    setShowProductForm(false);
  };

  const handleDeleteProduct = async (item: Product) => {
    if (!(await confirm(`Delete ${item.name}? This cannot be undone.`))) return;

    await CallAPI(() => deleteProduct(item.id), {
      onCompleted: () => {
        refreshAfterMutation();
        toast.success(`${item.name} deleted.`);
        if (selectedProduct?.id === item.id) setSelectedProduct(null);
      },
      onError: (err) => { console.error(err); toast.error('Failed to delete product.'); },
    });
  };

  const handleToggleArchive = async (item: Product) => {
    const nextStatus = item.status === 'INACTIVE' ? 'ACTIVE' : 'INACTIVE';
    await CallAPI(() => saveProduct({ ...item, status: nextStatus }), {
      onCompleted: () => {
        refreshAfterMutation();
        toast.success(nextStatus === 'INACTIVE' ? `${item.name} archived.` : `${item.name} restored.`);
        if (selectedProduct?.id === item.id) setSelectedProduct({ ...item, status: nextStatus });
      },
      onError: (err) => { console.error(err); toast.error('Failed to update product.'); },
    });
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedKeys);
    if (ids.length === 0) return;
    if (!(await confirm(`Delete ${ids.length} selected product${ids.length === 1 ? '' : 's'}? This cannot be undone.`))) return;

    await CallAPI(() => Promise.all(ids.map(id => deleteProduct(id))), {
      onCompleted: () => {
        refreshAfterMutation();
        toast.success(`${ids.length} product${ids.length === 1 ? '' : 's'} deleted.`);
        if (selectedProduct && ids.includes(selectedProduct.id)) setSelectedProduct(null);
        setSelectedKeys(new Set());
      },
      onError: (err) => { console.error(err); toast.error('Failed to delete selected products.'); },
    });
  };

  const buildActionItems = (item: Product, includeEdit: boolean): ActionMenuItem[] => [
    ...(includeEdit ? [{ label: 'Edit', icon: <Edit className="w-3.5 h-3.5" />, onClick: () => openEditProduct(item) }] : []),
    { label: 'Duplicate', icon: <Copy className="w-3.5 h-3.5" />, onClick: () => openEditProduct(item, { duplicate: true }) },
    item.status === 'INACTIVE'
      ? { label: 'Restore', icon: <ArchiveRestore className="w-3.5 h-3.5" />, onClick: () => handleToggleArchive(item) }
      : { label: 'Archive', icon: <Archive className="w-3.5 h-3.5" />, onClick: () => handleToggleArchive(item) },
    { label: 'Delete', icon: <Trash2 className="w-3.5 h-3.5" />, onClick: () => handleDeleteProduct(item), danger: true },
  ];

  // ─── Table columns ────────────────────────────────────────────────────────
  const showSaleDateColumn = sortField === 'latestSale' || sortField === 'oldestSale';
  const columns: DataTableColumn<Product>[] = [
    {
      key: 'name', header: 'Product', sortable: true, className: 'w-48',
      render: (p) => (
        <div className="max-w-[220px]">
          <div className="font-medium text-card-foreground truncate">{p.name}</div>
          {p.code && <div className="text-[11px] font-mono text-muted-foreground truncate">{p.code}</div>}
        </div>
      ),
    },
    {
      key: 'category', header: 'Category', className: 'w-32',
      render: (p) => <span className="block max-w-[120px] truncate">{p.productCategoryId ? (productCategoryMap.get(p.productCategoryId) || '—') : '—'}</span>,
    },
    {
      key: 'stock', header: 'Stock', sortable: true, align: 'right', className: 'w-24',
      render: (p) => <span className="whitespace-nowrap">{p.quantity ?? '—'}</span>,
    },
    {
      key: 'sellingPrice', header: 'Selling Price', align: 'right', className: 'w-28',
      render: (p) => p.sellingPrice.toFixed(2),
    },
    ...(showSaleDateColumn ? [{
      key: 'saleDate', header: sortField === 'latestSale' ? 'Last Sold' : 'First Sold', className: 'w-28',
      render: (p: Product) => (sortField === 'latestSale' ? p.latestSaleDate : p.oldestSaleDate) || '—',
    }] : []),
    {
      key: 'status', header: 'Status', className: 'w-[1%] whitespace-nowrap',
      render: (p) => <Badge variant={p.status === 'INACTIVE' ? 'secondary' : 'success'}>{p.status || 'ACTIVE'}</Badge>,
    },
  ];

  const selectedCategoryName = selectedProduct?.productCategoryId ? productCategoryMap.get(selectedProduct.productCategoryId) : undefined;

  return (
    <div className="flex flex-col gap-4 sm:gap-5 min-[1440px]:h-full min-[1440px]:min-h-0" id="product-view">
      <PageHeader
        title="Product Catalog"
        description="Search, filter, and manage every sellable product and its sales history."
        actions={<Button onClick={openAddProduct}><Plus className="w-4 h-4" />Add Product</Button>}
      />

      {/* Filter dialog (advanced: tick specific products by name/code) */}
      <FilterDialog
        open={showFilterDialog}
        onClose={() => setShowFilterDialog(false)}
        title="Filter Products"
        sections={[{
          type: 'checklist',
          key: 'products',
          label: 'Products',
          searchPlaceholder: 'Search by name or code...',
          searchQuery: filterSearchQuery,
          onSearchChange: (q) => { setFilterSearchQuery(q); loadFilterOptions(q); },
          items: filterOptions.map(p => ({ id: p.id, label: p.name, sublabel: p.code })),
          loading: filterOptionsLoading,
          selectedIds: filterDraftIds,
          onToggle: toggleFilterDraftId,
        }]}
        onApply={() => setAppliedProductIds(filterDraftIds)}
        onClear={() => { setFilterDraftIds([]); setAppliedProductIds([]); }}
      />

      {/* Edit/create slide-over drawer — flat (no tabs), same shape as
          Material's: history is read-only and stays in the detail panel. */}
      <Sheet
        open={showProductForm}
        onClose={() => setShowProductForm(false)}
        title={editProductId ? 'Edit Product' : 'Add Product'}
        description={editProductId ? code || undefined : 'Create a new catalog item'}
        width="w-full sm:max-w-xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setShowProductForm(false)}>Cancel</Button>
            <Button onClick={handleSaveProduct}>{editProductId ? 'Save Changes' : 'Add Product'}</Button>
          </div>
        }
      >
        <div ref={formRef} className="p-5">
          <div data-fade-item>
            <ProductFormFields
              name={name} setName={setName}
              code={code} setCode={setCode}
              dimension={dimension} setDimension={setDimension}
              productCategoryId={productCategoryId} setProductCategoryId={setProductCategoryId}
              productCategories={productCategories}
              status={status} setStatus={setStatus}
              sellingPrice={sellingPrice} setSellingPrice={setSellingPrice}
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
            title="Products"
            description={`${products.length} loaded${hasMore ? '+' : ''}`}
            contentClassName="p-0 flex-1 min-h-0 flex flex-col"
            className="flex-1 min-h-0"
          >
            <div className="p-5 border-b border-border space-y-4 shrink-0">
              <FilterBar
                search={searchQuery}
                onSearchChange={(v) => { setSearchQuery(v); search(v); }}
                searchPlaceholder="Search products..."
                chips={filterChips}
                onOpenFilters={openFilterDialog}
                filterCount={appliedProductIds.length}
                selectedCount={selectedKeys.size}
                bulkActions={
                  <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
                    <Trash2 className="w-3.5 h-3.5" /> Delete {selectedKeys.size}
                  </Button>
                }
                right={<SortMenu options={SORT_OPTIONS} sortField={sortField} sortDir={sortDir} onChange={changeSort} />}
              />
              <div className="flex items-center gap-2 flex-wrap">
                {productCategories.filter(c => c.is_active).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCategoryFilter(prev => (prev === c.id ? '' : c.id))}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${categoryFilter === c.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary/50 text-secondary-foreground border-transparent hover:bg-secondary'}`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>

            <div ref={tableScrollRef} className="flex-1 min-h-0 overflow-auto">
              <DataTable
                columns={columns}
                rows={products}
                rowKey={(p) => p.id}
                sortField={sortField}
                sortDir={sortDir}
                onSort={toggleColumnSort}
                selectable
                selectedKeys={selectedKeys}
                onToggleSelect={(key) => setSelectedKeys(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; })}
                onToggleSelectAll={() => setSelectedKeys(prev => (prev.size === products.length ? new Set() : new Set(products.map(p => p.id))))}
                onRowClick={(p) => setSelectedProduct(p)}
                activeKey={selectedProduct?.id}
                rowActions={(p) => <ActionsMenu items={buildActionItems(p, true)} />}
                loading={loading}
                emptyState="No products found matching your filters."
              />
              <InfiniteScrollSentinel onLoadMore={handleLoadMore} hasMore={hasMore} loading={loadingMore} rootRef={tableScrollRef} />
            </div>
          </SectionCard>
        }
        right={
          <DetailPanel
            title={selectedProduct?.name}
            subtitle={selectedProduct ? [selectedProduct.code, selectedCategoryName].filter(Boolean).join(' • ') : undefined}
            badges={selectedProduct && (
              <Badge variant={selectedProduct.status === 'INACTIVE' ? 'secondary' : 'success'}>{selectedProduct.status || 'ACTIVE'}</Badge>
            )}
            actions={selectedProduct && (
              <>
                <Button variant="outline" size="sm" onClick={() => openEditProduct(selectedProduct)}>
                  <Edit className="w-3.5 h-3.5" /> Edit
                </Button>
                <ActionsMenu items={buildActionItems(selectedProduct, false)} />
              </>
            )}
            emptyState={!selectedProduct && (
              <div className="text-center py-12 text-muted-foreground">
                <Package className="w-8 h-8 mx-auto mb-3 opacity-40" />
                <p className="text-xs">Select a product from the list to see its full profile.</p>
              </div>
            )}
          >
            {selectedProduct && (
              <>
                {selectedProduct.attachments?.[0] && (
                  selectedProduct.attachments[0].type.startsWith('image/') ? (
                    <img
                      src={selectedProduct.attachments[0].dataUrl}
                      alt={selectedProduct.attachments[0].name}
                      onClick={() => openDataUrlInNewTab(selectedProduct.attachments![0].dataUrl)}
                      className="max-h-48 max-w-full rounded-xl border border-border object-cover hover:opacity-90 transition-opacity cursor-pointer"
                    />
                  ) : (
                    <a
                      href={selectedProduct.attachments[0].dataUrl}
                      download={selectedProduct.attachments[0].name}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 hover:bg-primary/15 text-primary rounded-lg text-xs font-medium transition-colors"
                    >
                      <Paperclip className="w-3.5 h-3.5" />
                      <span className="truncate max-w-[220px]">{selectedProduct.attachments[0].name}</span>
                    </a>
                  )
                )}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <MetricCard label="Stock" value={selectedProduct.quantity ?? '—'} />
                  <MetricCard label="Selling Price" value={selectedProduct.sellingPrice.toFixed(2)} />
                  <MetricCard label="Dimension" value={selectedProduct.dimension || '—'} />
                  <MetricCard label="Description" value={selectedProduct.description || '—'} />
                </div>
                <div className="pt-2 border-t border-border space-y-3">
                  <div className="flex items-center gap-2">
                    <ShoppingBag className="w-4 h-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold text-card-foreground">Inventory List</h3>
                  </div>
                  <InventoryHistoryTable
                    items={salesHistory}
                    loading={salesHistoryLoading}
                    onViewSalesOrder={onViewSalesOrder ? (id) => onViewSalesOrder(id, selectedProduct.id) : undefined}
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
