/**
 * Invoice weeks and dates (plan 06 step 3). Built on the one London clock (`src/lib/timezone.ts`, BUILD/README
 * § Wave 1 alignment item 2; plan R22): no second converter, no copy of `londonToday`. A week runs Monday to Sunday,
 * London time; brief 07 finds the first week with the same `londonWeekStart`, so both sides agree on the Monday.
 *
 * Dates are London calendar dates ("YYYY-MM-DD"). Labels format a calendar date on a fixed noon-UTC instant with
 * `timeZone: "UTC"`, so the host's zone can't move a date (the `formatClockHourMinute` rule for wall clocks).
 *
 * BB-wave1-041126/06a-build, 2026-11-04.
 */

import { APP_LOCALE } from "@/lib/constants";
import { addLondonDays, londonDateOf, londonMondayOf, londonToday, localToUTC, type UtcRange } from "@/lib/timezone";

/** The Monday of the London week holding a date — the one clock's `londonMondayOf` (plan R21). */
export { londonMondayOf as londonWeekStart } from "@/lib/timezone";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NOON_UTC_HOUR = 12;

/** Noon UTC on a calendar date, or null when the string isn't a real date. */
function noonOf(date: string): Date | null {
  const m = ISO_DATE.exec(date);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = new Date(Date.UTC(year, month - 1, day, NOON_UTC_HOUR));
  return at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day ? at : null;
}

function requireNoonOf(date: string): Date {
  const at = noonOf(date);
  if (!at) throw new RangeError("not a calendar date");
  return at;
}

/** A real calendar date written "YYYY-MM-DD". */
export function isLondonDate(date: string): boolean {
  return noonOf(date) !== null;
}

/** A real date that is the Monday of its own week (a Regular week's `period_start`). */
export function isLondonMonday(date: string): boolean {
  return isLondonDate(date) && londonMondayOf(date) === date;
}

/** After London's today: future weeks and dates can't be invoiced; the current week can (brief §3 nanny 4). */
export function isFutureLondonDate(date: string, now: Date): boolean {
  return date > londonToday(now);
}

/** The Sunday that ends a week. */
export function weekEndOf(monday: string): string {
  return addLondonDays(monday, 6);
}

/** London's day holding `now`, midnight to midnight, as a half-open UTC range (the daily send cap). */
export function londonDayRange(now: Date): UtcRange {
  const today = londonToday(now);
  return { fromUtc: localToUTC(today, 0, 0), toUtc: localToUTC(addLondonDays(today, 1), 0, 0) };
}

const DAY_MONTH = new Intl.DateTimeFormat(APP_LOCALE, { day: "numeric", month: "short", timeZone: "UTC" });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat(APP_LOCALE, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const DAY = new Intl.DateTimeFormat(APP_LOCALE, { day: "numeric", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat(APP_LOCALE, { weekday: "short", timeZone: "UTC" });

/** "8–14 Feb 2027"; "29 Mar – 4 Apr 2027"; "28 Dec 2026 – 3 Jan 2027". */
export function weekRangeLabel(monday: string): string {
  const start = requireNoonOf(monday);
  const end = requireNoonOf(weekEndOf(monday));
  if (start.getUTCFullYear() !== end.getUTCFullYear()) {
    return `${DAY_MONTH_YEAR.format(start)} – ${DAY_MONTH_YEAR.format(end)}`;
  }
  if (start.getUTCMonth() !== end.getUTCMonth()) {
    return `${DAY_MONTH.format(start)} – ${DAY_MONTH_YEAR.format(end)}`;
  }
  return `${DAY.format(start)}–${DAY_MONTH_YEAR.format(end)}`;
}

/** "8 Feb 2027" — as in "week of 8 Feb 2027". */
export function weekOfLabel(monday: string): string {
  return DAY_MONTH_YEAR.format(requireNoonOf(monday));
}

/** "Wed 3 Feb 2027" — a Trial Shift's date. */
export function shiftDateLabel(date: string): string {
  const at = requireNoonOf(date);
  return `${WEEKDAY.format(at)} ${DAY_MONTH_YEAR.format(at)}`;
}

/** "15 Feb 2027" — the London date an invoice was issued. */
export function issueDateLabel(instant: Date | string): string {
  const at = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(at.getTime())) throw new RangeError("not an instant");
  return DAY_MONTH_YEAR.format(requireNoonOf(londonDateOf(at)));
}
