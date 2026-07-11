import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/Card';
import { cn } from '../../lib/utils';

interface SectionCardProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  'data-fade-item'?: boolean;
}

/** Generic bordered panel: header (title/description/actions) + body. Backbone of every dashboard/list panel. */
export function SectionCard({ title, description, actions, children, className, contentClassName = 'p-5', ...rest }: SectionCardProps) {
  return (
    <Card className={cn('flex flex-col', className)} {...rest}>
      <CardHeader className="p-5 pb-3 border-b border-border flex items-center justify-between gap-3">
        <div>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  );
}
