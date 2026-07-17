/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useState } from 'react';
import { PurchaseHeader, PurchaseDetail } from '../types';
import {
  ArrowLeft, Calendar, Paperclip, Trash2, Edit, ArrowRightCircle, Check, Boxes, FileSpreadsheet, FileText, Undo2, MessageCircle,
} from 'lucide-react';
import { Card, Badge, Button } from './ui';
import { SectionCard, DataTable } from './shell';
import type { DataTableColumn } from './shell';
import { useFadeInOnMount } from '../hooks/useFadeInOnMount';
import { formatDateTime, formatDate } from '../utils/date';

type LineItemSortKey = 'materialName' | 'quantity' | 'unitCost' | 'totalPrice' | 'receivedQuantity';
const NUMERIC_KEYS: LineItemSortKey[] = ['quantity', 'unitCost', 'totalPrice', 'receivedQuantity'];

const STATUS_META: Record<PurchaseHeader['status'], { label: string; variant: 'default' | 'warning' | 'success' | 'destructive' | 'secondary' }> = {
  QUOTATION: { label: 'Quotation', variant: 'default' },
  ORDERED: { label: 'Pending Stock', variant: 'warning' },
  PARTIALLY_RECEIVED: { label: 'Partially Received', variant: 'warning' },
  RECEIVED: { label: 'Received', variant: 'success' },
  PARTIALLY_RETURNED: { label: 'Partially Returned', variant: 'warning' },
  RETURNED: { label: 'Returned', variant: 'secondary' },
  CANCELLED: { label: 'Cancelled', variant: 'destructive' },
};

interface PurchaseOrderDetailViewProps {
  purchase: PurchaseHeader;
  onBack: () => void;
  // Label for the Back button — defaults to "Back to Purchases" for a plain
  // in-tab drill-in, but the caller overrides it (e.g. "Back to Material")
  // when this page was opened via a cross-tab link so onBack actually
  // returns to that origin instead of this tab's list.
  backLabel?: string;
  onEdit: (purchase: PurchaseHeader) => void;
  onConvert: (purchase: PurchaseHeader) => void;
  onDelete: (id: string) => void;
  onReceive: (purchase: PurchaseHeader) => void;
  onCancel: (id: string) => void;
  onReturn: (purchase: PurchaseHeader) => void;
  onOpenInvoiceDoc: (purchase: PurchaseHeader) => void;
  // Present only when purchase.salesHeaderId is set — jumps to the sales
  // order this purchase was raised against.
  onViewSalesOrder?: (salesHeaderId: string) => void;
  // Present only when purchase.contactName/contactPhone are set — opens WhatsApp with the filled Purchase template.
  onWhatsapp?: (purchase: PurchaseHeader) => void;
}

const sortByField = <K extends LineItemSortKey>(rows: PurchaseDetail[], key: K, dir: 'asc' | 'desc'): PurchaseDetail[] => {
  const isNumeric = NUMERIC_KEYS.includes(key);
  const mul = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[key], bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (isNumeric) return ((av as unknown as number) - (bv as unknown as number)) * mul;
    return String(av).localeCompare(String(bv)) * mul;
  });
};

/**
 * Drill-down "detail page" for a single purchase (PurchaseHeader): header
 * summary + status-appropriate lifecycle actions (mirrors PurchasesView.tsx's
 * row action cell) plus a read-only material line item breakdown. Split out
 * of PurchasesView.tsx so that view stays focused on the listing/search/form
 * flow — actions themselves still live in PurchasesView and are passed down
 * as callbacks so there's a single source of truth for each transition.
 */
export default function PurchaseOrderDetailView({
  purchase, onBack, backLabel = 'Back to Purchases',
  onEdit, onConvert, onDelete, onReceive, onCancel, onReturn, onOpenInvoiceDoc, onViewSalesOrder, onWhatsapp
}: PurchaseOrderDetailViewProps) {
  const contentRef = useFadeInOnMount<HTMLDivElement>([purchase.id]);
  const status = STATUS_META[purchase.status];

  // Whole list is already loaded (one order's line items, never heavy), so
  // this sorts client-side rather than re-fetching.
  const [sortKey, setSortKey] = useState<LineItemSortKey>('materialName');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const toggleSort = (key: string) => {
    const field = key as LineItemSortKey;
    if (field === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(field); setSortDir('asc'); }
  };
  const sortedDetails = useMemo(
    () => sortByField(purchase.details, sortKey, sortDir),
    [purchase.details, sortKey, sortDir]
  );

  const columns: DataTableColumn<PurchaseDetail>[] = [
    { key: 'materialName', header: 'Material', sortable: true, render: (d) => <span className="font-medium text-card-foreground">{d.materialName}</span> },
    { key: 'quantity', header: 'Ordered', sortable: true, align: 'right', render: (d) => <span className="font-mono text-muted-foreground">{d.quantity}</span> },
    { key: 'unitCost', header: 'Unit Cost', sortable: true, align: 'right', render: (d) => <span className="font-mono text-muted-foreground">RM {d.unitCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> },
    { key: 'totalPrice', header: 'Total Price', sortable: true, align: 'right', render: (d) => <span className="font-mono font-medium text-foreground">RM {d.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> },
    // Receiving is partial, so "received 40" alone doesn't say whether the line is done — show it
    // against the ordered qty, and highlight while anything is still outstanding.
    {
      key: 'receivedQuantity', header: 'Received', sortable: true, align: 'right',
      render: (d) => (
        <span className={`font-mono ${d.receivedQuantity >= d.quantity ? 'text-muted-foreground' : 'text-foreground font-medium'}`}>
          {d.receivedQuantity} / {d.quantity}
        </span>
      ),
    },
    {
      key: 'returnedQuantity', header: 'Returned', align: 'right',
      render: (d) => <span className="font-mono text-muted-foreground">{d.returnedQuantity || '—'}</span>,
    },
  ];

  return (
    <div ref={contentRef} className="space-y-5" id="purchase-order-detail-view">
      <button
        data-fade-item
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>{backLabel}</span>
      </button>

      {/* Header summary card */}
      <div data-fade-item>
        <Card className="p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-2.5 min-w-0">
              <div>
                <h2 className="font-mono font-bold text-foreground text-lg leading-snug">{purchase.purchaseNo}</h2>
                <p className="text-xs text-muted-foreground mt-1">{purchase.vendorName}</p>
                {purchase.contactName && purchase.contactPhone && (
                  <button
                    type="button"
                    onClick={() => onWhatsapp?.(purchase)}
                    className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline mt-1"
                    title="Message on WhatsApp"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    <span>{purchase.contactName}</span>
                  </button>
                )}
              </div>

              <Badge variant={status.variant}>{status.label}</Badge>

              {purchase.salesNo && purchase.salesHeaderId && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Sales Ref No:</span>
                  {onViewSalesOrder ? (
                    <button
                      type="button"
                      onClick={() => onViewSalesOrder(purchase.salesHeaderId!)}
                      className="font-mono text-primary hover:underline"
                    >
                      {purchase.salesNo}
                    </button>
                  ) : (
                    <span className="font-mono text-foreground">{purchase.salesNo}</span>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Quotation Date:</span>
                  <span className="text-foreground">{formatDateTime(purchase.quotationDate)}</span>
                </div>
                {purchase.orderDate && (
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>Order Date:</span>
                    <span className="text-foreground">{formatDateTime(purchase.orderDate)}</span>
                  </div>
                )}
                {purchase.receivedDate && (
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>Received Date:</span>
                    <span className="text-foreground">{formatDate(purchase.receivedDate)}</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <span>Total Cost:</span>
                  <span className="font-mono font-semibold text-foreground">RM {purchase.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>

              {purchase.attachments?.[0] && (
                <a
                  href={purchase.attachments[0].dataUrl}
                  download={purchase.attachments[0].name}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-primary/10 hover:bg-primary/20 text-primary rounded text-[10px] font-mono transition-colors"
                  title="Download attachment"
                >
                  <Paperclip className="w-2.5 h-2.5 shrink-0" />
                  <span className="truncate max-w-[200px]">{purchase.attachments[0].name}</span>
                </a>
              )}
            </div>

            {/* Status-appropriate lifecycle actions (mirrors PurchasesView.tsx's row actions) */}
            <div className="flex items-center flex-wrap gap-1.5 w-full sm:w-auto sm:shrink-0">
              {purchase.status === 'QUOTATION' && (
                <>
                  <Button variant="outline" size="sm" onClick={() => onEdit(purchase)}><Edit className="w-3.5 h-3.5" /> Edit</Button>
                  <Button size="sm" onClick={() => onConvert(purchase)}><ArrowRightCircle className="w-3.5 h-3.5" /> Proceed to Purchase Order</Button>
                  <Button variant="destructive" size="sm" onClick={() => onDelete(purchase.id)}><Trash2 className="w-3.5 h-3.5" /> Delete</Button>
                </>
              )}

              {['ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(purchase.status) && (
                <Button variant="outline" size="sm" onClick={() => onOpenInvoiceDoc(purchase)}><FileText className="w-3.5 h-3.5" /> Generate Invoice</Button>
              )}

              {purchase.status === 'ORDERED' && (
                <Button variant="outline" size="sm" onClick={() => onEdit(purchase)}><Edit className="w-3.5 h-3.5" /> Edit</Button>
              )}

              {/* Receive while anything is outstanding; return once anything has arrived. Cancel is
                  ORDERED-only — the one status where no goods have moved — so it never sits next to
                  Return. */}
              {(purchase.status === 'ORDERED' || purchase.status === 'PARTIALLY_RECEIVED') && (
                <Button size="sm" onClick={() => onReceive(purchase)}>
                  <Check className="w-3.5 h-3.5" /> Receive Goods
                </Button>
              )}

              {purchase.status === 'ORDERED' && (
                <Button variant="destructive" size="sm" onClick={() => onCancel(purchase.id)}>Cancel Order</Button>
              )}

              {['PARTIALLY_RECEIVED', 'RECEIVED', 'PARTIALLY_RETURNED'].includes(purchase.status) && (
                <Button variant="destructive" size="sm" onClick={() => onReturn(purchase)}>
                  <Undo2 className="w-3.5 h-3.5" /> Return to Vendor
                </Button>
              )}

              {purchase.status === 'CANCELLED' && (
                <Button variant="destructive" size="sm" onClick={() => onDelete(purchase.id)}><Trash2 className="w-3.5 h-3.5" /> Delete</Button>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* Material line items */}
      <SectionCard
        data-fade-item
        title={<span className="inline-flex items-center gap-2"><Boxes className="w-4 h-4 text-muted-foreground" /> Material Line Items</span>}
        contentClassName="p-0"
      >
        <DataTable
          columns={columns}
          rows={sortedDetails}
          rowKey={(d) => d.detailId}
          sortField={sortKey}
          sortDir={sortDir}
          onSort={toggleSort}
        />
      </SectionCard>
    </div>
  );
}
