/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { InventoryListItem, InventoryTransactionType } from '../types';
import { Card } from './ui';
import SortableTh from './SortableTh';
import { sortByField } from '../utils/sortRows';

// Shared badge styling for InventoryListItem.transactionType, used by both
// MaterialView's and ProductView's "Inventory List" detail-panel tables.
export const TRANSACTION_TYPE_BADGE: Record<InventoryTransactionType, { label: string; className: string }> = {
  PURCHASE: { label: 'Purchase', className: 'bg-primary/10 text-primary border-primary/20' },
  SALES: { label: 'Sales', className: 'bg-success/10 text-success border-success/20' },
  PURCHASE_RETURN: { label: 'Purchase Return', className: 'bg-warning/10 text-warning border-warning/20' },
  SALES_RETURN: { label: 'Sales Return', className: 'bg-warning/10 text-warning border-warning/20' },
  ADJUSTMENT: { label: 'Adjustment', className: 'bg-secondary text-secondary-foreground border-transparent' },
};

type SortKey = 'transactionType' | 'refNo' | 'counterpartyName' | 'orderDate' | 'quantity' | 'unitCost' | 'totalPrice' | 'status';
const NUMERIC_KEYS: SortKey[] = ['quantity', 'unitCost', 'totalPrice'];

interface InventoryHistoryTableProps {
  items: InventoryListItem[];
  loading: boolean;
  emptyMessage?: string;
  onViewPurchaseOrder?: (purchaseHeaderId: string) => void;
  onViewSalesOrder?: (salesHeaderId: string) => void;
}

/**
 * The "Inventory List" table shared by MaterialView.tsx and ProductView.tsx
 * (purchase/sales history + other stock movements for one material/product)
 * — identical shape in both, so built once here. Click-to-sort headers sort
 * client-side since the whole list is already loaded (one item's history,
 * never heavy).
 */
export function InventoryHistoryTable({ items, loading, emptyMessage = 'No inventory transactions yet.', onViewPurchaseOrder, onViewSalesOrder }: InventoryHistoryTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('orderDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const sorted = useMemo(() => sortByField(items, sortKey, sortDir, NUMERIC_KEYS), [items, sortKey, sortDir]);
  const showActionCol = !!(onViewPurchaseOrder || onViewSalesOrder);

  return (
    <Card className="overflow-hidden">
      {loading ? (
        <div className="p-12 text-center text-xs text-muted-foreground">Loading inventory list...</div>
      ) : items.length === 0 ? (
        <div className="p-12 text-center text-xs text-muted-foreground">{emptyMessage}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-secondary/50 text-muted-foreground border-b border-border">
              <tr>
                <SortableTh label="Type" sortKey="transactionType" activeKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortableTh label="Ref No." sortKey="refNo" activeKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortableTh label="Vendor / Client" sortKey="counterpartyName" activeKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortableTh label="Order Date" sortKey="orderDate" activeKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortableTh label="Quantity" sortKey="quantity" activeKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortableTh label="Unit Cost" sortKey="unitCost" activeKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortableTh label="Total Price" sortKey="totalPrice" activeKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortableTh label="Status" sortKey="status" activeKey={sortKey} dir={sortDir} onClick={toggleSort} />
                {showActionCol && <th className="px-4 py-2 font-semibold"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((item) => {
                const badge = TRANSACTION_TYPE_BADGE[item.transactionType];
                return (
                  <tr key={item.id} className="hover:bg-secondary/40 transition-colors">
                    <td className="px-4 py-2.5">
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${badge.className}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-card-foreground">{item.refNo || '-'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{item.counterpartyName || '-'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{item.orderDate || '-'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{item.quantity}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{item.unitCost != null ? item.unitCost.toFixed(2) : '-'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{item.totalPrice != null ? item.totalPrice.toFixed(2) : '-'}</td>
                    <td className="px-4 py-2.5">
                      {item.status && (
                        <span className="px-1.5 py-0.5 bg-secondary text-secondary-foreground rounded-full text-[10px] font-medium">
                          {item.status}
                        </span>
                      )}
                    </td>
                    {showActionCol && (
                      <td className="px-4 py-2.5 text-right">
                        {onViewPurchaseOrder && item.purchaseHeaderId && (
                          <button
                            onClick={() => onViewPurchaseOrder(item.purchaseHeaderId!)}
                            className="inline-flex items-center gap-0.5 text-[11px] font-medium text-primary hover:text-primary/80"
                            title="View purchase order"
                          >
                            <span>View</span>
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        )}
                        {onViewSalesOrder && item.salesHeaderId && (
                          <button
                            onClick={() => onViewSalesOrder(item.salesHeaderId!)}
                            className="inline-flex items-center gap-0.5 text-[11px] font-medium text-primary hover:text-primary/80"
                            title="View sales order"
                          >
                            <span>View</span>
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
