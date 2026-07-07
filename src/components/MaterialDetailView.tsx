/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  saveMaterial, deleteMaterial, getMaterialCategories, getMaterialPurchaseHistory
} from '../services/MaterialService';
import { Material, MaterialCategory, MaterialType, MaterialPurchaseHistoryItem, Attachment } from '../types';
import { Paperclip, Edit, Trash2, ArrowLeft, AlertTriangle, ShoppingBag, ChevronRight } from 'lucide-react';
import MaterialFormFields from './MaterialFormFields';
import { Dialog, DialogFooter, DialogCancelButton, DialogSubmitButton, Card } from './ui';
import { CallAPI } from './UIHelper';

interface MaterialDetailViewProps {
  material: Material;
  onBack: () => void;
  onMaterialUpdated: (material: Material) => void;
  onMaterialDeleted: () => void;
  // Cross-tab drill-in: opens the linked purchase order in the Purchases tab.
  // Optional since MaterialDetailView can render standalone (e.g. in tests).
  onViewPurchaseOrder?: (purchaseHeaderId: string) => void;
}

/**
 * Drill-down "detail page" for a single Material: its own info card (with
 * edit/delete) plus a read-only purchase history section, sorted newest
 * first. Split out of MaterialView.tsx to keep that file focused on the
 * catalog listing/search/create flow.
 */
export default function MaterialDetailView({ material, onBack, onMaterialUpdated, onMaterialDeleted, onViewPurchaseOrder }: MaterialDetailViewProps) {
  // ─── Material categories (reference data for the edit form) ─────────────
  const [materialCategories, setMaterialCategories] = useState<MaterialCategory[]>([]);
  useEffect(() => {
    CallAPI(getMaterialCategories, { onCompleted: setMaterialCategories, onError: console.error });
  }, []);
  const materialCategoryMap = useMemo(
    () => new Map(materialCategories.map(c => [c.id, c.name])),
    [materialCategories]
  );

  // ─── Purchase history for this material ──────────────────────────────────
  const [purchaseHistory, setPurchaseHistory] = useState<MaterialPurchaseHistoryItem[]>([]);
  const [purchaseHistoryLoading, setPurchaseHistoryLoading] = useState(true);

  useEffect(() => {
    setPurchaseHistoryLoading(true);
    CallAPI(() => getMaterialPurchaseHistory(material.id), {
      onCompleted: (data) => { setPurchaseHistory(data); setPurchaseHistoryLoading(false); },
      onError: (err) => { console.error(err); setPurchaseHistoryLoading(false); },
    });
  }, [material.id]);

  // ─── Material edit form ──────────────────────────────────────────────────
  const [showMaterialForm, setShowMaterialForm] = useState(false);
  const [name, setName] = useState(material.name);
  const [code, setCode] = useState(material.code || '');
  const [materialType, setMaterialType] = useState<MaterialType>(material.materialType || 'RAW_MATERIAL');
  const [dimension, setDimension] = useState(material.dimension || '');
  const [materialCategoryId, setMaterialCategoryId] = useState(material.materialCategoryId || '');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>(material.status || 'ACTIVE');
  const [minimumStock, setMinimumStock] = useState(material.minimumStock);
  const [reorderQuantity, setReorderQuantity] = useState(material.reorderQuantity);
  const [description, setDescription] = useState(material.description || '');
  const [attachment, setAttachment] = useState<Attachment | undefined>(material.attachments?.[0]);

  const openEditMaterial = () => {
    setName(material.name);
    setCode(material.code || '');
    setMaterialType(material.materialType || 'RAW_MATERIAL');
    setDimension(material.dimension || '');
    setMaterialCategoryId(material.materialCategoryId || '');
    setStatus(material.status || 'ACTIVE');
    setMinimumStock(material.minimumStock);
    setReorderQuantity(material.reorderQuantity);
    setDescription(material.description || '');
    setAttachment(material.attachments?.[0]);
    setShowMaterialForm(true);
  };

  const handleSaveMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const updated: Material = {
      ...material,
      name: name.trim(),
      code,
      materialType,
      dimension,
      description,
      attachments: attachment ? [attachment] : [],
      status,
      minimumStock,
      reorderQuantity,
      materialCategoryId: materialCategoryId || undefined,
    };

    await CallAPI(() => saveMaterial(updated), {
      onCompleted: () => onMaterialUpdated(updated),
      onError: console.error,
    });

    setShowMaterialForm(false);
  };

  const handleDeleteMaterial = async () => {
    if (!confirm(`Delete ${material.name}? This cannot be undone.`)) return;

    await CallAPI(() => deleteMaterial(material.id), {
      onCompleted: onMaterialDeleted,
      onError: console.error,
    });
  };

  const belowMinimum = material.quantity < material.minimumStock;
  const categoryName = material.materialCategoryId ? materialCategoryMap.get(material.materialCategoryId) : undefined;

  return (
    <div className="space-y-6" id="material-detail-view">
      <button
        onClick={onBack}
        className="flex items-center space-x-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>Back to Material Catalog</span>
      </button>

      {/* Material summary card */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2.5 min-w-0">
            <div>
              <h2 className="font-sans font-bold text-slate-900 text-lg leading-snug truncate">{material.name}</h2>
              {material.description && (
                <p className="text-xs text-slate-500 mt-1 max-w-2xl">{material.description}</p>
              )}
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
              {material.materialType && (
                <span className="px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-100 rounded text-[10px] font-mono">
                  {material.materialType}
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500">
              {material.dimension && (
                <div className="flex items-center space-x-1.5">
                  <span className="text-slate-400">Dimension:</span>
                  <span>{material.dimension}</span>
                </div>
              )}
              <div className="flex items-center space-x-1.5">
                <span className="text-slate-400">Stock:</span>
                <span className={belowMinimum ? 'text-red-600 font-semibold flex items-center gap-1' : ''}>
                  {belowMinimum && <AlertTriangle className="w-3 h-3" />}
                  {material.quantity}
                </span>
              </div>
              <div className="flex items-center space-x-1.5">
                <span className="text-slate-400">Min. Stock:</span>
                <span>{material.minimumStock}</span>
              </div>
              <div className="flex items-center space-x-1.5">
                <span className="text-slate-400">Reorder Qty:</span>
                <span>{material.reorderQuantity}</span>
              </div>
            </div>

            {material.attachments?.[0] && (
              <a
                href={material.attachments[0].dataUrl}
                download={material.attachments[0].name}
                className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-[10px] font-mono transition-colors"
                title="Download attachment"
              >
                <Paperclip className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                <span className="truncate max-w-[200px]">{material.attachments[0].name}</span>
              </a>
            )}
          </div>
          <div className="flex items-center space-x-1.5 shrink-0">
            <button
              onClick={openEditMaterial}
              className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded transition-colors"
              title="Edit"
            >
              <Edit className="w-4 h-4" />
            </button>
            <button
              onClick={handleDeleteMaterial}
              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded transition-colors"
              title="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </Card>

      {/* Purchase history section */}
      <div className="flex items-center gap-2">
        <ShoppingBag className="w-4 h-4 text-slate-500" />
        <h3 className="font-sans font-bold text-slate-900 text-sm">Purchase History</h3>
      </div>

      <Card className="overflow-hidden">
        {purchaseHistoryLoading ? (
          <div className="p-12 text-center text-xs text-slate-400">Loading purchase history...</div>
        ) : purchaseHistory.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400">No purchase history yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-100">
                <tr>
                  <th className="px-4 py-2 font-semibold">Purchase No.</th>
                  <th className="px-4 py-2 font-semibold">Order Date</th>
                  <th className="px-4 py-2 font-semibold">Quantity</th>
                  <th className="px-4 py-2 font-semibold">Unit Cost</th>
                  <th className="px-4 py-2 font-semibold">Total Price</th>
                  <th className="px-4 py-2 font-semibold">Received Qty</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  {onViewPurchaseOrder && <th className="px-4 py-2 font-semibold"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {purchaseHistory.map((item) => (
                  <tr key={item.detailId} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-2.5 font-mono text-slate-700">{item.purchaseNo || '-'}</td>
                    <td className="px-4 py-2.5 text-slate-600">{item.orderDate || item.quotationDate || '-'}</td>
                    <td className="px-4 py-2.5 text-slate-600">{item.quantity}</td>
                    <td className="px-4 py-2.5 text-slate-600">{item.unitCost.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-slate-600">{item.totalPrice.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-slate-600">{item.receivedQuantity}</td>
                    <td className="px-4 py-2.5">
                      {item.status && (
                        <span className="px-1.5 py-0.5 bg-slate-50 text-slate-600 border border-slate-200 rounded text-[10px] font-mono">
                          {item.status}
                        </span>
                      )}
                    </td>
                    {onViewPurchaseOrder && (
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => onViewPurchaseOrder(item.headerId)}
                          className="inline-flex items-center gap-0.5 text-[11px] font-medium text-blue-600 hover:text-blue-800"
                          title="View purchase order"
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

      {/* Material edit dialog */}
      <Dialog
        open={showMaterialForm}
        onClose={() => setShowMaterialForm(false)}
        title="Edit Material"
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
            <DialogSubmitButton>Save Material</DialogSubmitButton>
          </DialogFooter>
        </form>
      </Dialog>
    </div>
  );
}
