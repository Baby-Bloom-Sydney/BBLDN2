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
 * The "Change or cancel" button (plan 03 C3, D8): for a pre-booked cohort call (`cohort_prebook`) it opens her
 * deposit page while she has an open link; otherwise the call page, as before (`callButtonHref`).
 *
 * BB-wave1-041126/04a-core, 2026-11-04; templates wired by BB-wave1-041126/04b-build, 2026-11-04;
 * the button's href by BB-wave2-231126/03-build, 2026-11-25.
 */

import type { DbResult } from "@/lib/cohorts/db";
import { isDepositCode } from "@/lib/deposit/code";
import { depositLinkUrl, readOpenLinkCode } from "@/lib/deposit/links";
import { sendEmail } from "@/lib/email/resend";
import { buildCallAdminBookedEmail } from "@/lib/email/templates/call-admin-booked";
import { buildCallBookingCancelledEmail } from "@/lib/email/templates/call-booking-cancelled";
import { buildCallBookingChangedEmail } from "@/lib/email/templates/call-booking-changed";
import { buildCallBookingConfirmationEmail } from "@/lib/email/templates/call-booking-confirmation";
import { CALL_EMAIL_TYPES, CALL_PAGE_URL } from "@/lib/email/templates/call-email-parts";
import { depositLinkEnabled } from "@/lib/features/flags";
import { createAdminClient } from "@/lib/supabase/admin";
import { firstNameOf, mailAdmin, mailParent, parentNameOf, type CallEmailSend } from "./mailer";
import { createCallsRepo, type CallsRepo } from "./repo";
import type { ActorKind, CallPurpose, ParentContact } from "./types";

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

/** Her family's open deposit link's code (plan 03 C3, D8): null when none is open; not ok when the read failed. */
export type OpenDepositCodeReader = (parentUserId: string) => Promise<DbResult<string | null>>;

export interface CallNoticeDeps {
  readonly repo: Pick<CallsRepo, "readContacts" | "readSettings" | "readBookingsForParents">;
  readonly send: CallEmailSend;
  /** Plan 03 C3 (D8). Absent → every button opens the call page, as before. */
  readonly readOpenDepositCode?: OpenDepositCodeReader;
}

/** The default reader: one bounded read through the service-role client (made on use). */
export const readOpenDepositCode: OpenDepositCodeReader = (parentUserId) => readOpenLinkCode(createAdminClient(), parentUserId);

/** What the button rule needs to know about one booking. */
export interface ButtonBooking {
  readonly parentUserId: string;
  readonly bookingId: string;
  readonly purpose: CallPurpose | null;
}

/** A thrown value's code, or its name: never its message, which can carry an address. */
function failureCode(thrown: unknown): string {
  const code = typeof thrown === "object" && thrown !== null ? (thrown as { readonly code?: unknown }).code : undefined;
  if (typeof code === "string" || typeof code === "number") return String(code);
  return thrown instanceof Error ? thrown.name : typeof thrown;
}

/** Her open link's code, or null: none open, or a failed read / not a code (logged by code, never the value). */
async function openDepositCode(booking: ButtonBooking, read: OpenDepositCodeReader): Promise<string | null> {
  const failed = (code: string): null => {
    console.error("[calls/notify] deposit link read failed", { bookingId: booking.bookingId, code });
    return null;
  };
  try {
    const open = await read(booking.parentUserId);
    if (!open.ok) return failed("read_failed");
    if (open.value === null || isDepositCode(open.value)) return open.value;
    return failed("not_a_code");
  } catch (thrown) {
    return failed(failureCode(thrown));
  }
}

/**
 * Her "Change or cancel" button (plan 03 C3, D8). A pre-booked cohort call opens her deposit page, where the
 * pre-booked day's picker is, while she has an open link. Anything else (a first call, no open link, the switch
 * off, no reader, a failed read) opens the call page, as before.
 */
export async function callButtonHref(booking: ButtonBooking, read: OpenDepositCodeReader | undefined): Promise<string> {
  if (read === undefined || booking.purpose !== "cohort_prebook" || !depositLinkEnabled()) return CALL_PAGE_URL;
  const code = await openDepositCode(booking, read);
  return code === null ? CALL_PAGE_URL : depositLinkUrl(code);
}

/** The notice's booking purpose; null when it isn't found or can't be read (the repository logs a failed read). */
async function bookingPurpose(notice: CallNotice, repo: CallNoticeDeps["repo"]): Promise<CallPurpose | null> {
  try {
    const bookings = await repo.readBookingsForParents([notice.parentUserId]);
    return bookings.ok ? (bookings.value.find((b) => b.id === notice.bookingId)?.purpose ?? null) : null;
  } catch (thrown) {
    console.error("[calls/notify] booking read failed", { bookingId: notice.bookingId, code: failureCode(thrown) });
    return null;
  }
}

/** The button for this notice. Her booking is read only when it could change the button: never for a cancel. */
async function noticeButtonHref(notice: CallNotice, deps: CallNoticeDeps): Promise<string> {
  if (notice.kind === "cancelled" || deps.readOpenDepositCode === undefined || !depositLinkEnabled()) return CALL_PAGE_URL;
  const purpose = await bookingPurpose(notice, deps.repo);
  return callButtonHref({ parentUserId: notice.parentUserId, bookingId: notice.bookingId, purpose }, deps.readOpenDepositCode);
}

async function herContact(notice: CallNotice, repo: CallNoticeDeps["repo"]): Promise<ParentContact | null> {
  const contacts = await repo.readContacts([notice.parentUserId]);
  const contact = contacts.ok ? contacts.value.find((c) => c.userId === notice.parentUserId) : undefined;
  if (contact === undefined) console.error(`[calls/notify] ${notice.kind} notice: no contact`, { bookingId: notice.bookingId });
  return contact ?? null;
}

async function sendNotice(notice: CallNotice, deps: CallNoticeDeps): Promise<void> {
  const [contact, settings, href] = await Promise.all([herContact(notice, deps.repo), deps.repo.readSettings(), noticeButtonHref(notice, deps)]);
  if (contact === null) return;
  const params = { firstName: firstNameOf(contact), callerNumber: settings.ok ? settings.value.callerNumber : null, startsAt: notice.startsAt };
  if (notice.kind === "moved") {
    await mailParent(deps.send, contact, buildCallBookingChangedEmail({ ...params, fromStartsAt: notice.fromStartsAt, href }), CALL_EMAIL_TYPES.changed);
    return;
  }
  if (notice.kind === "cancelled") {
    await mailParent(deps.send, contact, buildCallBookingCancelledEmail(params), CALL_EMAIL_TYPES.cancelled);
    return;
  }
  const confirmation = mailParent(deps.send, contact, buildCallBookingConfirmationEmail({ ...params, href }), CALL_EMAIL_TYPES.confirmation);
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

/** The default sender: the service-role repository (its client made on first use), `sendEmail`, and the open-link reader. */
export const sendCallNotice: CallNoticeSender = (notice) =>
  sendNotice(notice, { repo: createCallsRepo(), send: sendEmail, readOpenDepositCode });

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
