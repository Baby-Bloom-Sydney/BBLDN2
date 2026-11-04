/**
 * What happened to a booking, for the emails (plan A7). Brief 04b replaces `sendCallNotice` with the real
 * templates (`call_booking_confirmation`, `call_booking_changed`, `call_booking_cancelled`, `admin_call_booked`);
 * until then it sends nothing.
 *
 * A notice only ever goes out after the database has committed the change, and a sender that fails is logged
 * and swallowed: an email failure never undoes or fails a booking (plan A7 test).
 *
 * BB-wave1-041126/04a-core, 2026-11-04.
 */

import type { ActorKind } from "./types";

interface NoticeBase {
  readonly parentUserId: string;
  readonly bookingId: string;
  readonly startsAt: string;
  /** Who acted: 04b sends `admin_call_booked` only for a parent's own booking, never for BAI's (plan B1). */
  readonly actorKind: ActorKind;
}

export type CallNotice =
  | (NoticeBase & { readonly kind: "booked" })
  | (NoticeBase & { readonly kind: "moved"; readonly fromStartsAt: string })
  | (NoticeBase & { readonly kind: "cancelled" });

export type CallNoticeSender = (notice: CallNotice) => Promise<void>;

/** The default sender: nothing yet. */
export const sendCallNotice: CallNoticeSender = async () => {};

export async function notifyCall(notice: CallNotice, send: CallNoticeSender): Promise<void> {
  try {
    await send(notice);
  } catch (thrown) {
    console.error(`[calls/notify] ${notice.kind} notice failed`, {
      bookingId: notice.bookingId,
      message: thrown instanceof Error ? thrown.message : String(thrown),
    });
  }
}
