/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  saveProduct, deleteProduct, getProductCategories, getProductInventoryList
} from '../services/ProductService';
import { Product, ProductCategory, InventoryListItem, Attachment } from '../types';
import { Paperclip, Edit, Trash2, ArrowLeft, FileSpreadsheet, ChevronRight } from 'lucide-react';
import ProductFormFields from './ProductFormFields';
import { Dialog, DialogFooter, DialogCancelButton, DialogSubmitButton, Card, useToast, useConfirm } from './ui';
import { CallAPI } from './UIHelper';
import { TRANSACTION_TYPE_BADGE } from './InventoryListShared';

interface ProductDetailViewProps {
  product: Product;
  onBack: () => void;
  onProductUpdated: (product: Product) => void;
  onProductDeleted: () => void;
  // Cross-tab drill-in: opens the linked sales order in the Orders tab.
  // Optional since ProductDetailView can render standalone (e.g. in tests).
  onViewSalesOrder?: (salesHeaderId: string) => void;
}

/**
 * Drill-down "detail page" for a single Product: its own info card (with
 * edit/delete) plus a read-only inventory list section (sales plus any other
 * stock movement — e.g. extra-produced adjustments), sorted newest first.
 * Split out of ProductView.tsx to keep that file focused on the catalog
 * listing/search/create flow.
 */
export default function ProductDetailView({ product, onBack, onProductUpdated, onProductDeleted, onViewSalesOrder }: ProductDetailViewProps) {
  const toast = useToast();
  const confirm = useConfirm();
  // ─── Product categories (reference data for the edit form) ──────────────
  const [productCategories, setProductCategories] = useState<ProductCategory[]>([]);
  useEffect(() => {
    CallAPI(getProductCategories, { onCompleted: setProductCategories, onError: console.error });
  }, []);
  const productCategoryMap = useMemo(
    () => new Map(productCategories.map(c => [c.id, c.name])),
    [productCategories]
  );

  // ─── Inventory list for this product ──────────────────────────────────────
  const [salesHistory, setSalesHistory] = useState<InventoryListItem[]>([]);
  const [salesHistoryLoading, setSalesHistoryLoading] = useState(true);

  useEffect(() => {
    setSalesHistoryLoading(true);
    CallAPI(() => getProductInventoryList(product.id), {
      onCompleted: (data) => { setSalesHistory(data); setSalesHistoryLoading(false); },
      onError: (err) => { console.error(err); setSalesHistoryLoading(false); },
    });
  }, [product.id]);

  // ─── Product edit form ───────────────────────────────────────────────────
  const [showProductForm, setShowProductForm] = useState(false);
  const [name, setName] = useState(product.name);
  const [code, setCode] = useState(product.code || '');
  const [dimension, setDimension] = useState(product.dimension || '');
  const [productCategoryId, setProductCategoryId] = useState(product.productCategoryId || '');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>(product.status || 'ACTIVE');
  const [sellingPrice, setSellingPrice] = useState(product.sellingPrice);
  const [description, setDescription] = useState(product.description || '');
  const [attachment, setAttachment] = useState<Attachment | undefined>(product.attachments?.[0]);

  const openEditProduct = () => {
    setName(product.name);
    setCode(product.code || '');
    setDimension(product.dimension || '');
    setProductCategoryId(product.productCategoryId || '');
    setStatus(product.status || 'ACTIVE');
    setSellingPrice(product.sellingPrice);
    setDescription(product.description || '');
    setAttachment(product.attachments?.[0]);
    setShowProductForm(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const updated: Product = {
      ...product,
      name: name.trim(),
      code,
      dimension,
      description,
      attachments: attachment ? [attachment] : [],
      status,
      sellingPrice,
      productCategoryId: productCategoryId || undefined,
    };

    await CallAPI(() => saveProduct(updated), {
      onCompleted: () => { onProductUpdated(updated); toast.success('Product updated.'); },
      onError: (err) => { console.error(err); toast.error('Failed to update product.'); },
    });

    setShowProductForm(false);
  };

  const handleDeleteProduct = async () => {
    if (!(await confirm(`Delete ${product.name}? This cannot be undone.`))) return;

    await CallAPI(() => deleteProduct(product.id), {
      onCompleted: () => { onProductDeleted(); toast.success(`${product.name} deleted.`); },
      onError: (err) => { console.error(err); toast.error('Failed to delete product.'); },
    });
  };

  const categoryName = product.productCategoryId ? productCategoryMap.get(product.productCategoryId) : undefined;

  return (
    <div className="space-y-6" id="product-detail-view">
      <button
        onClick={onBack}
        className="flex items-center space-x-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>Back to Product Catalog</span>
      </button>

      {/* Product summary card */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2.5 min-w-0">
            <div>
              <h2 className="font-sans font-bold text-slate-900 text-lg leading-snug truncate">{product.name}</h2>
              {product.description && (
                <p className="text-xs text-slate-500 mt-1 max-w-2xl">{product.description}</p>
              )}
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

            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500">
              {product.dimension && (
                <div className="flex items-center space-x-1.5">
                  <span className="text-slate-400">Dimension:</span>
                  <span>{product.dimension}</span>
                </div>
              )}
              <div className="flex items-center space-x-1.5">
                <span className="text-slate-400">Selling Price:</span>
                <span>{product.sellingPrice.toFixed(2)}</span>
              </div>
            </div>

            {product.attachments?.[0] && (
              <a
                href={product.attachments[0].dataUrl}
                download={product.attachments[0].name}
                className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-[10px] font-mono transition-colors"
                title="Download attachment"
              >
                <Paperclip className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                <span className="truncate max-w-[200px]">{product.attachments[0].name}</span>
              </a>
            )}
          </div>
          <div className="flex items-center space-x-1.5 shrink-0">
            <button
              onClick={openEditProduct}
              className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded transition-colors"
              title="Edit"
            >
              <Edit className="w-4 h-4" />
            </button>
            <button
              onClick={handleDeleteProduct}
              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded transition-colors"
              title="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </Card>

      {/* Inventory list section */}
      <div className="flex items-center gap-2">
        <FileSpreadsheet className="w-4 h-4 text-slate-500" />
        <h3 className="font-sans font-bold text-slate-900 text-sm">Inventory List</h3>
      </div>

      <Card className="overflow-hidden">
        {salesHistoryLoading ? (
          <div className="p-12 text-center text-xs text-slate-400">Loading inventory list...</div>
        ) : salesHistory.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400">No inventory transactions yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-100">
                <tr>
                  <th className="px-4 py-2 font-semibold">Type</th>
                  <th className="px-4 py-2 font-semibold">Ref No.</th>
                  <th className="px-4 py-2 font-semibold">Vendor / Client</th>
                  <th className="px-4 py-2 font-semibold">Order Date</th>
                  <th className="px-4 py-2 font-semibold">Quantity</th>
                  <th className="px-4 py-2 font-semibold">Unit Cost</th>
                  <th className="px-4 py-2 font-semibold">Total Price</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  {onViewSalesOrder && <th className="px-4 py-2 font-semibold"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {salesHistory.map((item) => {
                  const badge = TRANSACTION_TYPE_BADGE[item.transactionType];
                  return (
                    <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-2.5">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${badge.className}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-700">{item.refNo || '-'}</td>
                      <td className="px-4 py-2.5 text-slate-600">{item.counterpartyName || '-'}</td>
                      <td className="px-4 py-2.5 text-slate-600">{item.orderDate || '-'}</td>
                      <td className="px-4 py-2.5 text-slate-600">{item.quantity}</td>
                      <td className="px-4 py-2.5 text-slate-600">{item.unitCost != null ? item.unitCost.toFixed(2) : '-'}</td>
                      <td className="px-4 py-2.5 text-slate-600">{item.totalPrice != null ? item.totalPrice.toFixed(2) : '-'}</td>
                      <td className="px-4 py-2.5">
                        {item.status && (
                          <span className="px-1.5 py-0.5 bg-slate-50 text-slate-600 border border-slate-200 rounded text-[10px] font-mono">
                            {item.status}
                          </span>
                        )}
                      </td>
                      {onViewSalesOrder && (
                        <td className="px-4 py-2.5 text-right">
                          {item.salesHeaderId && (
                            <button
                              onClick={() => onViewSalesOrder(item.salesHeaderId!)}
                              className="inline-flex items-center gap-0.5 text-[11px] font-medium text-blue-600 hover:text-blue-800"
                              title="View sales order"
                            >
                              <span>View</span>
                              <ChevronRight className="w-3 h-3" />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Product edit dialog */}
      <Dialog
        open={showProductForm}
        onClose={() => setShowProductForm(false)}
        title="Edit Product"
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
            <DialogSubmitButton>Save Product</DialogSubmitButton>
          </DialogFooter>
        </form>
      </Dialog>
    </div>
  );
}
