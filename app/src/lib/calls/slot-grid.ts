/**
 * The call picker's whole grid (04b rework W4; BAI 2026-11-05: "the unavailable times and dates are greyed out and
 * unable to be selected"). Every London date in the booking window, and every slot the weekly hours and slot length
 * make on it, each marked `free` or not. Free is exactly `computeFreeSlots` (plan A4): not under a block, not
 * overlapping a booked call or a live hold (anyone's, hers elsewhere included), not before now + notice, not past the
 * window. So a past, blocked, taken or held time is listed — greyed in the picker — never hidden.
 *
 * This only draws the picker: every hold is still rechecked on the server (`booking.ts` `currentFreeSlot`) and the
 * database still refuses an overlap (amendment 19's exclusion constraint).
 *
 * BB-wave1-041126/04b-rework, 2026-11-05.
 */

import { callBookingEnabled } from "@/lib/features/flags";
import { londonDateOf } from "@/lib/timezone";
import { CALL_BOOKING_DISABLED, defaultCallsDeps, type CallsDeps } from "./deps";
import { computeFreeSlots, slotBounds, spanOf, type FreeSlotsInput } from "./free-slots";
import { datesBetween, generateSlots } from "./generate-slots";
import type { CallPurpose, CallsResult, Slot } from "./types";

export interface GridSlot extends Slot {
  readonly free: boolean;
}

export interface SlotGrid {
  /** Every London date in the window, in order (a date with no hours is still here). */
  readonly dates: readonly string[];
  readonly slots: readonly GridSlot[];
}

type GridInput = Omit<FreeSlotsInput, "blocks" | "bookings">;

/** The window's dates and every slot the hours make on them, before anything is taken away. */
function gridOf(input: GridInput): { readonly dates: readonly string[]; readonly all: readonly Slot[] } {
  const { earliest, latest } = slotBounds(input);
  const fromDate = input.londonDate ?? londonDateOf(earliest);
  const toDate = input.londonDate ?? londonDateOf(latest ?? earliest);
  const all = generateSlots({ hours: input.hours, fromDate, toDate, slotMinutes: input.settings.slotMinutes });
  return { dates: datesBetween(fromDate, toDate), all };
}

export function slotGridOf(input: FreeSlotsInput): SlotGrid {
  const { dates, all } = gridOf(input);
  const free = new Set(computeFreeSlots(input).map((s) => s.startsAt));
  return { dates, slots: all.map((slot) => Object.freeze({ ...slot, free: free.has(slot.startsAt) })) };
}

/** The grid for a request (the 7-day window, or one London date for the cohort pre-book). */
export async function loadSlotGrid(
  request: { readonly londonDate?: string; readonly purpose: CallPurpose },
  deps: CallsDeps = defaultCallsDeps(),
): Promise<CallsResult<SlotGrid>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  const [settings, hours] = await Promise.all([deps.repo.readSettings(), deps.repo.readWeeklyHours()]);
  if (!settings.ok) return settings;
  if (!hours.ok) return hours;
  const now = deps.now();
  const ignoreWindow = request.purpose === "cohort_prebook" && request.londonDate !== undefined;
  const input: GridInput = { hours: hours.value, settings: settings.value, now, londonDate: request.londonDate, ignoreWindow };
  const { dates, all } = gridOf(input);
  const span = spanOf(all);
  if (span === null) return { ok: true, value: { dates, slots: [] } };
  const [blocks, bookings] = await Promise.all([deps.repo.readBlocks(span), deps.repo.readOccupyingBookings(span)]);
  if (!blocks.ok) return blocks;
  if (!bookings.ok) return bookings;
  return { ok: true, value: slotGridOf({ ...input, blocks: blocks.value, bookings: bookings.value }) };
}
