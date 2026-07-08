/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Check } from 'lucide-react';
import { Dialog, DialogFooter, DialogCancelButton, SearchInput, fieldInputClassName } from './ui';

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
 * product) or a plain date range. Callers own all section state; this
 * component is purely presentational.
 */
export default function FilterDialog({ open, onClose, title = 'Filter', sections, onApply, onClear }: FilterDialogProps) {
  const handleApply = () => {
    onApply();
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title={title} maxWidth="max-w-lg">
      <div className="p-5 space-y-5">
        {sections.map((section) => (
          <div key={section.key} className="space-y-2">
            <div className="text-xs font-semibold text-slate-700">{section.label}</div>

            {section.type === 'checklist' ? (
              <>
                <SearchInput
                  value={section.searchQuery}
                  onChange={section.onSearchChange}
                  placeholder={section.searchPlaceholder || 'Search...'}
                  className="relative w-full"
                />
                {section.selectedIds.length > 0 && (
                  <div className="text-[11px] text-slate-500">{section.selectedIds.length} selected</div>
                )}
                <div className="max-h-48 overflow-y-auto border border-slate-100 rounded-lg divide-y divide-slate-100">
                  {section.loading ? (
                    <div className="p-6 text-center text-xs text-slate-400">Loading...</div>
                  ) : section.items.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-400">No matches.</div>
                  ) : (
                    section.items.map((item) => {
                      const checked = section.selectedIds.includes(item.id);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => section.onToggle(item.id)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs hover:bg-slate-50 transition-colors"
                        >
                          <span className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center ${checked ? 'bg-blue-600 border-blue-600' : 'border-slate-300'}`}>
                            {checked && <Check className="w-3 h-3 text-white" />}
                          </span>
                          <span className="min-w-0 flex-1 flex items-center justify-between gap-2">
                            <span className="truncate font-medium text-slate-700">{item.label}</span>
                            {item.sublabel && <span className="shrink-0 text-[10px] font-mono text-slate-400">{item.sublabel}</span>}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <input type="date" value={section.from} onChange={(e) => section.onFromChange(e.target.value)} className={fieldInputClassName} />
                <span>to</span>
                <input type="date" value={section.to} onChange={(e) => section.onToChange(e.target.value)} className={fieldInputClassName} />
              </div>
            )}
          </div>
        ))}

        <DialogFooter>
          <button
            type="button"
            onClick={() => { onClear(); onClose(); }}
            className="px-4 py-2 text-slate-500 hover:text-slate-700 rounded-lg font-medium transition-colors"
          >
            Clear
          </button>
          <DialogCancelButton onClick={onClose} />
          <button
            type="button"
            onClick={handleApply}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            Apply
          </button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}
