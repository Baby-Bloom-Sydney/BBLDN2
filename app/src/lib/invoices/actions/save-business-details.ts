"use server";

/**
 * Save her business details for invoices (plan 06 §14.6 b3.1; brief §0a B): the Settings Business section's one write.
 * Changes apply to future invoices only — a sent invoice keeps its own snapshot (amendment 21).
 *
 * Contract: the switch first (off → `invoices_disabled`, before the session or any client is read); then her proof
 * from the request's session (`proveNanny`, never an id from the client; none → `signed_out`); then the store, which
 * parses the input again (`validation-business.ts`) and calls `nanny_business_details_save` under her lock. A refusal
 * answers its code and a plain message (`messages.ts`). Nothing she typed is logged (the store logs codes only).
 *
 * Only this async function is exported: every async export of a `"use server"` file is callable from a browser.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */

import { nannyInvoicesEnabled } from "@/lib/features/flags";
import { proveNanny } from "../nanny-proof";
import { saveBusiness } from "../store-business";
import { actionRefusal, type BusinessSaveResult } from "./messages";

export async function saveBusinessDetails(input: unknown): Promise<BusinessSaveResult> {
  if (!nannyInvoicesEnabled()) return actionRefusal("invoices_disabled");
  const proof = await proveNanny();
  if (!proof) return actionRefusal("signed_out");
  const saved = await saveBusiness(proof, input);
  return saved.ok ? { ok: true, changed: saved.value.changed } : actionRefusal(saved.error);
}
