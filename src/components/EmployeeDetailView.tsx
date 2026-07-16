/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useState } from 'react';
import { ArrowLeft, Mail, Phone, Briefcase, FlaskConical } from 'lucide-react';
import { Employee, EmployeeConsumableUsageItem } from '../types';
import { Card, Badge } from './ui';
import { SectionCard, DataTable } from './shell';
import type { DataTableColumn } from './shell';
import { useFadeInOnMount } from '../hooks/useFadeInOnMount';
import { formatDateTime } from '../utils/date';

type SortKey = 'materialName' | 'quantity' | 'salesNo' | 'stage' | 'date';
const NUMERIC_KEYS: SortKey[] = ['quantity'];

interface EmployeeDetailViewProps {
  employee: Employee;
  jobPositionName?: string;
  onBack: () => void;
  backLabel?: string;
  rows: EmployeeConsumableUsageItem[];
  loading: boolean;
  // Drills into the sales order this consumable was used on.
  onViewSalesOrder?: (salesHeaderId: string) => void;
}

const sortRows = (rows: EmployeeConsumableUsageItem[], key: SortKey, dir: 'asc' | 'desc'): EmployeeConsumableUsageItem[] => {
  const isNumeric = NUMERIC_KEYS.includes(key);
  const mul = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[key], bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (isNumeric) return ((av as number) - (bv as number)) * mul;
    return String(av).localeCompare(String(bv)) * mul;
  });
};

/**
 * Drill-down page for one employee (modeled on PurchaseOrderDetailView): header
 * summary card + a read-only list of the consumable materials this employee
 * worked on across their assigned production orders.
 */
export default function EmployeeDetailView({
  employee, jobPositionName, onBack, backLabel = 'Back to Employees', rows, loading, onViewSalesOrder,
}: EmployeeDetailViewProps) {
  const contentRef = useFadeInOnMount<HTMLDivElement>([employee.id]);

  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const toggleSort = (key: string) => {
    const field = key as SortKey;
    if (field === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(field); setSortDir('asc'); }
  };
  const sorted = useMemo(() => sortRows(rows, sortKey, sortDir), [rows, sortKey, sortDir]);

  const columns: DataTableColumn<EmployeeConsumableUsageItem>[] = [
    { key: 'materialName', header: 'Consumable Material', sortable: true, render: (r) => (
      <div>
        <div className="font-medium text-card-foreground">{r.materialName}</div>
        {r.materialCode && <div className="text-[11px] font-mono text-muted-foreground">{r.materialCode}</div>}
      </div>
    ) },
    { key: 'quantity', header: 'Qty Used', sortable: true, align: 'right', render: (r) => <span className="font-mono text-muted-foreground">{r.quantity}</span> },
    { key: 'salesNo', header: 'Sales Order', sortable: true, render: (r) => (
      r.salesNo && r.salesHeaderId && onViewSalesOrder ? (
        <button type="button" onClick={() => onViewSalesOrder(r.salesHeaderId!)} className="font-mono text-primary hover:underline">{r.salesNo}</button>
      ) : <span className="font-mono text-muted-foreground">{r.salesNo || '—'}</span>
    ) },
    { key: 'stage', header: 'Stage', sortable: true, render: (r) => <span className="text-muted-foreground">{r.stage || '—'}</span> },
    { key: 'date', header: 'Date', sortable: true, render: (r) => <span className="text-muted-foreground">{r.date ? formatDateTime(r.date) : '—'}</span> },
  ];

  return (
    <div ref={contentRef} className="space-y-5" id="employee-detail-view">
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
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center shrink-0 border border-border text-muted-foreground font-bold text-sm uppercase">
                {employee.fullName.split(' ').map(n => n[0]).join('').substring(0, 2)}
              </div>
              <div className="space-y-1.5 min-w-0">
                <h2 className="font-bold text-foreground text-lg leading-snug">{employee.fullName}</h2>
                {jobPositionName && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Briefcase className="w-3.5 h-3.5" />{jobPositionName}</p>
                )}
                <Badge variant={employee.status === 'ACTIVE' ? 'success' : 'secondary'}>{employee.status}</Badge>
                <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground pt-1">
                  {employee.email && (
                    <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /><span className="font-mono">{employee.email}</span></span>
                  )}
                  {employee.contactNo && (
                    <span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /><span className="font-mono">{employee.contactNo}</span></span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Consumable usage */}
      <SectionCard
        data-fade-item
        title={<span className="inline-flex items-center gap-2"><FlaskConical className="w-4 h-4 text-muted-foreground" /> Consumable Materials Worked On</span>}
        contentClassName="p-0"
      >
        <DataTable
          columns={columns}
          rows={sorted}
          rowKey={(r) => r.id}
          sortField={sortKey}
          sortDir={sortDir}
          onSort={toggleSort}
          loading={loading}
          emptyState="No consumable materials recorded for this employee yet."
        />
      </SectionCard>
    </div>
  );
}
