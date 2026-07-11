import React from 'react';
import { cn } from '../../lib/utils';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle } from 'lucide-react';

interface NotificationCardProps {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  severity?: 'info' | 'warning' | 'destructive';
  action?: React.ReactNode;
  className?: string;
}

const SEVERITY_CLASS: Record<NonNullable<NotificationCardProps['severity']>, string> = {
  info: 'bg-primary/10 text-primary',
  warning: 'bg-warning/10 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
};

/** Single actionable alert row (e.g. a low-stock item) — distinct from TimelineCard's chronological feed. */
export function NotificationCard({ icon: Icon = AlertTriangle, title, description, severity = 'warning', action, className }: NotificationCardProps) {
  return (
    <div data-fade-item className={cn('flex items-start gap-3 py-2.5 first:pt-0 last:pb-0', className)}>
      <div className={cn('shrink-0 w-7 h-7 rounded-lg flex items-center justify-center mt-0.5', SEVERITY_CLASS[severity])}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground truncate">{title}</p>
        {description && <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
