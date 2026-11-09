/**
 * What the Settings Business action answers (plan 06 §14.6 b3.1; ledger B06 §9.1 R1, R5): its reply shape and one
 * plain, fixed message per refusal — never the database's words and never what she typed (06b-2 handoff: "a refused
 * name or address gets the plain message, never the database's"). A refusal by field carries each field's message
 * too. Client-safe: the page reads these, and a `"use server"` file can export only async functions, so they live here.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07; BB-wave1-041126/06b3-rework, 2026-11-09 (one page action; stale; fields).
 */

import { EDIT_MESSAGES } from "@/lib/settings/edit-messages";
import type { InvoiceError } from "../types";

/** A refusal code: the store's, plus `signed_out` (no nanny session behind the request). */
export type ActionError = InvoiceError | "signed_out";

export type ActionRefusal = {
  readonly ok: false;
  readonly error: ActionError;
  readonly message: string;
  /** Field → its message, when the page's check refused fields (nothing was written). */
  readonly fields?: Readonly<Record<string, string>>;
  /** Records written before the refusal, each with the version now stored, so the page re-bases (review round 1). */
  readonly saved?: Readonly<Partial<Record<"home" | "business" | "bank", string>>>;
};

/** `saveBusinessSettings`: saved (nothing of hers comes back), or refused. */
export type BusinessSettingsResult = { readonly ok: true } | ActionRefusal;

export const ACTION_MESSAGES = Object.freeze({
  invoices_disabled: "This isn't available right now.",
  signed_out: "Please sign in again, then try once more.",
  invalid: "Please check the details and try again.",
  busy: "Your details are being saved elsewhere — try again in a moment.",
  nanny_inactive: "Your account isn't active, so this can't be saved. Please contact us.",
  stale: EDIT_MESSAGES.stale,
  error: EDIT_MESSAGES.gaveUp,
} as const);

type Known = keyof typeof ACTION_MESSAGES;
const isKnown = (code: ActionError): code is Known => Object.hasOwn(ACTION_MESSAGES, code);

/** A refusal with its plain message; a code these saves don't expect gets the general one. */
export function actionRefusal(error: ActionError): ActionRefusal {
  return Object.freeze({ ok: false, error, message: isKnown(error) ? ACTION_MESSAGES[error] : ACTION_MESSAGES.error });
}

/** The page's check refused fields: "Please check the details marked below." and each field's message. */
export function fieldsRefusal(fields: Readonly<Record<string, string>>): ActionRefusal {
  return Object.freeze({ ok: false, error: "invalid", message: EDIT_MESSAGES.checkMarked, fields });
}
