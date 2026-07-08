/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  getProducts, getProductsPage, saveProduct, deleteProduct, generateId, getProductCategories, getProductById,
  ProductSortField, SortDir
} from '../services/ProductService';
import { Product, ProductCategory, Attachment } from '../types';
import { Plus, Paperclip, Edit, Trash2, ChevronRight, FileText, Tag, Filter, CalendarClock } from 'lucide-react';
import LoadingSpinner from './LoadingSpinner';
import ProductFormFields from './ProductFormFields';
import ProductDetailView from './ProductDetailView';
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
  { value: 'latestSale', label: 'Latest Sale Date' },
  { value: 'oldestSale', label: 'Oldest Sale Date' },
];

interface ProductViewProps {
  // Cross-tab drill-in: passed through to ProductDetailView's order history
  // links so they can jump to the Orders tab. fromProductId lets the
  // destination detail page's Back button return here instead of its list.
  onViewSalesOrder?: (salesHeaderId: string, fromProductId?: string) => void;
  // Cross-tab return trip: reopens this product's detail page after a
  // SalesOrderDetailView opened from here navigates back. Since switching
  // App.tsx tabs unmounts this view, local selectedProduct state can't
  // survive the round trip on its own.
  initialProductId?: string | null;
  onInitialProductHandled?: () => void;
}

/**
 * Product catalog listing: search, create/edit/delete, and the entry point
 * into ProductDetailView (product summary + order/sales history).
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

  // ─── Filter dialog: search by name/code keyword, tick multiple products ──
  const [appliedProductIds, setAppliedProductIds] = useState<string[]>([]);
  const [showFilterDialog, setShowFilterDialog] = useState(false);
  const [filterDraftIds, setFilterDraftIds] = useState<string[]>([]);
  const [filterSearchQuery, setFilterSearchQuery] = useState('');
  const [filterOptions, setFilterOptions] = useState<Product[]>([]);
  const [filterOptionsLoading, setFilterOptionsLoading] = useState(false);

  // ─── Sort ─────────────────────────────────────────────────────────────
  const [sortField, setSortField] = useState<ProductSortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const loadProducts = useCallback((nextOffset: number, append: boolean, search: string) => {
    const setBusy = append ? setLoadingMore : setLoading;
    setBusy(true);

    CallAPI(
      () => getProductsPage({ search, productIds: appliedProductIds, sortField, sortDir, offset: nextOffset, limit: PAGE_SIZE }),
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
  }, [appliedProductIds, sortField, sortDir]);

  useEffect(() => { loadProducts(0, false, searchQuery); }, []);

  // Filters or sort changing both restart from page 1
  useEffect(() => {
    loadProducts(0, false, searchQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedProductIds, sortField, sortDir]);

  const search = useMemo(
    () =>
      debounce((text: string) => {
        loadProducts(0, false, text);
      }, 500),
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

  const hasActiveFilters = appliedProductIds.length > 0;

  // ─── Product categories (reference data for the form) ───────────────────
  const [productCategories, setProductCategories] = useState<ProductCategory[]>([]);
  useEffect(() => {
    CallAPI(getProductCategories, { onCompleted: setProductCategories, onError: console.error });
  }, []);
  const productCategoryMap = useMemo(
    () => new Map(productCategories.map(c => [c.id, c.name])),
    [productCategories]
  );

  // Drill-down: selected product (shows ProductDetailView instead of the grid)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Cross-tab return trip: re-fetch and reopen the product this view was
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

  // ─── Product create/edit form ────────────────────────────────────────────
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

  const openEditProduct = (item: Product) => {
    setEditProductId(item.id);
    setName(item.name);
    setCode(item.code || '');
    setDimension(item.dimension || '');
    setProductCategoryId(item.productCategoryId || '');
    setStatus(item.status || 'ACTIVE');
    setSellingPrice(item.sellingPrice);
    setDescription(item.description || '');
    setAttachment(item.attachments?.[0]);
    setShowProductForm(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
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
      onCompleted: () => { loadProducts(0, false, searchQuery); toast.success(editProductId ? 'Product updated.' : 'Product added.'); },
      onError: (err) => { console.error(err); toast.error('Failed to save product.'); },
    });

    resetForm();
    setShowProductForm(false);
  };

  const handleDeleteProduct = async (item: Product) => {
    if (!(await confirm(`Delete ${item.name}? This cannot be undone.`))) return;

    await CallAPI(() => deleteProduct(item.id), {
      onCompleted: () => { loadProducts(0, false, searchQuery); toast.success(`${item.name} deleted.`); },
      onError: (err) => { console.error(err); toast.error('Failed to delete product.'); },
    });
  };

  // ─── Drill-down detail page ───────────────────────────────────────────────
  if (selectedProduct) {
    return (
      <ProductDetailView
        product={selectedProduct}
        onBack={() => { setSelectedProduct(null); loadProducts(0, false, searchQuery); }}
        onProductUpdated={(updated) => setSelectedProduct(updated)}
        onProductDeleted={() => { setSelectedProduct(null); loadProducts(0, false, searchQuery); }}
        onViewSalesOrder={(salesHeaderId) => onViewSalesOrder?.(salesHeaderId, selectedProduct.id)}
      />
    );
  }

  return (
    <div className="space-y-6" id="product-view">
      {loading && <LoadingSpinner message="Retrieving product catalog..." subtitle="PRODUCT_LOAD" />}
      {/* Top Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h3 className="font-sans font-bold text-slate-900 text-sm flex items-center space-x-2">
          <Tag className="w-4 h-4 text-slate-500" />
          <span>Product Catalog</span>
        </h3>

        <div className="flex items-center space-x-2">
          <SearchInput
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e)
              search(e)
            }}
            placeholder="Search products..."
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
          <SortMenu options={SORT_OPTIONS} sortField={sortField} sortDir={sortDir} onChange={(f, d) => { setSortField(f as ProductSortField); setSortDir(d); }} />
          <button
            onClick={openAddProduct}
            className="flex items-center space-x-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors font-sans shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Add Product</span>
          </button>
        </div>
      </div>

      {/* Filter dialog */}
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

      {/* Creation/Edit form as Dialog Modal */}
      <Dialog
        open={showProductForm}
        onClose={() => setShowProductForm(false)}
        title={editProductId ? 'Edit Product' : 'Add Product'}
      >
        <form onSubmit={handleSaveProduct} className="p-5 space-y-4">
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
          <DialogFooter>
            <DialogCancelButton onClick={() => setShowProductForm(false)} />
            <DialogSubmitButton>{editProductId ? 'Save Product' : 'Add Product'}</DialogSubmitButton>
          </DialogFooter>
        </form>
      </Dialog>

      {/* Product grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {products.length === 0 ? (
          <Card className="col-span-full text-center py-12 text-xs text-slate-400">
            No products found matching your query.
          </Card>
        ) : (
          products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              categoryName={product.productCategoryId ? productCategoryMap.get(product.productCategoryId) : undefined}
              sortField={sortField}
              onOpen={() => setSelectedProduct(product)}
              onEdit={() => openEditProduct(product)}
              onDelete={() => handleDeleteProduct(product)}
            />
          ))
        )}
      </div>
      <InfiniteScrollSentinel onLoadMore={handleLoadMore} hasMore={hasMore} loading={loadingMore} />

    </div>
  );
}

// Product summary card used in the catalog grid
function ProductCard({
  product, categoryName, sortField, onOpen, onEdit, onDelete
}: {
  product: Product;
  categoryName?: string;
  sortField?: ProductSortField;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const saleDateLabel = sortField === 'latestSale'
    ? { label: 'Last sold:', date: product.latestSaleDate }
    : sortField === 'oldestSale'
      ? { label: 'First sold:', date: product.oldestSaleDate }
      : null;

  return (
    <Card className="group p-5 hover:shadow-md transition-shadow flex flex-col justify-between space-y-4 cursor-pointer">
      <div className="space-y-2.5" onClick={onOpen}>
        <div className="flex items-start justify-between gap-2">
          <h4 className="font-sans font-semibold text-slate-900 text-sm leading-snug">{product.name}</h4>
          <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors shrink-0" />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {product.code && (
            <span className="px-1.5 py-0.5 bg-slate-50 text-slate-600 border border-slate-200 rounded text-[10px] font-mono">
              {product.code}
            </span>
          )}
          {categoryName && (
            <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-100 rounded text-[10px] font-mono">
              {categoryName}
            </span>
          )}
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${product.status === 'INACTIVE' ? 'bg-slate-50 text-slate-500 border-slate-200' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}`}>
            {product.status || 'ACTIVE'}
          </span>
        </div>

        <div className="space-y-1.5 text-xs text-slate-500">
          {product.dimension && (
            <div className="flex items-center space-x-2">
              <span className="text-slate-400 shrink-0">Dimension:</span>
              <span className="truncate">{product.dimension}</span>
            </div>
          )}
          <div className="flex items-center space-x-2">
            <span className="text-slate-400 shrink-0">Selling Price:</span>
            <span>{product.sellingPrice.toFixed(2)}</span>
          </div>
          {product.quantity != null && (
            <div className="flex items-center space-x-2">
              <span className="text-slate-400 shrink-0">Stock:</span>
              <span>{product.quantity}</span>
            </div>
          )}
          {saleDateLabel && (
            <div className="flex items-center space-x-2">
              <CalendarClock className="w-3.5 h-3.5 shrink-0 text-slate-400" />
              <span className="text-slate-400 shrink-0">{saleDateLabel.label}</span>
              <span>{saleDateLabel.date || '—'}</span>
            </div>
          )}
          {product.description && (
            <div className="flex items-start space-x-2">
              <FileText className="w-3.5 h-3.5 shrink-0 text-slate-400 mt-0.5" />
              <span className="line-clamp-2">{product.description}</span>
            </div>
          )}
          {product.attachments?.[0] && (
            <div className="pt-1 flex items-center">
              <a
                href={product.attachments[0].dataUrl}
                download={product.attachments[0].name}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-[10px] font-mono transition-colors"
                title="Download attachment"
              >
                <Paperclip className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                <span className="truncate max-w-[150px]">{product.attachments[0].name}</span>
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
