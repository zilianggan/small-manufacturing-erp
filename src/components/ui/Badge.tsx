import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

export const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-tight transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-primary/10 text-primary border-primary/20',
        secondary: 'bg-secondary text-secondary-foreground border-transparent',
        outline: 'text-foreground border-border bg-transparent',
        destructive: 'bg-destructive/10 text-destructive border-destructive/20',
        success: 'bg-success/10 text-success border-success/20',
        warning: 'bg-warning/10 text-warning border-warning/20',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
