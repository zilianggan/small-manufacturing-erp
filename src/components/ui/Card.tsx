import React from 'react';
import { cn } from '../../lib/utils';

interface CardProps {
  className?: string;
  children: React.ReactNode;
  id?: string;
}

/**
 * Shared bordered/rounded surface used for table wrappers, grid item cards,
 * and info panels. Pass layout-specific classes (padding, hover states, flex
 * direction, etc.) via `className` — the base surface classes always apply
 * so every card stays visually consistent, light and dark.
 */
export function Card({ className = '', children, id }: CardProps) {
  return (
    <div id={id} className={cn('bg-card text-card-foreground border border-border rounded-lg shadow-sm', className)}>
      {children}
    </div>
  );
}

interface CardSectionProps {
  className?: string;
  children: React.ReactNode;
}

export function CardHeader({ className = 'p-5 pb-3 border-b border-border flex items-center justify-between', children }: CardSectionProps) {
  return <div className={className}>{children}</div>;
}

export function CardTitle({ className = 'font-semibold text-card-foreground text-sm', children }: CardSectionProps) {
  return <h3 className={className}>{children}</h3>;
}

export function CardDescription({ className = 'text-xs text-muted-foreground mt-0.5', children }: CardSectionProps) {
  return <p className={className}>{children}</p>;
}

export function CardContent({ className = 'p-5', children }: CardSectionProps) {
  return <div className={className}>{children}</div>;
}

export function CardFooter({ className = 'p-5 pt-3 border-t border-border flex items-center justify-end gap-2', children }: CardSectionProps) {
  return <div className={className}>{children}</div>;
}

export function CardEmptyState({ className = 'text-center py-12 text-xs text-muted-foreground', children }: CardSectionProps) {
  return <div className={className}>{children}</div>;
}
