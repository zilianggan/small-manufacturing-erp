import React from 'react';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import { cn } from '../../lib/utils';

export const TooltipProvider = RadixTooltip.Provider;
export const Tooltip = RadixTooltip.Root;
export const TooltipTrigger = RadixTooltip.Trigger;

export function TooltipContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof RadixTooltip.Content>) {
  return (
    <RadixTooltip.Portal>
      <RadixTooltip.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 rounded-lg bg-foreground px-2.5 py-1.5 text-xs font-medium text-background shadow-md data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in',
          className
        )}
        {...props}
      />
    </RadixTooltip.Portal>
  );
}
