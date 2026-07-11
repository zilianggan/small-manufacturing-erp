import React from 'react';
import { useFadeInOnMount } from '../../hooks/useFadeInOnMount';
import { cn } from '../../lib/utils';

interface DashboardShellProps {
  children: React.ReactNode;
  /** Recompute the entrance stagger when this changes (e.g. after a data reload). */
  deps?: unknown[];
  className?: string;
}

/** Root layout wrapper for command-center style pages — wires the mount-stagger animation once for every direct `data-fade-item` descendant. */
export function DashboardShell({ children, deps = [], className }: DashboardShellProps) {
  const ref = useFadeInOnMount<HTMLDivElement>(deps);
  return (
    <div ref={ref} className={cn('space-y-6', className)}>
      {children}
    </div>
  );
}
