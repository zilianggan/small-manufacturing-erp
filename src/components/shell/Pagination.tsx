import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../ui/Button';

interface PaginationProps {
  page: number; // 1-indexed
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  loading?: boolean;
  className?: string;
}

/** Page-number pagination footer for tables fetched in fixed-size pages (as opposed to infinite scroll). */
export function Pagination({ page, pageSize, totalCount, onPageChange, loading, className }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(totalCount, page * pageSize);

  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-3 ${className ?? ''}`}>
      <span className="text-xs text-muted-foreground">
        {totalCount === 0 ? 'No results' : `Showing ${from}–${to} of ${totalCount}`}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="w-3.5 h-3.5" /> Prev
        </Button>
        <span className="text-xs text-muted-foreground px-1">Page {page} of {totalPages}</span>
        <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => onPageChange(page + 1)}>
          Next <ChevronRight className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
