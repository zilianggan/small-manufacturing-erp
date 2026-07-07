/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  getProducts, saveProduct, deleteProduct, generateId, getProductCategories
} from '../services/ProductService';
import { Product, ProductCategory, Attachment } from '../types';
import { Plus, Paperclip, Edit, Trash2, ChevronRight, FileText, Tag } from 'lucide-react';
import LoadingSpinner from './LoadingSpinner';
import ProductFormFields from './ProductFormFields';
import ProductDetailView from './ProductDetailView';
import { Dialog, DialogFooter, DialogCancelButton, DialogSubmitButton, Card, SearchInput } from './ui';
import { CallAPI } from './UIHelper';
import { debounce } from 'lodash'

/**
 * Product catalog listing: search, create/edit/delete, and the entry point
 * into ProductDetailView (product summary + order/sales history).
 */
export default function ProductView() {
  const [searchQuery, setSearchQuery] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const loadProducts = (search: string = '') => {
    setLoading(true);
    CallAPI(() => getProducts(search), {
      onCompleted: (data) => { setProducts(data); setLoading(false); },
      onError: (err) => { console.error(err); setLoading(false); },
    });
  };

  const search = useMemo(
    () =>
      debounce((text: string) => {
        loadProducts(text);
      }, 500),
    []
  );

  // Debounced search-as-you-type
  useEffect(() => {
    const t = setTimeout(() => loadProducts(searchQuery), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

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
      onCompleted: () => loadProducts(),
      onError: console.error,
    });

    resetForm();
    setShowProductForm(false);
  };

  const handleDeleteProduct = async (item: Product) => {
    if (!confirm(`Delete ${item.name}? This cannot be undone.`)) return;

    await CallAPI(() => deleteProduct(item.id), {
      onCompleted: () => loadProducts(),
      onError: console.error,
    });
  };

  // ─── Drill-down detail page ───────────────────────────────────────────────
  if (selectedProduct) {
    return (
      <ProductDetailView
        product={selectedProduct}
        onBack={() => { setSelectedProduct(null); loadProducts(); }}
        onProductUpdated={(updated) => setSelectedProduct(updated)}
        onProductDeleted={() => { setSelectedProduct(null); loadProducts(); }}
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
            onClick={openAddProduct}
            className="flex items-center space-x-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors font-sans shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Add Product</span>
          </button>
        </div>
      </div>

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
              onOpen={() => setSelectedProduct(product)}
              onEdit={() => openEditProduct(product)}
              onDelete={() => handleDeleteProduct(product)}
            />
          ))
        )}
      </div>

    </div>
  );
}

// Product summary card used in the catalog grid
function ProductCard({
  product, categoryName, onOpen, onEdit, onDelete
}: {
  product: Product;
  categoryName?: string;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
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
          <span>View Order History</span>
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
