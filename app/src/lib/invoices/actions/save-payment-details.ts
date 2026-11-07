"use server";

/**
 * Save her bank details for invoices (plan 06 §14.6 b3.1; brief §0a 2, §3 nanny 10, §11 Q12). Called from the
 * Settings Business section, and in 06b-4 from the first invoice's setup. Invoices only: it never touches payouts.
 *
 * Contract:
 * - The switch first (off → `invoices_disabled`, before the session or any client is read); then her proof from the
 *   request's session (`proveNanny`; none → `signed_out`); then the store, which parses again and calls
 *   `nanny_payment_details_save` under her lock.
 * - The reply carries the **masks only** (brief §0.2): the full numbers never come back to the browser.
 * - **A change to saved details** (not the first save, not an unchanged re-save) sends her the security email
 *   (`emails/payment-details-changed.ts`), with no digit in it, replying to the support inbox. The email is best
 *   effort: a failure is logged by code and never fails the save, which has already happened.
 * - Nothing she typed is logged, on any path (the store and this file log codes only).
 *
 * Only this async function is exported: every async export of a `"use server"` file is callable from a browser.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */

import { SUPPORT_INBOX } from "@/lib/constants";
import { getUserEmailInfo } from "@/lib/email/helpers";
import { sendEmail } from "@/lib/email/resend";
import { nannyInvoicesEnabled } from "@/lib/features/flags";
import { logFailure } from "../db";
import { PAYMENT_DETAILS_CHANGED_EMAIL_TYPE, paymentDetailsChangedEmail } from "../emails/payment-details-changed";
import { proveNanny } from "../nanny-proof";
import { saveDetails } from "../store";
import { actionRefusal, type PaymentSaveResult } from "./messages";

const EMAIL_LABEL = "the details-changed email";

/** Tell her that her bank details changed (Q12). Never throws. */
async function sendChangedEmail(userId: string): Promise<void> {
  try {
    const who = await getUserEmailInfo(userId);
    if (!who) {
      logFailure(EMAIL_LABEL, { code: "no_profile" });
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
    if (!sent.success) logFailure(EMAIL_LABEL, { code: "send_failed" });
  } catch (thrown) {
    logFailure(EMAIL_LABEL, thrown);
  }
}

export async function savePaymentDetails(input: unknown): Promise<PaymentSaveResult> {
  if (!nannyInvoicesEnabled()) return actionRefusal("invoices_disabled");
  const proof = await proveNanny();
  if (!proof) return actionRefusal("signed_out");
  const saved = await saveDetails(proof, input);
  if (!saved.ok) return actionRefusal(saved.error);
  if (saved.value.changed && !saved.value.firstSave) await sendChangedEmail(proof.userId);
  return { ok: true, masks: saved.value.masks };
}
