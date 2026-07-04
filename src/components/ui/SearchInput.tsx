/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Search } from 'lucide-react';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/** Shared search bar (icon + text input) used at the top of Inventory/Contacts/Purchases/Orders views. */
export default function SearchInput({
  value,
  onChange,
  placeholder = 'Search...',
  className = 'relative flex-1 max-w-md'
}: SearchInputProps) {
  return (
    <div className={className}>
      <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 font-sans dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500"
      />
    </div>
  );
}
