import React from 'react';
import * as RadixDropdown from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

export const DropdownMenu = RadixDropdown.Root;
export const DropdownMenuTrigger = RadixDropdown.Trigger;
export const DropdownMenuGroup = RadixDropdown.Group;
export const DropdownMenuSub = RadixDropdown.Sub;
export const DropdownMenuSubTrigger = ({ className, children, ...props }: React.ComponentProps<typeof RadixDropdown.SubTrigger>) => (
  <RadixDropdown.SubTrigger
    className={cn('flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:bg-secondary data-[state=open]:bg-secondary', className)}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto h-3.5 w-3.5" />
  </RadixDropdown.SubTrigger>
);

export function DropdownMenuContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof RadixDropdown.Content>) {
  return (
    <RadixDropdown.Portal>
      <RadixDropdown.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-[10rem] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95',
          className
        )}
        {...props}
      />
    </RadixDropdown.Portal>
  );
}

export function DropdownMenuSubContent({ className, ...props }: React.ComponentProps<typeof RadixDropdown.SubContent>) {
  return (
    <RadixDropdown.Portal>
      <RadixDropdown.SubContent
        className={cn('z-50 min-w-[8rem] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none', className)}
        {...props}
      />
    </RadixDropdown.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof RadixDropdown.Item>) {
  return (
    <RadixDropdown.Item
      className={cn(
        'relative flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs outline-none transition-colors focus:bg-secondary data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({ className, children, checked, ...props }: React.ComponentProps<typeof RadixDropdown.CheckboxItem>) {
  return (
    <RadixDropdown.CheckboxItem
      checked={checked}
      className={cn('relative flex cursor-pointer items-center gap-2 rounded-lg py-1.5 pl-7 pr-2.5 text-xs outline-none transition-colors focus:bg-secondary', className)}
      {...props}
    >
      <RadixDropdown.ItemIndicator className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <Check className="h-3.5 w-3.5" />
      </RadixDropdown.ItemIndicator>
      {children}
    </RadixDropdown.CheckboxItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof RadixDropdown.Label>) {
  return <RadixDropdown.Label className={cn('px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground', className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof RadixDropdown.Separator>) {
  return <RadixDropdown.Separator className={cn('my-1 h-px bg-border', className)} {...props} />;
}
