import React from 'react';
import { QUICK_RANGES } from '../utils/dateRanges';

interface QuickRangePillsProps {
  activeKey: string | null;
  onSelect: (key: string) => void;
}

/** Today/Yesterday/Last 7 Days/This Month/Last Month pill row — shared by Inventory/Purchases/Orders date filters. */
export default function QuickRangePills({ activeKey, onSelect }: QuickRangePillsProps) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {QUICK_RANGES.map((r) => (
        <button
          key={r.key}
          type="button"
          onClick={() => onSelect(r.key)}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${activeKey === r.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary/50 text-secondary-foreground border-transparent hover:bg-secondary'}`}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
