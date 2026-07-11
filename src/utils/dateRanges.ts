/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { monthStart, monthEnd } from './date';

export interface QuickRangeOption {
  key: string;
  label: string;
  from: () => string;
  to: () => string;
}

const todayStr = (): string => new Date().toISOString().split('T')[0];
const daysAgo = (n: number): string => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0]; };

/** Shared quick date-range presets — Inventory/Purchases/Orders all filter by the same shape. */
export const QUICK_RANGES: QuickRangeOption[] = [
  { key: 'today', label: 'Today', from: todayStr, to: todayStr },
  { key: 'yesterday', label: 'Yesterday', from: () => daysAgo(1), to: () => daysAgo(1) },
  { key: 'last7', label: 'Last 7 Days', from: () => daysAgo(6), to: todayStr },
  { key: 'thisMonth', label: 'This Month', from: () => monthStart(0), to: () => monthEnd(0) },
  { key: 'lastMonth', label: 'Last Month', from: () => monthStart(1), to: () => monthEnd(1) },
];
