/**
 * The nanny invoice generator's shared types and result shapes (brief 06; plan `BUILD/plans/06-plan.md`, §14).
 * Client-safe: no I/O here.
 *
 * BB-wave1-041126/06a-build, 2026-11-04; BB-wave1-041126/06b2-build, 2026-11-06 (lines, VAT, business types).
 */

import { BUSINESS_TYPES, EXPENSE_TYPES } from "@/config/invoices";

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

/** An invoice is a header plus lines (plan 14.1): shifts and expenses, in the order she entered them. */
export const LINE_KINDS = ["shift", "expense"] as const;
export type LineKind = (typeof LINE_KINDS)[number];

/** The expense types and business types, from config (their labels live there too). */
export type ExpenseType = keyof typeof EXPENSE_TYPES;
export const EXPENSE_TYPE_KEYS = Object.freeze(Object.keys(EXPENSE_TYPES)) as readonly ExpenseType[];
export type BusinessType = keyof typeof BUSINESS_TYPES;
export const BUSINESS_TYPE_KEYS = Object.freeze(Object.keys(BUSINESS_TYPES)) as readonly BusinessType[];

/** VAT (brief §0a B): not registered; included in her rates (the family pays the agreed rate); added on top. */
export const VAT_MODES = ["none", "included", "added"] as const;
export type VatMode = (typeof VAT_MODES)[number];

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
  | "no_address" // no address she can print: no street line and postcode in her profile, and not a limited company with its registered office (06b-3 rework)
  | "bad_lines" // a shift or expense line the database refused (counts, steps, ceilings, dates, a day's hours)
  | "changed" // her settings changed since the review, so the total isn't the one she saw (plan 14.4, X6)
  | "stale" // a Settings save carried an older version of the record than the one stored: nothing written (06b-3 rework)
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
