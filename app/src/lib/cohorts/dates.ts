/**
 * Cohort dates. Client-safe and pure. The London clock itself is `src/lib/timezone.ts` (plan 02 R17, BUILD/README
 * § Wave 1 alignment item 2): this file keeps only what is cohort-specific — the "Mon 1 Feb 2027" label, the
 * suggested Monday and day counts — all calendar arithmetic on "YYYY-MM-DD" strings, never the host's zone.
 *
 * BB-wave1-041126/02-build, 2026-11-04.
 */

import { addLondonDays, londonDateOf, londonMondayOf } from "@/lib/timezone";

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

interface DateParts {
  readonly year: number;
  readonly monthIndex: number;
  readonly day: number;
  readonly weekday: number;
}

/** Noon UTC on the date: a fixed instant whose UTC calendar day is the date itself, whatever the host's zone. */
function partsOf(date: string): DateParts | null {
  const match = DATE_RE.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const noon = new Date(Date.UTC(year, month - 1, day, 12));
  if (noon.getUTCFullYear() !== year || noon.getUTCMonth() !== month - 1 || noon.getUTCDate() !== day) return null;
  return { year, monthIndex: month - 1, day, weekday: noon.getUTCDay() };
}

/** A real calendar date written "YYYY-MM-DD" (a cohort's identity). */
export function isLondonDate(value: unknown): value is string {
  return typeof value === "string" && partsOf(value) !== null;
}

/** "Mon 1 Feb 2027". Anything that isn't a date comes back unchanged, so a bad value shows as itself. */
export function formatCohortDate(date: string): string {
  const p = partsOf(date);
  return p ? `${WEEKDAYS[p.weekday]} ${p.day} ${MONTHS[p.monthIndex]} ${p.year}` : date;
}

/** "Mon 1 Feb" — the family panel's short form. */
export function formatCohortShort(date: string): string {
  const p = partsOf(date);
  return p ? `${WEEKDAYS[p.weekday]} ${p.day} ${MONTHS[p.monthIndex]}` : date;
}

/** An instant as its London day and month: "3 Feb". */
export function formatDayMonth(instant: string): string {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) return "—";
  const p = partsOf(londonDateOf(at));
  return p ? `${p.day} ${MONTHS[p.monthIndex]}` : "—";
}

/** The Monday after a London date (a Monday suggests the following one): the form's suggested first start. */
export function nextMonday(today: string): string {
  return londonMondayOf(addLondonDays(today, 7));
}

/** Whole calendar days from one London date to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const a = partsOf(from);
  const b = partsOf(to);
  if (!a || !b) return Number.NaN;
  return Math.round((Date.UTC(b.year, b.monthIndex, b.day) - Date.UTC(a.year, a.monthIndex, a.day)) / DAY_MS);
}
