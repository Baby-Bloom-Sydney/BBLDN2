/**
 * Invoice weeks and dates (plan 06 step 3). Built on the one London clock (`src/lib/timezone.ts`, BUILD/README
 * § Wave 1 alignment item 2; plan R22): no second converter, no copy of `londonToday`. A week runs Monday to Sunday,
 * London time; brief 07 finds the first week with the same `londonWeekStart`, so both sides agree on the Monday.
 *
 * Dates are London calendar dates ("YYYY-MM-DD"). Labels format a calendar date on a fixed noon-UTC instant with
 * `timeZone: "UTC"`, so the host's zone can't move a date (the `formatClockHourMinute` rule for wall clocks).
 *
 * 06b-4 rework (BAI 2026-11-12): an invoice is any set of dated shifts, so its period — the earliest to the latest
 * shift date — is labelled by `periodLabel`, which generalises the old week label. The week stays only for brief 07
 * (`londonWeekStart`, `isLondonMonday`, `weekEndOf`: a placement's hours in one Monday–Sunday).
 *
 * BB-wave1-041126/06a-build, 2026-11-04; 06b2-build, 2026-11-06 (dayLabel); 06b4-server, 2026-11-12 (periodLabel).
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

/** A real date that is the Monday of its own week (brief 07's week, `getPlacementWeekHours`). */
export function isLondonMonday(date: string): boolean {
  return isLondonDate(date) && londonMondayOf(date) === date;
}

/** After London's today: a future date can't be invoiced; today can (brief §3 nanny 4). */
export function isFutureLondonDate(date: string, now: Date): boolean {
  return date > londonToday(now);
}

/** The Sunday that ends a week (brief 07's week). */
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

/**
 * An invoice's period (ledger reading 7): "2–29 Nov 2026"; "29 Oct – 2 Nov 2026"; "29 Dec 2026 – 2 Jan 2027"; and
 * "5 Oct 2026" for one day. A RangeError for a date that isn't one, or an end before the start.
 */
export function periodLabel(start: string, end: string): string {
  const from = requireNoonOf(start);
  const to = requireNoonOf(end);
  if (end < start) throw new RangeError("a period ends on or after its start");
  if (start === end) return DAY_MONTH_YEAR.format(from);
  if (from.getUTCFullYear() !== to.getUTCFullYear()) {
    return `${DAY_MONTH_YEAR.format(from)} – ${DAY_MONTH_YEAR.format(to)}`;
  }
  if (from.getUTCMonth() !== to.getUTCMonth()) {
    return `${DAY_MONTH.format(from)} – ${DAY_MONTH_YEAR.format(to)}`;
  }
  return `${DAY.format(from)}–${DAY_MONTH_YEAR.format(to)}`;
}

/** "Mon 8 Feb" — a shift's date in the invoice's table, under its period heading (06b-2). */
export function dayLabel(date: string): string {
  const at = requireNoonOf(date);
  return `${WEEKDAY.format(at)} ${DAY_MONTH.format(at)}`;
}

/** "15 Feb 2027" — the London date an invoice was issued. */
export function issueDateLabel(instant: Date | string): string {
  const at = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(at.getTime())) throw new RangeError("not an instant");
  return DAY_MONTH_YEAR.format(requireNoonOf(londonDateOf(at)));
}
