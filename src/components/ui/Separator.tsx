import React from 'react';
import * as RadixSeparator from '@radix-ui/react-separator';
import { cn } from '../../lib/utils';

export function Separator({ className, orientation = 'horizontal', decorative = true, ...props }: React.ComponentProps<typeof RadixSeparator.Root>) {
  return (
    <RadixSeparator.Root
      orientation={orientation}
      decorative={decorative}
      className={cn('shrink-0 bg-border', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className)}
      {...props}
    />
  );
}
