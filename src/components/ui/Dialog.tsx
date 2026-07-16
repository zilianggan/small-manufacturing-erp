import React from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './Button';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  /** Tailwind max-width class for the dialog panel, e.g. 'max-w-2xl' (default) or 'max-w-md' */
  maxWidth?: string;
  /** Extra classes for the header row */
  headerClassName?: string;
  /** Extra classes for the title text */
  titleClassName?: string;
  /** Optional icon/badge rendered before the title */
  titleIcon?: React.ReactNode;
}

/**
 * Shared modal dialog shell used across the app (Add/Edit Item, Contact, Employee, PO, Order forms).
 * Renders the fixed backdrop + centered panel + header (title & close button).
 * Pass form/body content as children; use <DialogFooter> for the action row.
 */
export default function Dialog({
  open,
  onClose,
  title,
  children,
  maxWidth = 'max-w-2xl',
  headerClassName = '',
  titleClassName = 'font-semibold text-card-foreground text-sm',
  titleIcon,
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out" />
        <RadixDialog.Content
          className={cn(
            'fixed inset-0 z-50 w-full h-full bg-card shadow-xl overflow-hidden data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95 duration-200 flex flex-col',
            'sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[90vh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:border sm:border-border sm:rounded-2xl',
            maxWidth
          )}
        >
          <div className={cn('p-5 border-b border-border flex items-center justify-between shrink-0', headerClassName)}>
            <RadixDialog.Title className={cn(titleClassName, 'flex items-center space-x-2')}>
              {titleIcon}
              <span>{title}</span>
            </RadixDialog.Title>
            <RadixDialog.Close asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
                <X className="w-4 h-4" />
              </Button>
            </RadixDialog.Close>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export function DialogFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-end space-x-2 pt-3 border-t border-border text-xs mt-4">
      {children}
    </div>
  );
}

export function DialogCancelButton({ onClick, children = 'Cancel' }: { onClick: () => void; children?: React.ReactNode }) {
  return (
    <Button type="button" variant="secondary" onClick={onClick}>
      {children}
    </Button>
  );
}

export function DialogSubmitButton({ children, className = '', disabled }: { children: React.ReactNode; className?: string; disabled?: boolean }) {
  return (
    <Button type="submit" className={className} disabled={disabled}>
      {children}
    </Button>
  );
}
