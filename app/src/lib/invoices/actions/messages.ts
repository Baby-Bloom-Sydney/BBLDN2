/**
 * What the Settings actions answer (plan 06 §14.6 b3.1): their reply shapes and one plain, fixed message per refusal
 * — never the database's words and never what she typed (06b-2 handoff: "a refused name or address gets the plain
 * message, never the database's"). Client-safe: the forms read these types, and a `"use server"` file can export
 * only async functions, so they live here.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */

import type { DetailMasks } from "../masking";
import type { InvoiceError } from "../types";

/** A refusal code: the store's, plus `signed_out` (no nanny session behind the request). */
export type ActionError = InvoiceError | "signed_out";

export type ActionRefusal = { readonly ok: false; readonly error: ActionError; readonly message: string };

/** `saveBusinessDetails`: saved (and whether anything changed), or refused. */
export type BusinessSaveResult = { readonly ok: true; readonly changed: boolean } | ActionRefusal;

/** `savePaymentDetails`: saved, with the masks only (brief §0.2), or refused. */
export type PaymentSaveResult = { readonly ok: true; readonly masks: DetailMasks } | ActionRefusal;

export const ACTION_MESSAGES = Object.freeze({
  invoices_disabled: "This isn't available right now.",
  signed_out: "Please sign in again, then try once more.",
  invalid: "Please check the details and try again.",
  busy: "Your details are being saved elsewhere — try again in a moment.",
  nanny_inactive: "Your account isn't active, so this can't be saved. Please contact us.",
  error: "We couldn't save that. Please try again.",
} as const);

type Known = keyof typeof ACTION_MESSAGES;
const isKnown = (code: ActionError): code is Known => Object.hasOwn(ACTION_MESSAGES, code);

/** A refusal with its plain message; a code these saves don't expect gets the general one. */
export function actionRefusal(error: ActionError): ActionRefusal {
  return Object.freeze({ ok: false, error, message: isKnown(error) ? ACTION_MESSAGES[error] : ACTION_MESSAGES.error });
}
