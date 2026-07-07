/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { InventoryTransactionType } from '../types';

// Shared badge styling for InventoryListItem.transactionType, used by both
// MaterialDetailView's and ProductDetailView's "Inventory List" tables.
export const TRANSACTION_TYPE_BADGE: Record<InventoryTransactionType, { label: string; className: string }> = {
  PURCHASE: { label: 'Purchase', className: 'bg-blue-50 text-blue-700 border-blue-100' },
  SALES: { label: 'Sales', className: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  PURCHASE_RETURN: { label: 'Purchase Return', className: 'bg-amber-50 text-amber-700 border-amber-100' },
  SALES_RETURN: { label: 'Sales Return', className: 'bg-amber-50 text-amber-700 border-amber-100' },
  ADJUSTMENT: { label: 'Adjustment', className: 'bg-slate-50 text-slate-600 border-slate-200' },
};
