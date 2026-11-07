/**
 * The "payment details changed" security email (plan 06 §3a, 14.8; brief §3 nanny 10, §11 Q12 — default accepted
 * 2026-11-04; b3.2). `save-payment-details` sends it to the nanny when she replaces her saved bank details; the first
 * save sends none.
 *
 * - **No digit of her details**, not even the masks: `sendEmail` keeps the whole body in `email_logs` (brief §5), so
 *   its inputs are her first name and the time only.
 * - Her name is escaped in the html; the subject is fixed text. The brand header and the nanny footer (`brand.ts`).
 * - Replies go to the support inbox (the sender sets `replyTo`), so "reply to this email" reaches a person.
 * - Pure: builds strings, sends nothing.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */

import { APP_LOCALE, APP_TZ, SITE_NAME } from "@/lib/constants";
import { emailFooter, emailHeader } from "@/lib/email/brand";
import type { EmailTemplate } from "@/lib/email/templates/types";

/** Its `email_logs.email_type`. */
export const PAYMENT_DETAILS_CHANGED_EMAIL_TYPE = "invoice_payment_details_changed";

export interface PaymentDetailsChangedParams {
  readonly firstName: string;
  /** When the change was saved (an ISO instant). */
  readonly changedAt: string;
}

const LONDON = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TZ,
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "15 February 2027 at 14:05" in London; null when the instant can't be read. */
function londonWhen(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const part = Object.fromEntries(LONDON.formatToParts(at).map((p) => [p.type, p.value]));
  return `${part.day} ${part.month} ${part.year} at ${part.hour}:${part.minute}`;
}

const TEXT_ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
const escapeText = (value: string): string => value.replace(/[&<>]/g, (c) => TEXT_ESCAPES[c] ?? c);

function paragraphs(params: PaymentDetailsChangedParams): readonly string[] {
  const name = params.firstName.trim();
  const when = londonWhen(params.changedAt);
  return [
    `Hi ${name === "" ? "there" : name},`,
    when === null ? "The bank details on your invoices were changed." : `The bank details on your invoices were changed on ${when}.`,
    "Invoices you send from now on will show the new details. Invoices you've already sent stay as they were.",
    "If this wasn't you, reply to this email straight away.",
  ];
}

const PARAGRAPH = "font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;";

export function paymentDetailsChangedEmail(params: PaymentDetailsChangedParams): EmailTemplate & { readonly text: string } {
  const lines = paragraphs(params);
  const body = lines.map((line) => `<p style="${PARAGRAPH}">${escapeText(line)}</p>`).join("\n    ");
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#f8fafc;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;">
  <div style="background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;padding:32px;">
    ${emailHeader()}
    <h2 style="font-size:20px;font-weight:700;color:#1e293b;margin:0 0 16px;">Your payment details were changed</h2>
    ${body}
    ${emailFooter()}
  </div>
</div>
</body></html>`;
  return {
    subject: `Your ${SITE_NAME} payment details were changed`,
    html,
    text: [...lines, SITE_NAME].join("\n\n"),
  };
}
