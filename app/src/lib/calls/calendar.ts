/**
 * The Calendar tab's pure parts (plan C5, §13; brief §0.12, §3 admin 5, §9.12). No reads: `admin-calls.ts`
 * `calendarWeek` loads the rows and calls `calendarViewOf`.
 *
 * - **The 7-day grid**, from today's London date: every cell is free, booked (with the family's name), held or
 *   blocked. A free cell is exactly a time a parent may pick now (`free-slots.ts`: the hours on the current slot
 *   length, after the notice, inside the window, not under a block, not overlapping a booked call or a live hold).
 *   A booked call or live hold keeps its own time whatever the slot length, and a grid time that would overlap it
 *   isn't drawn ("Changing the slot length doesn't move existing bookings", brief §3 admin 5). A booked call inside a
 *   block is booked and flagged, never cancelled (ADR-077). Grid times before the notice aren't drawn; bookings are.
 * - **Native date and time strings** from the forms ("2027-02-12", "09:00") are read as London clock time here, on the
 *   server — never in the browser's zone (brief §3 admin 1). The hour the clocks skip in spring is refused.
 * - The block form and the weekly-hours form, checked (overlap is `hours.ts`'s, and the database's).
 *
 * Every label is London, on the 24-hour clock (`slot-words.ts`); admin keeps "(London time)" (§0a.10 is parents').
 *
 * BB-wave1-041126/04c2-build, 2026-11-06.
 */

import { z } from "zod";
import { addLondonDays, localToUTC, londonDateOf, londonToday, wallClockExists } from "@/lib/timezone";
import { BLOCK_REASON_MAX } from "./calendar-limits";
import { LONDON_TIME_SUFFIX } from "./copy";
import { contactWords, londonDayWords } from "./dashboard-row";
import { candidateSlots, overlaps } from "./free-slots";
import type { NewCallBlock } from "./repo";
import { dayWords, slotWords } from "./slot-words";
import { occupiesSlot } from "./status";
import type { CallBlock, CallBooking, CallSettings, CallsResult, Slot, TimeSpan, WeeklyHoursRange } from "./types";
import { isIsoWeekday, weekdayName, type IsoWeekday } from "./weekday";

/** The grid's length (brief §3 admin 5: "a 7-day grid"). */
export const GRID_DAYS = 7;
export { BLOCK_REASON_MAX };
/** Ten ranges a weekday is more than a week of call hours needs. */
export const MAX_HOURS_ROWS = 70;
/** A block runs at most a year, and ends at most two years ahead (security review LOW-2: one mistyped block can't
 *  take every time out for decades). */
export const BLOCK_SPAN_MAX_DAYS = 366;
export const BLOCK_AHEAD_MAX_DAYS = 730;
const DAY_MS = 24 * 60 * 60 * 1000;

const INVALID = Object.freeze({ ok: false, error: "invalid" } as const);
/** A 24-hour "HH:MM" (shared with the Calls tab's call-back time, `actions.ts`). */
export const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** A range may end at midnight: "24:00" is 1440, as an end only (`clockOf(1440)` writes it). */
const MIDNIGHT_END = "24:00";
const londonDate = z.iso.date();

export type CalendarCellKind = "free" | "booked" | "held" | "blocked";

export interface CalendarCell extends TimeSpan {
  readonly key: string;
  readonly kind: CalendarCellKind;
  /** "09:00–09:30", London. */
  readonly time: string;
  /** "09:00" and "09:30", London (the grid marks each as a <time>). */
  readonly startTime: string;
  readonly endTime: string;
  /** A booked call's family; null otherwise. */
  readonly name: string | null;
  /** The block over this time (a blocked time, or a booked call or hold inside a block). */
  readonly blockReason: string | null;
  /** A booked call or hold inside a block: "Blocked over — move or cancel". */
  readonly blockedOver: boolean;
}

export interface CalendarDay {
  readonly londonDate: string;
  /** "Saturday 6 February". */
  readonly heading: string;
  readonly cells: readonly CalendarCell[];
}

export interface CalendarDaysInput {
  readonly settings: CallSettings;
  readonly hours: readonly WeeklyHoursRange[];
  /** Every block that may matter (the grid's and the ones still to come). */
  readonly blocks: readonly CallBlock[];
  /** Held and booked rows over the grid's days. */
  readonly bookings: readonly CallBooking[];
  /** Family names by parent user id. */
  readonly names: ReadonlyMap<string, string>;
  readonly now: Date;
}

const byStart = (a: TimeSpan, b: TimeSpan): number => a.startsAt.localeCompare(b.startsAt);
const clocksOf = (span: TimeSpan) => {
  const startTime = slotWords(span.startsAt).time;
  const endTime = slotWords(span.endsAt).time;
  return { time: `${startTime}–${endTime}`, startTime, endTime };
};

function bookingCell(booking: CallBooking, input: CalendarDaysInput): CalendarCell {
  const booked = booking.status === "booked";
  const over = input.blocks.find((b) => overlaps(b, booking)) ?? null;
  return Object.freeze({
    key: booking.id,
    kind: booked ? "booked" : "held",
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    ...clocksOf(booking),
    name: booked ? input.names.get(booking.parentUserId) ?? contactWords(null).name : null,
    blockReason: over?.reason ?? null,
    blockedOver: over !== null,
  });
}

function slotCell(slot: Slot, blocks: readonly CallBlock[]): CalendarCell {
  const over = blocks.find((b) => overlaps(b, slot)) ?? null;
  return Object.freeze({
    key: `slot:${slot.startsAt}`,
    kind: over === null ? "free" : "blocked",
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    ...clocksOf(slot),
    name: null,
    blockReason: over?.reason ?? null,
    blockedOver: false,
  });
}

/** Seven London days from today: every booked call and live hold at its own time, and the grid's times around them. */
export function calendarDays(input: CalendarDaysInput): readonly CalendarDay[] {
  const first = londonToday(input.now);
  const dates = Array.from({ length: GRID_DAYS }, (_, i) => addLondonDays(first, i));
  const inGrid = new Set(dates);
  const occupying = input.bookings.filter((b) => occupiesSlot(b, input.now) && inGrid.has(londonDateOf(b.startsAt)));
  const slots = candidateSlots({ hours: input.hours, settings: input.settings, now: input.now }).filter(
    (slot) => inGrid.has(londonDateOf(slot.startsAt)) && !occupying.some((b) => overlaps(b, slot)),
  );
  const cells = [...occupying.map((b) => bookingCell(b, input)), ...slots.map((s) => slotCell(s, input.blocks))];
  return Object.freeze(
    dates.map((date) =>
      Object.freeze({
        londonDate: date,
        heading: dayWords(date).legend,
        cells: Object.freeze(cells.filter((c) => londonDateOf(c.startsAt) === date).sort(byStart)),
      }),
    ),
  );
}

/** "09:30" → 570; anything that isn't a 24-hour "HH:MM" → null. */
export function clockMinutes(clock: string): number | null {
  const match = CLOCK_PATTERN.exec(clock);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** 570 → "09:30" (1440 → "24:00"). */
export function clockOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** A native date and time input's strings, read as London clock time → the instant; null if either isn't one, or
 *  the London time doesn't exist (the spring-forward hour). */
export function londonInstantOf(date: string, time: string): string | null {
  if (!londonDate.safeParse(date).success) return null;
  const minutes = clockMinutes(time);
  if (minutes === null) return null;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return wallClockExists(date, hour, minute) ? localToUTC(date, hour, minute) : null;
}

/** The block form's shape: native date and time strings, and a reason. */
export const blockFormInput = z.strictObject({
  fromDate: z.string().max(10),
  fromTime: z.string().max(5),
  toDate: z.string().max(10),
  toTime: z.string().max(5),
  reason: z.string().max(1000),
});

/** A block from the Calendar tab: London from and to, ending after it starts and after now, at most a year long and
 *  two years ahead; a 1–200 character reason. */
export function parseBlockForm(input: unknown, now: Date): CallsResult<NewCallBlock, "invalid"> {
  const parsed = blockFormInput.safeParse(input);
  if (!parsed.success) return INVALID;
  const form = parsed.data;
  const startsAt = londonInstantOf(form.fromDate, form.fromTime);
  const endsAt = londonInstantOf(form.toDate, form.toTime);
  const reason = form.reason.trim();
  if (startsAt === null || endsAt === null || endsAt <= startsAt || Date.parse(endsAt) <= now.getTime()) return INVALID;
  if (Date.parse(endsAt) - Date.parse(startsAt) > BLOCK_SPAN_MAX_DAYS * DAY_MS) return INVALID;
  if (Date.parse(endsAt) > now.getTime() + BLOCK_AHEAD_MAX_DAYS * DAY_MS) return INVALID;
  if (reason.length === 0 || reason.length > BLOCK_REASON_MAX) return INVALID;
  return { ok: true, value: Object.freeze({ startsAt, endsAt, reason }) };
}

/** The weekly-hours form's shape: one row per range, London clock strings. */
export const hoursFormInput = z
  .array(z.strictObject({ weekday: z.int().min(1).max(7), start: z.string().max(5), end: z.string().max(5) }))
  .max(MAX_HOURS_ROWS);

/** One form row → a range in London minutes, or null if a clock isn't one ("24:00" is allowed as an end). */
function rangeOfRow(row: { readonly weekday: number; readonly start: string; readonly end: string }): WeeklyHoursRange | null {
  const startMinute = clockMinutes(row.start);
  const endMinute = row.end === MIDNIGHT_END ? 1440 : clockMinutes(row.end);
  if (!isIsoWeekday(row.weekday) || startMinute === null || endMinute === null) return null;
  return Object.freeze({ weekday: row.weekday, startMinute, endMinute });
}

/** The form's rows → ranges in London minutes (overlap and order are `hours.ts`'s to check). */
export function hoursFromForm(rows: unknown): CallsResult<readonly WeeklyHoursRange[], "invalid"> {
  const parsed = hoursFormInput.safeParse(rows);
  if (!parsed.success) return INVALID;
  const ranges = parsed.data.map(rangeOfRow);
  if (ranges.some((r) => r === null)) return INVALID;
  return { ok: true, value: Object.freeze(ranges.filter((r): r is WeeklyHoursRange => r !== null)) };
}

export interface HoursRow {
  readonly weekday: IsoWeekday;
  readonly dayName: string;
  readonly start: string;
  readonly end: string;
}

export interface BlockRow {
  readonly id: string;
  /** "Fri 12 Feb, 09:00 – 13:00 (London time)". */
  readonly when: string;
  readonly reason: string;
}

export interface CalendarView {
  readonly settings: CallSettings;
  readonly hours: readonly HoursRow[];
  /** The blocks still to come, soonest first. */
  readonly blocks: readonly BlockRow[];
  readonly days: readonly CalendarDay[];
  /** "6 November 2026" once Start call booking was pressed; null before. */
  readonly startedOn: string | null;
}

function blockWhen(block: CallBlock): string {
  const from = slotWords(block.startsAt);
  const to = slotWords(block.endsAt);
  return `${from.short} – ${from.londonDate === to.londonDate ? to.time : to.short} ${LONDON_TIME_SUFFIX}`;
}

/** Everything the Calendar tab draws, from one read of its rows. */
export function calendarViewOf(input: CalendarDaysInput): CalendarView {
  const now = input.now.toISOString();
  const blocks = [...input.blocks].filter((b) => b.endsAt > now).sort(byStart);
  return Object.freeze({
    settings: input.settings,
    hours: Object.freeze(input.hours.map((h) => Object.freeze({ weekday: h.weekday, dayName: weekdayName(h.weekday), start: clockOf(h.startMinute), end: clockOf(h.endMinute) }))),
    blocks: Object.freeze(blocks.map((b) => Object.freeze({ id: b.id, when: blockWhen(b), reason: b.reason }))),
    days: calendarDays(input),
    startedOn: input.settings.enabledSince === null ? null : londonDayWords(input.settings.enabledSince),
  });
}
