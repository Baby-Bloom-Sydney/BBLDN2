/**
 * Numbers 02 shows but doesn't own (plan 02 §8, §12 R1–R2). Server-only. The two seams:
 *
 * - 04 → 02 (calls): 04's "calls still to make this week", booked and not-yet-booked kept apart — the same numbers
 *   as /admin/calls' counts line, because it is 04's own contract function. 04 owns "this week": the London week
 *   from `londonWeekRange`. 04a merged before 02, so 02 (merging second) wires it here (R1).
 * - 03 → 02 (pre-booked): "N pre-booked calls" counts 03's open pre-bookings for the cohort (R2; plan 03 §8, A8):
 *   `countOpenPrebookings` while the deposit switch is on (`depositLinkEnabled()`, which needs cohorts on too).
 *   Off, the source is null.
 *
 * A null source means "not connected": the page says so, never a stand-in 0 (brief §0.12). A count that couldn't be
 * read is null too ("could not be read").
 *
 * BB-wave1-041126/02-build, 2026-11-04. Pre-booked source wired: BB-wave2-231126/03-build, 2026-11-25.
 */

import { getCallsToMake, londonWeekRange } from "@/lib/calls/contracts";
import { countOpenPrebookings } from "@/lib/deposit/prebook";
import { callBookingEnabled, depositLinkEnabled } from "@/lib/features/flags";
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
  return depositLinkEnabled() ? (admin, start) => countOpenPrebookings(admin, start) : null;
}
