import React from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './Button';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** Tailwind width class for the panel, e.g. 'w-full max-w-lg' (default) or 'max-w-xl' */
  width?: string;
  footer?: React.ReactNode;
}

/**
 * Slide-over drawer panel anchored to the right edge of the screen — used for
 * record editors (Material/Product) so the underlying list/detail stays visible
 * and no full-page navigation happens.
 */
export function Sheet({ open, onClose, title, description, children, width = 'w-full max-w-lg', footer }: SheetProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out" />
        <RadixDialog.Content
          className={cn(
            'fixed right-0 top-0 z-50 h-dvh bg-card border-l border-border shadow-2xl flex flex-col',
            'data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right duration-300',
            width
          )}
        >
          <div className="p-5 border-b border-border flex items-start justify-between shrink-0">
            <div>
              <RadixDialog.Title className="font-semibold text-card-foreground text-sm">{title}</RadixDialog.Title>
              {description && <RadixDialog.Description className="text-xs text-muted-foreground mt-0.5">{description}</RadixDialog.Description>}
            </div>
            <RadixDialog.Close asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground -mt-1">
                <X className="w-4 h-4" />
              </Button>
            </RadixDialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto">{children}</div>
          {footer && <div className="p-5 border-t border-border shrink-0">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
