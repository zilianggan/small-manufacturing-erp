import React from 'react';
import * as RadixScrollArea from '@radix-ui/react-scroll-area';
import { cn } from '../../lib/utils';

export function ScrollArea({ className, children, ...props }: React.ComponentProps<typeof RadixScrollArea.Root>) {
  return (
    <RadixScrollArea.Root className={cn('relative overflow-hidden', className)} {...props}>
      <RadixScrollArea.Viewport className="h-full w-full">{children}</RadixScrollArea.Viewport>
      <RadixScrollArea.Scrollbar
        orientation="vertical"
        className="flex touch-none select-none p-0.5 w-2.5 transition-colors"
      >
        <RadixScrollArea.Thumb className="relative flex-1 rounded-full bg-border hover:bg-muted-foreground/40" />
      </RadixScrollArea.Scrollbar>
      <RadixScrollArea.Corner />
    </RadixScrollArea.Root>
  );
}
