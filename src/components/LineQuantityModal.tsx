/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Dialog, DialogFooter, DialogCancelButton, DialogSubmitButton } from './ui';

// One modal for all four per-line quantity actions in the order lifecycle:
//
//   Receive Goods      Material  Ordered   / Received   → cap: ordered − received
//   Deliver            Product   Ordered   / Delivered  → cap: ordered − delivered
//   Return to Vendor   Material  Received  / Returned   → cap: received − returned
//   Return from Client Product   Delivered / Returned   → cap: delivered − returned
//
// They're the same interaction — pick a quantity per line, capped at what's left to act on — so
// they're one component with the nouns passed in, not four near-identical ones. (This was
// ReturnModal; it grew the other two callers.)
export interface LineQuantityModalLine {
  id: string;       // detailId
  name: string;     // material or product name
  totalQty: number; // the ceiling: ordered, received, or delivered
  doneQty: number;  // how much of it is already accounted for
  requiredQty?: number; // optional extra column — e.g. Deliver's true ordered qty, since totalQty there is capped by stock/production, not the order itself
}

interface LineQuantityModalProps {
  isOpen: boolean;
  title: string;
  itemHeader: string;   // "Material" | "Product"
  requiredHeader?: string; // header for the optional requiredQty column, e.g. "Required"
  totalHeader: string;  // "Ordered" | "Received" | "Delivered"
  doneHeader: string;   // "Received" | "Delivered" | "Returned"
  actionLabel: string;  // column header + submit verb, e.g. "Receive"
  doneLabel?: string;   // what a maxed-out line reads, e.g. "fully received"
  remarkPlaceholder?: string;
  lines: LineQuantityModalLine[];
  onClose: () => void;
  onSubmit: (quantities: Record<string, number>, remark: string) => Promise<void>;
}

export default function LineQuantityModal({
  isOpen, title, itemHeader, requiredHeader, totalHeader, doneHeader, actionLabel,
  doneLabel = 'complete', remarkPlaceholder, lines, onClose, onSubmit,
}: LineQuantityModalProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [remark, setRemark] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Clear the draft when the modal opens — without this, a previous draft's typed
  // quantities would leak into the next one. Keyed on isOpen alone; depending on lines
  // would reset the draft on any parent re-render (since callers build the array inline),
  // wiping quantities mid-edit.
  useEffect(() => {
    if (!isOpen) return;
    setQuantities({});
    setRemark('');
    setSubmitting(false);
  }, [isOpen]);

  const remainingOf = (line: LineQuantityModalLine) => Math.max(0, line.totalQty - line.doneQty);
  const hasAnything = Object.values(quantities).some(q => q > 0);

  const handleChange = (line: LineQuantityModalLine, raw: string) => {
    // Clamp on the way in so the field can never show a quantity the service would silently
    // reject. The service clamps too — this is the courtesy, that one is the guarantee.
    const clamped = Math.max(0, Math.min(Number(raw) || 0, remainingOf(line)));
    setQuantities({ ...quantities, [line.id]: clamped });
  };

  // Prefill every line with everything still outstanding. The common case for all four actions is
  // "all of it" — a partial is the exception, and it's one keystroke away.
  const fillRemaining = () => {
    const next: Record<string, number> = {};
    lines.forEach(line => { next[line.id] = remainingOf(line); });
    setQuantities(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasAnything || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(quantities, remark.trim());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onClose={onClose} title={title} maxWidth="max-w-2xl">
      <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
        <div className="border border-slate-150 rounded-lg overflow-hidden">
          <div className={`grid ${requiredHeader ? 'grid-cols-[1fr_auto_auto_auto_7rem]' : 'grid-cols-[1fr_auto_auto_7rem]'} gap-3 px-3 py-2 bg-slate-50 font-semibold text-slate-600 text-[11px]`}>
            <span>{itemHeader}</span>
            {requiredHeader && <span className="text-right w-20">{requiredHeader}</span>}
            <span className="text-right w-20">{totalHeader}</span>
            <span className="text-right w-20">{doneHeader}</span>
            <span className="text-right">{actionLabel}</span>
          </div>

          {lines.map(line => {
            const remaining = remainingOf(line);
            return (
              <div key={line.id} className={`grid ${requiredHeader ? 'grid-cols-[1fr_auto_auto_auto_7rem]' : 'grid-cols-[1fr_auto_auto_7rem]'} gap-3 items-center px-3 py-2 border-t border-slate-150`}>
                <span className="text-slate-700 truncate">{line.name}</span>
                {requiredHeader && <span className="text-right w-20 font-mono text-slate-600">{line.requiredQty ?? '—'}</span>}
                <span className="text-right w-20 font-mono text-slate-600">{line.totalQty}</span>
                <span className="text-right w-20 font-mono text-slate-600">{line.doneQty}</span>
                {remaining === 0 ? (
                  <span className="text-right text-[10px] text-slate-400 italic">
                    {line.requiredQty !== undefined && line.doneQty < line.requiredQty ? 'awaiting stock' : doneLabel}
                  </span>
                ) : (
                  <input
                    type="number"
                    min="0"
                    max={remaining}
                    value={quantities[line.id] ?? 0}
                    onChange={(e) => handleChange(line, e.target.value)}
                    className="w-full px-2 py-1 bg-white border border-slate-200 rounded focus:outline-none text-[11px] text-right"
                  />
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <label className="font-semibold text-slate-700 text-[11px] block">Remark</label>
            <input
              type="text"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder={remarkPlaceholder}
              className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded focus:outline-none text-[11px]"
            />
          </div>
          <button
            type="button"
            onClick={fillRemaining}
            className="px-2.5 py-1.5 border border-slate-200 rounded text-[11px] text-slate-600 hover:bg-slate-50 whitespace-nowrap"
          >
            {actionLabel} All
          </button>
        </div>

        <DialogFooter>
          <DialogCancelButton onClick={onClose} />
          <DialogSubmitButton disabled={!hasAnything || submitting}>
            {submitting ? 'Saving...' : `Confirm ${actionLabel}`}
          </DialogSubmitButton>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
