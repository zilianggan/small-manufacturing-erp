import type { CSSProperties, ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Eye, EyeOff } from 'lucide-react';
import { DashboardSectionKey } from '../../types';
import { cn } from '../../lib/utils';

interface SortableSectionProps {
  id: DashboardSectionKey;
  span: number;
  customizing: boolean;
  hidden: boolean;
  onToggleVisible: () => void;
  children: ReactNode;
}

export function SortableSection({ id, span, customizing, hidden, onToggleVisible, children }: SortableSectionProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !customizing });

  const style: CSSProperties = {
    gridColumn: `span ${span} / span ${span}`,
    transform: CSS.Transform.toString(transform),
    transition,
  };

  if (hidden && !customizing) return null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'relative',
        isDragging && 'z-10 opacity-80',
        hidden && customizing && 'opacity-40 rounded-xl border-2 border-dashed border-border'
      )}
    >
      {customizing && (
        <div className="flex items-center justify-between mb-1 px-1">
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Drag to reorder ${id}`}
            className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-secondary/60 active:cursor-grabbing"
          >
            <GripVertical className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onToggleVisible}
            aria-label={hidden ? `Show ${id}` : `Hide ${id}`}
            className="rounded p-1 text-muted-foreground hover:bg-secondary/60"
          >
            {hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      )}
      {children}
    </div>
  );
}
