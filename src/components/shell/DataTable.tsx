import React from 'react';
import { ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../ui/Table';
import { Skeleton } from '../ui/Skeleton';
import { CardEmptyState } from '../ui/Card';
import { cn } from '../../lib/utils';

export interface DataTableColumn<T> {
  key: string;
  header: React.ReactNode;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  className?: string;
  render: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  sortField?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (field: string) => void;
  density?: 'comfortable' | 'compact';
  selectable?: boolean;
  selectedKeys?: Set<string>;
  onToggleSelect?: (key: string) => void;
  onToggleSelectAll?: () => void;
  /** Key of the row currently shown elsewhere (e.g. a detail panel) — highlighted, independent of bulk-select `selectedKeys`. */
  activeKey?: string;
  onRowClick?: (row: T) => void;
  rowActions?: (row: T) => React.ReactNode;
  loading?: boolean;
  emptyState?: React.ReactNode;
  footer?: React.ReactNode;
}

const ALIGN_CLASS = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sortField,
  sortDir = 'asc',
  onSort,
  density = 'comfortable',
  selectable,
  selectedKeys,
  onToggleSelect,
  onToggleSelectAll,
  activeKey,
  onRowClick,
  rowActions,
  loading,
  emptyState,
  footer,
}: DataTableProps<T>) {
  const cellPad = density === 'compact' ? '[&_td]:py-1.5 [&_th]:h-8' : '';
  const allSelected = selectable && rows.length > 0 && rows.every((r) => selectedKeys?.has(rowKey(r)));

  return (
    <div className="flex flex-col min-h-0">
      <Table className={cellPad}>
        <TableHeader className="sticky top-0 z-20 bg-card">
          <TableRow className="hover:bg-transparent">
            {selectable && (
              <TableHead className="w-9">
                <input type="checkbox" checked={!!allSelected} onChange={onToggleSelectAll} className="accent-primary rounded" />
              </TableHead>
            )}
            {columns.map((col) => (
              <TableHead key={col.key} className={cn("sticky top-0 z-20 bg-card", ALIGN_CLASS[col.align ?? 'left'], col.className)}>
                {col.sortable && onSort ? (
                  <button type="button" onClick={() => onSort(col.key)} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                    {col.header}
                    {sortField === col.key ? (
                      sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                    ) : (
                      <ChevronsUpDown className="w-3 h-3 opacity-40" />
                    )}
                  </button>
                ) : (
                  col.header
                )}
              </TableHead>
            ))}
            {rowActions && <TableHead className="w-10" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            // Sort/filter/search-triggered reloads land here too (not just the
            // initial empty load) — the previous rows are always replaced by
            // skeleton rows while a fetch is in flight, never left stale.
            Array.from({ length: 6 }).map((_, i) => (
              <TableRow key={`skeleton-${i}`}>
                {(selectable ? [null, ...columns] : columns).map((col, j) => (
                  <TableCell key={j} className={col?.className}><Skeleton className="h-4 w-full max-w-32" /></TableCell>
                ))}
                {rowActions && <TableCell />}
              </TableRow>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)}>
                <CardEmptyState>{emptyState ?? 'No records found.'}</CardEmptyState>
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const key = rowKey(row);
              const selected = selectedKeys?.has(key);
              const active = activeKey !== undefined && key === activeKey;
              return (
                <TableRow
                  key={key}
                  data-fade-item
                  data-state={selected ? 'selected' : undefined}
                  onClick={() => onRowClick?.(row)}
                  className={cn('group', onRowClick && 'cursor-pointer', active && 'bg-primary/10 hover:bg-primary/10 border-l-2 border-l-primary')}
                >
                  {selectable && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={!!selected} onChange={() => onToggleSelect?.(key)} className="accent-primary rounded" />
                    </TableCell>
                  )}
                  {columns.map((col) => (
                    <TableCell key={col.key} className={cn(ALIGN_CLASS[col.align ?? 'left'], col.className)}>
                      {col.render(row)}
                    </TableCell>
                  ))}
                  {rowActions && (
                    <TableCell onClick={(e) => e.stopPropagation()} className="opacity-0 group-hover:opacity-100 transition-opacity">
                      {rowActions(row)}
                    </TableCell>
                  )}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
      {footer}
    </div>
  );
}
