/**
 * Weekly call hours (plan A5; brief §3 admin 5; amendment 19 `call_weekly_hours`). Pure.
 *
 * Several ranges a weekday are allowed. Overlapping ranges are refused; ranges that touch (09:00–12:00 and
 * 12:00–14:00) are fine, as the SQL exclusion constraint's half-open ranges say. The database refuses overlap too
 * (`call_replace_weekly_hours` → `overlap`); checking here first gives BAI the answer without a round trip.
 *
 * BB-wave1-041126/04a-core, 2026-11-04.
 */

import { z } from "zod";
import type { CallsResult, WeeklyHoursRange } from "./types";
import type { IsoWeekday } from "./weekday";

const weekday = z.int().min(1).max(7).transform((value) => value as IsoWeekday);
const startMinute = z.int().min(0).max(1439);
const endMinute = z.int().min(1).max(1440);

const rangeSchema = z
  .strictObject({ weekday, startMinute, endMinute })
  .refine((range) => range.startMinute < range.endMinute);

const rowSchema = z
  .object({ weekday, start_minute: startMinute, end_minute: endMinute })
  .refine((row) => row.start_minute < row.end_minute)
  .transform((row): WeeklyHoursRange => ({ weekday: row.weekday, startMinute: row.start_minute, endMinute: row.end_minute }));

const byDayThenStart = (a: WeeklyHoursRange, b: WeeklyHoursRange): number =>
  a.weekday - b.weekday || a.startMinute - b.startMinute;

function hasOverlap(sorted: readonly WeeklyHoursRange[]): boolean {
  return sorted.some((range, i) => {
    const previous = sorted[i - 1];
    return previous !== undefined && previous.weekday === range.weekday && range.startMinute < previous.endMinute;
  });
}

/** A whole week of hours from the Calendar tab, sorted, or why not. */
export function validateWeeklyHours(input: unknown): CallsResult<readonly WeeklyHoursRange[], "invalid" | "overlap"> {
  const parsed = z.array(rangeSchema).safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const sorted = Object.freeze([...parsed.data].sort(byDayThenStart));
  return hasOverlap(sorted) ? { ok: false, error: "overlap" } : { ok: true, value: sorted };
}

/** The `call_weekly_hours` rows, sorted, or null if they aren't hours. */
export function weeklyHoursFromRows(rows: unknown): readonly WeeklyHoursRange[] | null {
  const parsed = z.array(rowSchema).safeParse(rows);
  return parsed.success ? Object.freeze([...parsed.data].sort(byDayThenStart)) : null;
}
