/**
 * Invoice numbers (brief §11 Q4). The database allocates the per-nanny sequence under a lock (amendment 21's
 * `nanny_invoice_create`); this only prints it: 1 → "INV-0001", 10000 → "INV-10000".
 *
 * BB-wave1-041126/06a-build, 2026-11-04.
 */

import { INVOICE_RULES } from "@/config/invoices";

export function invoiceNumber(seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) throw new RangeError("not an invoice sequence");
  return `${INVOICE_RULES.numberPrefix}${String(seq).padStart(INVOICE_RULES.numberPad, "0")}`;
}
