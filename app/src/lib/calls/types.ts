/**
 * The call-booking domain (brief 04; plan `BUILD/plans/04-plan.md` A4–A9, amendment 19).
 *
 * Types only. Every instant is a UTC ISO string ("2027-02-09T14:00:00.000Z"); every London wall-clock value is
 * minutes since London midnight, on an ISO weekday (1 = Monday … 7 = Sunday, `weekday.ts`).
 *
 * BB-wave1-041126/04a-core, 2026-11-04.
 */

import type { IsoWeekday } from "./weekday";

export type CallPurpose = "first_call" | "cohort_prebook";
export type BookingStatus = "held" | "booked" | "cancelled" | "done" | "no_answer";
export type ActorKind = "parent" | "admin";
export type CancelReason = "parent" | "admin" | "hold_expired" | "hold_replaced";
export type CallResultCode = "answered" | "no_answer" | "voicemail" | "wrong_number";
export type CallOutcomeCode =
  | "deposit_taken"
  | "link_sent"
  | "call_back_later"
  | "not_going_ahead"
  | "prebooked_next_cohort"
  | "other"
  | "stop_calling";
export type CallMethod = "phone" | "justcall" | "other";
export type CallSource = "manual" | "justcall";

/** Who is acting. `userId` is null only for a system writer (05's JustCall webhook). */
export interface CallActor {
  readonly userId: string | null;
  readonly kind: ActorKind;
}

/** A half-open stretch of time `[startsAt, endsAt)`. */
export interface TimeSpan {
  readonly startsAt: string;
  readonly endsAt: string;
}

/** A bookable call time. */
export type Slot = TimeSpan;

export interface CallSettings {
  readonly slotMinutes: number;
  readonly windowDays: number;
  readonly noticeMinutes: number;
  readonly holdMinutes: number;
  readonly parentReminderMinutes: number;
  readonly adminReminderMinutes: number;
  readonly overdueGraceMinutes: number;
  readonly notBookedDelayMinutes: number;
  /** E.164 `+44…`; the line is left out of emails while null. */
  readonly callerNumber: string | null;
  /** When BAI pressed "Start call booking" (plan §12 R11); null until then — no one is in the to-call scope. */
  readonly enabledSince: string | null;
}

export interface WeeklyHoursRange {
  readonly weekday: IsoWeekday;
  /** London minutes since midnight, 0–1439. */
  readonly startMinute: number;
  /** London minutes since midnight, 1–1440, after `startMinute`. */
  readonly endMinute: number;
}

export interface CallBlock extends TimeSpan {
  readonly id: string;
  readonly reason: string;
}

export interface CallBooking extends TimeSpan {
  readonly id: string;
  readonly parentUserId: string;
  readonly positionId: string | null;
  readonly status: BookingStatus;
  readonly purpose: CallPurpose;
  readonly bookedByKind: ActorKind;
  readonly holdExpiresAt: string | null;
  readonly bookedAt: string | null;
  readonly movedAt: string | null;
  readonly movedFromStartsAt: string | null;
  readonly cancelledAt: string | null;
  readonly cancelReason: CancelReason | null;
  readonly closedAt: string | null;
  readonly createdAt: string;
}

export interface CallLogEntry {
  readonly id: string;
  readonly parentUserId: string;
  readonly bookingId: string | null;
  readonly occurredAt: string;
  readonly recordedBy: string | null;
  readonly method: CallMethod;
  readonly source: CallSource;
  readonly result: CallResultCode | null;
  readonly outcome: CallOutcomeCode | null;
  readonly note: string | null;
  readonly callBackAt: string | null;
  readonly justcallCallId: string | null;
}

/** A parent sign-up in the base to-call scope (brief §3 "who appears"). */
export interface ScopeParent {
  readonly userId: string;
  readonly signupSource: string | null;
  readonly signedUpAt: string;
}

/** The contact facts a call row shows. */
export interface ParentContact {
  readonly userId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly mobile: string | null;
  readonly isTestUser: boolean;
}

/** Refusals the call functions return (amendment 19's jsonb `status` codes). */
export type CallRefusal =
  | "taken"
  | "too_soon"
  | "hold_expired"
  | "not_yours"
  | "not_found"
  | "rate_limited"
  | "invalid"
  | "overlap"
  | "booked_call_exists";

/** Every way a call operation can fail. `error` = something broke (logged server-side, never shown as detail). */
export type CallError = CallRefusal | "call_booking_disabled" | "error";

/** The result of every call operation: a value, or a closed error code. Never thrown. */
export type CallsResult<T, E extends string = CallError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

// ── What the repository's writers take and give back (amendment 19's six functions + Start call booking) ──

export interface HoldInput {
  readonly parentUserId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly purpose: CallPurpose;
  readonly positionId: string | null;
  readonly actor: CallActor;
}

export interface BookInput extends HoldInput {
  readonly idempotencyKey: string;
}

export interface ConfirmInput {
  readonly parentUserId: string;
  readonly holdId: string;
  readonly idempotencyKey: string;
  readonly actor: CallActor;
}

export interface CancelInput {
  readonly parentUserId: string;
  readonly bookingId: string;
  readonly actor: CallActor;
}

export interface OutcomeInput {
  readonly parentUserId: string;
  readonly bookingId: string | null;
  readonly result: CallResultCode | null;
  readonly outcome: CallOutcomeCode | null;
  readonly note: string | null;
  readonly callBackAt: string | null;
  readonly method: CallMethod;
  readonly source: CallSource;
  readonly actor: Pick<CallActor, "userId">;
  readonly justcallCallId: string | null;
}

export interface HeldSlot {
  readonly bookingId: string;
  readonly holdExpiresAt: string;
}

/** A confirmed time: a new booking, or her existing booking moved (the same row keeps its id). */
export type ConfirmedBooking =
  | { readonly kind: "booked"; readonly bookingId: string; readonly startsAt: string; readonly replay: boolean }
  | { readonly kind: "moved"; readonly bookingId: string; readonly startsAt: string; readonly fromStartsAt: string };

export interface CancelledBooking {
  readonly bookingId: string;
  readonly startsAt: string;
}

export interface RecordedOutcome {
  readonly entryId: string;
  readonly replay: boolean;
}

export interface StartedCallBooking {
  readonly enabledSince: string;
  /** False when it was already started (the first time is kept). */
  readonly startedNow: boolean;
}
