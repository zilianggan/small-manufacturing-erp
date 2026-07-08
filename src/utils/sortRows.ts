/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Generic client-side sort for already-loaded row arrays (small/single-record
// tables — e.g. one order's line items). Missing values always sort last,
// regardless of direction. Pass the field's own key in numericKeys when it
// holds a number so it isn't compared as a string.
export function sortByField<T, K extends keyof T>(rows: T[], key: K, dir: 'asc' | 'desc', numericKeys: K[] = []): T[] {
  const isNumeric = numericKeys.includes(key);
  const mul = dir === 'asc' ? 1 : -1;

  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (isNumeric) return ((av as unknown as number) - (bv as unknown as number)) * mul;
    return String(av).localeCompare(String(bv)) * mul;
  });
}
