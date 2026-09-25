// T-032 — Date/time formatters anchored to Sydney timezone.
// Used across the leads list + drawer + log so operators always see absolute
// ANZ wall-clock time regardless of where the server or their browser is.

const SYDNEY_DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Australia/Sydney",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const SYDNEY_DATE_ONLY = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Australia/Sydney",
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * Format an ISO timestamp as e.g. "20 May 2026, 2:35 pm" in Sydney time.
 * Returns "—" for null/undefined/invalid input.
 */
export function formatSydneyDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return SYDNEY_DATE_TIME.format(d);
}

/**
 * Format an ISO timestamp as e.g. "20 May 2026" in Sydney time (no time).
 * Use for fields where time-of-day is not meaningful (e.g. snooze date).
 */
export function formatSydneyDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return SYDNEY_DATE_ONLY.format(d);
}
