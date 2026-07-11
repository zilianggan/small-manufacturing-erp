import React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

export function Breadcrumb({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <nav aria-label="breadcrumb" className={className} {...props} />;
}

export function BreadcrumbList({ className, ...props }: React.HTMLAttributes<HTMLOListElement>) {
  return <ol className={cn('flex items-center gap-1.5 text-xs text-muted-foreground', className)} {...props} />;
}

export function BreadcrumbItem({ className, ...props }: React.HTMLAttributes<HTMLLIElement>) {
  return <li className={cn('flex items-center gap-1.5', className)} {...props} />;
}

export function BreadcrumbLink({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={cn('hover:text-foreground transition-colors', className)} {...props} />;
}

export function BreadcrumbPage({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('font-medium text-foreground', className)} {...props} />;
}

export function BreadcrumbSeparator({ className }: { className?: string }) {
  return <ChevronRight className={cn('h-3.5 w-3.5', className)} />;
}
