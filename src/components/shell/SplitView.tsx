import React from 'react';
import { cn } from '../../lib/utils';

interface SplitViewProps {
  left: React.ReactNode;
  right: React.ReactNode;
  leftClassName?: string;
  rightClassName?: string;
  leftWidth?: string;
  className?: string;
}

/**
 * Two-pane workspace layout: fixed-width list pane + flexible detail pane.
 * Stacks below 1440px — a Split Workspace needs real width for both panes
 * to be usable side by side, so it switches later than Tailwind's default
 * `lg` (1024px) would.
 */
export function SplitView({ left, right, leftClassName, rightClassName, leftWidth = 'min-[1440px]:w-[420px]', className }: SplitViewProps) {
  return (
    <div className={cn('flex flex-col min-[1440px]:flex-row gap-5 min-h-0 flex-1', className)}>
      <div className={cn('w-full min-w-0 min-h-0 flex flex-col', leftWidth, leftClassName)}>{left}</div>
      <div className={cn('flex-1 min-w-0 min-h-0 flex flex-col', rightClassName)}>{right}</div>
    </div>
  );
}
