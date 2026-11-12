/**
 * The cancellation emails (plan 06 §3a, §14.8; brief §0.8, §3 parent 2; old step 13; R15, R16): one to the family
 * and one to her, both to the addresses the invoice was sent to (its snapshot). The subject is the same for both:
 * "Invoice <number> has been cancelled — please disregard it". Each states the invoice's figures (the totals
 * sentence) and the reason in plain words. The family's says reply to reach her (the send path sets reply-to to her
 * email); hers is sent after the family's result and says whether it reached them (as her copy does, R16).
 *
 * No bank details; names escaped in the html; one-line subject. Pure: builds strings, sends nothing.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { emailFooter } from "@/lib/email/brand";
import type { CancelReason, EmailDelivery } from "../types";
import {
  CANCEL_REASON_LABELS,
  firstNameOf,
  oneLine,
  periodForSentence,
  renderEmail,
  totalsClause,
  type InvoiceEmail,
  type InvoiceEmailFacts,
} from "./invoice-wording";

/** The two `email_logs.email_type`s. */
export const INVOICE_CANCELLED_FAMILY_EMAIL_TYPE = "invoice_cancelled_family";
export const INVOICE_CANCELLED_NANNY_EMAIL_TYPE = "invoice_cancelled_nanny";

type CancelledFacts = InvoiceEmailFacts & { readonly reason: CancelReason };

export type InvoiceCancelledParams =
  | (CancelledFacts & { readonly to: "family" })
  | (CancelledFacts & { readonly to: "nanny"; readonly familyDelivery: EmailDelivery });

/** "Reason: wrong week or date." */
function reasonSentence(reason: CancelReason): string {
  const label = CANCEL_REASON_LABELS[reason];
  return `Reason: ${label.charAt(0).toLowerCase()}${label.slice(1)}.`;
}

function familyParagraphs(p: CancelledFacts): readonly string[] {
  const first = firstNameOf(p.nannyName) || p.nannyName;
  return [
    `${p.nannyName} has cancelled invoice ${p.number} for ${periodForSentence(p.kind, p.periodStart)}: ${totalsClause(p.figures)}.`,
    `Please disregard it. ${reasonSentence(p.reason)}`,
    `Reply to this email to reach ${first}.`,
  ];
}

function nannyParagraphs(p: CancelledFacts, familyDelivery: EmailDelivery): readonly string[] {
  const first = firstNameOf(p.nannyName);
  return [
    `Hi ${first === "" ? "there" : first},`,
    `You cancelled invoice ${p.number} to ${p.familyName} for ${periodForSentence(p.kind, p.periodStart)}: ${totalsClause(p.figures)}.`,
    reasonSentence(p.reason),
    familyDelivery === "sent"
      ? `We've told ${p.familyName} to disregard it.`
      : `We couldn't deliver the cancellation to ${p.familyName}; try Resend on your invoices page.`,
  ];
}

export function invoiceCancelledEmail(params: InvoiceCancelledParams): InvoiceEmail {
  const toFamily = params.to === "family";
  const paragraphs = params.to === "family" ? familyParagraphs(params) : nannyParagraphs(params, params.familyDelivery);
  return {
    subject: oneLine(`Invoice ${params.number} has been cancelled — please disregard it`),
    ...renderEmail({
      heading: `Invoice ${params.number} cancelled`,
      paragraphs,
      footer: toFamily ? emailFooter({ terms: "client" }) : emailFooter(),
    }),
  };
}
