/**
 * The invoice email to the family (plan 06 §3a, §14.8; brief §0.5, §3 parent 1; R20). The send path attaches the
 * PDF and sets reply-to to her email, so "Reply to this email to reach Sophie" reaches her, not BabyBloom.
 *
 * - **No bank details**, not even a mask: they are on the attached PDF only (brief §0.5, §9.8).
 * - **No link into the app** (R20, BAI 2026-11-04: reachable from the nanny's side only): the only links are the
 *   footer's legal pages.
 * - The client footer (the family signed the client terms).
 * - `@pending:legal` — brief 11's invoice wording (`11-legal-text.md` §3, "invoice emails and the PDF footer")
 *   drops in as a paragraph before the footer, here and in the nanny's copy.
 * - Pure: builds strings, sends nothing.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { emailFooter } from "@/lib/email/brand";
import {
  firstNameOf,
  oneLine,
  periodForSentence,
  periodForSubject,
  renderEmail,
  totalsClause,
  type InvoiceEmail,
  type InvoiceEmailFacts,
} from "./invoice-wording";

/** Its `email_logs.email_type`. */
export const INVOICE_TO_FAMILY_EMAIL_TYPE = "invoice_to_family";

export type InvoiceToFamilyParams = InvoiceEmailFacts;

export function invoiceToFamilyEmail(params: InvoiceToFamilyParams): InvoiceEmail {
  const { number, kind, periodStart, nannyName, figures, replacesNumber } = params;
  const first = firstNameOf(nannyName) || nannyName;
  const paragraphs = [
    `${nannyName} has sent you an invoice for ${periodForSentence(kind, periodStart)}: ${totalsClause(figures)}.`,
    ...(replacesNumber === null ? [] : [`It replaces invoice ${replacesNumber}, which was cancelled.`]),
    `Please pay ${first} directly, using the bank details on the attached invoice.`,
    `Reply to this email to reach ${first}.`,
  ];
  return {
    subject: oneLine(`Invoice ${number} from ${nannyName} — ${periodForSubject(kind, periodStart)}`),
    ...renderEmail({ heading: `Invoice ${number}`, paragraphs, footer: emailFooter({ terms: "client" }) }),
  };
}
