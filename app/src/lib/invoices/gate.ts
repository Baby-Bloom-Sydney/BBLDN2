/**
 * The two gates every invoice operation passes before it reads or writes (plan 06 §5; the 04a/02 review lesson):
 * the switch first (`invoices_disabled`), then the proof — a `NannyProof` for her own things, an `AdminProof` for
 * the readers' rows. Anything else is `invalid`. Neither gate reads anything. (06a code review 5: one copy.)
 *
 * BB-wave1-041126/06a-build, 2026-11-04.
 */

import { isAdminProof } from "@/lib/calls/admin-proof";
import { nannyInvoicesEnabled } from "@/lib/features/flags";
import { isNannyProof } from "./nanny-proof";
import { INVALID, INVOICES_DISABLED, type InvoiceResult } from "./types";

/** A refusal, or null to go on. */
export function nannyGate(proof: unknown): InvoiceResult<never> | null {
  if (!nannyInvoicesEnabled()) return INVOICES_DISABLED;
  return isNannyProof(proof) ? null : INVALID;
}

export function adminGate(proof: unknown): InvoiceResult<never> | null {
  if (!nannyInvoicesEnabled()) return INVOICES_DISABLED;
  return isAdminProof(proof) ? null : INVALID;
}
