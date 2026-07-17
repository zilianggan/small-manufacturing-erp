/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { isValidPhoneNumber } from 'libphonenumber-js';

export const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// Default region MY: a number typed without an explicit country code (e.g.
// "012-345 6789") is parsed as Malaysian; numbers with an explicit country
// code (e.g. "+1 202-555-0143") still parse via that code.
export const isValidPhone = (phone: string): boolean => isValidPhoneNumber(phone, 'MY');
