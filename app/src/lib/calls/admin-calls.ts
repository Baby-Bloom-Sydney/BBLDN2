/**
 * The call operations only an admin may run (04a security review H2e), each taking an `AdminProof` first and
 * acting as that admin. 04c's `"use server"` actions call `proveAdmin()` and pass the proof here.
 *
 * Server-only, not `"use server"` (`src/lib/invite/mint.ts:1-9`). The switch is checked first, then the proof; a
 * missing or forged proof answers `invalid` before anything is read or written.
 *
 * (`recordCallOutcome`, `getToCallList` and `getWhoIsNext` take the proof the same way, in their own modules.)
 *
 * 04c-1 adds the on-behalf picker's steps (plan §13): `holdSlotOnBehalf` (a tap holds the time for her, as the
 * admin), `confirmHoldOnBehalf` (her first booking, or her booked call moved there), and `familySlotGrid` (her
 * picker's grid). Her first call only; the server recomputes every time against the live grid (`booking.ts`).
 *
 * BB-wave1-041126/04a-core, 2026-11-04; BB-wave1-041126/04c1-build, 2026-11-05.
 */

import { callBookingEnabled } from "@/lib/features/flags";
import { actingAdmin, isAdminProof, type AdminProof } from "./admin-proof";
import {
  bookSlotForParent,
  cancelBooking,
  confirmHoldForParent,
  holdSlotForParent,
  type BookRequest,
  type CancelRequest,
  type HeldTime,
} from "./booking";
import { CALL_BOOKING_DISABLED, CALLS_INVALID, defaultCallsDeps, type CallsDeps } from "./deps";
import { validateWeeklyHours } from "./hours";
import { loadSlotGrid, type SlotGrid } from "./slot-grid";
import type { CallError, CallsResult, CancelledBooking, ConfirmedBooking, StartedCallBooking } from "./types";
import { uuid } from "./zod-parts";

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

/** The on-behalf picker's tap: hold this time for her first call, as the admin (her latest position, server-side). */
export async function holdSlotOnBehalf(
  proof: AdminProof,
  request: { readonly parentUserId: string; readonly startsAt: string },
  deps: CallsDeps = defaultCallsDeps(),
): Promise<CallsResult<HeldTime>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  if (!isAdminProof(proof)) return CALLS_INVALID;
  return holdSlotForParent({ parentUserId: request.parentUserId, startsAt: request.startsAt, purpose: "first_call", actor: { kind: "admin", proof } }, deps);
}

/** "Book this time" / "Move to this time": confirm the admin's hold for her; she gets the usual email. */
export async function confirmHoldOnBehalf(
  proof: AdminProof,
  request: { readonly parentUserId: string; readonly holdId: string; readonly idempotencyKey: string },
  deps: CallsDeps = defaultCallsDeps(),
): Promise<CallsResult<ConfirmedBooking>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  if (!isAdminProof(proof)) return CALLS_INVALID;
  return confirmHoldForParent({ ...request, actor: { kind: "admin", proof } }, deps);
}

/** Her first call's picker grid (every date and slot in the window, free or greyed); her own live hold stays hers. */
export async function familySlotGrid(proof: AdminProof, parentUserId: string, deps: CallsDeps = defaultCallsDeps()): Promise<CallsResult<SlotGrid>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  if (!isAdminProof(proof)) return CALLS_INVALID;
  if (!uuid.safeParse(parentUserId).success) return CALLS_INVALID;
  return loadSlotGrid({ purpose: "first_call", parentUserId }, deps);
}

/**
 * What /admin/calls' actions answer when they refuse: closed codes only, never detail (brief §9.15). The gate adds
 * `not_authorized`; the rest are the call operations' own, with an overlap read as taken.
 */
export type AdminCallError =
  | "call_booking_disabled"
  | "not_authorized"
  | "invalid"
  | "taken"
  | "too_soon"
  | "hold_expired"
  | "not_yours"
  | "not_found"
  | "rate_limited"
  | "booked_call_exists"
  | "error";

export type AdminCallResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: AdminCallError };

/** Typed as a full `Record` over `CallError`, so a new code fails to compile until it is mapped here. */
const ADMIN_REFUSAL: Readonly<Record<CallError, AdminCallError>> = Object.freeze({
  taken: "taken",
  overlap: "taken",
  too_soon: "too_soon",
  hold_expired: "hold_expired",
  not_yours: "not_yours",
  not_found: "not_found",
  rate_limited: "rate_limited",
  invalid: "invalid",
  booked_call_exists: "booked_call_exists",
  call_booking_disabled: "call_booking_disabled",
  error: "error",
});

export function adminRefusalOf(error: CallError): AdminCallError {
  return ADMIN_REFUSAL[error];
}
