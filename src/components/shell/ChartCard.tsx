import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/Card';
import { cn } from '../../lib/utils';

interface ChartCardProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  legend?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  'data-fade-item'?: boolean;
}

/** SectionCard variant tuned for charts: header can carry a legend/timeframe row above the plot area. */
export function ChartCard({ title, description, legend, children, className, ...rest }: ChartCardProps) {
  return (
    <Card className={cn('flex flex-col', className)} {...rest}>
      <CardHeader className="p-5 pb-0 border-0 flex-col items-start gap-3">
        <div className="w-full flex items-center justify-between gap-3">
          <div>
            <CardTitle>{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </div>
          {legend}
        </div>
      </CardHeader>
      <CardContent className="p-5 flex-1">{children}</CardContent>
    </Card>
  );
}
