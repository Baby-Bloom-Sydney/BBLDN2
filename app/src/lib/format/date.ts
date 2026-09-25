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
 */

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
  const day = d.getDate();
  const month = (style === "short" ? SHORT_MONTHS : LONG_MONTHS)[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
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
