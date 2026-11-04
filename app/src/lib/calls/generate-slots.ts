/**
 * Weekly hours → the slot grid between two London dates (plan A4). Pure.
 *
 * Ported from LDN1 `scheduling/lib/generate-slots.ts` onto the one London clock (`@/lib/timezone`, plan R24) and
 * the ISO weekday (`weekday.ts`):
 * - each range's grid is anchored at its own start; a slot never runs past the range's end;
 * - a wall time the clocks skip (spring) is left out (`wallClockExists`);
 * - a repeated wall time (autumn) is one instant, so one slot per clock time;
 * - duplicates and any slot overlapping an earlier one are dropped (the spring gap shortens a wall interval).
 *
 * BB-wave1-041126/04a-core, 2026-11-04.
 */

import { addLondonDays, localToUTC, wallClockExists } from "@/lib/timezone";
import type { Slot, WeeklyHoursRange } from "./types";
import { isoWeekdayOf } from "./weekday";

const MINUTE_MS = 60 * 1000;

export interface GenerateSlotsInput {
  readonly hours: readonly WeeklyHoursRange[];
  /** First London date, inclusive. */
  readonly fromDate: string;
  /** Last London date, inclusive. */
  readonly toDate: string;
  readonly slotMinutes: number;
}

function datesBetween(fromDate: string, toDate: string): readonly string[] {
  const dates: string[] = [];
  for (let date = fromDate; date <= toDate; date = addLondonDays(date, 1)) dates.push(date);
  return dates;
}

function slotsInRange(date: string, range: WeeklyHoursRange, slotMinutes: number): readonly Slot[] {
  const slots: Slot[] = [];
  for (let at = range.startMinute; at + slotMinutes <= range.endMinute; at += slotMinutes) {
    const hour = Math.floor(at / 60);
    const minute = at % 60;
    if (!wallClockExists(date, hour, minute)) continue;
    const startsAt = localToUTC(date, hour, minute);
    slots.push({ startsAt, endsAt: new Date(Date.parse(startsAt) + slotMinutes * MINUTE_MS).toISOString() });
  }
  return slots;
}

/** Sorted, with every slot starting at or after the end of the one before. */
function withoutOverlaps(slots: readonly Slot[]): readonly Slot[] {
  const sorted = [...slots].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return sorted.reduce<readonly Slot[]>((kept, slot) => {
    const last = kept.at(-1);
    return last !== undefined && slot.startsAt < last.endsAt ? kept : [...kept, slot];
  }, []);
}

export function generateSlots(input: GenerateSlotsInput): readonly Slot[] {
  if (input.slotMinutes <= 0) return [];
  const all = datesBetween(input.fromDate, input.toDate).flatMap((date) => {
    const weekday = isoWeekdayOf(date);
    return input.hours
      .filter((range) => range.weekday === weekday)
      .flatMap((range) => slotsInRange(date, range, input.slotMinutes));
  });
  return withoutOverlaps(all);
}
