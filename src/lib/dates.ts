import type { Timestamp } from 'firebase/firestore'

/**
 * Expense dates are date-only values. They must round-trip through the
 * <input type="date"> string format in the user's local timezone — naive
 * `new Date('YYYY-MM-DD')` parses as UTC midnight and shifts a day for
 * anyone west of UTC.
 */

function toDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Today as a YYYY-MM-DD string in the user's local timezone. */
export function todayString(): string {
  return toDateString(new Date())
}

/** Parse a YYYY-MM-DD input value as local midnight (not UTC). */
export function parseDateString(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

/**
 * Expenses written by older versions stored UTC midnight (date-only ISO
 * parsing); newer ones store local midnight. Reading UTC-midnight values
 * with UTC accessors keeps both showing the date that was picked.
 */
function toDateParts(ts: Timestamp): { y: number; m: number; d: number } {
  const date = ts.toDate()
  if (date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0) {
    return { y: date.getUTCFullYear(), m: date.getUTCMonth(), d: date.getUTCDate() }
  }
  return { y: date.getFullYear(), m: date.getMonth(), d: date.getDate() }
}

/** Timestamp → YYYY-MM-DD for the date input; today when missing. */
export function timestampToDateString(ts?: Timestamp): string {
  if (!ts?.toDate) return todayString()
  const { y, m, d } = toDateParts(ts)
  return toDateString(new Date(y, m, d))
}

/** Timestamp → locale-formatted date-only string (e.g. 6/10/2026). */
export function formatDateOnly(ts?: Timestamp, locale?: string): string {
  if (!ts?.toDate) return ''
  const { y, m, d } = toDateParts(ts)
  return new Date(y, m, d).toLocaleDateString(locale)
}
