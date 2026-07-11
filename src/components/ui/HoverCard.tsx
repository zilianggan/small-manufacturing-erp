import React from 'react';
import * as RadixHoverCard from '@radix-ui/react-hover-card';
import { cn } from '../../lib/utils';

export const HoverCard = RadixHoverCard.Root;
export const HoverCardTrigger = RadixHoverCard.Trigger;

export function HoverCardContent({ className, sideOffset = 8, ...props }: React.ComponentProps<typeof RadixHoverCard.Content>) {
  return (
    <RadixHoverCard.Portal>
      <RadixHoverCard.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 w-64 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95',
          className
        )}
        {...props}
      />
    </RadixHoverCard.Portal>
  );
}
