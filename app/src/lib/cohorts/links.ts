/**
 * Numbers 02 shows but doesn't own (plan 02 §8, §12 R1–R2). Server-only. The two seams:
 *
 * - 04 → 02 (calls): 04's "calls still to make this week", booked and not-yet-booked kept apart — the same numbers
 *   as /admin/calls' counts line, because it is 04's own contract function. 04 owns "this week": the London week
 *   from `londonWeekRange`. 04a merged before 02, so 02 (merging second) wires it here (R1).
 * - 03 → 02 (pre-booked): "N pre-booked calls" counts 03's pre-booking records (R2). 03 is wave 2 and wires
 *   `preBookedSource()`; until then it is null.
 *
 * A null source means "not connected": the page says so, never a stand-in 0 (brief §0.12).
 *
 * BB-wave1-041126/02-build, 2026-11-04.
 */

import { getCallsToMake, londonWeekRange } from "@/lib/calls/contracts";
import { callBookingEnabled } from "@/lib/features/flags";
import type { AdminClient } from "./db";
import type { CallCounts } from "./types";

/** 04's "calls still to make this week". Null from the call itself = the numbers couldn't be read. */
export type CallsThisWeek = (admin: AdminClient, now: Date) => Promise<CallCounts | null>;
/** 03's pre-bookings for one cohort (its London start date). Null = couldn't be read — never a stand-in 0. */
export type PreBookedFor = (admin: AdminClient, cohortStartDate: string) => Promise<number | null>;

export function callsThisWeekSource(): CallsThisWeek | null {
  return callBookingEnabled() ? (_admin, now) => getCallsToMake(londonWeekRange(now)) : null;
}

export function preBookedSource(): PreBookedFor | null {
  return null;
}
