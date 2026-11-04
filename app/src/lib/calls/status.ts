/**
 * The booking status lattice (plan A5; LDN1 `scheduling/lib/status-lattice.ts`, with amendment 19's five statuses).
 * Pure.
 *
 *   held   → booked | cancelled                         (confirmed; or run out / replaced)
 *   booked → booked | cancelled | done | no_answer      (booked → booked is a move: the same row, a new time)
 *   cancelled, done, no_answer                          terminal
 *
 * BB-wave1-041126/04a-core, 2026-11-04.
 */

import type { BookingStatus } from "./types";

export const BOOKING_STATUSES: readonly BookingStatus[] = Object.freeze([
  "held",
  "booked",
  "cancelled",
  "done",
  "no_answer",
] as const);

const LATTICE: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = Object.freeze({
  held: Object.freeze(["booked", "cancelled"] as const),
  booked: Object.freeze(["booked", "cancelled", "done", "no_answer"] as const),
  cancelled: Object.freeze([] as const),
  done: Object.freeze([] as const),
  no_answer: Object.freeze([] as const),
});

export function canMoveStatus(from: BookingStatus, to: BookingStatus): boolean {
  return LATTICE[from].includes(to);
}

export interface OccupancyFacts {
  readonly status: BookingStatus;
  readonly holdExpiresAt: string | null;
}

/**
 * Does this row keep its time from being offered? A booked call does; a hold does until it runs out (the database
 * clears run-out holds only on its next write, so a read must not trust `held` alone).
 */
export function occupiesSlot(booking: OccupancyFacts, now: Date): boolean {
  if (booking.status === "booked") return true;
  if (booking.status !== "held" || booking.holdExpiresAt === null) return false;
  return Date.parse(booking.holdExpiresAt) > now.getTime();
}

/**
 * Was this ever a real booking (plan §12 R2)? Every confirmed row keeps `booked_at`; a hold that ran out or was
 * replaced never had one.
 */
export function everBooked(booking: { readonly bookedAt: string | null }): boolean {
  return booking.bookedAt !== null;
}
