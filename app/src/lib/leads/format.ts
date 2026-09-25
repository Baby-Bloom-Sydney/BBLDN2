// T-032 — Date/time formatters anchored to the app's home timezone.
// Used across the leads list + drawer + log so operators always see absolute
// wall-clock time in `APP_TZ` regardless of where the server or their browser is.

import { APP_LOCALE, APP_TZ } from "@/lib/constants";

const LEAD_DATE_TIME = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TZ,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const LEAD_DATE_ONLY = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TZ,
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * Format an ISO timestamp as e.g. "20 May 2026, 14:35" in the app's home zone.
 * Returns "—" for null/undefined/invalid input.
 */
export function formatLeadDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return LEAD_DATE_TIME.format(d);
}

/**
 * Format an ISO timestamp as e.g. "20 May 2026" in the app's home zone (no time).
 * Use for fields where time-of-day is not meaningful (e.g. snooze date).
 */
export function formatLeadDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return LEAD_DATE_ONLY.format(d);
}
