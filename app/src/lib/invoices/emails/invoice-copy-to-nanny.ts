/**
 * The nanny's copy of her invoice (plan 06 §3a, §14.8; brief §0.5; R16). Sent **after** the family's email, so it
 * can say whether it reached them: "<family> has been sent the attached invoice", or "We couldn't deliver it to
 * <family>; try Resend on your invoices page". The send path attaches the same PDF.
 *
 * No bank details (they are on the PDF only); her name and the family's are escaped in the html; the nanny footer.
 * Pure: builds strings, sends nothing.
 *
 * 06b-4 rework: the period label ("2–29 Nov 2026") replaces "the week of …" and "the Trial Shift on …".
 *
 * BB-wave1-041126/06b4, 2026-11-12; BB-wave1-041126/06b4-server, 2026-11-12.
 */

import { emailFooter } from "@/lib/email/brand";
import type { EmailDelivery } from "../types";
import {
  firstNameOf,
  invoicePeriod,
  oneLine,
  renderEmail,
  totalsClause,
  type InvoiceEmail,
  type InvoiceEmailFacts,
} from "./invoice-wording";

/** Its `email_logs.email_type`. */
export const INVOICE_COPY_TO_NANNY_EMAIL_TYPE = "invoice_copy_to_nanny";

export interface InvoiceCopyToNannyParams extends InvoiceEmailFacts {
  /** What happened to the family's email, just before this one (R16). */
  readonly familyDelivery: EmailDelivery;
}

export function invoiceCopyToNannyEmail(params: InvoiceCopyToNannyParams): InvoiceEmail {
  const { number, nannyName, familyName, figures, replacesNumber, familyDelivery } = params;
  const first = firstNameOf(nannyName);
  const period = invoicePeriod(params);
  const paragraphs = [
    `Hi ${first === "" ? "there" : first},`,
    `Here is a copy of your invoice to ${familyName} for ${period}: ${totalsClause(figures)}.`,
    ...(replacesNumber === null ? [] : [`It replaces invoice ${replacesNumber}, which you cancelled.`]),
    familyDelivery === "sent"
      ? `${familyName} has been sent the attached invoice.`
      : `We couldn't deliver it to ${familyName}; try Resend on your invoices page.`,
  ];
  return {
    subject: oneLine(`Copy: invoice ${number} to ${familyName} — ${period}`),
    ...renderEmail({ heading: `Invoice ${number}`, paragraphs, footer: emailFooter() }),
  };
}
