/**
 * What the invoice actions answer (plan 06 §14.6 b4.2–b4.3): their result shapes, and one plain, fixed message per
 * refusal — never the database's words and never what she typed. A draft the schema refused answers by field, with
 * the schema's own messages (`validation-lines.ts`), keyed by the field's path ("lines.2.hours").
 *
 * Client-safe (no I/O): the invoice pages read these types and messages, and a `"use server"` file can export only
 * async functions, so they live here (as `messages.ts` does for the Settings action).
 *
 * 06b-4 rework (BAI 2026-11-12): no week and no kind. The draft is the family's link id, the lines and any correction;
 * a date before the family's earliest allowed date answers `too_early` by field, as a future date answers `future`.
 *
 * BB-wave1-041126/06b4, 2026-11-12; BB-wave1-041126/06b4-server, 2026-11-12.
 */

import type { z } from "zod";
import { INVOICE_RULES } from "@/config/invoices";
import { EDIT_MESSAGES } from "@/lib/settings/edit-messages";
import type { Issuer } from "../store-map-lines";
import type { InvoiceTotals } from "../totals";
import type { CancelReason, EmailDelivery, InvoiceError, VatMode } from "../types";
import { FUTURE_ISSUE, LINE_MESSAGES, type invoiceLineSchema } from "../validation-lines";
import { ACTION_MESSAGES } from "./messages";

/**
 * A refusal code: the store's, plus `signed_out` (no nanny session) and `not_recorded` (send: the emails went, but
 * the row couldn't be finished — she must check her list before sending again).
 */
export type InvoiceActionError = InvoiceError | "signed_out" | "not_recorded";

export interface InvoiceActionRefusal {
  readonly ok: false;
  readonly error: InvoiceActionError;
  readonly message: string;
  /** Field path → its message: fields the draft's schema refused (nothing read or written), or dates too early. */
  readonly fields?: Readonly<Record<string, string>>;
}

const GENERAL = "Something went wrong. Please try again.";

export const INVOICE_ACTION_MESSAGES: Readonly<Record<InvoiceActionError, string>> = Object.freeze({
  invoices_disabled: ACTION_MESSAGES.invoices_disabled,
  signed_out: ACTION_MESSAGES.signed_out,
  invalid: "Please check the invoice and try again.",
  future: LINE_MESSAGES.future,
  too_early: LINE_MESSAGES.tooEarly,
  not_hers: "You can only invoice families you work with.",
  nanny_inactive: "Your account isn't active, so you can't send or change invoices. Please contact us.",
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
  too_soon: "That email was just tried. Please wait a minute, then try again.",
  not_recorded: "Your invoice was emailed, but your list couldn't be updated. Check your invoices before sending it again.",
});

/** A refusal with its plain message. */
export function invoiceRefusal(error: InvoiceActionError): InvoiceActionRefusal {
  return Object.freeze({ ok: false, error, message: INVOICE_ACTION_MESSAGES[error] });
}

/** Shifts dated before the family's earliest allowed date (by their index in the draft's lines): `too_early`, by field. */
export function tooEarlyRefusal(lineIndexes: readonly number[]): InvoiceActionRefusal {
  const fields = Object.fromEntries(lineIndexes.map((i) => [`lines.${i}.date`, LINE_MESSAGES.tooEarly]));
  return Object.freeze({ ok: false, error: "too_early", message: LINE_MESSAGES.tooEarly, fields: Object.freeze(fields) });
}

/** The first message for each field path the schema refused ("form" when it names none). Messages are fixed text. */
function fieldsByPath(error: z.ZodError): Readonly<Record<string, string>> {
  return error.issues.reduce<Readonly<Record<string, string>>>((found, issue) => {
    const key = issue.path.length === 0 ? "form" : issue.path.map(String).join(".");
    return Object.hasOwn(found, key) ? found : { ...found, [key]: issue.message };
  }, {});
}

/** A draft the schema refused: `future` when a shift's date hasn't happened yet, else `invalid`; by field either way. */
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
  /** The period (spec d): the first and last shift dates, any length apart; for expenses only, today for both. */
  readonly periodStart: string;
  readonly periodEnd: string;
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
  /** Her live invoices to this family whose period overlaps this one on any date: "You have already invoiced …". */
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

export type CancelInvoiceResult =
  | { readonly ok: true; readonly invoiceId: string; readonly number: string; readonly delivery: InvoiceDeliveries }
  | InvoiceActionRefusal;

/** Which email a resend is: the invoice email (on a sent invoice) or the cancellation (on a cancelled one). */
export type ResendWhat = "invoice" | "cancellation";
export type ResendRecipient = "family" | "nanny";

export type ResendInvoiceEmailResult =
  | {
      readonly ok: true;
      readonly invoiceId: string;
      readonly what: ResendWhat;
      readonly recipient: ResendRecipient;
      /** What this resend did: `failed` again is an answer, not a refusal (the list keeps offering Resend). */
      readonly delivery: EmailDelivery;
    }
  | InvoiceActionRefusal;

/** One line of the form, as the actions take it (the shared schema's input). */
export type InvoiceLineInput = z.input<typeof invoiceLineSchema>;

/** `previewInvoice`'s input: no kind and no period — the server works them out (ledger reading 5). */
export interface PreviewInvoiceInput {
  /** The family's link id (`InvoiceableFamily.targetId`): her placement's or her connection's id. */
  readonly targetId: string;
  /** Shifts (each with its own date) and expenses, in her order; at least one. */
  readonly lines: readonly InvoiceLineInput[];
  /** The cancelled invoice this one corrects (`?replaces=`), else null. */
  readonly replacesInvoiceId: string | null;
}

/** `sendInvoice`'s input: the draft she reviewed, with the review's id, total and key. */
export interface SendInvoiceInput extends PreviewInvoiceInput {
  readonly invoiceId: string;
  readonly expectedTotalPence: number;
  readonly reviewKey: string;
}

/** `cancelInvoice`'s input. */
export interface CancelInvoiceInput {
  readonly invoiceId: string;
  readonly reason: CancelReason;
}

/** `resendInvoiceEmail`'s input. */
export interface ResendInvoiceEmailInput {
  readonly invoiceId: string;
  readonly what: ResendWhat;
  readonly recipient: ResendRecipient;
}
