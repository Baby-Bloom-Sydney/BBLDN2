/**
 * What her call page and her hub card show (plan B6, B7; brief §3 parent 2–7, §0.5, §0.10). Pure: the loaders in
 * `parent-state.ts` read, these decide. Every line is built here, on the server, in London words (`slot-words.ts`),
 * so the device's zone can never matter (brief §3 parent 6). The client components import the types only.
 *
 * BB-wave1-041126/04b-build, 2026-11-04.
 */

import { bookedLine, heldLine, hubBookedLine, PARENT_COPY } from "./copy";
import { groupSlotGridByDay, type SlotDay } from "./group-slots-by-day";
import type { SlotGrid } from "./slot-grid";
import { slotWords } from "./slot-words";
import { everBooked } from "./status";
import { latestEntryOf } from "./to-call";
import type { CallBooking, CallError, CallLogEntry, CallsResult, ScopeParent } from "./types";

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

/**
 * Every call operation's error as the parent may see it: a hold or booking gone is "not yours"; nothing internal.
 * Typed as a full `Record` over `CallError` (review F3), so a new code fails to compile until it is mapped here.
 */
export const REFUSAL_FOR: Readonly<Record<CallError, MyCallRefusal>> = Object.freeze({
  taken: "taken",
  too_soon: "too_soon",
  hold_expired: "hold_expired",
  not_yours: "not_yours",
  rate_limited: "rate_limited",
  invalid: "invalid",
  call_booking_disabled: "call_booking_disabled",
  overlap: "taken",
  not_found: "not_yours",
  booked_call_exists: "error",
  error: "error",
});

export function refusalOf(error: CallError): MyCallRefusal {
  return REFUSAL_FOR[error];
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

/** The page's view from her three reads. The days are the whole grid, greyed where not free (04b rework W4). */
export function callViewOf(reads: {
  readonly bookings: CallsResult<readonly CallBooking[]>;
  readonly entries: CallsResult<readonly CallLogEntry[]>;
  readonly grid: CallsResult<SlotGrid>;
  readonly now: Date;
}): MyCallView {
  if (!reads.bookings.ok) return { kind: "load_failed" };
  const days = reads.grid.ok ? groupSlotGridByDay(reads.grid.value) : null;
  const booked = myBookedCall(reads.bookings.value);
  if (booked !== null) return { kind: "booked", booking: bookedViewOf(booked, reads.now), days };
  if (days === null) return { kind: "load_failed" };
  // Her attempts unreadable: she can still pick; there's just no "We tried to call you" line (review F6).
  const afterNoAnswer = reads.entries.ok && isAfterNoAnswer(reads.bookings.value, reads.entries.value);
  return { kind: "pick", afterNoAnswer, days };
}

/** The one card at the top of `/parent` (brief §0.5; plan B7). */
export type HubCallCard =
  | { readonly kind: "booked"; readonly line: string; readonly changeable: boolean }
  | { readonly kind: "not_booked"; readonly line: string };

const INVITE_SOURCES: ReadonlySet<string> = new Set(["nanny_invite", "parent_invite"]);

/** Brief §3 "who appears": not from an invite (a NULL source counts, plan D7), signed up since Start call booking. */
function inScope(parent: ScopeParent | null, enabledSince: string | null): boolean {
  if (parent === null || enabledSince === null) return false;
  const fromInvite = parent.signupSource !== null && INVITE_SOURCES.has(parent.signupSource);
  return !fromInvite && parent.signedUpAt >= enabledSince;
}

/**
 * Booked → her short London time ("· Change" while it's ahead). Not booked → "Pick a time…", but only in scope, and
 * never after an answered call or Stop calling (the call has happened, or BAI has stopped). Otherwise no card.
 */
export function hubCardFor(facts: {
  readonly bookings: readonly CallBooking[];
  readonly entries: readonly CallLogEntry[];
  readonly parent: ScopeParent | null;
  readonly enabledSince: string | null;
  readonly now: Date;
}): HubCallCard | null {
  const booked = myBookedCall(facts.bookings);
  if (booked !== null) {
    return { kind: "booked", line: hubBookedLine(slotWords(booked.startsAt)), changeable: Date.parse(booked.startsAt) > facts.now.getTime() };
  }
  if (!inScope(facts.parent, facts.enabledSince)) return null;
  if (facts.entries.some((e) => e.result === "answered" || e.outcome === "stop_calling")) return null;
  return { kind: "not_booked", line: PARENT_COPY.hubNotBooked };
}
