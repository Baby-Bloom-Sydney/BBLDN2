/**
 * Display helpers for /admin/guarantees (4e). Dates in the app's clock and locale; money from pence in the
 * configured currency. Kept here rather than `lib/format/date.ts` (unit 4b's file this wave). BB-LDN-4e-151026.
 */
import { PRICES } from "@/config/prices";
import { APP_LOCALE, APP_TZ } from "@/lib/constants";

const PENCE_PER_POUND = 100;
const MONEY = new Intl.NumberFormat(APP_LOCALE, { style: "currency", currency: PRICES.currency.toUpperCase() });
const DATE = new Intl.DateTimeFormat(APP_LOCALE, { dateStyle: "medium", timeZone: APP_TZ });
const DATE_TIME = new Intl.DateTimeFormat(APP_LOCALE, { dateStyle: "medium", timeStyle: "short", timeZone: APP_TZ });

export const formatPence = (pence: number): string => MONEY.format(pence / PENCE_PER_POUND);

function format(fmt: Intl.DateTimeFormat, iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : fmt.format(d);
}

export const formatDay = (iso: string | null): string => format(DATE, iso);
export const formatDayTime = (iso: string | null): string => format(DATE_TIME, iso);
