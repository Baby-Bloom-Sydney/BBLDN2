/**
 * The nanny invoice generator's shared types and result shapes (brief 06; plan `BUILD/plans/06-plan.md`).
 * Client-safe: no I/O here.
 *
 * BB-wave1-041126/06a-build, 2026-11-04.
 */

export const INVOICE_KINDS = ["regular_week", "trial_shift"] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

/** A row's lifecycle (plan R1): sending → sent | failed; sent → cancelled (a database trigger enforces it). */
export const INVOICE_STATUSES = ["sending", "sent", "failed", "cancelled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
/** What the readers return: an invoice that went out (cancelled ones included, marked). */
export type IssuedStatus = "sent" | "cancelled";

export const CANCEL_REASONS = ["wrong_hours", "wrong_rate", "wrong_period", "wrong_family", "other"] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

export type EmailDelivery = "sent" | "failed";

/** Every refusal an invoice operation can answer with. Codes only: no message carries her details. */
export type InvoiceError =
  | "invoices_disabled" // the switch is off: refused before any read
  | "invalid" // bad input, or not a proven nanny
  | "future" // a week or date after London's today
  | "not_hers" // not her placement or trial connection (or a dismissed placement)
  | "no_trial" // a connection with no trial date (plan R3)
  | "wrong_date" // a Trial Shift on a day that isn't the connection's trial date
  | "nanny_inactive" // her nanny account is suspended or deactivated
  | "cap" // the daily send cap is reached (counted in the database, under her lock)
  | "busy" // her lock is held by another write of hers: try again
  | "in_progress" // this invoice id is being sent right now: never a second send
  | "already_done" // this invoice id already went out
  | "already_failed" // this invoice id failed: start again with a new invoice
  | "no_pdf" // finishing as sent before its PDF is stored
  | "no_details" // no payment details, or not the account she reviewed
  | "bad_replaces" // a correction for an invoice that isn't hers, cancelled and to the same family (plan R4)
  | "already_replaced" // that invoice already has a correction
  | "no_contact" // a name or email missing from a profile
  | "not_found" // no such invoice of hers
  | "not_sending" // finishing an invoice that isn't sending
  | "error"; // the database or renderer failed (logged by code)

export type InvoiceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: InvoiceError };

export const invoiceOk = <T>(value: T): InvoiceResult<T> => ({ ok: true, value });
export const refused = (error: InvoiceError): { readonly ok: false; readonly error: InvoiceError } =>
  Object.freeze({ ok: false, error } as const);
export const INVOICES_DISABLED = refused("invoices_disabled");
export const INVALID = refused("invalid");
export const FAILED = refused("error");

/** A reader's read failed. Thrown, never a silent null, so 07 can't mistake an outage for "no invoice" (plan step 9). */
export class InvoiceReadError extends Error {
  constructor(readonly what: string) {
    super(`invoice read failed: ${what}`);
    this.name = "InvoiceReadError";
  }
}
