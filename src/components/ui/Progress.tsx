import React from 'react';
import * as RadixProgress from '@radix-ui/react-progress';
import { cn } from '../../lib/utils';

interface ProgressProps extends React.ComponentProps<typeof RadixProgress.Root> {
  value: number;
  indicatorClassName?: string;
}

export function Progress({ className, value, indicatorClassName, ...props }: ProgressProps) {
  return (
    <RadixProgress.Root className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-secondary', className)} {...props}>
      <RadixProgress.Indicator
        className={cn('h-full w-full flex-1 bg-primary transition-transform duration-500 ease-out', indicatorClassName)}
        style={{ transform: `translateX(-${100 - Math.min(100, Math.max(0, value))}%)` }}
      />
    </RadixProgress.Root>
  );
}
