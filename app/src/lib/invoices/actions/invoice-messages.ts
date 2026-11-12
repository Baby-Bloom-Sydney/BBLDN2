/**
 * What the invoice actions answer (plan 06 §14.6 b4.2–b4.3): their result shapes, and one plain, fixed message per
 * refusal — never the database's words and never what she typed. A draft the schema refused answers by field, with
 * the schema's own messages (`validation-lines.ts`), keyed by the field's path ("lines.2.hours").
 *
 * Client-safe (no I/O): the invoice pages read these types and messages, and a `"use server"` file can export only
 * async functions, so they live here (as `messages.ts` does for the Settings action).
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import type { z } from "zod";
import { INVOICE_RULES } from "@/config/invoices";
import { EDIT_MESSAGES } from "@/lib/settings/edit-messages";
import type { Issuer } from "../store-map-lines";
import type { InvoiceTotals } from "../totals";
import type { EmailDelivery, InvoiceError, VatMode } from "../types";
import { FUTURE_ISSUE, LINE_MESSAGES } from "../validation-lines";
import { ACTION_MESSAGES } from "./messages";

/**
 * A refusal code: the store's, plus `signed_out` (no nanny session), `not_cancellable` (cancel: not a sent invoice),
 * `not_resendable` (resend: nothing undelivered of that kind) and `not_recorded` (send: the emails went, but the
 * row couldn't be finished — she must check her list before sending again).
 */
export type InvoiceActionError = InvoiceError | "signed_out" | "not_cancellable" | "not_resendable" | "not_recorded";

export interface InvoiceActionRefusal {
  readonly ok: false;
  readonly error: InvoiceActionError;
  readonly message: string;
  /** Field path → its message, when the draft's schema refused fields (nothing was read or written). */
  readonly fields?: Readonly<Record<string, string>>;
}

const GENERAL = "Something went wrong. Please try again.";

export const INVOICE_ACTION_MESSAGES: Readonly<Record<InvoiceActionError, string>> = Object.freeze({
  invoices_disabled: ACTION_MESSAGES.invoices_disabled,
  signed_out: ACTION_MESSAGES.signed_out,
  invalid: "Please check the invoice and try again.",
  future: LINE_MESSAGES.future,
  not_hers: "You can only invoice families you work with.",
  no_trial: "This family has no Trial Shift date to invoice.",
  wrong_date: LINE_MESSAGES.trialDate,
  nanny_inactive: "Your account isn't active, so invoices can't be sent. Please contact us.",
  cap: `You can send up to ${INVOICE_RULES.dailySendCap} invoices a day. Please try again tomorrow.`,
  busy: "Another invoice of yours is being sent — try again in a moment.",
  in_progress: "This invoice is being sent — check your invoices in a moment.",
  already_done: "This invoice has already been sent.",
  already_failed: "This invoice couldn't be sent. Please review it again, then send.",
  no_pdf: GENERAL,
  no_details: "Add your bank details to send this invoice.",
  no_address: "Add your address to send this invoice.",
  bad_lines: "Please check the shifts and expenses.",
  changed: "Your business settings changed — check the invoice again",
  stale: EDIT_MESSAGES.stale,
  bad_replaces: "That invoice can't be corrected with this one.",
  already_replaced: "That invoice has already been corrected.",
  no_contact: "A name or email this invoice needs is missing.",
  not_found: "We couldn't find that invoice.",
  not_sending: GENERAL,
  error: GENERAL,
  not_cancellable: "Only a sent invoice can be cancelled.",
  not_resendable: "There's nothing to resend for this invoice.",
  not_recorded: "Your invoice was emailed, but your list couldn't be updated. Check your invoices before sending it again.",
});

/** A refusal with its plain message. */
export function invoiceRefusal(error: InvoiceActionError): InvoiceActionRefusal {
  return Object.freeze({ ok: false, error, message: INVOICE_ACTION_MESSAGES[error] });
}

/** The first message for each field path the schema refused ("form" when it names none). Messages are fixed text. */
function fieldsByPath(error: z.ZodError): Readonly<Record<string, string>> {
  return error.issues.reduce<Readonly<Record<string, string>>>((found, issue) => {
    const key = issue.path.length === 0 ? "form" : issue.path.map(String).join(".");
    return Object.hasOwn(found, key) ? found : { ...found, [key]: issue.message };
  }, {});
}

/** A draft the schema refused: `future` when a week or day hasn't happened yet, else `invalid`; by field either way. */
export function draftRefusal(error: z.ZodError): InvoiceActionRefusal {
  const future = error.issues.some((i) => i.code === "custom" && i.params?.issue === FUTURE_ISSUE);
  return Object.freeze({
    ok: false,
    error: future ? "future" : "invalid",
    message: future ? LINE_MESSAGES.future : EDIT_MESSAGES.checkMarked,
    fields: fieldsByPath(error),
  });
}

/** One of her invoices, as a warning or a correction names it. */
export interface InvoiceRef {
  readonly invoiceId: string;
  readonly number: string;
}

/** Her bank details as the review shows them: the name and the masks, never the full numbers (brief §0.2; R3). */
export interface ReviewBank {
  readonly accountName: string;
  readonly sortCodeLast2: string;
  readonly accountLast4: string;
}

/** Who she is on the invoice, read-only ("Change in Settings"); no bank field, no version. */
export type ReviewIssuer = Omit<Issuer, "businessUpdatedAt">;

export interface InvoicePreview {
  /** The id this invoice will have: send it back with `sendInvoice`. A new review mints a new one. */
  readonly invoiceId: string;
  /** What she reviewed, sealed: send it back with `sendInvoice` (anything changed since → `changed`). */
  readonly reviewKey: string;
  /** The server's total: send it back with `sendInvoice`. */
  readonly expectedTotalPence: number;
  readonly totals: InvoiceTotals;
  readonly vat: { readonly mode: VatMode; readonly rateBp: number | null };
  /** "This invoice goes to Olivia Hartley (olivia@…)": the email masked to its local part. */
  readonly recipient: { readonly familyName: string; readonly emailHint: string; readonly area: string | null };
  readonly issuer: ReviewIssuer;
  /** Null when she has none saved yet. */
  readonly bank: ReviewBank | null;
  /** The setup asks for her bank details (saved with `saveBusinessSettings({ bank })`, version null). */
  readonly needsPaymentDetails: boolean;
  /** The setup asks for her address (saved with `saveBusinessSettings({ address })` and `addressVersion`). */
  readonly needsAddress: boolean;
  /** Her home address row's version when `needsAddress` (null = she has no row); null otherwise. */
  readonly addressVersion: string | null;
  /** Her live invoices to this family for the same week or Trial Shift date: "You have already invoiced …". */
  readonly duplicates: readonly InvoiceRef[];
  /** The cancelled invoice this one corrects. */
  readonly replaces: InvoiceRef | null;
}

export type PreviewInvoiceResult = { readonly ok: true; readonly preview: InvoicePreview } | InvoiceActionRefusal;

export interface InvoiceDeliveries {
  readonly family: EmailDelivery;
  readonly nanny: EmailDelivery;
}

export type SendInvoiceResult =
  | { readonly ok: true; readonly invoiceId: string; readonly number: string; readonly delivery: InvoiceDeliveries }
  | InvoiceActionRefusal;
