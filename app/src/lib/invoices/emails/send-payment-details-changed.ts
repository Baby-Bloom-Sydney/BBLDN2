/**
 * Send the "payment details changed" security email (plan 06 §3 nanny 10, §11 Q12; b3.1–b3.2). Called by
 * `actions/save-payment-details.ts` once a change to saved bank details has been stored. Server-only, and deliberately
 * NOT a `"use server"` file: it logs through `db.ts`, and every async export of a `"use server"` file is callable from
 * a browser (`boundary.test.ts`).
 *
 * Best effort: it never throws. A missing profile, a provider failure or a throw is logged by code only; the save it
 * follows has already happened. The email carries no digit of her details and replies to the support inbox.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */

import { SUPPORT_INBOX } from "@/lib/constants";
import { getUserEmailInfo } from "@/lib/email/helpers";
import { sendEmail } from "@/lib/email/resend";
import { logFailure } from "../db";
import { PAYMENT_DETAILS_CHANGED_EMAIL_TYPE, paymentDetailsChangedEmail } from "./payment-details-changed";

const LABEL = "the details-changed email";

/** Tell her (by her user id) that her bank details for invoices changed. Never throws. */
export async function sendPaymentDetailsChangedEmail(userId: string): Promise<void> {
  try {
    const who = await getUserEmailInfo(userId);
    if (!who) {
      logFailure(LABEL, { code: "no_profile" });
      return;
    }
    const email = paymentDetailsChangedEmail({ firstName: who.firstName, changedAt: new Date().toISOString() });
    const sent = await sendEmail({
      to: who.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      replyTo: SUPPORT_INBOX,
      emailType: PAYMENT_DETAILS_CHANGED_EMAIL_TYPE,
      recipientUserId: userId,
    });
    if (!sent.success) logFailure(LABEL, { code: "send_failed" });
  } catch (thrown) {
    logFailure(LABEL, thrown);
  }
}
