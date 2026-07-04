/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  /** Tailwind max-width class for the dialog panel, e.g. 'max-w-2xl' (default) or 'max-w-md' */
  maxWidth?: string;
  /** Extra classes for the header row (e.g. 'bg-slate-50' used by the Employees dialog) */
  headerClassName?: string;
  /** Extra classes for the title text (e.g. 'font-bold' + icon wrapper support via titleIcon) */
  titleClassName?: string;
  /** Optional icon/badge rendered before the title (kept generic so callers can pass their own icon markup) */
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
  titleClassName = 'font-sans font-semibold text-slate-900 text-sm',
  titleIcon
}: DialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div className={`w-full ${maxWidth} bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in duration-200`}>
        <div className={`p-5 border-b border-slate-100 flex items-center justify-between ${headerClassName}`}>
          <h3 className={`${titleClassName} flex items-center space-x-2`}>
            {titleIcon}
            <span>{title}</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 font-bold text-base p-1 leading-none"
          >
            &times;
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Standard footer action row (Cancel + Submit buttons) used at the bottom of dialog forms. */
export function DialogFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100 text-xs mt-4">
      {children}
    </div>
  );
}

/** Secondary "Cancel" style button matching the existing dialog footer look. */
export function DialogCancelButton({ onClick, children = 'Cancel' }: { onClick: () => void; children?: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition-colors"
    >
      {children}
    </button>
  );
}

/** Primary "Save/Submit" style button matching the existing dialog footer look. */
export function DialogSubmitButton({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <button
      type="submit"
      className={`px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors ${className}`}
    >
      {children}
    </button>
  );
}
