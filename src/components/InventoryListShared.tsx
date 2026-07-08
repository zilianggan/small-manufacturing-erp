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
// MaterialDetailView's and ProductDetailView's "Inventory List" tables.
export const TRANSACTION_TYPE_BADGE: Record<InventoryTransactionType, { label: string; className: string }> = {
  PURCHASE: { label: 'Purchase', className: 'bg-blue-50 text-blue-700 border-blue-100' },
  SALES: { label: 'Sales', className: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  PURCHASE_RETURN: { label: 'Purchase Return', className: 'bg-amber-50 text-amber-700 border-amber-100' },
  SALES_RETURN: { label: 'Sales Return', className: 'bg-amber-50 text-amber-700 border-amber-100' },
  ADJUSTMENT: { label: 'Adjustment', className: 'bg-slate-50 text-slate-600 border-slate-200' },
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
 * The "Inventory List" table shared by MaterialDetailView.tsx and
 * ProductDetailView.tsx (purchase/sales history + other stock movements for
 * one material/product) — identical shape in both, so built once here.
 * Click-to-sort headers sort client-side since the whole list is already
 * loaded (one item's history, never heavy).
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
        <div className="p-12 text-center text-xs text-slate-400">Loading inventory list...</div>
      ) : items.length === 0 ? (
        <div className="p-12 text-center text-xs text-slate-400">{emptyMessage}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-100">
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
            <tbody className="divide-y divide-slate-100">
              {sorted.map((item) => {
                const badge = TRANSACTION_TYPE_BADGE[item.transactionType];
                return (
                  <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-2.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${badge.className}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-700">{item.refNo || '-'}</td>
                    <td className="px-4 py-2.5 text-slate-600">{item.counterpartyName || '-'}</td>
                    <td className="px-4 py-2.5 text-slate-600">{item.orderDate || '-'}</td>
                    <td className="px-4 py-2.5 text-slate-600">{item.quantity}</td>
                    <td className="px-4 py-2.5 text-slate-600">{item.unitCost != null ? item.unitCost.toFixed(2) : '-'}</td>
                    <td className="px-4 py-2.5 text-slate-600">{item.totalPrice != null ? item.totalPrice.toFixed(2) : '-'}</td>
                    <td className="px-4 py-2.5">
                      {item.status && (
                        <span className="px-1.5 py-0.5 bg-slate-50 text-slate-600 border border-slate-200 rounded text-[10px] font-mono">
                          {item.status}
                        </span>
                      )}
                    </td>
                    {showActionCol && (
                      <td className="px-4 py-2.5 text-right">
                        {onViewPurchaseOrder && item.purchaseHeaderId && (
                          <button
                            onClick={() => onViewPurchaseOrder(item.purchaseHeaderId!)}
                            className="inline-flex items-center gap-0.5 text-[11px] font-medium text-blue-600 hover:text-blue-800"
                            title="View purchase order"
                          >
                            <span>View</span>
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        )}
                        {onViewSalesOrder && item.salesHeaderId && (
                          <button
                            onClick={() => onViewSalesOrder(item.salesHeaderId!)}
                            className="inline-flex items-center gap-0.5 text-[11px] font-medium text-blue-600 hover:text-blue-800"
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
