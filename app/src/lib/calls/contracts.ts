/**
 * Brief 04's cross-brief surface (plan A9, §7; brief §8) — what 02, 03 and 05 import. **Re-exports only**: every
 * rule lives in the module it comes from, so this file can never drift from them.
 *
 * Server-only, not `"use server"` (`src/lib/invite/mint.ts:1-9`). With `CALL_BOOKING_ENABLED` off, the counts
 * answer null and every operation answers `call_booking_disabled`, before anything is read.
 *
 * - 02 (cohorts): `getCallsToMake(londonWeekRange(now))` for "12 more families to call this week (8 booked ·
 *   4 not booked)". The pre-booked count in 02's line is 03's to wire (plan §12 R1); `getPrebookedCallCount` is
 *   04's own dashboard tag.
 * - 03 (deposit): `getFreeSlots({ londonDate, purpose: "cohort_prebook" })`, then `holdSlotForParent` /
 *   `confirmHoldForParent` or `bookSlotForParent`, after 03 has verified the parent itself.
 * - 05 (JustCall): `getWhoIsNext()` and `recordCallOutcome({ …, method: "justcall", source: "justcall",
 *   justcallCallId })`.
 *
 * BB-wave1-041126/04a-core, 2026-11-04.
 */

export { londonWeekRange, type UtcRange } from "@/lib/timezone";
export { getCallsToMake, getPrebookedCallCount, type CallsToMake } from "./counts";
export {
  bookSlotForParent,
  confirmHoldForParent,
  getFreeSlots,
  holdSlotForParent,
  recordCallOutcome,
  type BookRequest,
  type FreeSlotsRequest,
  type HeldTime,
  type HoldRequest,
  type OutcomeRequest,
} from "./booking";
export { getWhoIsNext, type WhoIsNextGroup, type WhoIsNextRow } from "./who-next";
export type { CallError, CallRefusal, CallsResult, ConfirmedBooking, ConfirmInput, RecordedOutcome, Slot } from "./types";
