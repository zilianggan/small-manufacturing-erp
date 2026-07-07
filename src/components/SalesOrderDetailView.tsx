/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { SalesHeader } from '../types';
import {
  ArrowLeft, Calendar, Paperclip, Trash2, Edit, FileText, ArrowRightCircle,
  Check, CheckCheck, Factory, Boxes,
} from 'lucide-react';
import { Card } from './ui';

interface SalesOrderDetailViewProps {
  order: SalesHeader;
  onBack: () => void;
  transitioningId: string | null;
  onEdit: (order: SalesHeader) => void;
  onConvert: (order: SalesHeader) => void;
  onDelete: (id: string) => void;
  onStartProduction: (order: SalesHeader) => void;
  onProductionCompletion: (order: SalesHeader) => void;
  onMarkDelivered: (id: string) => void;
  onCancel: (order: SalesHeader) => void;
  onOpenQuotationDoc: (order: SalesHeader) => void;
  onOpenInvoiceDoc: (order: SalesHeader) => void;
}

/**
 * Drill-down "detail page" for a single sales contract (SalesHeader): header
 * summary + status-appropriate lifecycle actions (mirrors OrdersView.tsx's
 * row action cell) plus a read-only line item / material breakdown. Split
 * out of OrdersView.tsx so that view stays focused on the listing/search/
 * form flow — actions themselves still live in OrdersView and are passed
 * down as callbacks so there's a single source of truth for each transition.
 */
export default function SalesOrderDetailView({
  order, onBack, transitioningId,
  onEdit, onConvert, onDelete, onStartProduction, onProductionCompletion,
  onMarkDelivered, onCancel, onOpenQuotationDoc, onOpenInvoiceDoc,
}: SalesOrderDetailViewProps) {
  const statusBadgeClass = order.status === 'ORDERED' ? 'bg-amber-50 text-amber-800 border-amber-200'
    : order.status === 'IN_PRODUCTION' ? 'bg-blue-50 text-blue-800 border-blue-200'
      : order.status === 'DONE_IN_PRODUCTION' ? 'bg-violet-50 text-violet-800 border-violet-200'
        : order.status === 'DELIVERED' ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
          : order.status === 'CANCELLED' ? 'bg-red-50 text-red-800 border-red-200'
            : 'bg-slate-50 text-slate-600 border-slate-200';

  const statusLabel = order.status === 'ORDERED' ? 'Pending Delivery'
    : order.status === 'IN_PRODUCTION' ? 'In Production'
      : order.status === 'DONE_IN_PRODUCTION' ? 'Done in Production'
        : order.status;

  return (
    <div className="space-y-6" id="sales-order-detail-view">
      <button
        onClick={onBack}
        className="flex items-center space-x-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>Back to Sales Contracts</span>
      </button>

      {/* Header summary card */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-2.5 min-w-0">
            <div>
              <h2 className="font-sans font-bold text-slate-900 text-lg leading-snug font-mono">{order.salesNo}</h2>
              <p className="text-xs text-slate-500 mt-1">{order.clientName}</p>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${statusBadgeClass}`}>
                {statusLabel || order.status}
              </span>
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500">
              <div className="flex items-center space-x-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-slate-400">Order Date:</span>
                <span>{order.orderDate}</span>
              </div>
              {order.deliveryDate && (
                <div className="flex items-center space-x-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-slate-400">Delivery Due:</span>
                  <span>{order.deliveryDate}</span>
                </div>
              )}
              <div className="flex items-center space-x-1.5">
                <span className="text-slate-400">Contract Total:</span>
                <span className="font-mono font-semibold text-slate-800">RM {order.totalAmount.toLocaleString('en-US')}</span>
              </div>
            </div>

            {order.remark && (
              <p className="text-xs text-slate-500 max-w-2xl">{order.remark}</p>
            )}

            {order.attachments?.[0] && (
              <a
                href={order.attachments[0].dataUrl}
                download={order.attachments[0].name}
                className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-[10px] font-mono transition-colors"
                title="Download attachment"
              >
                <Paperclip className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                <span className="truncate max-w-[200px]">{order.attachments[0].name}</span>
              </a>
            )}
          </div>

          {/* Status-appropriate lifecycle actions (mirrors OrdersView.tsx's row actions) */}
          <div className="flex items-center flex-wrap gap-1.5 shrink-0">
            {order.status === 'QUOTATION' && (
              <>
                <button onClick={() => onEdit(order)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded transition-colors" title="Edit">
                  <Edit className="w-4 h-4" />
                </button>
                <button onClick={() => onDelete(order.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded transition-colors" title="Delete">
                  <Trash2 className="w-4 h-4" />
                </button>
                <button onClick={() => onOpenQuotationDoc(order)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded transition-colors" title="Generate Quotation">
                  <FileText className="w-4 h-4" />
                </button>
                <button onClick={() => onConvert(order)} className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors" title="Proceed to Sales Order">
                  <ArrowRightCircle className="w-4 h-4" />
                </button>
              </>
            )}

            {order.status === 'ORDERED' && (
              <>
                <button onClick={() => onEdit(order)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded transition-colors" title="Edit">
                  <Edit className="w-4 h-4" />
                </button>
                <button onClick={() => onOpenInvoiceDoc(order)} title="Generate Tax Invoice" className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded transition-colors">
                  <FileText className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onStartProduction(order)}
                  disabled={transitioningId === order.id}
                  title="Proceed to production"
                  className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Factory className="w-4 h-4" />
                </button>
                <button onClick={() => onCancel(order)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded transition-colors text-[11px] font-medium">
                  Cancel
                </button>
              </>
            )}

            {order.status === 'IN_PRODUCTION' && (
              <>
                <button onClick={() => onOpenInvoiceDoc(order)} title="Generate Tax Invoice" className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded transition-colors">
                  <FileText className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onProductionCompletion(order)}
                  disabled={transitioningId === order.id}
                  title="Mark production as done"
                  className="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <CheckCheck className="w-4 h-4" />
                </button>
                <button onClick={() => onCancel(order)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded transition-colors text-[11px] font-medium">
                  Cancel
                </button>
              </>
            )}

            {order.status === 'DONE_IN_PRODUCTION' && (
              <>
                <button onClick={() => onOpenInvoiceDoc(order)} title="Generate Tax Invoice" className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded transition-colors">
                  <FileText className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onMarkDelivered(order.id)}
                  disabled={transitioningId === order.id}
                  title="Mark as delivered"
                  className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Check className="w-4 h-4" />
                </button>
              </>
            )}

            {order.status === 'DELIVERED' && (
              <>
                <button onClick={() => onOpenInvoiceDoc(order)} title="Generate Tax Invoice" className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded transition-colors">
                  <FileText className="w-4 h-4" />
                </button>
                <span className="text-[11px] text-emerald-600 font-semibold flex items-center space-x-0.5 font-mono px-1.5">
                  <span>✓ Delivered</span>
                </span>
              </>
            )}

            {order.status === 'CANCELLED' && (
              <>
                <span className="text-[11px] text-slate-400 font-mono italic px-1.5">Cancelled</span>
                <button onClick={() => onDelete(order.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded transition-colors" title="Delete">
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Line items + material breakdown */}
      <div className="flex items-center gap-2">
        <Boxes className="w-4 h-4 text-slate-500" />
        <h3 className="font-sans font-bold text-slate-900 text-sm">Contract Line Items</h3>
      </div>

      <div className="space-y-2">
        {order.details.map((item, idx) => (
          <Card key={item.detailId || idx} className="p-3.5">
            <div className="flex items-center justify-between gap-3">
              <span className="font-sans font-semibold text-slate-800 text-xs">{item.productName}</span>
              <span className="text-[11px] text-slate-500 font-mono">
                Qty: {item.quantity} @ RM {item.unitPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} = RM {item.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            {item.materials.length > 0 && (
              <div className="mt-2 pl-3 border-l-2 border-slate-100 space-y-1">
                {item.materials.map((m, midx) => (
                  <div key={midx} className="text-[10px] text-slate-500 font-mono flex items-center gap-3">
                    <span>{m.materialName}</span>
                    <span>planned {m.plannedQuantity}</span>
                    {(m.actualQuantity > 0 || m.returnedQuantity > 0) && (
                      <>
                        <span>actual {m.actualQuantity}</span>
                        <span>returned {m.returnedQuantity}</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
