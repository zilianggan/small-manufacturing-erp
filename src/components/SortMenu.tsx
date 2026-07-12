/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, Check } from 'lucide-react';

export interface SortOption {
  value: string;
  label: string;
}

interface SortMenuProps {
  options: SortOption[];
  sortField: string;
  sortDir: 'asc' | 'desc';
  onChange: (field: string, dir: 'asc' | 'desc') => void;
}

/**
 * Button-triggered sort menu — the "click a table header to toggle asc/desc"
 * pattern, but for views (like a card grid) that have no table header to
 * click. Clicking the already-active option flips its direction; clicking a
 * different option switches to it at 'asc'.
 */
export default function SortMenu({ options, sortField, sortDir, onChange }: SortMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const activeLabel = options.find((o) => o.value === sortField)?.label || 'Sort';

  const selectOption = (value: string) => {
    onChange(value, value === sortField ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc');
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center space-x-1.5 px-3 py-2 bg-card border border-border hover:bg-secondary/60 text-foreground rounded-lg text-xs font-medium transition-colors"
      >
        <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground" />
        <span>{activeLabel}</span>
        {sortDir === 'asc' ? <ArrowUp className="w-3 h-3 text-muted-foreground" /> : <ArrowDown className="w-3 h-3 text-muted-foreground" />}
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-56 bg-card border border-border rounded-lg shadow-lg z-50 overflow-hidden py-1 animate-in fade-in zoom-in-95 duration-100">
          {options.map((option) => {
            const active = option.value === sortField;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => selectOption(option.value)}
                className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left transition-colors ${active ? 'text-primary bg-primary/10' : 'text-foreground hover:bg-secondary/50'}`}
              >
                <span className="flex items-center space-x-1.5">
                  {active && <Check className="w-3 h-3" />}
                  <span>{option.label}</span>
                </span>
                {active && (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
