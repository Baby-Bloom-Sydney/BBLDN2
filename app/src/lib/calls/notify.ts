/**
 * What happened to a booking, and the emails it sends (plan A7, B1; brief §0.3, §0.11, §5 email types).
 *
 *   booked    → `call_booking_confirmation` to her; `admin_call_booked` too when the parent booked it herself (or
 *               brief 03's flow did, as her) — never for a booking BAI made on her behalf
 *   moved     → `call_booking_changed` to her (the same booking, a new time)
 *   cancelled → `call_booking_cancelled` to her, whoever cancelled
 *
 * Her name and address are read here (`readContacts`, her row only) and the caller number from the settings (left
 * out while empty, or if the settings can't be read). Sending goes through `mailer.ts`.
 *
 * A notice only ever goes out after the database has committed the change, and a sender that fails is logged
 * and swallowed: an email failure never undoes or fails a booking (plan A7 test).
 *
 * BB-wave1-041126/04a-core, 2026-11-04; templates wired by BB-wave1-041126/04b-build, 2026-11-04.
 */

import { sendEmail } from "@/lib/email/resend";
import { buildCallAdminBookedEmail } from "@/lib/email/templates/call-admin-booked";
import { buildCallBookingCancelledEmail } from "@/lib/email/templates/call-booking-cancelled";
import { buildCallBookingChangedEmail } from "@/lib/email/templates/call-booking-changed";
import { buildCallBookingConfirmationEmail } from "@/lib/email/templates/call-booking-confirmation";
import { CALL_EMAIL_TYPES } from "@/lib/email/templates/call-email-parts";
import { firstNameOf, mailAdmin, mailParent, parentNameOf, type CallEmailSend } from "./mailer";
import { createCallsRepo, type CallsRepo } from "./repo";
import type { ActorKind, ParentContact } from "./types";

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

export interface CallNoticeDeps {
  readonly repo: Pick<CallsRepo, "readContacts" | "readSettings">;
  readonly send: CallEmailSend;
}

async function herContact(notice: CallNotice, repo: CallNoticeDeps["repo"]): Promise<ParentContact | null> {
  const contacts = await repo.readContacts([notice.parentUserId]);
  const contact = contacts.ok ? contacts.value.find((c) => c.userId === notice.parentUserId) : undefined;
  if (contact === undefined) console.error(`[calls/notify] ${notice.kind} notice: no contact`, { bookingId: notice.bookingId });
  return contact ?? null;
}

async function sendNotice(notice: CallNotice, deps: CallNoticeDeps): Promise<void> {
  const [contact, settings] = await Promise.all([herContact(notice, deps.repo), deps.repo.readSettings()]);
  if (contact === null) return;
  const params = { firstName: firstNameOf(contact), callerNumber: settings.ok ? settings.value.callerNumber : null, startsAt: notice.startsAt };
  if (notice.kind === "moved") {
    await mailParent(deps.send, contact, buildCallBookingChangedEmail({ ...params, fromStartsAt: notice.fromStartsAt }), CALL_EMAIL_TYPES.changed);
    return;
  }
  if (notice.kind === "cancelled") {
    await mailParent(deps.send, contact, buildCallBookingCancelledEmail(params), CALL_EMAIL_TYPES.cancelled);
    return;
  }
  const confirmation = mailParent(deps.send, contact, buildCallBookingConfirmationEmail(params), CALL_EMAIL_TYPES.confirmation);
  if (notice.actorKind !== "parent") {
    await confirmation;
    return;
  }
  // Her own booking: both emails together, so neither waits on the other (review F9; mailer never throws).
  const admin = buildCallAdminBookedEmail({ parentName: parentNameOf(contact), startsAt: notice.startsAt });
  await Promise.all([confirmation, mailAdmin(deps.send, admin, CALL_EMAIL_TYPES.adminBooked)]);
}

/** A sender over the given repository and mail function (tests pass their own). */
export function createCallNoticeSender(deps: CallNoticeDeps): CallNoticeSender {
  return (notice) => sendNotice(notice, deps);
}

/** The default sender: the service-role repository (its client made on first use) and `sendEmail`. */
export const sendCallNotice: CallNoticeSender = (notice) => sendNotice(notice, { repo: createCallsRepo(), send: sendEmail });

export async function notifyCall(notice: CallNotice, send: CallNoticeSender): Promise<void> {
  try {
    await send(notice);
  } catch (thrown) {
    // The name and code only: a mail provider's message can echo the recipient's address.
    const code = typeof thrown === "object" && thrown !== null ? (thrown as { readonly code?: unknown }).code : undefined;
    console.error(`[calls/notify] ${notice.kind} notice failed`, {
      bookingId: notice.bookingId,
      name: thrown instanceof Error ? thrown.name : typeof thrown,
      code: typeof code === "string" || typeof code === "number" ? String(code) : undefined,
    });
  }
}
