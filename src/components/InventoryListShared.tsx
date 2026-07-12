/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useState } from 'react';
import { InventoryListItem, InventoryTransactionType } from '../types';
import { Card } from './ui';
import SortableTh from './SortableTh';
import { sortByField } from '../utils/sortRows';
import { formatDateTime } from '../utils/date';

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
  // Material detail opts in to an Employee column (who used the stock in
  // production). Products don't, so it's off by default.
  showEmployee?: boolean;
  onViewEmployee?: (employeeId: string) => void;
}

/**
 * The "Inventory List" table shared by MaterialView.tsx and ProductView.tsx
 * (purchase/sales history + other stock movements for one material/product)
 * — identical shape in both, so built once here. Click-to-sort headers sort
 * client-side since the whole list is already loaded (one item's history,
 * never heavy).
 */
export function InventoryHistoryTable({ items, loading, emptyMessage = 'No inventory transactions yet.', onViewPurchaseOrder, onViewSalesOrder, showEmployee, onViewEmployee }: InventoryHistoryTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('orderDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const sorted = useMemo(() => sortByField(items, sortKey, sortDir, NUMERIC_KEYS), [items, sortKey, sortDir]);

  // Ref No. is the drill-in link now (no separate View column). Resolves to the
  // purchase or sales order that generated the row.
  const refLink = (item: InventoryListItem): (() => void) | undefined => {
    if (onViewPurchaseOrder && item.purchaseHeaderId) return () => onViewPurchaseOrder(item.purchaseHeaderId!);
    if (onViewSalesOrder && item.salesHeaderId) return () => onViewSalesOrder(item.salesHeaderId!);
    return undefined;
  };

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
                {showEmployee && <th className="px-4 py-2 font-semibold">Employee</th>}
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
                    <td className="px-4 py-2.5 font-mono">
                      {item.refNo && refLink(item) ? (
                        <button onClick={refLink(item)} className="text-primary hover:underline" title="View order">{item.refNo}</button>
                      ) : <span className="text-card-foreground">{item.refNo || '-'}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{item.counterpartyName || '-'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{item.orderDate ? formatDateTime(item.orderDate) : '-'}</td>
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
                    {showEmployee && (
                      <td className="px-4 py-2.5">
                        {item.employeeId && item.employeeName && onViewEmployee ? (
                          <button onClick={() => onViewEmployee(item.employeeId!)} className="text-primary hover:underline">{item.employeeName}</button>
                        ) : <span className="text-muted-foreground">{item.employeeName || '-'}</span>}
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
