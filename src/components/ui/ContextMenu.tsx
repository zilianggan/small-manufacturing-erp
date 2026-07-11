import React from 'react';
import * as RadixContextMenu from '@radix-ui/react-context-menu';
import { cn } from '../../lib/utils';

export const ContextMenu = RadixContextMenu.Root;
export const ContextMenuTrigger = RadixContextMenu.Trigger;

export function ContextMenuContent({ className, ...props }: React.ComponentProps<typeof RadixContextMenu.Content>) {
  return (
    <RadixContextMenu.Portal>
      <RadixContextMenu.Content
        className={cn(
          'z-50 min-w-[10rem] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95',
          className
        )}
        {...props}
      />
    </RadixContextMenu.Portal>
  );
}

export function ContextMenuItem({ className, ...props }: React.ComponentProps<typeof RadixContextMenu.Item>) {
  return (
    <RadixContextMenu.Item
      className={cn(
        'relative flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs outline-none transition-colors focus:bg-secondary data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className
      )}
      {...props}
    />
  );
}

export function ContextMenuSeparator({ className, ...props }: React.ComponentProps<typeof RadixContextMenu.Separator>) {
  return <RadixContextMenu.Separator className={cn('my-1 h-px bg-border', className)} {...props} />;
}
