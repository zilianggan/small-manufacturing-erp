/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';

export interface ActionMenuItem {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  hidden?: boolean;
}

const MENU_WIDTH = 176; // w-44

export default function ActionsMenu({ items }: { items: ActionMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const visible = items.filter(i => !i.hidden);

  // Position as fixed + portaled to <body> so ancestor `overflow-hidden`
  // table/card wrappers can't clip the menu for rows near the edge.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const menuHeight = visible.length * 34 + 8;
    const openUp = rect.bottom + menuHeight > window.innerHeight;
    setPos({
      top: openUp ? rect.top - menuHeight : rect.bottom + 4,
      left: Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8),
    });
  }, [open, visible.length]);

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

  if (visible.length === 0) return null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors dark:hover:bg-slate-700"
        title="Actions"
      >
        <MoreVertical className="w-3.5 h-3.5" />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: MENU_WIDTH }}
          className="z-50 bg-white border border-slate-200 rounded-lg shadow-lg py-1 text-xs dark:bg-slate-800 dark:border-slate-700"
        >
          {visible.map((item, i) => (
            <button
              key={i}
              type="button"
              disabled={item.disabled}
              onClick={() => { setOpen(false); item.onClick(); }}
              className={`w-full flex items-center space-x-2 px-3 py-2 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                item.danger ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40' : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
