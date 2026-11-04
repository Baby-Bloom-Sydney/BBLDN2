/**
 * The nanny invoice generator's one entry point for other features (brief 06 §8; plan §7, §12 R18/R21). Brief 07
 * (Balance) and 08 import only from here: the readers below, the shared week helper, and their types.
 *
 * Server-only and deliberately NOT `"use server"` (a static test checks): nothing here is callable from a browser.
 * Every reader takes an `AdminProof` from `proveAdmin()` (`src/lib/calls/admin-proof.ts`), returns `null` / `[]`
 * with the switch off, throws `InvoiceReadError` on a failed read, and never returns bank details, emails, PDF
 * paths or links. Her own details, the store, the PDF and the family list are not exported here: they belong to the
 * nanny's side of this feature only (BAI 2026-11-04, plan R20).
 *
 * BB-wave1-041126/06a-build, 2026-11-04.
 */

export {
  formatFamilySummary,
  getFamilyInvoiceSummary,
  getPlacementWeekHours,
  listFamilyInvoices,
  summarise,
  type FamilyInvoice,
  type FamilyInvoiceSummary,
  type PlacementWeekHours,
  type WeekHoursInvoice,
} from "./readers";
export { InvoiceReadError, type CancelReason, type InvoiceKind, type IssuedStatus } from "./types";
/** 07's first week: `londonWeekStart(placement.start_date)`, the same Monday the nanny's form uses (R21). */
export { londonWeekStart } from "./week";
