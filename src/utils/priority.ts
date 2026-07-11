/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SalesPriority } from '../types';

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive' | 'success' | 'warning';

export const PRIORITY_META: Record<SalesPriority, { label: string; variant: BadgeVariant; rank: number }> = {
  LOW: { label: 'Low', variant: 'secondary', rank: 0 },
  MEDIUM: { label: 'Medium', variant: 'outline', rank: 1 },
  HIGH: { label: 'High', variant: 'warning', rank: 2 },
  URGENT: { label: 'Urgent', variant: 'destructive', rank: 3 },
};

export const PRIORITY_OPTIONS: { value: SalesPriority; label: string }[] = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
];

export interface DueUrgency {
  label: string;
  variant: BadgeVariant;
}

/** Urgency tag derived from days-until-due — separate from the manual `priority` field. */
export function getDueUrgency(dueDate?: string): DueUrgency | null {
  if (!dueDate) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + 'T00:00:00');
  const daysLeft = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (daysLeft < 0) return { label: 'Overdue', variant: 'destructive' };
  if (daysLeft <= 2) return { label: 'Due Soon', variant: 'warning' };
  return null;
}
