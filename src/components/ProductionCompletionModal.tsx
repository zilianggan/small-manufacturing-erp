/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { SalesHeader, Material } from '../types';
import { MaterialReconciliationInput, LeftoverMaterialInput, ExtraProducedInput } from '../services/OrdersService';
import ComboBox from './ComboBox';
import { Dialog, DialogFooter, DialogCancelButton, DialogSubmitButton } from './ui';

interface LeftoverDraft extends LeftoverMaterialInput {
  materialName: string;
}

interface ProductionCompletionModalProps {
  order: SalesHeader | null;
  isOpen: boolean;
  materials: Material[];
  onClose: () => void;
  onSubmit: (
    reconciliations: MaterialReconciliationInput[],
    leftovers: LeftoverMaterialInput[],
    extraProduced: ExtraProducedInput[],
  ) => Promise<void>;
}

export default function ProductionCompletionModal({ order, isOpen, materials, onClose, onSubmit }: ProductionCompletionModalProps) {
  const [actualQuantities, setActualQuantities] = useState<Record<string, number>>({});
  const [extraProduced, setExtraProduced] = useState<Record<string, number>>({});
  const [leftovers, setLeftovers] = useState<LeftoverDraft[]>([]);
  const [tempLeftoverDetailId, setTempLeftoverDetailId] = useState('');
  const [tempLeftoverMaterialId, setTempLeftoverMaterialId] = useState('');
  const [tempLeftoverQty, setTempLeftoverQty] = useState(1);

  // Re-stage actual quantities (defaulted to plannedQuantity) and clear
  // leftover/extra-produced drafts whenever a different order opens in the
  // dialog — without this, a previous order's edits would leak into the next.
  useEffect(() => {
    if (!isOpen || !order) return;
    const initialActuals: Record<string, number> = {};
    order.details.forEach(d => {
      d.materials.forEach(m => {
        initialActuals[m.id] = m.plannedQuantity;
      });
    });
    setActualQuantities(initialActuals);
    setExtraProduced({});
    setLeftovers([]);
    setTempLeftoverDetailId(order.details[0]?.detailId || '');
    setTempLeftoverMaterialId('');
    setTempLeftoverQty(1);
  }, [isOpen, order]);

  if (!isOpen || !order) return null;

  const handleAddLeftover = () => {
    if (!tempLeftoverDetailId || !tempLeftoverMaterialId || tempLeftoverQty <= 0) return;
    const material = materials.find(m => m.id === tempLeftoverMaterialId);
    if (!material) return;

    setLeftovers([...leftovers, {
      salesDetailId: tempLeftoverDetailId,
      materialId: tempLeftoverMaterialId,
      materialName: material.name,
      quantity: tempLeftoverQty,
    }]);
    setTempLeftoverMaterialId('');
    setTempLeftoverQty(1);
  };

  const handleRemoveLeftover = (index: number) => {
    setLeftovers(leftovers.filter((_, idx) => idx !== index));
  };

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();

    const reconciliations: MaterialReconciliationInput[] = order.details.flatMap(d =>
      d.materials.map(m => ({
        usageId: m.id,
        materialId: m.materialId,
        plannedQuantity: m.plannedQuantity,
        actualQuantity: actualQuantities[m.id] ?? m.plannedQuantity,
      }))
    );

    const leftoverInputs: LeftoverMaterialInput[] = leftovers.map(l => ({
      salesDetailId: l.salesDetailId,
      materialId: l.materialId,
      quantity: l.quantity,
    }));

    const extraProducedInputs: ExtraProducedInput[] = order.details.map(d => ({
      salesDetailId: d.detailId,
      productId: d.productId,
      quantity: extraProduced[d.detailId] || 0,
    }));

    await onSubmit(reconciliations, leftoverInputs, extraProducedInputs);
  };

  return (
    <Dialog open={isOpen} onClose={onClose} title={`Confirm Production — ${order.salesNo}`} maxWidth="max-w-3xl">
      <form onSubmit={handleConfirm} className="p-5 space-y-4 text-xs">
        {/* Planned Materials */}
        <div className="border border-slate-150 rounded-lg p-3 bg-slate-50/50 space-y-2">
          <span className="font-semibold block text-slate-700 text-xs">Planned Materials</span>
          {order.details.map(detail => (
            <div key={detail.detailId} className="space-y-1.5">
              <span className="font-semibold text-slate-600 text-[11px]">{detail.productName}</span>
              {detail.materials.length === 0 ? (
                <div className="text-[10px] text-slate-400 italic pl-2">No planned materials for this line.</div>
              ) : (
                detail.materials.map(m => (
                  <div key={m.id} className="flex items-center justify-between bg-white border border-slate-200 rounded px-2 py-1.5">
                    <span className="text-slate-700">{m.materialName} — planned {m.plannedQuantity}</span>
                    <input
                      type="number"
                      min="0"
                      value={actualQuantities[m.id] ?? m.plannedQuantity}
                      onChange={(e) => setActualQuantities({ ...actualQuantities, [m.id]: Number(e.target.value) })}
                      className="w-24 px-2 py-1 bg-white border border-slate-200 rounded focus:outline-none text-[11px] text-right"
                    />
                  </div>
                ))
              )}
            </div>
          ))}
        </div>

        {/* Leftover / by-product items */}
        <div className="border border-emerald-100 rounded-lg p-3 bg-emerald-50/20 space-y-2">
          <span className="font-semibold block text-slate-700 text-[10px] uppercase tracking-wider">Leftover Items Returned to Inventory ({leftovers.length})</span>
          {leftovers.length > 0 && (
            <div className="space-y-1">
              {leftovers.map((l, idx) => (
                <div key={idx} className="flex items-center justify-between bg-white border border-slate-200 rounded px-2 py-1">
                  <span className="text-[10px] text-slate-700">{l.materialName} — qty {l.quantity}</span>
                  <button type="button" onClick={() => handleRemoveLeftover(idx)} className="text-red-500 hover:text-red-700 p-0.5" title="Remove">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
            {order.details.length > 1 && (
              <div className="sm:col-span-4">
                <ComboBox
                  value={tempLeftoverDetailId}
                  onChange={setTempLeftoverDetailId}
                  noneLabel="-- Product Line --"
                  options={order.details.map(d => ({ value: d.detailId, label: d.productName }))}
                />
              </div>
            )}
            <div className={order.details.length > 1 ? 'sm:col-span-5' : 'sm:col-span-7'}>
              <ComboBox
                value={tempLeftoverMaterialId}
                onChange={setTempLeftoverMaterialId}
                noneLabel="-- Choose Material --"
                options={materials.map(m => ({ value: m.id, label: m.name, sublabel: m.code }))}
              />
            </div>
            <div className="sm:col-span-2">
              <input
                type="number"
                min="1"
                value={tempLeftoverQty}
                onChange={(e) => setTempLeftoverQty(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none text-xs text-slate-800"
              />
            </div>
            <div className="sm:col-span-1">
              <button type="button" onClick={handleAddLeftover} className="w-full px-2 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium text-[10px]">
                Add
              </button>
            </div>
          </div>
        </div>

        {/* Extra produced quantity */}
        <div className="border border-slate-150 rounded-lg p-3 bg-slate-50/50 space-y-2">
          <span className="font-semibold block text-slate-700 text-[10px] uppercase tracking-wider">Extra Produced (beyond ordered quantity)</span>
          {order.details.map(detail => (
            <div key={detail.detailId} className="flex items-center justify-between bg-white border border-slate-200 rounded px-2 py-1.5">
              <span className="text-slate-700">{detail.productName} <span className="text-slate-400 font-mono text-[10px]">(ordered {detail.quantity})</span></span>
              <input
                type="number"
                min="0"
                value={extraProduced[detail.detailId] || 0}
                onChange={(e) => setExtraProduced({ ...extraProduced, [detail.detailId]: Number(e.target.value) })}
                className="w-24 px-2 py-1 bg-white border border-slate-200 rounded focus:outline-none text-[11px] text-right"
              />
            </div>
          ))}
        </div>

        <DialogFooter>
          <DialogCancelButton onClick={onClose} />
          <DialogSubmitButton>Confirm Production Done</DialogSubmitButton>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
