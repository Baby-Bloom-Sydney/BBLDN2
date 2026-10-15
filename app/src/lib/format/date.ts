/**
 * Deterministic day-month-year date formatting — identical output on
 * server (Node) and client (browser).
 *
 * Why this file exists: `Date.toLocaleDateString(locale, ...)` is
 * non-deterministic across runtimes. A Node ICU build returned "June"
 * for BOTH `month: "long"` and `month: "short"`, while modern browsers
 * correctly produce "June" / "Jun". Mixing them in SSR causes React
 * hydration mismatches.
 *
 * This helper is locale-data-free: short/long month names are hard-
 * coded English so they can never drift between platforms.
 *
 * Bailey 2026-05-14 root-cause fix.
 *
 * LDN2 4b (card 3b): `formatAuDate` reads the day, month and year of the
 * instant **in the app timezone** (`APP_TZ`, Europe/London) from
 * `Intl.DateTimeFormat`'s numeric parts — no locale month names, so the
 * hydration guarantee above holds. The other helpers below still use the
 * runtime's local accessors (not in 4b's scope; noted for cleanup).
 */

import { APP_LOCALE, APP_TZ } from "@/lib/constants";

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const LONG_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export type DateStyle = "short" | "long";

/**
 * "13 Jun 2026" (short) or "13 June 2026" (long).
 * Returns "—" when input is null / undefined / unparseable so callers
 * don't have to handle the empty case themselves.
 */
export function formatAuDate(
  iso: string | Date | null | undefined,
  style: DateStyle = "short",
): string {
  if (iso === null || iso === undefined) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  const { day, monthIndex, year } = appTzParts(d);
  const month = (style === "short" ? SHORT_MONTHS : LONG_MONTHS)[monthIndex];
  return `${day} ${month} ${year}`;
}

const APP_TZ_PARTS = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TZ,
  day: "numeric",
  month: "numeric",
  year: "numeric",
});

/** Day, 0-based month and year of an instant on the app's clock (numeric parts only). */
function appTzParts(d: Date): { day: number; monthIndex: number; year: number } {
  const parts = APP_TZ_PARTS.formatToParts(d);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return { day: part("day"), monthIndex: part("month") - 1, year: part("year") };
}

/** "13 Jun" — used where the year is redundant (current-year context). */
export function formatAuDayMonth(
  iso: string | Date | null | undefined,
  style: DateStyle = "short",
): string {
  if (iso === null || iso === undefined) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  const day = d.getDate();
  const month = (style === "short" ? SHORT_MONTHS : LONG_MONTHS)[d.getMonth()];
  return `${day} ${month}`;
}

/** "June" — current-month label for headers like "Earnings · June". */
export function formatAuMonth(date: Date, style: DateStyle = "long"): string {
  const month = (style === "short" ? SHORT_MONTHS : LONG_MONTHS)[
    date.getMonth()
  ];
  return month;
}

const SHORT_WEEKDAYS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

/** "Mon 13 Jun" — weekday + day + short-month. Year omitted to keep
 *  this format scannable in lists. */
export function formatAuWeekdayDayMonth(
  iso: string | Date | null | undefined,
): string {
  if (iso === null || iso === undefined) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  const weekday = SHORT_WEEKDAYS[d.getDay()];
  const day = d.getDate();
  const month = SHORT_MONTHS[d.getMonth()];
  return `${weekday} ${day} ${month}`;
}

/** "Mon 13 Jun 2026" — weekday-prefixed full date for inbox lists,
 *  babysitting requests, etc. where the year is meaningful. */
export function formatAuWeekdayDate(
  iso: string | Date | null | undefined,
): string {
  if (iso === null || iso === undefined) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  const weekday = SHORT_WEEKDAYS[d.getDay()];
  const day = d.getDate();
  const month = SHORT_MONTHS[d.getMonth()];
  const year = d.getFullYear();
  return `${weekday}, ${day} ${month} ${year}`;
}
