/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';

interface SortableThProps<K extends string> {
  label: string;
  sortKey: K;
  activeKey: K;
  dir: 'asc' | 'desc';
  onClick: (key: K) => void;
  align?: 'left' | 'right';
  /** Override the <th> classes — detail-page line-item tables use
   *  'px-4 py-2 font-semibold' (the default); list-page tables use
   *  'p-4' (their uppercase/font-mono styling already lives on the <tr>). */
  thClassName?: string;
}

/**
 * Clickable table header cell shared by every sortable list/detail table in
 * the app — click toggles asc/desc when already the active sort column, or
 * switches to this column at asc otherwise. Callers own the sort state and
 * either re-query (server-side sort) or re-sort the already-loaded rows
 * (client-side sort) in response to onClick.
 */
export default function SortableTh<K extends string>({ label, sortKey, activeKey, dir, onClick, align = 'left', thClassName = 'px-4 py-2 font-semibold' }: SortableThProps<K>) {
  const active = sortKey === activeKey;
  return (
    <th className={`${thClassName} ${align === 'right' ? 'text-right' : ''}`}>
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className={`flex items-center space-x-1 hover:text-slate-800 transition-colors ${align === 'right' ? 'ml-auto' : ''} ${active ? 'text-slate-800' : ''}`}
      >
        <span>{label}</span>
        {active ? (dir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 text-slate-300" />}
      </button>
    </th>
  );
}
