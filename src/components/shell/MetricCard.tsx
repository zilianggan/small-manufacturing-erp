import React from 'react';
import { cn } from '../../lib/utils';

interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  className?: string;
}

/** Bare label/value pair (no card chrome) — for dense stat grids inside a DetailPanel or quick-summary panel. */
export function MetricCard({ label, value, className }: MetricCardProps) {
  return (
    <div className={cn('space-y-0.5', className)}>
      <div className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}
