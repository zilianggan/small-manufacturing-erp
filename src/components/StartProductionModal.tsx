/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { SalesHeader } from '../types';
import { ProduceLine, MaterialShortfall, suggestedProduceQuantity } from '../services/OrdersService';
import { Dialog, DialogFooter, DialogCancelButton, DialogSubmitButton } from './ui';

interface StartProductionModalProps {
  order: SalesHeader | null;
  isOpen: boolean;
  // Finished-goods stock per product id. The order's own lines don't carry it (sales_detail has no
  // stock column), so the parent looks it up.
  stockByProductId: Record<string, number>;
  shortfalls: MaterialShortfall[];
  onClose: () => void;
  onCheck: (produce: ProduceLine[]) => Promise<void>;
  onConfirm: (produce: ProduceLine[]) => Promise<void>;
}

// What a line still owes the client. Non-zero delivered_quantity means part of the line already
// shipped from stock (production is optional now — an order can deliver before it ever produces), and
// producing that part again would double-make it.
const outstandingOf = (d: { quantity: number; deliveredQuantity: number }) =>
  Math.max(0, d.quantity - d.deliveredQuantity);

export default function StartProductionModal({
  order, isOpen, stockByProductId, shortfalls, onClose, onCheck, onConfirm,
}: StartProductionModalProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  // Shortfalls are only meaningful for the quantities they were computed from, so any edit
  // invalidates them — the user must re-check before the confirm unlocks.
  const [checkedFor, setCheckedFor] = useState<string>('');

  // Prefill each line with what stock doesn't already cover. Re-runs when the dialog opens on a
  // different order, so one order's edits can't leak into the next.
  useEffect(() => {
    if (!isOpen || !order) return;
    const initial: Record<string, number> = {};
    order.details.forEach(d => {
      initial[d.detailId] = suggestedProduceQuantity(outstandingOf(d), stockByProductId[d.productId] ?? 0);
    });
    setQuantities(initial);
    setCheckedFor('');
    setSubmitting(false);
  }, [isOpen, order, stockByProductId]);

  if (!isOpen || !order) return null;

  const produceLines = (): ProduceLine[] =>
    order.details.map(d => ({ detailId: d.detailId, quantity: quantities[d.detailId] ?? 0 }));

  const currentKey = JSON.stringify(quantities);
  const isChecked = checkedFor === currentKey;
  const blocked = shortfalls.length > 0;
  // A run that makes nothing is not a run — startProduction rejects it too. Stock already covers the
  // order? Deliver it instead of starting an empty production stage.
  const nothingToProduce = produceLines().every(l => l.quantity <= 0);

  const handleChange = (detailId: string, raw: string) => {
    setQuantities({ ...quantities, [detailId]: Math.max(0, Number(raw) || 0) });
    setCheckedFor('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || nothingToProduce) return;

    // Two-step on purpose. Material validation is a hard gate — startProduction deducts stock with
    // nothing at the DB level stopping material.quantity going negative — so the shortfall list is
    // computed against the quantities actually entered, shown, and only then can it be confirmed.
    if (!isChecked) {
      setSubmitting(true);
      try {
        await onCheck(produceLines());
        setCheckedFor(currentKey);
      } finally {
        setSubmitting(false);
      }
      return;
    }
    if (blocked) return;

    setSubmitting(true);
    try {
      await onConfirm(produceLines());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onClose={onClose} title={`Start Production — ${order.salesNo}`} maxWidth="max-w-3xl">
      <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
        <div className="border border-slate-150 rounded-lg overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto_7rem] gap-3 px-3 py-2 bg-slate-50 font-semibold text-slate-600 text-[11px]">
            <span>Product</span>
            <span className="text-right w-20">Ordered</span>
            <span className="text-right w-20">Delivered</span>
            <span className="text-right w-20">In Stock</span>
            <span className="text-right w-20">Suggested</span>
            <span className="text-right">Produce Qty</span>
          </div>

          {order.details.map(detail => {
            const inStock = stockByProductId[detail.productId] ?? 0;
            const suggested = suggestedProduceQuantity(outstandingOf(detail), inStock);
            return (
              <div key={detail.detailId} className="grid grid-cols-[1fr_auto_auto_auto_auto_7rem] gap-3 items-center px-3 py-2 border-t border-slate-150">
                <span className="text-slate-700 truncate">{detail.productName}</span>
                <span className="text-right w-20 font-mono text-slate-600">{detail.quantity}</span>
                <span className="text-right w-20 font-mono text-slate-600">{detail.deliveredQuantity}</span>
                <span className="text-right w-20 font-mono text-slate-600">{inStock}</span>
                <span className="text-right w-20 font-mono text-slate-400">{suggested}</span>
                <input
                  type="number"
                  min="0"
                  value={quantities[detail.detailId] ?? 0}
                  onChange={(e) => handleChange(detail.detailId, e.target.value)}
                  className="w-full px-2 py-1 bg-white border border-slate-200 rounded focus:outline-none text-[11px] text-right"
                />
              </div>
            );
          })}
        </div>

        <p className="text-[10px] text-slate-400">
          Suggested is <span className="font-mono">ordered − delivered − stock on hand</span> — only what's
          left to cover. Produce Qty is yours to set: raw materials are deducted against the quantity you
          confirm, not the ordered quantity.
        </p>

        {isChecked && blocked && (
          <div className="border border-red-200 bg-red-50/60 rounded-lg p-3 space-y-1.5">
            <span className="flex items-center gap-1.5 font-semibold text-red-700 text-[11px]">
              <AlertTriangle className="w-3.5 h-3.5" /> Insufficient raw material — production is blocked
            </span>
            {shortfalls.map(s => (
              <div key={s.materialId} className="flex justify-between text-[11px] text-red-700">
                <span>{s.materialName}</span>
                <span className="font-mono">need {s.required}, have {s.available} (short {Math.round((s.required - s.available) * 100) / 100})</span>
              </div>
            ))}
            <p className="text-[10px] text-red-600/80 pt-0.5">
              Purchase the shortfall or lower the Produce Qty, then check again.
            </p>
          </div>
        )}

        {isChecked && !blocked && !nothingToProduce && (
          <div className="border border-emerald-200 bg-emerald-50/60 rounded-lg px-3 py-2 text-[11px] text-emerald-700">
            Raw material is sufficient for these quantities.
          </div>
        )}

        {nothingToProduce && (
          <div className="border border-amber-200 bg-amber-50/60 rounded-lg px-3 py-2 text-[11px] text-amber-700">
            Nothing to produce — every line is 0. Stock already covers this order, so close this and use
            Deliver instead.
          </div>
        )}

        <DialogFooter>
          <DialogCancelButton onClick={onClose} />
          <DialogSubmitButton disabled={submitting || nothingToProduce || (isChecked && blocked)}>
            {submitting ? 'Working...' : isChecked ? 'Confirm & Deduct Material' : 'Check Material'}
          </DialogSubmitButton>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
