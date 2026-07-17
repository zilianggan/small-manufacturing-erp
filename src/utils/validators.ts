/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { isValidPhoneNumber, parsePhoneNumber } from 'libphonenumber-js';

export const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// Default region MY: a number typed without an explicit country code (e.g.
// "012-345 6789") is parsed as Malaysian; numbers with an explicit country
// code (e.g. "+1 202-555-0143") still parse via that code.
export const isValidPhone = (phone: string): boolean => isValidPhoneNumber(phone, 'MY');

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

// Only meaningful for an already-valid number (callers gate on isValidPhone
// first) — falls back to the original string on anything unparseable so a
// call site can never turn a value into an empty/garbled one.
export const toE164Phone = (phone: string): string => {
  try {
    const parsed = parsePhoneNumber(phone, 'MY');
    return parsed?.isValid() ? parsed.format('E.164') : phone;
  } catch {
    return phone;
  }
};
