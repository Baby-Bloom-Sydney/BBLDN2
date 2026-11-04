/**
 * Which call times a parent may pick right now (plan A4). Pure.
 *
 *   free = the weekly-hours grid
 *        − anything under a block
 *        − anything overlapping a booked call or a live hold (any length, any purpose)
 *        − anything before now + notice
 *        − anything after now + window (inclusive)   ← dropped in the one-date pre-book mode (brief §11 Q9)
 *
 * The server always recomputes this before a hold or a booking, so a client can never book off the grid.
 *
 * BB-wave1-041126/04a-core, 2026-11-04.
 */

import { londonDateOf } from "@/lib/timezone";
import { generateSlots } from "./generate-slots";
import { occupiesSlot, type OccupancyFacts } from "./status";
import type { CallSettings, Slot, TimeSpan, WeeklyHoursRange } from "./types";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export interface FreeSlotsInput {
  readonly hours: readonly WeeklyHoursRange[];
  readonly settings: Pick<CallSettings, "slotMinutes" | "noticeMinutes" | "windowDays">;
  readonly blocks: readonly TimeSpan[];
  readonly bookings: readonly (TimeSpan & OccupancyFacts)[];
  readonly now: Date;
  /** Only this London date ("YYYY-MM-DD"). */
  readonly londonDate?: string;
  /** With `londonDate`: offer that day even beyond the window (the cohort pre-book). The notice still applies. */
  readonly ignoreWindow?: boolean;
}

export const overlaps = (a: TimeSpan, b: TimeSpan): boolean => a.startsAt < b.endsAt && b.startsAt < a.endsAt;

type GridInput = Omit<FreeSlotsInput, "blocks" | "bookings">;

/**
 * The earliest and latest start a parent may pick now: now + notice, and now + window (inclusive). The window is
 * dropped (`latest: null`) only for one London date asked with `ignoreWindow` — the cohort pre-book.
 */
export function slotBounds(
  input: Pick<GridInput, "settings" | "now" | "londonDate" | "ignoreWindow">,
): { readonly earliest: string; readonly latest: string | null } {
  const earliest = new Date(input.now.getTime() + input.settings.noticeMinutes * MINUTE_MS).toISOString();
  const keepWindow = !(input.londonDate !== undefined && input.ignoreWindow === true);
  const latest = keepWindow ? new Date(input.now.getTime() + input.settings.windowDays * DAY_MS).toISOString() : null;
  return { earliest, latest };
}

/** The grid inside the notice and the window, before blocks and bookings are taken away. */
export function candidateSlots(input: GridInput): readonly Slot[] {
  const { earliest, latest } = slotBounds(input);
  const fromDate = input.londonDate ?? londonDateOf(earliest);
  const toDate = input.londonDate ?? londonDateOf(latest ?? earliest);
  return generateSlots({ hours: input.hours, fromDate, toDate, slotMinutes: input.settings.slotMinutes }).filter(
    (slot) => slot.startsAt >= earliest && (latest === null || slot.startsAt <= latest),
  );
}

/** The candidates no block covers and no booked call or live hold overlaps. */
export function withoutTaken(
  candidates: readonly Slot[],
  taken: Pick<FreeSlotsInput, "blocks" | "bookings" | "now">,
): readonly Slot[] {
  const occupied = taken.bookings.filter((b) => occupiesSlot(b, taken.now));
  return candidates.filter(
    (slot) => !taken.blocks.some((block) => overlaps(block, slot)) && !occupied.some((b) => overlaps(b, slot)),
  );
}

export function computeFreeSlots(input: FreeSlotsInput): readonly Slot[] {
  return withoutTaken(candidateSlots(input), input);
}

/** The stretch of time a set of slots covers, for loading only the blocks and bookings that matter. */
export function spanOf(slots: readonly Slot[]): TimeSpan | null {
  if (slots.length === 0) return null;
  const endsAt = slots.reduce((latest, slot) => (slot.endsAt > latest ? slot.endsAt : latest), slots[0].endsAt);
  return { startsAt: slots[0].startsAt, endsAt };
}
