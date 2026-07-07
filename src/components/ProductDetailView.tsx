/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  saveProduct, deleteProduct, getProductCategories, getProductSalesHistory
} from '../services/ProductService';
import { Product, ProductCategory, ProductSalesHistoryItem, Attachment } from '../types';
import { Paperclip, Edit, Trash2, ArrowLeft, FileSpreadsheet, ChevronRight } from 'lucide-react';
import ProductFormFields from './ProductFormFields';
import { Dialog, DialogFooter, DialogCancelButton, DialogSubmitButton, Card } from './ui';
import { CallAPI } from './UIHelper';

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
 * edit/delete) plus a read-only order/sales history section, sorted newest
 * first. Split out of ProductView.tsx to keep that file focused on the
 * catalog listing/search/create flow.
 */
export default function ProductDetailView({ product, onBack, onProductUpdated, onProductDeleted, onViewSalesOrder }: ProductDetailViewProps) {
  // ─── Product categories (reference data for the edit form) ──────────────
  const [productCategories, setProductCategories] = useState<ProductCategory[]>([]);
  useEffect(() => {
    CallAPI(getProductCategories, { onCompleted: setProductCategories, onError: console.error });
  }, []);
  const productCategoryMap = useMemo(
    () => new Map(productCategories.map(c => [c.id, c.name])),
    [productCategories]
  );

  // ─── Order (sales) history for this product ──────────────────────────────
  const [salesHistory, setSalesHistory] = useState<ProductSalesHistoryItem[]>([]);
  const [salesHistoryLoading, setSalesHistoryLoading] = useState(true);

  useEffect(() => {
    setSalesHistoryLoading(true);
    CallAPI(() => getProductSalesHistory(product.id), {
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
      onCompleted: () => onProductUpdated(updated),
      onError: console.error,
    });

    setShowProductForm(false);
  };

  const handleDeleteProduct = async () => {
    if (!confirm(`Delete ${product.name}? This cannot be undone.`)) return;

    await CallAPI(() => deleteProduct(product.id), {
      onCompleted: onProductDeleted,
      onError: console.error,
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

      {/* Order history section */}
      <div className="flex items-center gap-2">
        <FileSpreadsheet className="w-4 h-4 text-slate-500" />
        <h3 className="font-sans font-bold text-slate-900 text-sm">Order History</h3>
      </div>

      <Card className="overflow-hidden">
        {salesHistoryLoading ? (
          <div className="p-12 text-center text-xs text-slate-400">Loading order history...</div>
        ) : salesHistory.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400">No order history yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-100">
                <tr>
                  <th className="px-4 py-2 font-semibold">Sales No.</th>
                  <th className="px-4 py-2 font-semibold">Order Date</th>
                  <th className="px-4 py-2 font-semibold">Delivery Date</th>
                  <th className="px-4 py-2 font-semibold">Quantity</th>
                  <th className="px-4 py-2 font-semibold">Unit Price</th>
                  <th className="px-4 py-2 font-semibold">Total Price</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  {onViewSalesOrder && <th className="px-4 py-2 font-semibold"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {salesHistory.map((item) => (
                  <tr key={item.detailId} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-2.5 font-mono text-slate-700">{item.salesNo || '-'}</td>
                    <td className="px-4 py-2.5 text-slate-600">{item.orderDate || '-'}</td>
                    <td className="px-4 py-2.5 text-slate-600">{item.deliveryDate || '-'}</td>
                    <td className="px-4 py-2.5 text-slate-600">{item.quantity}</td>
                    <td className="px-4 py-2.5 text-slate-600">{item.unitPrice.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-slate-600">{item.totalPrice.toFixed(2)}</td>
                    <td className="px-4 py-2.5">
                      {item.status && (
                        <span className="px-1.5 py-0.5 bg-slate-50 text-slate-600 border border-slate-200 rounded text-[10px] font-mono">
                          {item.status}
                        </span>
                      )}
                    </td>
                    {onViewSalesOrder && (
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => onViewSalesOrder(item.headerId)}
                          className="inline-flex items-center gap-0.5 text-[11px] font-medium text-blue-600 hover:text-blue-800"
                          title="View sales order"
                        >
                          <span>View</span>
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
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
