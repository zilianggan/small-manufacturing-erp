/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface CardProps {
  className?: string;
  children: React.ReactNode;
  id?: string;
}

/**
 * Shared white/bordered/rounded surface used for table wrappers, grid item cards,
 * and info panels throughout the app. Pass layout-specific classes (padding,
 * hover states, flex direction, etc.) via `className` — the base surface classes
 * (bg/border/rounded/shadow) are always applied so every card stays visually consistent.
 */
export function Card({ className = '', children, id }: CardProps) {
  return (
    <div id={id} className={`bg-white border border-slate-200 rounded-xl shadow-sm ${className}`}>
      {children}
    </div>
  );
}

interface CardContentProps {
  className?: string;
  children: React.ReactNode;
}

/** Standard padded body region inside a <Card>. Defaults to the common p-5 padding. */
export function CardContent({ className = 'p-5', children }: CardContentProps) {
  return <div className={className}>{children}</div>;
}

/** Empty-state row/panel used inside cards, tables and grids ("No items found", etc). */
export function CardEmptyState({ className = 'text-center py-12 text-xs text-slate-400', children }: CardContentProps) {
  return <div className={className}>{children}</div>;
}
