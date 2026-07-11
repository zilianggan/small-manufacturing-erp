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
      <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full pl-9 pr-4 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring transition-shadow"
      />
    </div>
  );
}
