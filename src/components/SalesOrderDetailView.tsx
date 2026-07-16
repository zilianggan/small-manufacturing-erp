/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useState } from 'react';
import { SalesHeader, SalesDetail, ProductionMaterialUsage } from '../types';
import {
  ArrowLeft, Calendar, Paperclip, Trash2, Edit, FileText, ArrowRightCircle,
  Check, CheckCheck, Factory, Boxes, Undo2, Layers, Plus,
} from 'lucide-react';
import { canStartProduction, canDeliver, canDeleteSalesOrder, canAddMaterial, suggestedProduceQuantity } from '../services/OrdersService';
import { Card, Badge, Button } from './ui';
import { SectionCard, DataTable } from './shell';
import type { DataTableColumn } from './shell';
import { useFadeInOnMount } from '../hooks/useFadeInOnMount';
import { sortByField } from '../utils/sortRows';
import { PRIORITY_META, getDueUrgency } from '../utils/priority';
import { formatDateTime, formatDate } from '../utils/date';

type LineItemSortKey = 'productName' | 'quantity' | 'unitPrice' | 'totalPrice';
const NUMERIC_KEYS: LineItemSortKey[] = ['quantity', 'unitPrice', 'totalPrice'];

const STATUS_META: Record<SalesHeader['status'], { label: string; variant: 'default' | 'warning' | 'success' | 'destructive' | 'secondary' }> = {
  QUOTATION: { label: 'Quotation', variant: 'default' },
  ORDERED: { label: 'Pending Production', variant: 'warning' },
  IN_PRODUCTION: { label: 'In Production', variant: 'default' },
  DONE_IN_PRODUCTION: { label: 'Done in Production', variant: 'secondary' },
  PARTIALLY_DELIVERED: { label: 'Partially Delivered', variant: 'warning' },
  DELIVERED: { label: 'Delivered', variant: 'success' },
  PARTIALLY_RETURNED: { label: 'Partially Returned', variant: 'warning' },
  RETURNED: { label: 'Returned', variant: 'secondary' },
  CANCELLED: { label: 'Cancelled', variant: 'destructive' },
};

interface SalesOrderDetailViewProps {
  order: SalesHeader;
  onBack: () => void;
  // Label for the Back button — defaults to "Back to Sales Contracts" for a
  // plain in-tab drill-in, but the caller overrides it (e.g. "Back to
  // Product"/"Back to Material") when this page was opened via a cross-tab
  // link so onBack actually returns to that origin instead of this tab's list.
  backLabel?: string;
  transitioningId: string | null;
  // Finished-goods stock per product id, so Start Production can hide itself when stock already
  // covers the order instead of opening a dialog that just says so.
  stockByProductId: Record<string, number>;
  onEdit: (order: SalesHeader) => void;
  onConvert: (order: SalesHeader) => void;
  onDelete: (id: string) => void;
  onStartProduction: (order: SalesHeader) => void;
  onAddMaterial: (order: SalesHeader) => void;
  onProductionCompletion: (order: SalesHeader) => void;
  onMarkDelivered: (order: SalesHeader) => void;
  onCancel: (order: SalesHeader) => void;
  onReturn: (order: SalesHeader) => void;
  onOpenQuotationDoc: (order: SalesHeader) => void;
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
  order, onBack, backLabel = 'Back to Sales Contracts', transitioningId, stockByProductId,
  onEdit, onConvert, onDelete, onStartProduction, onAddMaterial, onProductionCompletion,
  onMarkDelivered, onCancel, onReturn, onOpenQuotationDoc,
}: SalesOrderDetailViewProps) {
  const contentRef = useFadeInOnMount<HTMLDivElement>([order.id]);
  const status = STATUS_META[order.status];

  // Mirrors StartProductionModal's own "nothing to produce" check — if stock already covers every
  // line, hide the button instead of letting the user open the dialog just to be told that.
  const nothingToProduce = order.details.every(d =>
    suggestedProduceQuantity(Math.max(0, d.quantity - d.deliveredQuantity), stockByProductId[d.productId] ?? 0) <= 0
  );

  // Whole list is already loaded (one order's line items, never heavy), so
  // this sorts client-side rather than re-fetching.
  const [sortKey, setSortKey] = useState<LineItemSortKey>('productName');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const toggleSort = (key: string) => {
    const field = key as LineItemSortKey;
    if (field === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(field); setSortDir('asc'); }
  };
  const sortedDetails = useMemo(
    () => sortByField(order.details, sortKey, sortDir, NUMERIC_KEYS),
    [order.details, sortKey, sortDir]
  );

  const columns: DataTableColumn<SalesDetail>[] = [
    { key: 'productName', header: 'Product', sortable: true, render: (d) => <span className="font-medium text-card-foreground">{d.productName}</span> },
    { key: 'quantity', header: 'Ordered', sortable: true, align: 'right', render: (d) => <span className="font-mono text-muted-foreground">{d.quantity}</span> },
    // Production and delivery are both partial, so the ordered qty alone no longer says where a line
    // stands. These three are how the user knows what's left to make and what's left to ship.
    {
      key: 'producedQuantity', header: 'Produced', align: 'right',
      render: (d) => <span className="font-mono text-muted-foreground">{d.producedQuantity || (d.produceQuantity ? `0 / ${d.produceQuantity}` : '—')}</span>,
    },
    {
      key: 'deliveredQuantity', header: 'Delivered', align: 'right',
      render: (d) => (
        <span className={`font-mono ${d.deliveredQuantity >= d.quantity ? 'text-muted-foreground' : 'text-foreground font-medium'}`}>
          {d.deliveredQuantity} / {d.quantity}
        </span>
      ),
    },
    {
      key: 'returnedQuantity', header: 'Returned', align: 'right',
      render: (d) => <span className="font-mono text-muted-foreground">{d.returnedQuantity || '—'}</span>,
    },
    { key: 'unitPrice', header: 'Unit Price', sortable: true, align: 'right', render: (d) => <span className="font-mono text-muted-foreground">RM {d.unitPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> },
    { key: 'totalPrice', header: 'Total Price', sortable: true, align: 'right', render: (d) => <span className="font-mono font-medium text-foreground">RM {d.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> },
  ];

  type MaterialRow = ProductionMaterialUsage & { productName: string };
  const materialRows: MaterialRow[] = useMemo(
    () => order.details.flatMap(d => d.materials.map(m => ({ ...m, productName: d.productName }))),
    [order.details]
  );

  const materialColumns: DataTableColumn<MaterialRow>[] = [
    { key: 'productName', header: 'Product', render: (m) => <span className="text-muted-foreground">{m.productName}</span> },
    { key: 'materialName', header: 'Material', render: (m) => <span className="font-medium text-card-foreground">{m.materialName}</span> },
    { key: 'plannedQuantity', header: 'Planned', align: 'right', render: (m) => <span className="font-mono text-muted-foreground">{m.plannedQuantity}</span> },
    { key: 'actualQuantity', header: 'Actual', align: 'right', render: (m) => <span className="font-mono text-muted-foreground">{m.actualQuantity || '—'}</span> },
    { key: 'returnedQuantity', header: 'Returned', align: 'right', render: (m) => <span className="font-mono text-muted-foreground">{m.returnedQuantity || '—'}</span> },
  ];

  return (
    <div ref={contentRef} className="space-y-5" id="sales-order-detail-view">
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
              <h2 className="font-mono font-bold text-foreground text-lg leading-snug">{order.salesNo}</h2>
              <p className="text-xs text-muted-foreground mt-1">{order.clientName}</p>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant={status.variant}>{status.label}</Badge>
              <Badge variant={PRIORITY_META[order.priority].variant}>{PRIORITY_META[order.priority].label} Priority</Badge>
              {(() => {
                const urgency = getDueUrgency(order.productionDueDate);
                return urgency && <Badge variant={urgency.variant}>{urgency.label}</Badge>;
              })()}
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                <span>Order Date:</span>
                <span className="text-foreground">{formatDateTime(order.orderDate)}</span>
              </div>
              {order.deliveryDate && (
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Delivery Due:</span>
                  <span className="text-foreground">{formatDateTime(order.deliveryDate)}</span>
                </div>
              )}
              {order.productionDueDate && (
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Production Due:</span>
                  <span className="text-foreground">{formatDate(order.productionDueDate)}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <span>Contract Total:</span>
                <span className="font-mono font-semibold text-foreground">RM {order.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>

            {order.remark && (
              <p className="text-xs text-muted-foreground max-w-2xl">{order.remark}</p>
            )}

            {order.attachments?.[0] && (
              <a
                href={order.attachments[0].dataUrl}
                download={order.attachments[0].name}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-primary/10 hover:bg-primary/20 text-primary rounded text-[10px] font-mono transition-colors"
                title="Download attachment"
              >
                <Paperclip className="w-2.5 h-2.5 shrink-0" />
                <span className="truncate max-w-[200px]">{order.attachments[0].name}</span>
              </a>
            )}
          </div>

          {/* Status-appropriate lifecycle actions (mirrors OrdersView.tsx's row actions) */}
          <div className="flex items-center flex-wrap gap-1.5 w-full sm:w-auto sm:shrink-0">
            {order.status === 'QUOTATION' && (
              <>
                <Button variant="outline" size="sm" onClick={() => onEdit(order)}><Edit className="w-3.5 h-3.5" /> Edit</Button>
                <Button variant="outline" size="sm" onClick={() => onOpenQuotationDoc(order)}><FileText className="w-3.5 h-3.5" /> Generate Quotation</Button>
                <Button size="sm" onClick={() => onConvert(order)}><ArrowRightCircle className="w-3.5 h-3.5" /> Proceed to Sales Order</Button>
              </>
            )}

            {order.status === 'ORDERED' && (
              <Button variant="outline" size="sm" onClick={() => onEdit(order)}><Edit className="w-3.5 h-3.5" /> Edit</Button>
            )}

            {/* For a line ordered without a BOM — see canAddMaterial in OrdersService.ts */}
            {canAddMaterial(order) && (
              <Button variant="outline" size="sm" onClick={() => onAddMaterial(order)}>
                <Plus className="w-3.5 h-3.5" /> Add Material
              </Button>
            )}

            {/* Same two gates the row menu uses: production needs a BOM to run against, and delivery
                can skip production entirely when finished goods already cover the order. */}
            {canStartProduction(order) && !nothingToProduce && (
              <Button size="sm" onClick={() => onStartProduction(order)}>
                <Factory className="w-3.5 h-3.5" /> Start Production
              </Button>
            )}

            {order.status === 'IN_PRODUCTION' && (
              <Button size="sm" onClick={() => onProductionCompletion(order)} disabled={transitioningId === order.id}>
                <CheckCheck className="w-3.5 h-3.5" /> Mark Production Done
              </Button>
            )}

            {/* Deliver while anything is unshipped; return once anything has shipped. Cancel stays
                on the pre-delivery statuses, so it never appears next to Return. */}
            {canDeliver(order) && (
              <Button size="sm" onClick={() => onMarkDelivered(order)}>
                <Check className="w-3.5 h-3.5" /> Deliver
              </Button>
            )}

            {['ORDERED', 'IN_PRODUCTION', 'DONE_IN_PRODUCTION'].includes(order.status) && (
              <Button variant="destructive" size="sm" onClick={() => onCancel(order)}>Cancel Order</Button>
            )}

            {['PARTIALLY_DELIVERED', 'DELIVERED', 'PARTIALLY_RETURNED'].includes(order.status) && (
              <Button variant="destructive" size="sm" onClick={() => onReturn(order)}>
                <Undo2 className="w-3.5 h-3.5" /> Return from Client
              </Button>
            )}

            {/* Delete is only offered pre-inventory-movement (QUOTATION/ORDERED) or on a CANCELLED
                order that never posted a ledger row — once any inventory transaction exists the
                order is historical and only Cancel remains available. */}
            {canDeleteSalesOrder(order) && (
              <Button variant="destructive" size="sm" onClick={() => onDelete(order.id)}><Trash2 className="w-3.5 h-3.5" /> Delete</Button>
            )}
          </div>
        </div>
      </Card>
      </div>

      {/* Line items */}
      <SectionCard
        data-fade-item
        title={<span className="inline-flex items-center gap-2"><Boxes className="w-4 h-4 text-muted-foreground" /> Contract Line Items</span>}
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

      {/* Material breakdown — its own table, one row per material per line, since the planned/
          actual/returned numbers don't fit legibly squeezed into the line items row anymore. */}
      {materialRows.length > 0 && (
        <SectionCard
          data-fade-item
          title={<span className="inline-flex items-center gap-2"><Layers className="w-4 h-4 text-muted-foreground" /> Material Usage</span>}
          contentClassName="p-0"
        >
          <DataTable
            columns={materialColumns}
            rows={materialRows}
            rowKey={(m) => m.id}
          />
        </SectionCard>
      )}
    </div>
  );
}
