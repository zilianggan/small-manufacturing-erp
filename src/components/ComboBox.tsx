import React, { useState, useRef, useEffect, useId } from 'react';
import * as RadixPopover from '@radix-ui/react-popover';
import { ChevronDown, Search, X } from 'lucide-react';

export interface ComboBoxOption {
  value: string;
  label: string;
  sublabel?: string;
}

interface ComboBoxProps {
  options: ComboBoxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  /** Show a "none" option at top (with empty string value) */
  noneLabel?: string;
  id?: string;
  /** When provided, ComboBox stops filtering `options` locally and instead
   *  calls this (debounced ~300ms) as the user types, so the parent can
   *  re-fetch matching options from the server (search-as-you-type). */
  onSearch?: (query: string) => void;
  /** Shows a "Searching..." hint below the input while a server search is in flight. */
  searchLoading?: boolean;
}

/**
 * Built on Radix Popover (not a hand-rolled document.body portal) so it
 * cooperates correctly with an ancestor Radix Dialog/Sheet's focus trap and
 * dismissable-layer stack — a raw createPortal sibling of the Dialog content
 * gets its focus silently stolen back by the Dialog's FocusScope, and
 * pointerdown on it gets treated as "outside" and dismisses the Dialog.
 */
export default function ComboBox({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  disabled = false,
  required = false,
  className = '',
  noneLabel,
  id,
  onSearch,
  searchLoading = false,
}: ComboBoxProps) {
  const uid = useId();
  const fieldId = id ?? uid;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const allOptions: ComboBoxOption[] = noneLabel !== undefined
    ? [{ value: '', label: noneLabel }, ...options]
    : options;

  // In server-search mode, `options` already reflects the current query
  // (the parent re-fetched them), so we don't re-filter client-side.
  const filtered = onSearch
    ? allOptions
    : query.trim()
      ? allOptions.filter(o =>
        o.label.toLowerCase().includes(query.toLowerCase()) ||
        (o.sublabel?.toLowerCase().includes(query.toLowerCase()) ?? false)
      )
      : allOptions;

  const selectedLabel = allOptions.find(o => o.value === value)?.label ?? '';

  // Debounce server-side search calls as the user types.
  useEffect(() => {
    if (!onSearch) return;
    const t = setTimeout(() => onSearch(query), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, onSearch]);

  useEffect(() => {
    if (open) setHighlighted(0);
  }, [open]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (listRef.current) {
      const el = listRef.current.children[highlighted] as HTMLElement | undefined;
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlighted]);

  const handleSelect = (opt: ComboBoxOption) => {
    onChange(opt.value);
    setOpen(false);
    setQuery('');
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted(h => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlighted]) handleSelect(filtered[highlighted]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  };

  const triggerBase = `
    w-full flex items-center justify-between gap-2
    px-3 py-2 text-xs rounded-lg border transition-colors
    focus:outline-none focus:border-blue-500
    ${disabled
      ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed dark:bg-slate-800 dark:border-slate-700 dark:text-slate-600'
      : 'bg-white border-slate-200 text-slate-800 cursor-pointer hover:border-slate-300 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600'
    }
  `.trim();

  return (
    <RadixPopover.Root open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(''); }}>
      <RadixPopover.Trigger asChild>
        <button
          type="button"
          id={fieldId}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={`relative ${className} ${triggerBase}`}
        >
          <span className={`truncate flex-1 text-left ${!value && !selectedLabel ? 'text-slate-400 dark:text-slate-500' : ''}`}>
            {selectedLabel || placeholder}
          </span>
          {value && !required && noneLabel !== undefined && (
            <X
              className="w-3 h-3 text-slate-400 hover:text-slate-600 shrink-0"
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onChange(''); }}
            />
          )}
          <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-slate-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
        </button>
      </RadixPopover.Trigger>

      <RadixPopover.Portal>
        <RadixPopover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          style={{ width: 'var(--radix-popover-trigger-width)' }}
          onOpenAutoFocus={(e) => { e.preventDefault(); inputRef.current?.focus(); }}
          className="z-[100] min-w-[180px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl overflow-hidden data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95 duration-100"
        >
          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => { setQuery(e.target.value); setHighlighted(0); }}
              onKeyDown={handleInputKeyDown}
              placeholder="Search..."
              className="flex-1 text-xs bg-transparent outline-none text-slate-800 dark:text-slate-200 placeholder:text-slate-400"
            />
            {query && !searchLoading && (
              <button type="button" onClick={() => setQuery('')}>
                <X className="w-3 h-3 text-slate-400 hover:text-slate-600" />
              </button>
            )}
          </div>
          {searchLoading && (
            <div className="px-3 py-1.5 text-[10px] text-slate-400 font-mono border-b border-slate-100 dark:border-slate-800">
              Searching...
            </div>
          )}

          {/* Options list */}
          <ul
            ref={listRef}
            role="listbox"
            // Portal renders outside the parent Sheet/Dialog's DOM subtree, so its
            // scroll-lock (react-remove-scroll) swallows the native wheel scroll —
            // drive scrollTop manually so the list still scrolls inside a drawer.
            onWheel={(e) => { e.currentTarget.scrollTop += e.deltaY; }}
            className="max-h-[min(13rem,var(--radix-popover-content-available-height,13rem))] overflow-y-auto py-1"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-slate-400 text-center">No results</li>
            ) : (
              filtered.map((opt, idx) => (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={opt.value === value}
                  onMouseDown={(e) => { e.preventDefault(); handleSelect(opt); }}
                  onMouseEnter={() => setHighlighted(idx)}
                  className={`
                    flex flex-col px-3 py-1.5 cursor-pointer text-xs transition-colors
                    ${idx === highlighted
                      ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                    }
                    ${opt.value === value ? 'font-semibold' : ''}
                  `}
                >
                  <span className="truncate">{opt.label || <span className="text-slate-400 italic">None</span>}</span>
                  {opt.sublabel && (
                    <span className="text-[10px] text-slate-400 truncate">{opt.sublabel}</span>
                  )}
                </li>
              ))
            )}
          </ul>
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
