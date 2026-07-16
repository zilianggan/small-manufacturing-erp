/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Trash2, AlertTriangle } from 'lucide-react';
import { SalesHeader, Material } from '../types';
import { MaterialReconciliationInput, LeftoverMaterialInput, ProducedLine, MaterialShortfall } from '../services/OrdersService';
import ComboBox from './ComboBox';
import { Dialog, DialogFooter, DialogCancelButton, DialogSubmitButton } from './ui';

interface LeftoverDraft extends LeftoverMaterialInput {
  materialName: string;
}

// Consumables are added on the Kanban and deducted (AUTOMATIC) or recorded-only
// (MANUAL) at completion by confirmProductionDone — they were never reserved, so
// they don't belong in this modal's planned-vs-actual reconciliation.
const isPlanned = (m: { materialType?: string }) => m.materialType !== 'CONSUMABLE_MATERIAL';

interface ProductionCompletionModalProps {
  order: SalesHeader | null;
  isOpen: boolean;
  materials: Material[];
  shortfalls: MaterialShortfall[];
  onClose: () => void;
  onCheck: (reconciliations: MaterialReconciliationInput[]) => Promise<void>;
  onSubmit: (
    reconciliations: MaterialReconciliationInput[],
    leftovers: LeftoverMaterialInput[],
    produced: ProducedLine[],
  ) => Promise<void>;
}

export default function ProductionCompletionModal({ order, isOpen, materials, shortfalls, onClose, onCheck, onSubmit }: ProductionCompletionModalProps) {
  const [actualQuantities, setActualQuantities] = useState<Record<string, number>>({});
  const [actualProduced, setActualProduced] = useState<Record<string, number>>({});
  const [leftovers, setLeftovers] = useState<LeftoverDraft[]>([]);
  const [tempLeftoverDetailId, setTempLeftoverDetailId] = useState('');
  const [tempLeftoverMaterialId, setTempLeftoverMaterialId] = useState('');
  const [tempLeftoverQty, setTempLeftoverQty] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  // Shortfalls are only meaningful for the actual quantities they were computed from, so any edit to
  // them invalidates the check — same pattern as StartProductionModal.
  const [checkedFor, setCheckedFor] = useState('');

  // Re-stage the two editable tables — actual material used (defaulted to the reservation
  // startProduction made) and actual produced (defaulted to the produce qty it committed to) — and
  // clear the leftover draft whenever a different order opens. Without this a previous order's
  // edits would leak into the next.
  useEffect(() => {
    if (!isOpen || !order) return;
    const initialActuals: Record<string, number> = {};
    const initialProduced: Record<string, number> = {};
    order.details.forEach(d => {
      initialProduced[d.detailId] = d.produceQuantity;
      d.materials.filter(isPlanned).forEach(m => {
        initialActuals[m.id] = m.plannedQuantity;
      });
    });
    setActualQuantities(initialActuals);
    setActualProduced(initialProduced);
    setLeftovers([]);
    setTempLeftoverDetailId(order.details[0]?.detailId || '');
    setTempLeftoverMaterialId('');
    setTempLeftoverQty(1);
    setCheckedFor('');
    setSubmitting(false);
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

  const handleLeftoverQtyChange = (index: number, quantity: number) => {
    setLeftovers(leftovers.map((l, idx) => idx === index ? { ...l, quantity } : l));
  };

  const handleQuantityChange = (materialUsageId: string, quantity: number) => {
    setActualQuantities({ ...actualQuantities, [materialUsageId]: quantity });
    setCheckedFor('');
  };

  const buildReconciliations = (): MaterialReconciliationInput[] =>
    order.details.flatMap(d =>
      d.materials.filter(isPlanned).map(m => ({
        usageId: m.id,
        actualQuantity: actualQuantities[m.id] ?? m.plannedQuantity,
      }))
    );

  const currentKey = JSON.stringify(actualQuantities);
  const isChecked = checkedFor === currentKey;
  const blocked = shortfalls.length > 0;

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    // Two-step, same as Start Production: the shortfall check is only meaningful for the actual
    // quantities entered, so it must be (re-)run and shown clean before the RPC — which applies the
    // same guard server-side — can be trusted to succeed.
    if (!isChecked) {
      setSubmitting(true);
      try {
        await onCheck(buildReconciliations());
        setCheckedFor(currentKey);
      } finally {
        setSubmitting(false);
      }
      return;
    }
    if (blocked) return;

    const leftoverInputs: LeftoverMaterialInput[] = leftovers.map(l => ({
      salesDetailId: l.salesDetailId,
      materialId: l.materialId,
      quantity: l.quantity,
    }));

    const producedInputs: ProducedLine[] = order.details.map(d => ({
      detailId: d.detailId,
      quantity: actualProduced[d.detailId] ?? d.produceQuantity,
    }));

    setSubmitting(true);
    try {
      await onSubmit(buildReconciliations(), leftoverInputs, producedInputs);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onClose={onClose} title={`Confirm Production — ${order.salesNo}`} maxWidth="max-w-3xl">
      <form onSubmit={handleConfirm} className="p-5 space-y-4 text-xs">
        {/* Products — actual yield. This is what credits finished goods, so it's the first thing
            the user sees. Defaults to the produce qty committed at Start Production; an actual
            above it is simply over-production (there is no separate "extra produced" input). */}
        <div className="border border-slate-150 rounded-lg overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_7rem] gap-3 px-3 py-2 bg-slate-50 font-semibold text-slate-600 text-[11px]">
            <span>Product</span>
            <span className="text-right w-24">Planned Produce</span>
            <span className="text-right">Actual Produced</span>
          </div>
          {order.details.map(detail => (
            <div key={detail.detailId} className="grid grid-cols-[1fr_auto_7rem] gap-3 items-center px-3 py-2 border-t border-slate-150">
              <span className="text-slate-700 truncate">
                {detail.productName}
                <span className="text-slate-400 font-mono text-[10px]"> (ordered {detail.quantity})</span>
              </span>
              <span className="text-right w-24 font-mono text-slate-600">{detail.produceQuantity}</span>
              <input
                type="number"
                min="0"
                value={actualProduced[detail.detailId] ?? detail.produceQuantity}
                onChange={(e) => setActualProduced({ ...actualProduced, [detail.detailId]: Math.max(0, Number(e.target.value) || 0) })}
                className="w-full px-2 py-1 bg-white border border-slate-200 rounded focus:outline-none text-[11px] text-right"
              />
            </div>
          ))}
        </div>
        <p className="text-[10px] text-slate-400 -mt-2">
          Finished goods are credited to stock at the Actual Produced quantity.
        </p>

        {/* Planned Materials */}
        <div className="border border-slate-150 rounded-lg p-3 bg-slate-50/50 space-y-2">
          <span className="font-semibold block text-slate-700 text-xs">Planned Materials</span>
          {order.details.map(detail => (
            <div key={detail.detailId} className="space-y-1.5">
              <span className="font-semibold text-slate-600 text-[11px]">{detail.productName}</span>
              {detail.materials.filter(isPlanned).length === 0 ? (
                <div className="text-[10px] text-slate-400 italic pl-2">No planned materials for this line.</div>
              ) : (
                detail.materials.filter(isPlanned).map(m => (
                  <div key={m.id} className="flex items-center justify-between bg-white border border-slate-200 rounded px-2 py-1.5">
                    <span className="text-slate-700">{m.materialName} — planned {m.plannedQuantity}</span>
                    <input
                      type="number"
                      min="0"
                      value={actualQuantities[m.id] ?? m.plannedQuantity}
                      onChange={(e) => handleQuantityChange(m.id, Number(e.target.value))}
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
                <div key={idx} className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded px-2 py-1.5">
                  <span className="text-[11px] text-slate-700">{l.materialName}</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      value={l.quantity}
                      onChange={(e) => handleLeftoverQtyChange(idx, Math.max(1, Number(e.target.value) || 1))}
                      className="w-20 px-2 py-1 bg-white border border-slate-200 rounded focus:outline-none text-[11px] text-right"
                    />
                    <button type="button" onClick={() => handleRemoveLeftover(idx)} className="text-red-500 hover:text-red-700 p-0.5" title="Remove">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
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

        {isChecked && blocked && (
          <div className="border border-red-200 bg-red-50/60 rounded-lg p-3 space-y-1.5">
            <span className="flex items-center gap-1.5 font-semibold text-red-700 text-[11px]">
              <AlertTriangle className="w-3.5 h-3.5" /> Insufficient material — production completion is blocked
            </span>
            {shortfalls.map(s => (
              <div key={s.materialId} className="flex justify-between text-[11px] text-red-700">
                <span>{s.materialName}</span>
                <span className="font-mono">need {s.required}, have {s.available} (short {Math.round((s.required - s.available) * 100) / 100})</span>
              </div>
            ))}
            <p className="text-[10px] text-red-600/80 pt-0.5">
              Lower the actual quantity or top up stock (purchase/adjustment), then check again.
            </p>
          </div>
        )}

        {isChecked && !blocked && (
          <div className="border border-emerald-200 bg-emerald-50/60 rounded-lg px-3 py-2 text-[11px] text-emerald-700">
            Material is sufficient.
          </div>
        )}

        <DialogFooter>
          <DialogCancelButton onClick={onClose} />
          <DialogSubmitButton disabled={submitting || (isChecked && blocked)}>
            {submitting ? 'Working...' : isChecked ? 'Confirm Production Done' : 'Check Material'}
          </DialogSubmitButton>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
