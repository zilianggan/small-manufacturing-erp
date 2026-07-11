import React from 'react';
import { X, SlidersHorizontal } from 'lucide-react';
import SearchInput from '../ui/SearchInput';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { cn } from '../../lib/utils';

export interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

interface FilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  chips?: FilterChip[];
  onOpenFilters?: () => void;
  filterCount?: number;
  selectedCount?: number;
  bulkActions?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}

/** Search + filter-chip row for list/table pages. When `selectedCount` > 0, swaps the right side for `bulkActions`. */
export function FilterBar({ search, onSearchChange, searchPlaceholder, chips = [], onOpenFilters, filterCount = 0, selectedCount = 0, bulkActions, right, className }: FilterBarProps) {
  return (
    <div className={cn('space-y-2.5', className)}>
      <div className="flex items-center gap-2 flex-wrap">
        <SearchInput value={search} onChange={onSearchChange} placeholder={searchPlaceholder} className="relative flex-1 min-w-[180px]" />
        {onOpenFilters && (
          <Button variant="outline" size="sm" onClick={onOpenFilters}>
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filter
            {filterCount > 0 && <Badge className="ml-0.5 h-4 px-1.5">{filterCount}</Badge>}
          </Button>
        )}
        <div className="flex-1" />
        {selectedCount > 0 && bulkActions ? bulkActions : right}
      </div>
      {chips.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {chips.map((chip) => (
            <span key={chip.key} className="inline-flex items-center gap-1 rounded-full bg-secondary text-secondary-foreground text-[11px] font-medium px-2.5 py-1">
              {chip.label}
              <button type="button" onClick={chip.onRemove} className="hover:text-destructive transition-colors">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
