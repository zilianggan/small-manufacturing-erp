import React from 'react';
import { Card } from '../ui/Card';
import { cn } from '../../lib/utils';
import { useCountUp } from '../../hooks/useCountUp';
import type { LucideIcon } from 'lucide-react';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: number;
  formatter?: (value: number) => string;
  icon: LucideIcon;
  trend?: { value: number; label: string; direction?: 'up' | 'down' };
  className?: string;
  'data-fade-item'?: boolean;
}

/** KPI tile: icon chip + count-up value + optional trend line. Used in Dashboard/Inventory summary rows. */
export function StatCard({ label, value, formatter, icon: Icon, trend, className, ...rest }: StatCardProps) {
  const ref = useCountUp<HTMLSpanElement>(value, { formatter });
  const isUp = trend?.direction !== 'down';

  return (
    <Card className={cn('p-5 flex items-start justify-between gap-3 hover:shadow-md transition-shadow', className)} {...rest}>
      <div className="space-y-1.5 min-w-0">
        <span className="text-muted-foreground text-xs font-medium uppercase tracking-wider">{label}</span>
        <div className="text-2xl font-semibold text-card-foreground tabular-nums">
          <span ref={ref}>0</span>
        </div>
        {trend && (
          <p className={cn('text-xs flex items-center gap-1', isUp ? 'text-success' : 'text-destructive')}>
            {isUp ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            <span>{trend.label}</span>
          </p>
        )}
      </div>
      <div className="p-2.5 bg-primary/10 text-primary rounded-xl shrink-0">
        <Icon className="w-5 h-5" />
      </div>
    </Card>
  );
}
