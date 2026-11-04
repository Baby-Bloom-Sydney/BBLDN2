/**
 * What her call page and her hub card show (plan B6, B7; brief §3 parent 2–7, §0.5, §0.10). Pure: the loaders in
 * `parent-state.ts` read, these decide. Every line is built here, on the server, in London words (`slot-words.ts`),
 * so the device's zone can never matter (brief §3 parent 6). The client components import the types only.
 *
 * BB-wave1-041126/04b-build, 2026-11-04.
 */

import { bookedLine, heldLine } from "./copy";
import { groupSlotsByDay, type SlotDay } from "./group-slots-by-day";
import { slotWords } from "./slot-words";
import { everBooked } from "./status";
import { latestEntryOf } from "./to-call";
import type { CallBooking, CallError, CallLogEntry, CallsResult, Slot } from "./types";

export interface BookedCallView {
  readonly bookingId: string;
  readonly startsAt: string;
  /** "Your Complimentary matchmaker call is on Tuesday 9 February at 14:00 (London time)" */
  readonly line: string;
  /** Change time and Cancel only before the start (brief §3 parent 4). */
  readonly changeable: boolean;
}

export interface HeldCallView {
  readonly holdId: string;
  readonly startsAt: string;
  /** "We're holding Tuesday 9 February, 14:00 (London time) for you until 10:05." */
  readonly line: string;
}

/** Her page: booked (with the free days for Change time, null if they couldn't be read), picking, or failed. */
export type MyCallView =
  | { readonly kind: "booked"; readonly booking: BookedCallView; readonly days: readonly SlotDay[] | null }
  | { readonly kind: "pick"; readonly afterNoAnswer: boolean; readonly days: readonly SlotDay[] }
  | { readonly kind: "load_failed" };

/** What the parent's actions can answer. Never a detail: a code the page turns into one of its lines. */
export type MyCallRefusal =
  | "taken"
  | "too_soon"
  | "hold_expired"
  | "not_yours"
  | "rate_limited"
  | "invalid"
  | "not_a_parent"
  | "call_booking_disabled"
  | "error";

export type MyCallResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: MyCallRefusal };

/** A confirmed time (brief 10 hooks `Schedule` on `moved: false, replay: false`; plan §12 R9). */
export interface ConfirmedCallView {
  readonly bookingId: string;
  readonly moved: boolean;
  readonly replay: boolean;
  readonly booking: BookedCallView;
}

const PASSED: ReadonlySet<CallError> = new Set<CallError>([
  "taken",
  "too_soon",
  "hold_expired",
  "not_yours",
  "rate_limited",
  "invalid",
  "call_booking_disabled",
]);

/** A call operation's error as the parent may see it: a hold or booking gone is "not yours"; nothing internal. */
export function refusalOf(error: CallError): MyCallRefusal {
  if (PASSED.has(error)) return error as MyCallRefusal;
  if (error === "overlap") return "taken";
  if (error === "not_found") return "not_yours";
  return "error";
}

/** Her booked first call (a cohort pre-book is brief 03's; the database allows one booked row per purpose). */
export function myBookedCall(bookings: readonly CallBooking[]): CallBooking | null {
  return bookings.find((b) => b.status === "booked" && b.purpose === "first_call") ?? null;
}

export function bookedViewOf(booking: Pick<CallBooking, "id" | "startsAt">, now: Date): BookedCallView {
  return {
    bookingId: booking.id,
    startsAt: booking.startsAt,
    line: bookedLine(slotWords(booking.startsAt)),
    changeable: Date.parse(booking.startsAt) > now.getTime(),
  };
}

export function heldViewOf(held: { readonly bookingId: string; readonly startsAt: string; readonly holdExpiresAt: string }): HeldCallView {
  return { holdId: held.bookingId, startsAt: held.startsAt, line: heldLine(slotWords(held.startsAt), slotWords(held.holdExpiresAt).time) };
}

/** Brief §0.10: her latest attempt went unanswered (No answer, Voicemail, Wrong number) and she hasn't booked since. */
export function isAfterNoAnswer(bookings: readonly CallBooking[], entries: readonly CallLogEntry[]): boolean {
  const last = latestEntryOf(entries);
  if (last === null || last.result === null || last.result === "answered") return false;
  return !bookings.some((b) => everBooked(b) && [b.bookedAt, b.movedAt].some((at) => at !== null && at > last.occurredAt));
}

/** The page's view from her three reads. */
export function callViewOf(reads: {
  readonly bookings: CallsResult<readonly CallBooking[]>;
  readonly entries: CallsResult<readonly CallLogEntry[]>;
  readonly slots: CallsResult<readonly Slot[]>;
  readonly now: Date;
}): MyCallView {
  if (!reads.bookings.ok) return { kind: "load_failed" };
  const days = reads.slots.ok ? groupSlotsByDay(reads.slots.value) : null;
  const booked = myBookedCall(reads.bookings.value);
  if (booked !== null) return { kind: "booked", booking: bookedViewOf(booked, reads.now), days };
  if (!reads.entries.ok || days === null) return { kind: "load_failed" };
  return { kind: "pick", afterNoAnswer: isAfterNoAnswer(reads.bookings.value, reads.entries.value), days };
}
