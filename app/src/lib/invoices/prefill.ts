/**
 * The new-invoice form's pre-fill (plan 06 §14.3, b2.5; brief §0a A "the default rate, their rate, is the default
 * option"). Pure, no I/O, client-safe: `families.ts` reads the rows and calls these; 06b-4's form shows the result,
 * and she can change every row.
 *
 * - **The rate on every new shift row:** Regular week — the placement's `hourly_rate`, then the position's (the rate
 *   the family agreed), then her profile rate `nannies.hourly_rate_min`, else blank. Trial Shift — the position's,
 *   then her profile's. Each is pounds, converted with `poundsToPence`; a null or ≤ 0 value is skipped.
 * - **Shift rows for a Regular week:** one for each of her usual days — the keys of `position_schedule.schedule`
 *   (`{ monday: ["morning", …] }`, `buildScheduleJson`), else `nanny_positions.days_required`. The data holds days,
 *   not hours per day (the roster's blocks are 4-hour ranges), so the placement's `weekly_hours` are split evenly
 *   over those days in quarter hours, the remainder going to the first days, at most 24 each — a full pre-filled
 *   week equals her agreed weekly hours. Then any day after London's today is dropped. No usual days (or none up to
 *   today): one row on the Monday, hours blank. No weekly hours: hours blank.
 * - **Trial Shift:** one row on the trial date, hours blank (no trial length is stored).
 * - **"Send a corrected invoice":** the cancelled invoice's lines, each with its own rate and description.
 *
 * BB-wave1-041126/06b2-build, 2026-11-06.
 */

import { INVOICE_RULES } from "@/config/invoices";
import { addLondonDays } from "@/lib/timezone";
import { poundsToPence } from "./money";
import type { StoredLine } from "./store-map-lines";
import type { ExpenseType, InvoiceKind } from "./types";
import { isFutureLondonDate, isLondonMonday } from "./week";

export type RateSource = "placement" | "position" | "profile";

export interface PrefillShift {
  readonly date: string;
  readonly hours: number | null;
  readonly ratePence: number | null;
  readonly description: string | null;
}

export interface PrefillExpense {
  readonly expenseType: ExpenseType;
  readonly amountPence: number;
  readonly description: string | null;
}

/** What the form starts from (`InvoiceTarget.prefill`, plan 14.6 b2.5). */
export interface Prefill {
  readonly shifts: readonly PrefillShift[];
  readonly ratePence: number | null;
  readonly rateSource: RateSource | null;
}

const QUARTERS_PER_HOUR = Math.round(1 / INVOICE_RULES.hourStep);
const MAX_DAY_QUARTERS = INVOICE_RULES.maxShiftHours * QUARTERS_PER_HOUR;
/** Monday-first weekday names, as their first three letters (`buildScheduleJson` keys; `days_required` values). */
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_NAME = /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*$/;

/** The rate for every new shift row, and where it came from (14.3). The inputs are pounds as the rows hold them. */
export function pickRate(
  kind: InvoiceKind,
  rates: { readonly placement?: unknown; readonly position?: unknown; readonly profile?: unknown },
): { readonly ratePence: number | null; readonly rateSource: RateSource | null } {
  const order: readonly RateSource[] = kind === "regular_week" ? ["placement", "position", "profile"] : ["position", "profile"];
  for (const source of order) {
    const pence = poundsToPence(rates[source]);
    if (pence !== null) return { ratePence: pence, rateSource: source };
  }
  return { ratePence: null, rateSource: null };
}

/** "Monday", "mon", "THU" → 0…6; anything else → null. */
function weekdayOf(name: string): number | null {
  const m = DAY_NAME.exec(name.trim().toLowerCase());
  return m ? WEEKDAYS.indexOf(m[1] as (typeof WEEKDAYS)[number]) : null;
}

const toSorted = (days: Iterable<number>): readonly number[] => [...new Set(days)].sort((a, b) => a - b);

/** Her usual days as offsets from Monday: the schedule's days that have times, else `days_required`. */
export function usualDays(schedule: unknown, daysRequired: readonly string[] | null): readonly number[] {
  const fromSchedule =
    typeof schedule === "object" && schedule !== null && !Array.isArray(schedule)
      ? Object.entries(schedule).flatMap(([day, times]) => {
          const d = Array.isArray(times) && times.length > 0 ? weekdayOf(day) : null;
          return d === null ? [] : [d];
        })
      : [];
  if (fromSchedule.length > 0) return toSorted(fromSchedule);
  return toSorted((daysRequired ?? []).flatMap((day) => {
    const d = weekdayOf(day);
    return d === null ? [] : [d];
  }));
}

/** The weekly hours over `days` days, in quarter hours: an even split, the remainder to the first days, ≤ 24 each. */
export function splitHours(weeklyHours: number | null, days: number): readonly (number | null)[] {
  const quarters = weeklyHours !== null && Number.isFinite(weeklyHours) ? Math.round(weeklyHours * QUARTERS_PER_HOUR) : 0;
  if (days <= 0) return [];
  const base = Math.floor(quarters / days);
  const remainder = quarters % days;
  return Array.from({ length: days }, (_, i) => {
    const share = Math.min(base + (i < remainder ? 1 : 0), MAX_DAY_QUARTERS);
    return share > 0 ? share / QUARTERS_PER_HOUR : null;
  });
}

/** A Regular week's starting rows (14.3). `weekStart` is the London Monday she chose. */
export function weekPrefill(input: {
  readonly weekStart: string;
  readonly days: readonly number[];
  readonly weeklyHours: number | null;
  readonly ratePence: number | null;
  readonly now: Date;
}): readonly PrefillShift[] {
  const { weekStart, days, weeklyHours, ratePence, now } = input;
  if (!isLondonMonday(weekStart)) throw new RangeError("a week starts on a London Monday");
  const hours = splitHours(weeklyHours, days.length);
  const rows = days
    .map((d, i): PrefillShift => ({ date: addLondonDays(weekStart, d), hours: hours[i] ?? null, ratePence, description: null }))
    .filter((row) => !isFutureLondonDate(row.date, now));
  return rows.length > 0 ? rows : [{ date: weekStart, hours: null, ratePence, description: null }];
}

/** A Trial Shift's starting row: its date, hours blank. */
export function trialPrefill(trialDate: string, ratePence: number | null): readonly PrefillShift[] {
  return [{ date: trialDate, hours: null, ratePence, description: null }];
}

/** "Send a corrected invoice": the cancelled invoice's lines (from `readMyInvoiceLines`), in her order. */
export function correctionPrefill(lines: readonly StoredLine[]): {
  readonly shifts: readonly PrefillShift[];
  readonly expenses: readonly PrefillExpense[];
} {
  const ordered = [...lines].sort((a, b) => a.lineNo - b.lineNo);
  return {
    shifts: ordered.flatMap((l) => (l.kind === "shift" ? [{ date: l.date, hours: l.hours, ratePence: l.ratePence, description: l.description }] : [])),
    expenses: ordered.flatMap((l) => (l.kind === "expense" ? [{ expenseType: l.expenseType, amountPence: l.amountPence, description: l.description }] : [])),
  };
}
