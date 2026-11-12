/**
 * Send an invoice's emails (plan 06 §3 nanny 7, §3a, §14.8; brief §0.5, §9.7–9.8; R16, R20). Called by the send
 * action once the PDF is stored. Server-only, and deliberately NOT a `"use server"` file: it logs through `db.ts`,
 * and every async export of a `"use server"` file is callable from a browser (`boundary.test.ts`).
 *
 * - **To the invoice's snapshot addresses only** (the created row's `family_email` / `nanny_email`, never a
 *   client field); the family's email first, with the PDF attached and **reply-to her** (brief §0.5: replying
 *   reaches her, not BabyBloom); then her copy, with the same PDF, **after** the family's result so it can say
 *   whether it arrived (R16). Her copy replies to the support inbox.
 * - **Never throws.** A provider failure, a throw, or no answer within `INVOICE_EMAIL_WAIT_MS` is `failed` (the
 *   row records it, and her list offers Resend), logged by code only. A timed-out email may still arrive; a Resend
 *   then sends the same PDF and number again, which is harmless. The wait keeps the whole send (render, upload, two
 *   emails) inside the page's 30 s.
 * - The bodies carry no bank detail: the templates take none (`sendEmail` keeps every body in `email_logs`).
 * - **Cancellations** (brief §0.8; R15, R16): the family's first (reply-to her), then hers saying whether the
 *   family's arrived; no attachment. Each email also goes alone, for a resend (old step 13).
 * - **A family with no account any more** (security review L2): their email is skipped — `failed`, logged by code —
 *   rather than sent to the address of a closed account.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { SUPPORT_INBOX } from "@/lib/constants";
import { sendEmail, type SendEmailParams } from "@/lib/email/resend";
import { logFailure } from "../db";
import type { EmailDelivery } from "../types";
import {
  INVOICE_CANCELLED_FAMILY_EMAIL_TYPE,
  INVOICE_CANCELLED_NANNY_EMAIL_TYPE,
  invoiceCancelledEmail,
  type CancelledFacts,
} from "./invoice-cancelled";
import { INVOICE_COPY_TO_NANNY_EMAIL_TYPE, invoiceCopyToNannyEmail } from "./invoice-copy-to-nanny";
import { INVOICE_TO_FAMILY_EMAIL_TYPE, invoiceToFamilyEmail } from "./invoice-to-family";
import type { InvoiceEmailFacts } from "./invoice-wording";

/** How long one email may take before it counts as not delivered. */
export const INVOICE_EMAIL_WAIT_MS = 10_000;

/** Where an invoice's emails go: the created row's snapshot, and whose they are (for `email_logs`). */
export interface InvoiceAddresses {
  readonly familyEmail: string;
  readonly nannyEmail: string;
  readonly parentUserId: string;
  readonly nannyUserId: string;
}

/** The stored PDF, attached to both invoice emails. */
export interface InvoicePdfFile {
  readonly filename: string;
  readonly content: Buffer;
}

/** One email, bounded and never thrown: `sent` or `failed` (logged by code). */
async function deliver(label: string, email: SendEmailParams): Promise<EmailDelivery> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), INVOICE_EMAIL_WAIT_MS);
  });
  const sent = sendEmail(email).then(
    (r) => (r.success ? ("sent" as const) : ("send_failed" as const)),
    () => "threw" as const,
  );
  const outcome = await Promise.race([sent, late]);
  clearTimeout(timer);
  if (outcome === "sent") return "sent";
  logFailure(label, { code: outcome });
  return "failed";
}

/** The family's email (PDF attached, reply-to her). */
export function familyInvoiceEmail(facts: InvoiceEmailFacts, to: InvoiceAddresses, pdf: InvoicePdfFile): Promise<EmailDelivery> {
  const email = invoiceToFamilyEmail(facts);
  return deliver("the invoice email to the family", {
    to: to.familyEmail,
    subject: email.subject,
    html: email.html,
    text: email.text,
    replyTo: to.nannyEmail,
    emailType: INVOICE_TO_FAMILY_EMAIL_TYPE,
    recipientUserId: to.parentUserId,
    attachments: [{ filename: pdf.filename, content: pdf.content }],
  });
}

/** Her copy (the same PDF), saying what happened to the family's. */
export function nannyInvoiceCopy(
  facts: InvoiceEmailFacts,
  to: InvoiceAddresses,
  pdf: InvoicePdfFile,
  familyDelivery: EmailDelivery,
): Promise<EmailDelivery> {
  const email = invoiceCopyToNannyEmail({ ...facts, familyDelivery });
  return deliver("the invoice copy to the nanny", {
    to: to.nannyEmail,
    subject: email.subject,
    html: email.html,
    text: email.text,
    replyTo: SUPPORT_INBOX,
    emailType: INVOICE_COPY_TO_NANNY_EMAIL_TYPE,
    recipientUserId: to.nannyUserId,
    attachments: [{ filename: pdf.filename, content: pdf.content }],
  });
}

/** Both invoice emails: the family's, then her copy (R16). */
export async function sendInvoiceEmails(
  facts: InvoiceEmailFacts,
  to: InvoiceAddresses,
  pdf: InvoicePdfFile,
): Promise<{ readonly family: EmailDelivery; readonly nanny: EmailDelivery }> {
  const family = await familyInvoiceEmail(facts, to, pdf);
  const nanny = await nannyInvoiceCopy(facts, to, pdf, family);
  return { family, nanny };
}

/** The family's cancellation email (reply-to her). */
export function familyCancellation(facts: CancelledFacts, to: InvoiceAddresses): Promise<EmailDelivery> {
  const email = invoiceCancelledEmail({ ...facts, to: "family" });
  return deliver("the cancellation email to the family", {
    to: to.familyEmail,
    subject: email.subject,
    html: email.html,
    text: email.text,
    replyTo: to.nannyEmail,
    emailType: INVOICE_CANCELLED_FAMILY_EMAIL_TYPE,
    recipientUserId: to.parentUserId,
  });
}

/** Her cancellation email, saying what happened to the family's. */
export function nannyCancellation(facts: CancelledFacts, to: InvoiceAddresses, familyDelivery: EmailDelivery): Promise<EmailDelivery> {
  const email = invoiceCancelledEmail({ ...facts, to: "nanny", familyDelivery });
  return deliver("the cancellation email to the nanny", {
    to: to.nannyEmail,
    subject: email.subject,
    html: email.html,
    text: email.text,
    replyTo: SUPPORT_INBOX,
    emailType: INVOICE_CANCELLED_NANNY_EMAIL_TYPE,
    recipientUserId: to.nannyUserId,
  });
}

/** The family's email not sent because they no longer have an account (L2): `failed`, logged by code. */
export function skippedFamilyEmail(): EmailDelivery {
  logFailure("the family email", { code: "no_family_account" });
  return "failed";
}

/** Both cancellation emails: the family's (skipped when they have no account), then hers (R16's order). */
export async function sendCancellationEmails(
  facts: CancelledFacts,
  to: InvoiceAddresses,
  familyHasAccount: boolean,
): Promise<{ readonly family: EmailDelivery; readonly nanny: EmailDelivery }> {
  const family = familyHasAccount ? await familyCancellation(facts, to) : skippedFamilyEmail();
  const nanny = await nannyCancellation(facts, to, family);
  return { family, nanny };
}
