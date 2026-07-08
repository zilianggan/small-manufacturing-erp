/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { PurchaseHeader } from '../types';
import {
  ArrowLeft, Calendar, Paperclip, Trash2, Edit, FileText, ArrowRightCircle, Check, Boxes,
} from 'lucide-react';
import { Card } from './ui';
import SortableTh from './SortableTh';
import { sortByField } from '../utils/sortRows';

type LineItemSortKey = 'materialName' | 'quantity' | 'unitCost' | 'totalPrice' | 'receivedQuantity';
const NUMERIC_KEYS: LineItemSortKey[] = ['quantity', 'unitCost', 'totalPrice', 'receivedQuantity'];

interface PurchaseOrderDetailViewProps {
  purchase: PurchaseHeader;
  onBack: () => void;
  // Label for the Back button — defaults to "Back to Purchases" for a plain
  // in-tab drill-in, but the caller overrides it (e.g. "Back to Material")
  // when this page was opened via a cross-tab link so onBack actually
  // returns to that origin instead of this tab's list.
  backLabel?: string;
  receivingId: string | null;
  onEdit: (purchase: PurchaseHeader) => void;
  onConvert: (purchase: PurchaseHeader) => void;
  onDelete: (id: string) => void;
  onReceive: (purchase: PurchaseHeader) => void;
  onCancel: (id: string) => void;
  onOpenQuotationDoc: (purchase: PurchaseHeader) => void;
}

/**
 * Drill-down "detail page" for a single purchase (PurchaseHeader): header
 * summary + status-appropriate lifecycle actions (mirrors PurchasesView.tsx's
 * row action cell) plus a read-only material line item breakdown. Split out
 * of PurchasesView.tsx so that view stays focused on the listing/search/form
 * flow — actions themselves still live in PurchasesView and are passed down
 * as callbacks so there's a single source of truth for each transition.
 */
export default function PurchaseOrderDetailView({
  purchase, onBack, backLabel = 'Back to Purchases', receivingId,
  onEdit, onConvert, onDelete, onReceive, onCancel, onOpenQuotationDoc
}: PurchaseOrderDetailViewProps) {
  const statusBadgeClass = purchase.status === 'ORDERED' ? 'bg-amber-50 text-amber-800 border-amber-200'
    : purchase.status === 'RECEIVED' ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
      : purchase.status === 'CANCELLED' ? 'bg-red-50 text-red-800 border-red-200'
        : 'bg-slate-50 text-slate-600 border-slate-200';

  // Click-to-sort table headers. Whole list is already loaded (one order's
  // line items, never heavy), so this sorts client-side rather than re-fetching.
  const [sortKey, setSortKey] = useState<LineItemSortKey>('materialName');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const toggleSort = (key: LineItemSortKey) => {
    if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };
  const sortedDetails = useMemo(
    () => sortByField(purchase.details, sortKey, sortDir, NUMERIC_KEYS),
    [purchase.details, sortKey, sortDir]
  );

  return (
    <div className="space-y-6" id="purchase-order-detail-view">
      <button
        onClick={onBack}
        className="flex items-center space-x-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>{backLabel}</span>
      </button>

      {/* Header summary card */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-2.5 min-w-0">
            <div>
              <h2 className="font-sans font-bold text-slate-900 text-lg leading-snug font-mono">{purchase.purchaseNo}</h2>
              <p className="text-xs text-slate-500 mt-1">{purchase.vendorName}</p>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${statusBadgeClass}`}>
                {purchase.status === 'ORDERED' ? 'Pending Stock' : purchase.status}
              </span>
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500">
              <div className="flex items-center space-x-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-slate-400">Quotation Date:</span>
                <span>{purchase.quotationDate}</span>
              </div>
              {purchase.orderDate && (
                <div className="flex items-center space-x-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-slate-400">Order Date:</span>
                  <span>{purchase.orderDate}</span>
                </div>
              )}
              {purchase.receivedDate && (
                <div className="flex items-center space-x-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-slate-400">Received Date:</span>
                  <span>{purchase.receivedDate}</span>
                </div>
              )}
              <div className="flex items-center space-x-1.5">
                <span className="text-slate-400">Total Cost:</span>
                <span className="font-mono font-semibold text-slate-800">RM {purchase.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>

            {purchase.attachments?.[0] && (
              <a
                href={purchase.attachments[0].dataUrl}
                download={purchase.attachments[0].name}
                className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-[10px] font-mono transition-colors"
                title="Download attachment"
              >
                <Paperclip className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                <span className="truncate max-w-[200px]">{purchase.attachments[0].name}</span>
              </a>
            )}
          </div>

          {/* Status-appropriate lifecycle actions (mirrors PurchasesView.tsx's row actions) */}
          <div className="flex items-center flex-wrap gap-1.5 shrink-0">
            {purchase.status === 'QUOTATION' && (
              <>
                <button onClick={() => onEdit(purchase)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded transition-colors" title="Edit">
                  <Edit className="w-4 h-4" />
                </button>
                <button onClick={() => onDelete(purchase.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded transition-colors" title="Delete">
                  <Trash2 className="w-4 h-4" />
                </button>
                <button onClick={() => onOpenQuotationDoc(purchase)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded transition-colors" title="Generate Quotation">
                  <FileText className="w-4 h-4" />
                </button>
                <button onClick={() => onConvert(purchase)} className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors" title="Proceed to Purchase Order">
                  <ArrowRightCircle className="w-4 h-4" />
                </button>
              </>
            )}

            {purchase.status === 'ORDERED' && (
              <>
                <button onClick={() => onEdit(purchase)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded transition-colors" title="Edit">
                  <Edit className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onReceive(purchase)}
                  disabled={receivingId === purchase.id}
                  title="Mark material package as received"
                  className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button onClick={() => onCancel(purchase.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded transition-colors text-[11px] font-medium">
                  Cancel
                </button>
              </>
            )}

            {purchase.status === 'RECEIVED' && (
              <span className="text-[11px] text-emerald-600 font-semibold flex items-center space-x-0.5 font-mono px-1.5">
                <span className="px-2 py-0.5 bg-emerald-50 rounded">Replenished ✓</span>
              </span>
            )}

            {purchase.status === 'CANCELLED' && (
              <>
                <span className="text-[11px] text-slate-400 font-mono italic px-1.5">Cancelled</span>
                <button onClick={() => onDelete(purchase.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded transition-colors" title="Delete">
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Material line items */}
      <div className="flex items-center gap-2">
        <Boxes className="w-4 h-4 text-slate-500" />
        <h3 className="font-sans font-bold text-slate-900 text-sm">Material Line Items</h3>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-100">
              <tr>
                <SortableTh label="Material" sortKey="materialName" activeKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortableTh label="Quantity" sortKey="quantity" activeKey={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
                <SortableTh label="Unit Cost" sortKey="unitCost" activeKey={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
                <SortableTh label="Total Price" sortKey="totalPrice" activeKey={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
                <SortableTh label="Received Qty" sortKey="receivedQuantity" activeKey={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedDetails.map((item, idx) => (
                <tr key={item.detailId || idx} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-2.5 font-semibold text-slate-800">{item.materialName}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-600">{item.quantity}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-600">RM {item.unitCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-800">RM {item.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-600">{item.receivedQuantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
