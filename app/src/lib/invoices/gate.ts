/**
 * The two gates every invoice operation passes before it reads or writes (plan 06 §5; the 04a/02 review lesson):
 * the switch first (`invoices_disabled`), then the proof — a `NannyProof` for her own things, an `AdminProof` for
 * the readers' rows, an `InvoiceCronProof` for the Friday reminder's run (06b-5, plan §16.7 b5.2). Anything else is
 * `invalid`. No gate reads anything. (06a code review 5: one copy.)
 *
 * BB-wave1-041126/06a-build, 2026-11-04; BB-wave1-041126/06b5-app, 2026-11-23 (`cronGate`).
 */

import { isAdminProof } from "@/lib/calls/admin-proof";
import { nannyInvoicesEnabled } from "@/lib/features/flags";
import { isInvoiceCronProof } from "./cron-proof";
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

export function cronGate(proof: unknown): InvoiceResult<never> | null {
  if (!nannyInvoicesEnabled()) return INVOICES_DISABLED;
  return isInvoiceCronProof(proof) ? null : INVALID;
}
