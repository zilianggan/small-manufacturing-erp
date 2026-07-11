/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Shared date/time helpers for the order/quotation/delivery/inventory dates,
// which are stored as timestamptz (ISO strings) and shown with a time
// component in interactive views. Printed documents use formatDate (date
// only) for a cleaner look.

const pad = (n: number): string => String(n).padStart(2, '0');

/** Current instant as an ISO string, for auto-stamped timestamp columns. */
export const nowIso = (): string => new Date().toISOString();

/**
 * ISO/timestamptz value → "yyyy-MM-ddThh:mm" in local wall time, the value
 * shape an <input type="datetime-local"> expects. Empty string when missing.
 */
export const toDateTimeLocal = (value?: string | null): string => {
  const d = value ? new Date(value) : new Date();
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * datetime-local input value ("yyyy-MM-ddThh:mm", no tz) → ISO string for
 * storage. new Date() reads the tz-less string as local wall time, so the
 * stored instant round-trips back through toDateTimeLocal in the same zone.
 */
export const fromDateTimeLocal = (value: string): string => {
  if (!value) return '';
  const d = new Date(value);
  return isNaN(d.getTime()) ? '' : d.toISOString();
};

/** Display date + time, e.g. "11 Jul 2026, 2:30 pm". Empty for missing. */
export const formatDateTime = (value?: string | null): string => {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
};

/** Display date only, e.g. "11 Jul 2026". Empty for missing. */
export const formatDate = (value?: string | null): string => {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

/** First day (yyyy-MM-dd) of the month `monthsBack` months ago (0 = current). */
export const monthStart = (monthsBack = 0): string => {
  const d = new Date(); d.setMonth(d.getMonth() - monthsBack, 1);
  return d.toISOString().split('T')[0];
};

/** Last day (yyyy-MM-dd) of the month `monthsBack` months ago (0 = current). */
export const monthEnd = (monthsBack = 0): string => {
  const d = new Date(); d.setMonth(d.getMonth() - monthsBack + 1, 0);
  return d.toISOString().split('T')[0];
};
