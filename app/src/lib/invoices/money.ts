/**
 * Invoice money (plan 06 step 4). Amounts are integer pence (the Stage 4 rule, `src/config/prices.ts`); the one
 * money format is the guarantees page's `formatPence` (plan R23: imported, never copied).
 *
 * BB-wave1-041126/06a-build, 2026-11-04.
 */

import { formatPence } from "@/app/admin/guarantees/format";

const PENCE_PER_POUND = 100;
/** Enough places to undo binary drift (20.555 × 100 = 2055.4999…) before rounding to a penny. */
const DRIFT_PLACES = 6;

/** "£540.00" — `Intl.NumberFormat(APP_LOCALE, PRICES.currency)`, through `formatPence`. */
export const formatInvoiceMoney = formatPence;

/**
 * Hours × rate in whole pence. Hours come in half steps and the rate in whole pence, so the product is a whole or
 * half penny; a half rounds up, as Postgres `round()` does in amendment 21's total CHECK (0.5 h × 1801 p = 901 p).
 */
export function invoiceTotalPence(hours: number, ratePence: number): number {
  if (!Number.isFinite(hours) || hours <= 0 || !Number.isInteger(ratePence) || ratePence <= 0) {
    throw new RangeError("hours and rate must be positive");
  }
  return Math.round(hours * ratePence);
}

/** A placement's or position's hourly rate (pounds, `numeric`) in pence; null when there's no usable rate. */
export function poundsToPence(pounds: unknown): number | null {
  const value = typeof pounds === "string" && pounds.trim() !== "" ? Number(pounds) : pounds;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(Number((value * PENCE_PER_POUND).toFixed(DRIFT_PLACES)));
}

/** "30", "0.5", "37.5". */
export function formatHours(hours: number): string {
  return String(hours);
}
