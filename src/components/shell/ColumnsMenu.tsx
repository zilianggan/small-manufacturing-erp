import { Columns3 } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/Popover';
import { Button } from '../ui/Button';

interface ColumnsMenuProps {
  columns: { key: string; label: string }[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
  onSelectAll: () => void;
}

/** Dropdown checklist to show/hide table columns — pair with useColumnVisibility. */
export function ColumnsMenu({ columns, hidden, onToggle, onSelectAll }: ColumnsMenuProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm"><Columns3 className="w-3.5 h-3.5" /> Columns</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 space-y-1">
        <button
          type="button"
          onClick={onSelectAll}
          disabled={hidden.size === 0}
          className="w-full text-left px-1 py-1 text-xs font-medium text-primary hover:underline disabled:opacity-50 disabled:no-underline disabled:cursor-default"
        >
          Select All
        </button>
        {columns.map((col) => (
          <label key={col.key} className="flex items-center gap-2 px-1 py-1 text-xs cursor-pointer hover:bg-secondary rounded-md">
            <input type="checkbox" checked={!hidden.has(col.key)} onChange={() => onToggle(col.key)} className="accent-primary rounded" />
            {col.label}
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}
