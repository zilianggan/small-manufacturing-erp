/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState, FormEvent } from 'react';
import { SalesHeader, Material } from '../types';
import { NewMaterialUsage } from '../services/OrdersService';
import { Dialog, DialogFooter, DialogCancelButton, DialogSubmitButton, Button, fieldInputClassName } from './ui';
import ComboBox from './ComboBox';

interface AddMaterialModalProps {
  order: SalesHeader | null;
  isOpen: boolean;
  rawMaterials: Material[];
  onClose: () => void;
  onSubmit: (rows: NewMaterialUsage[]) => Promise<void>;
}

interface StagedRow extends NewMaterialUsage {
  productName: string;
  materialName: string;
}

// For adding a BOM row to a line that was ordered without one — see canAddMaterial's doc comment in
// OrdersService.ts for why this is a separate action from Edit rather than routing through it.
export default function AddMaterialModal({ order, isOpen, rawMaterials, onClose, onSubmit }: AddMaterialModalProps) {
  const [staged, setStaged] = useState<StagedRow[]>([]);
  const [tempDetailId, setTempDetailId] = useState('');
  const [tempMaterialId, setTempMaterialId] = useState('');
  const [tempQty, setTempQty] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setStaged([]);
    setTempDetailId(order?.details[0]?.detailId ?? '');
    setTempMaterialId('');
    setTempQty(1);
    setSubmitting(false);
  }, [isOpen, order]);

  if (!isOpen || !order) return null;

  const handleAdd = () => {
    const detail = order.details.find(d => d.detailId === tempDetailId);
    const material = rawMaterials.find(m => m.id === tempMaterialId);
    if (!detail || !material || tempQty <= 0) return;
    setStaged([...staged, {
      detailId: detail.detailId,
      materialId: material.id,
      plannedQuantity: tempQty,
      productName: detail.productName,
      materialName: material.name,
    }]);
    setTempMaterialId('');
    setTempQty(1);
  };

  const handleRemove = (idx: number) => setStaged(staged.filter((_, i) => i !== idx));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (staged.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(staged.map(({ detailId, materialId, plannedQuantity }) => ({ detailId, materialId, plannedQuantity })));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onClose={onClose} title={`Add Material — ${order.salesNo}`} maxWidth="max-w-2xl">
      <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
        <div className="border border-slate-150 rounded-lg overflow-hidden">
          <div className="grid grid-cols-[1fr_1fr_6rem_2rem] gap-2 px-3 py-2 bg-slate-50 font-semibold text-slate-600 text-[11px]">
            <span>Product</span>
            <span>Material</span>
            <span className="text-right">Planned Qty</span>
            <span />
          </div>
          {staged.length === 0 ? (
            <div className="text-center py-3 text-slate-400 text-[11px]">No materials staged yet.</div>
          ) : staged.map((row, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_1fr_6rem_2rem] gap-2 items-center px-3 py-2 border-t border-slate-150">
              <span className="text-slate-700 truncate">{row.productName}</span>
              <span className="text-slate-700 truncate">{row.materialName}</span>
              <span className="text-right font-mono text-slate-600">{row.plannedQuantity}</span>
              <button type="button" onClick={() => handleRemove(idx)} className="text-red-500 hover:text-red-600 text-center">×</button>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
          <div className="sm:col-span-4">
            <ComboBox
              value={tempDetailId}
              onChange={setTempDetailId}
              options={order.details.map((d, idx) => ({ value: d.detailId, label: `${d.productName}${order.details.filter(x => x.productName === d.productName).length > 1 ? ` (line ${idx + 1})` : ''}` }))}
            />
          </div>
          <div className="sm:col-span-4">
            <ComboBox
              value={tempMaterialId}
              onChange={setTempMaterialId}
              noneLabel="-- Choose Material --"
              options={rawMaterials.map(m => ({ value: m.id, label: m.name, sublabel: `Stock: ${m.quantity}` }))}
            />
          </div>
          <div className="sm:col-span-2">
            <input
              type="number" min="1" value={tempQty}
              onChange={(e) => setTempQty(Number(e.target.value))}
              className={fieldInputClassName}
            />
          </div>
          <div className="sm:col-span-2">
            <Button type="button" className="w-full" onClick={handleAdd} disabled={!tempDetailId || !tempMaterialId || tempQty <= 0}>
              +
            </Button>
          </div>
        </div>

        <p className="text-[10px] text-slate-400">
          Adds a Planned Qty for the line's full ordered quantity — Start Production still scales it to
          whatever's actually produced.
        </p>

        <DialogFooter>
          <DialogCancelButton onClick={onClose} />
          <DialogSubmitButton disabled={staged.length === 0 || submitting}>
            {submitting ? 'Saving...' : `Add ${staged.length || ''} Material${staged.length === 1 ? '' : 's'}`}
          </DialogSubmitButton>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
