import React from 'react';
import * as RadixAvatar from '@radix-ui/react-avatar';
import { cn } from '../../lib/utils';

export function Avatar({ className, ...props }: React.ComponentProps<typeof RadixAvatar.Root>) {
  return <RadixAvatar.Root className={cn('relative flex h-8 w-8 shrink-0 overflow-hidden rounded-full', className)} {...props} />;
}

export function AvatarImage(props: React.ComponentProps<typeof RadixAvatar.Image>) {
  return <RadixAvatar.Image className="aspect-square h-full w-full" {...props} />;
}

export function AvatarFallback({ className, ...props }: React.ComponentProps<typeof RadixAvatar.Fallback>) {
  return (
    <RadixAvatar.Fallback
      className={cn('flex h-full w-full items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary', className)}
      {...props}
    />
  );
}
