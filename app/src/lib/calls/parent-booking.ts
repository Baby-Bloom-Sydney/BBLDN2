/**
 * The parent's own call booking — the only entry points 04b's `"use server"` actions call (04a security review
 * H2a, H2c, H2d). Each takes nothing about who she is but the session's user id: she is both the parent and the
 * actor, the purpose is always her first call, and her position is found server-side (her latest). So a request
 * from the browser can never name another parent, another actor, a position or a purpose.
 *
 * Server-only, not `"use server"` (`src/lib/invite/mint.ts:1-9`): the actions read the session, then call these.
 * The general functions in `booking.ts` stay for admin on-behalf (`admin-calls.ts`) and brief 03.
 *
 * BB-wave1-041126/04a-core, 2026-11-04.
 */

import { callBookingEnabled } from "@/lib/features/flags";
import { cancelBooking, confirmHoldForParent, holdSlotForParent, type BookingActor, type HeldTime } from "./booking";
import { CALL_BOOKING_DISABLED, CALLS_INVALID, defaultCallsDeps, type CallsDeps } from "./deps";
import { loadSlotGrid, type SlotGrid } from "./slot-grid";
import type { CallsResult, CancelledBooking, ConfirmedBooking } from "./types";
import { uuid } from "./zod-parts";

/** She acts for herself: the session id is the parent and the actor. Null if it isn't a user id. */
function herself(sessionUserId: string): { readonly parentUserId: string; readonly actor: BookingActor } | null {
  if (!uuid.safeParse(sessionUserId).success) return null;
  return { parentUserId: sessionUserId, actor: { kind: "parent", userId: sessionUserId } };
}

/** Her picker's whole grid (04b rework W4): every date and slot in the window, free or greyed. */
export async function parentSlotGrid(sessionUserId: string, deps: CallsDeps = defaultCallsDeps()): Promise<CallsResult<SlotGrid>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  if (herself(sessionUserId) === null) return CALLS_INVALID;
  return loadSlotGrid({ purpose: "first_call", parentUserId: sessionUserId }, deps);
}

/** A tap on a time: hold it for her (the server rechecks it is a free slot). */
export async function parentHoldSlot(sessionUserId: string, startsAt: string, deps: CallsDeps = defaultCallsDeps()): Promise<CallsResult<HeldTime>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  const her = herself(sessionUserId);
  if (her === null) return CALLS_INVALID;
  return holdSlotForParent({ ...her, startsAt, purpose: "first_call" }, deps);
}

/** Confirm her hold: her first booking, or her booked call moved there. */
export async function parentConfirmHold(
  sessionUserId: string,
  holdId: string,
  idempotencyKey: string,
  deps: CallsDeps = defaultCallsDeps(),
): Promise<CallsResult<ConfirmedBooking>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  const her = herself(sessionUserId);
  if (her === null) return CALLS_INVALID;
  return confirmHoldForParent({ ...her, holdId, idempotencyKey }, deps);
}

/** Cancel her booked call before it starts. */
export async function parentCancelBooking(
  sessionUserId: string,
  bookingId: string,
  deps: CallsDeps = defaultCallsDeps(),
): Promise<CallsResult<CancelledBooking>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  const her = herself(sessionUserId);
  if (her === null) return CALLS_INVALID;
  return cancelBooking({ ...her, bookingId }, deps);
}
