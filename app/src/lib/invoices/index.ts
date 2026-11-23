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
 * 06b-4 rework (spec j): `getPlacementWeekHours` keeps its signature; a week's hours are the shift lines of the
 * placement's live invoices dated in that London Monday–Sunday, on or after its start. `FamilyInvoice` carries its
 * period's end.
 *
 * 06b-5 (plan §16.7 b5.6): the cron route's two — `proveInvoiceCron`, the proof made only from the request's cron
 * secret, and `runInvoiceReminders`, the Friday reminder's run, which takes it.
 *
 * BB-wave1-041126/06a-build, 2026-11-04; BB-wave1-041126/06b4-server, 2026-11-12; BB-wave1-041126/06b5-app, 2026-11-23.
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
/** 07's weeks: `londonWeekStart(date)`, the one clock's Monday, as `getPlacementWeekHours` expects (R21). */
export { londonWeekStart } from "./week";
/** The Friday invoice reminder (06b-5): the cron route proves the request, then runs it. */
export { runInvoiceReminders } from "./reminders";
export { proveInvoiceCron } from "./cron-proof";
