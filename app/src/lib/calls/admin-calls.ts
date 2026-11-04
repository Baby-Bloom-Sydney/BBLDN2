/**
 * The call operations only an admin may run (04a security review H2e), each taking an `AdminProof` first and
 * acting as that admin. 04c's `"use server"` actions call `proveAdmin()` and pass the proof here.
 *
 * Server-only, not `"use server"` (`src/lib/invite/mint.ts:1-9`). The switch is checked first, then the proof; a
 * missing or forged proof answers `invalid` before anything is read or written.
 *
 * (`recordCallOutcome`, `getToCallList` and `getWhoIsNext` take the proof the same way, in their own modules.)
 *
 * BB-wave1-041126/04a-core, 2026-11-04.
 */

import { callBookingEnabled } from "@/lib/features/flags";
import { actingAdmin, isAdminProof, type AdminProof } from "./admin-proof";
import { bookSlotForParent, cancelBooking, type BookRequest, type CancelRequest } from "./booking";
import { CALL_BOOKING_DISABLED, CALLS_INVALID, defaultCallsDeps, type CallsDeps } from "./deps";
import { validateWeeklyHours } from "./hours";
import type { CallsResult, CancelledBooking, ConfirmedBooking, StartedCallBooking } from "./types";

/** Brief 14's "Start call booking": sets `enabled_since` once; later presses keep the first time (plan §12 R11). */
export async function startCallBooking(proof: AdminProof, deps: CallsDeps = defaultCallsDeps()): Promise<CallsResult<StartedCallBooking>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  if (!isAdminProof(proof)) return CALLS_INVALID;
  return deps.repo.startCallBooking(actingAdmin(proof));
}

/** The whole week of call hours from the Calendar tab: checked here (invalid / overlap), then replaced atomically. */
export async function replaceWeeklyHours(proof: AdminProof, hours: unknown, deps: CallsDeps = defaultCallsDeps()): Promise<CallsResult<true>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  if (!isAdminProof(proof)) return CALLS_INVALID;
  const week = validateWeeklyHours(hours);
  if (!week.ok) return week;
  return deps.repo.replaceWeeklyHours(week.value, actingAdmin(proof));
}

/** Book (or move) a family's call on her behalf (brief §0.11); she gets the same emails. */
export async function bookSlotOnBehalf(
  proof: AdminProof,
  request: Omit<BookRequest, "actor">,
  deps: CallsDeps = defaultCallsDeps(),
): Promise<CallsResult<ConfirmedBooking>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  if (!isAdminProof(proof)) return CALLS_INVALID;
  return bookSlotForParent({ ...request, actor: { kind: "admin", proof } }, deps);
}

/** Cancel a family's booked call on her behalf. */
export async function cancelBookingOnBehalf(
  proof: AdminProof,
  request: Omit<CancelRequest, "actor">,
  deps: CallsDeps = defaultCallsDeps(),
): Promise<CallsResult<CancelledBooking>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  if (!isAdminProof(proof)) return CALLS_INVALID;
  return cancelBooking({ ...request, actor: { kind: "admin", proof } }, deps);
}
