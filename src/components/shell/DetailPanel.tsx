import React from 'react';
import { Card } from '../ui/Card';
import { cn } from '../../lib/utils';

interface DetailPanelProps {
  image?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  emptyState?: React.ReactNode;
  className?: string;
}

/** Right-pane record view for a SplitView — header block (image/title/badges/actions) + scrollable body. */
export function DetailPanel({ image, title, subtitle, badges, actions, children, emptyState, className }: DetailPanelProps) {
  if (emptyState) {
    return (
      <Card className={cn('flex-1 flex items-center justify-center', className)}>
        {emptyState}
      </Card>
    );
  }

  return (
    <Card className={cn('flex-1 flex flex-col min-h-0', className)}>
      <div className="p-5 border-b border-border flex items-start gap-4 shrink-0">
        {image}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold text-card-foreground truncate">{title}</h2>
            {badges}
          </div>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-5">{children}</div>
    </Card>
  );
}
