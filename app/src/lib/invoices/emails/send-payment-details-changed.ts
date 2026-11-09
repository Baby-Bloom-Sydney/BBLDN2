/**
 * Send the "payment details changed" security email (plan 06 §3 nanny 10, §11 Q12; b3.1–b3.2). Called by
 * `actions/save-business-settings.ts` once a change to saved bank details has been stored. Server-only, and deliberately
 * NOT a `"use server"` file: it logs through `db.ts`, and every async export of a `"use server"` file is callable from
 * a browser (`boundary.test.ts`).
 *
 * Best effort: it never throws. A missing profile, a provider failure or a throw is logged by code only; the save it
 * follows has already happened. The email carries no digit of her details and replies to the support inbox.
 *
 * **Capped** (06b-3 security review M1): at most `ALERTS_PER_HOUR` of these to her in any hour, counted from
 * `email_logs` (every send, dry runs and failures included, is logged there), so repeated changes can't use BabyBloom's
 * sender to flood her inbox or the shared provider's rate limit. The save is never refused. If the count can't be
 * read, the alert is sent anyway: a missed alert is worse than one too many. Best effort, not a hard limit: the count
 * is read before the send and the row written after it, so a burst of parallel changes can pass it (verification L1);
 * failed sends count too, so a failing provider isn't hammered.
 *
 * **Bounded** (06b-3 TypeScript review M2): the save's reply waits at most `EMAIL_WAIT_MS` for it, so a slow provider
 * never holds a save that has already happened; past that it is logged as `timeout` (it may still go out).
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */

import { SUPPORT_INBOX } from "@/lib/constants";
import { getUserEmailInfo } from "@/lib/email/helpers";
import { sendEmail } from "@/lib/email/resend";
import { logFailure, serviceClient } from "../db";
import { PAYMENT_DETAILS_CHANGED_EMAIL_TYPE, paymentDetailsChangedEmail } from "./payment-details-changed";

const LABEL = "the details-changed email";
/** The cap: this many alerts to one nanny in the last `ALERT_WINDOW_MS`. */
export const ALERTS_PER_HOUR = 3;
const ALERT_WINDOW_MS = 60 * 60 * 1000;

/** Whether she has had `ALERTS_PER_HOUR` of these in the last hour; false when the count can't be read. */
async function capped(userId: string): Promise<boolean> {
  const admin = serviceClient();
  if (!admin) return false;
  const since = new Date(Date.now() - ALERT_WINDOW_MS).toISOString();
  const { data, error } = await admin
    .from("email_logs")
    .select("id")
    .eq("recipient_user_id", userId)
    .eq("email_type", PAYMENT_DETAILS_CHANGED_EMAIL_TYPE)
    .gte("created_at", since)
    .limit(ALERTS_PER_HOUR);
  if (error) {
    logFailure(`${LABEL} cap`, error);
    return false;
  }
  return Array.isArray(data) && data.length >= ALERTS_PER_HOUR;
}

/** How long the save's reply waits for the email. */
export const EMAIL_WAIT_MS = 5_000;

/** Tell her (by her user id) that her bank details for invoices changed. Never throws; waits at most `EMAIL_WAIT_MS`. */
export async function sendPaymentDetailsChangedEmail(userId: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), EMAIL_WAIT_MS);
  });
  const outcome = await Promise.race([send(userId).then(() => "done" as const), late]);
  clearTimeout(timer);
  if (outcome === "timeout") logFailure(LABEL, { code: "timeout" });
}

async function send(userId: string): Promise<void> {
  try {
    if (await capped(userId)) {
      console.warn(`[invoices] ${LABEL} skipped`, { code: "alert_cap" });
      return;
    }
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
