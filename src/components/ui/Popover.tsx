import React from 'react';
import * as RadixPopover from '@radix-ui/react-popover';
import { cn } from '../../lib/utils';

export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverAnchor = RadixPopover.Anchor;

export function PopoverContent({ className, align = 'center', sideOffset = 6, ...props }: React.ComponentProps<typeof RadixPopover.Content>) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95',
          className
        )}
        {...props}
      />
    </RadixPopover.Portal>
  );
}
