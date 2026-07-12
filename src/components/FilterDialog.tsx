/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Dialog, DialogFooter, DialogCancelButton, SearchInput, fieldInputClassName, Button, Badge } from './ui';
import InfiniteScrollSentinel from './InfiniteScrollSentinel';
import { cn } from '../lib/utils';

export interface FilterPickerItem {
  id: string;
  label: string;
  sublabel?: string;
}

export interface ChecklistFilterSection {
  type: 'checklist';
  key: string;
  label: string;
  searchPlaceholder?: string;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  items: FilterPickerItem[];
  loading?: boolean;
  selectedIds: string[];
  onToggle: (id: string) => void;
  /** Skip the search box — for small static option lists (e.g. priority). */
  hideSearch?: boolean;
  /** More records beyond `items` exist — shows the scroll-to-load-more sentinel. */
  hasMore?: boolean;
  onLoadMore?: () => void;
}

export interface DateRangeFilterSection {
  type: 'dateRange';
  key: string;
  label: string;
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
}

export type FilterSection = ChecklistFilterSection | DateRangeFilterSection;

interface FilterDialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  sections: FilterSection[];
  onApply: () => void;
  onClear: () => void;
}

/**
 * Generic multi-section filter dialog, shared across list views. Each
 * section is either a searchable multi-select record picker (search a
 * keyword, tick as many records as desired — e.g. vendor, material, client,
 * product, or a small static list like priority) or a plain date range.
 * Callers own all section state; this component is purely presentational.
 */
export default function FilterDialog({ open, onClose, title = 'Filter', sections, onApply, onClear }: FilterDialogProps) {
  const handleApply = () => {
    onApply();
    onClose();
  };

  // Every checklist section is an expand/collapse card, open by default.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleCollapsed = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <Dialog open={open} onClose={onClose} title={title} maxWidth="max-w-lg">
      <div className="p-5 space-y-3">
        {sections.map((section) => (
          section.type === 'checklist' ? (
            <div key={section.key} className="border border-border rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => toggleCollapsed(section.key)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-secondary/40 transition-colors"
              >
                <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
                  {section.label}
                  {section.selectedIds.length > 0 && (
                    <Badge className="px-1.5 py-0 text-[10px]">{section.selectedIds.length}</Badge>
                  )}
                </span>
                <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform shrink-0', !collapsed[section.key] && 'rotate-180')} />
              </button>
              <div
                className={cn(
                  'grid transition-[grid-template-rows] duration-200 ease-out',
                  collapsed[section.key] ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'
                )}
              >
                <div className="overflow-hidden">
                  <div className="px-3 pb-3 space-y-2">
                    <ChecklistSection section={section} />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div key={section.key} className="space-y-2">
              <div className="text-xs font-semibold text-foreground">{section.label}</div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="date" value={section.from} onChange={(e) => section.onFromChange(e.target.value)} className={fieldInputClassName} />
                <span>to</span>
                <input type="date" value={section.to} onChange={(e) => section.onToChange(e.target.value)} className={fieldInputClassName} />
              </div>
            </div>
          )
        ))}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => { onClear(); onClose(); }}>Clear</Button>
          <DialogCancelButton onClick={onClose} />
          <Button type="button" onClick={handleApply}>Apply</Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}

function ChecklistSection({ section }: { section: ChecklistFilterSection }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <>
      {!section.hideSearch && (
        <SearchInput
          value={section.searchQuery}
          onChange={section.onSearchChange}
          placeholder={section.searchPlaceholder || 'Search...'}
          className="relative w-full"
        />
      )}
      {section.selectedIds.length > 0 && (
        <div className="text-[11px] text-muted-foreground">{section.selectedIds.length} selected</div>
      )}
      <div ref={scrollRef} className="max-h-48 overflow-y-auto border border-border rounded-lg divide-y divide-border">
        {section.loading && section.items.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">Loading...</div>
        ) : section.items.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">No matches.</div>
        ) : (
          <>
            {section.items.map((item) => {
              const checked = section.selectedIds.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => section.onToggle(item.id)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs hover:bg-secondary/50 transition-colors"
                >
                  <span className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center ${checked ? 'bg-primary border-primary' : 'border-input'}`}>
                    {checked && <Check className="w-3 h-3 text-primary-foreground" />}
                  </span>
                  <span className="min-w-0 flex-1 flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-foreground">{item.label}</span>
                    {item.sublabel && <span className="shrink-0 text-[10px] font-mono text-muted-foreground">{item.sublabel}</span>}
                  </span>
                </button>
              );
            })}
            {section.onLoadMore && (
              <InfiniteScrollSentinel onLoadMore={section.onLoadMore} hasMore={!!section.hasMore} loading={!!section.loading} rootRef={scrollRef} />
            )}
          </>
        )}
      </div>
    </>
  );
}
