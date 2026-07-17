/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import PhoneInputBase from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import { fieldInputClassName } from './FormField';

interface PhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

// Wraps react-phone-number-input (built on the same libphonenumber-js this
// app already validates phone numbers with) — country-prefix dropdown, live
// formatting, always emits E.164 (e.g. +60123456789), matching what the
// import path normalizes to (see utils/validators.ts's toE164Phone) so
// wa.me links and stored values stay consistent everywhere.
export default function PhoneInput({ value, onChange, placeholder }: PhoneInputProps) {
  return (
    <PhoneInputBase
      value={value || undefined}
      onChange={(v) => onChange(v || '')}
      defaultCountry="MY"
      international
      placeholder={placeholder || 'e.g. 12-345 6789'}
      className={`${fieldInputClassName} flex items-center gap-2`}
      numberInputProps={{ className: 'outline-none bg-transparent flex-1 min-w-0 border-0 focus:ring-0' }}
    />
  );
}
