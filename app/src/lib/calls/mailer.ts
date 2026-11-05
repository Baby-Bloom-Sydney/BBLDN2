/**
 * How every call email is sent (plan B1, B2; brief §5 "Each is sent from `DEFAULT_FROM`, with replies to
 * `SENDERS.hello`"): a parent's to her own address with `recipientUserId` set, an admin's to `ADMIN_EMAIL` (else
 * `SENDERS.admin`, the `payment-due-sweep` pattern). Used by `notify.ts` (booking emails) and `reminders.ts` (the
 * cron).
 *
 * Never throws, and answers whether the email went: a failure is logged with its type and the user id only —
 * never an address or the provider's message, which can echo one.
 *
 * BB-wave1-041126/04b-build, 2026-11-04.
 */

import { SENDERS } from "@/lib/constants";
import { DEFAULT_FROM, type SendEmailParams, type SendEmailResult } from "@/lib/email/resend";
import type { EmailTemplate } from "@/lib/email/templates/types";
import type { ParentContact } from "./types";

export type CallEmailSend = (params: SendEmailParams) => Promise<SendEmailResult>;

/** "Jane Smith"; "(no name)" when both are empty. */
export function parentNameOf(contact: Pick<ParentContact, "firstName" | "lastName">): string {
  return [contact.firstName, contact.lastName].map((part) => part.trim()).filter(Boolean).join(" ") || "(no name)";
}

/** Her first name for "Hi Jane,", or "there". */
export function firstNameOf(contact: Pick<ParentContact, "firstName">): string {
  return contact.firstName.trim() || "there";
}

async function deliver(send: CallEmailSend, params: SendEmailParams): Promise<boolean> {
  try {
    const result = await send(params);
    if (!result.success) console.error(`[calls/mailer] ${params.emailType} not sent`, { recipientUserId: params.recipientUserId });
    return result.success;
  } catch (thrown) {
    console.error(`[calls/mailer] ${params.emailType} failed`, {
      recipientUserId: params.recipientUserId,
      name: thrown instanceof Error ? thrown.name : typeof thrown,
    });
    return false;
  }
}

export function mailParent(send: CallEmailSend, contact: ParentContact, template: EmailTemplate, emailType: string): Promise<boolean> {
  return deliver(send, {
    to: contact.email,
    subject: template.subject,
    html: template.html,
    from: DEFAULT_FROM,
    replyTo: SENDERS.hello,
    emailType,
    recipientUserId: contact.userId,
  });
}

export function mailAdmin(send: CallEmailSend, template: EmailTemplate, emailType: string): Promise<boolean> {
  return deliver(send, {
    to: process.env.ADMIN_EMAIL || SENDERS.admin,
    subject: template.subject,
    html: template.html,
    from: DEFAULT_FROM,
    replyTo: SENDERS.hello,
    emailType,
  });
}
