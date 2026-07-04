/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface FormFieldProps {
  /** Full label text, including a trailing " *" for required fields if desired */
  label: string;
  children: React.ReactNode;
  className?: string;
  labelClassName?: string;
  /** Pass through to place the field in a grid, e.g. 'space-y-1 sm:col-span-2' */
  colSpan?: string;
}

/**
 * Shared "controller field" wrapper: a <label> stacked above its input/select/textarea.
 * Mirrors the `<div className="space-y-1"><label className="font-semibold block">...</label>{input}</div>`
 * pattern repeated across every add/edit form in the app.
 */
export default function FormField({
  label,
  children,
  className = 'space-y-1',
  labelClassName = 'font-semibold block',
  colSpan = ''
}: FormFieldProps) {
  return (
    <div className={`${className} ${colSpan}`.trim()}>
      <label className={labelClassName}>{label}</label>
      {children}
    </div>
  );
}

/** Shared text input styling used by plain <input>/<textarea> fields inside forms. */
export const fieldInputClassName =
  'w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500';
