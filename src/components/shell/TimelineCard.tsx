import React from 'react';
import { cn } from '../../lib/utils';
import type { LucideIcon } from 'lucide-react';

export interface TimelineEntry {
  id: string;
  icon: LucideIcon;
  title: React.ReactNode;
  timestamp: string;
  description?: React.ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'destructive';
}

const TONE_CLASS: Record<NonNullable<TimelineEntry['tone']>, string> = {
  default: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
};

/** Vertical activity feed — connecting rail + icon dot per entry. Used by Dashboard's Activity Timeline. */
export function TimelineCard({ entries, className }: { entries: TimelineEntry[]; className?: string }) {
  return (
    <div className={cn('space-y-0', className)}>
      {entries.map((entry, i) => {
        const Icon = entry.icon;
        return (
          <div key={entry.id} data-fade-item className="flex gap-3 pb-5 last:pb-0 relative">
            {i < entries.length - 1 && <div className="absolute left-[15px] top-8 bottom-0 w-px bg-border" />}
            <div className={cn('relative z-10 shrink-0 w-8 h-8 rounded-full flex items-center justify-center', TONE_CLASS[entry.tone ?? 'default'])}>
              <Icon className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-foreground truncate">{entry.title}</span>
                <span className="text-[11px] text-muted-foreground shrink-0">{entry.timestamp}</span>
              </div>
              {entry.description && <p className="text-xs text-muted-foreground mt-0.5">{entry.description}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
