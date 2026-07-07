import React, { useState, useRef, useEffect, useId, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
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
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [highlighted, setHighlighted] = useState(0);

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

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Compute trigger position for the portal-rendered dropdown, and close
  // on scroll/resize of any ancestor so it never drifts off its trigger.
  useLayoutEffect(() => {
    if (!open) return;

    const updateCoords = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) {
        setCoords({ top: rect.bottom + 4, left: rect.left, width: rect.width });
      }
    };
    updateCoords();

    const handleScroll = (e: Event) => {
      // Ignore scrolls that originate inside the dropdown itself (e.g. the
      // user scrolling a long options list) - only close when something
      // outside it scrolls, since that's what would make it drift off
      // its trigger.
      const target = e.target as Node;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
      setQuery('');
    };
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', updateCoords);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', updateCoords);
    };
  }, [open]);

  // Debounce server-side search calls as the user types.
  useEffect(() => {
    if (!onSearch) return;
    const t = setTimeout(() => onSearch(query), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, onSearch]);

  // Focus search input when opened
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      setHighlighted(0);
    }
  }, [open]);

  const handleSelect = (opt: ComboBoxOption) => {
    onChange(opt.value);
    setOpen(false);
    setQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
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

  // Scroll highlighted item into view
  useEffect(() => {
    if (listRef.current) {
      const el = listRef.current.children[highlighted] as HTMLElement | undefined;
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlighted]);

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
    <div ref={containerRef} className={`relative ${className}`} onKeyDown={handleKeyDown}>
      {/* Trigger button */}
      <button
        type="button"
        id={fieldId}
        ref={triggerRef}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen(v => !v)}
        className={triggerBase}
      >
        <span className={`truncate flex-1 text-left ${!value && !selectedLabel ? 'text-slate-400 dark:text-slate-500' : ''}`}>
          {selectedLabel || placeholder}
        </span>
        {value && !required && noneLabel !== undefined && (
          <X
            className="w-3 h-3 text-slate-400 hover:text-slate-600 shrink-0"
            onClick={(e) => { e.stopPropagation(); onChange(''); }}
          />
        )}
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-slate-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown, portalled to body so it can't inflate a scrollable ancestor */}
      {open && !(coords?.top === 0 && coords?.left === 0 && coords?.width === 0) && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', top: coords.top, left: coords.left, width: coords.width }}
          className="z-50 min-w-[180px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100"
        >
          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => { setQuery(e.target.value); setHighlighted(0); }}
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
            className="max-h-52 overflow-y-auto py-1"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-slate-400 text-center">No results</li>
            ) : (
              filtered.map((opt, idx) => (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={opt.value === value}
                  onMouseDown={() => handleSelect(opt)}
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
        </div>,
        document.body
      )}
    </div>
  );
}
