/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import * as RadixPopover from '@radix-ui/react-popover';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';

const pad = (n: number): string => String(n).padStart(2, '0');
const toValue = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Native date inputs are timezone-naive ("yyyy-MM-dd") — parsing through a bare `new Date(value)`
// reads it as UTC midnight, which can roll to the previous day in a negative-offset timezone. Pinning
// to local midnight (same trick as getDueUrgency in utils/priority.ts) keeps the calendar in sync.
const parseValue = (value: string): Date | null => {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
};
const isSameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTH_LABEL = (d: Date) => d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

interface DatePickerProps {
  /** "yyyy-MM-dd", matching a native <input type="date"> value. Empty string = unset. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
}

/**
 * Custom calendar dropdown replacing the browser's native <input type="date">, whose popup can't be
 * restyled at all and looks inconsistent across OSes. Built on Radix Popover (already a dependency,
 * same primitive ComboBox.tsx uses) rather than a new date-picker library — this is just a month grid.
 */
export default function DatePicker({
  value, onChange, placeholder = 'Select date...', disabled = false, required = false, className = '', id,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = parseValue(value);
  const [viewDate, setViewDate] = useState(() => selected ?? new Date());

  const openPicker = (next: boolean) => {
    setOpen(next);
    if (next) setViewDate(selected ?? new Date());
  };

  const handleSelect = (d: Date) => {
    onChange(toValue(d));
    setOpen(false);
  };

  const today = new Date();
  const monthStartDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const gridStart = new Date(monthStartDay);
  gridStart.setDate(gridStart.getDate() - monthStartDay.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });

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
    <RadixPopover.Root open={open} onOpenChange={openPicker}>
      <RadixPopover.Trigger asChild>
        <button type="button" id={id} disabled={disabled} className={`relative ${className} ${triggerBase}`}>
          <span className={`truncate flex-1 text-left ${!value ? 'text-slate-400 dark:text-slate-500' : ''}`}>
            {selected ? selected.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : placeholder}
          </span>
          {value && !required && (
            <X
              className="w-3 h-3 text-slate-400 hover:text-slate-600 shrink-0"
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onChange(''); }}
            />
          )}
          <Calendar className="w-3.5 h-3.5 shrink-0 text-slate-400" />
        </button>
      </RadixPopover.Trigger>

      <RadixPopover.Portal>
        <RadixPopover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-[100] w-[16.5rem] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl overflow-hidden p-3 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95 duration-100"
        >
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => setViewDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
              className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{MONTH_LABEL(viewDate)}</span>
            <button
              type="button"
              onClick={() => setViewDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
              className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {WEEKDAYS.map(w => (
              <span key={w} className="text-center text-[10px] font-medium text-slate-400 py-1">{w}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((d, i) => {
              const inMonth = d.getMonth() === viewDate.getMonth();
              const isToday = isSameDay(d, today);
              const isSelected = selected && isSameDay(d, selected);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSelect(d)}
                  className={`
                    h-7 w-7 rounded-md text-[11px] transition-colors
                    ${isSelected
                      ? 'bg-blue-600 text-white font-semibold'
                      : isToday
                        ? 'text-blue-600 dark:text-blue-400 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800'
                        : inMonth
                          ? 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                          : 'text-slate-300 dark:text-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }
                  `}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => handleSelect(new Date())}
            className="mt-2 w-full text-center text-[10px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
          >
            Today
          </button>
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
