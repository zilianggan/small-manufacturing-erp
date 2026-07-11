import React from 'react';
import { cn } from '../../lib/utils';

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, breadcrumb, className }: PageHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4 flex-wrap', className)}>
      <div className="space-y-1">
        {breadcrumb}
        <h1 className="text-xl font-semibold text-foreground tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
