/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

const MENU_WIDTH = 224; // w-56

/**
 * Button-triggered sort menu — the "click a table header to toggle asc/desc"
 * pattern, but for views (like a card grid) that have no table header to
 * click. Clicking the already-active option flips its direction; clicking a
 * different option switches to it at 'asc'.
 *
 * Positioned as fixed + portaled to <body> (mirrors ActionsMenu.tsx) so it
 * can't be clipped by an ancestor `overflow-hidden` and its horizontal
 * position is clamped to the viewport instead of a plain CSS `right-0`,
 * which overflows off-screen when the trigger sits near a narrow mobile
 * viewport's edge.
 */
export default function SortMenu({ options, sortField, sortDir, onChange }: SortMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const menuHeight = options.length * 34 + 8;
    const openUp = rect.bottom + menuHeight > window.innerHeight;
    const centered = rect.left + rect.width / 2 - MENU_WIDTH / 2;
    setPos({
      top: openUp ? rect.top - menuHeight : rect.bottom + 4,
      left: Math.min(Math.max(centered, 8), window.innerWidth - MENU_WIDTH - 8),
    });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const activeLabel = options.find((o) => o.value === sortField)?.label || 'Sort';

  const selectOption = (value: string) => {
    onChange(value, value === sortField ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc');
    setOpen(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center space-x-1.5 px-3 py-2 bg-card border border-border hover:bg-secondary/60 text-foreground rounded-lg text-xs font-medium transition-colors"
      >
        <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground" />
        <span>{activeLabel}</span>
        {sortDir === 'asc' ? <ArrowUp className="w-3 h-3 text-muted-foreground" /> : <ArrowDown className="w-3 h-3 text-muted-foreground" />}
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: MENU_WIDTH }}
          className="bg-card border border-border rounded-lg shadow-lg z-50 overflow-hidden py-1 animate-in fade-in zoom-in-95 duration-100"
        >
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
        </div>,
        document.body
      )}
    </>
  );
}
