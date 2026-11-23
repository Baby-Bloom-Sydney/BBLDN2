/**
 * The readers brief 07 (Balance) and 08 use — plan 06 §7 as made final by §12 R18/R21; brief §0.12, §8, §9.15.
 * Server-only, never `"use server"` (so never callable from a browser). Reached only through `./index`.
 *
 * - **An admin proof first** (`proveAdmin()`, `src/lib/calls/admin-proof.ts` — the 04a/02 review lesson): 07 reads
 *   on BAI's bill panel. A missing proof is a programming error and throws a TypeError, as a non-Monday week does.
 * - **Switch off:** `null` (week hours), `[]` (R18) or an all-zero summary (R21 types it non-null), before any
 *   check or read; 07 then asks BAI for the hours by hand.
 * - **What counts** (R1): only invoices that went out with a PDF. Cancelled ones are listed (marked) but never
 *   counted; failed and still-sending ones never appear.
 * - **Never returned:** bank details, emails, PDF paths or links. Hours and rates are not capped here: 07 applies
 *   the 37.5-hour cap and the flat rate.
 * - A read failure throws `InvoiceReadError` — never a silent null that 07 could mistake for "no invoice".
 *
 * 06b-2 (plan 14.7): an invoice is a header plus lines. A family's invoice carries its childcare, expenses and VAT;
 * `totalPence` is the whole total; `ratePence` is null when its shifts' rates differ. The issuer snapshot is not
 * returned (07 doesn't need it).
 *
 * 06b-4 rework (spec j; BAI 2026-11-12: an invoice is any set of dated shifts, over any period): `getPlacementWeekHours`
 * keeps its signature. A week's hours are the shift lines of the live invoices linked to that placement, dated in that
 * London Monday–Sunday and on or after the placement's start — so a two-week or monthly invoice counts in each week by
 * its own dates, and a trial day before the start, expenses and invoices linked to a trial connection add nothing. An
 * invoice with no such line is not listed. A family's invoice carries its period's end.
 *
 * 06c (plan 06 step 17, §14.6 c.1): `listAdminInvoices`, BAI's read-only `/admin/invoices` — every family's invoices that
 * went out, under the same rules, adding the family's name, the VAT mode and the email deliveries (never an address).
 * Its per-family summary is this module's `summarise()`, the one 07 reads.
 *
 * BB-wave1-041126/06a-build, 2026-11-04; BB-wave1-041126/06b2-build, 2026-11-06; BB-wave1-041126/06b4-server, 2026-11-12;
 * BB-wave1-041126/06c, 2026-11-23.
 */

import { NO_PENCE } from "@/config/invoices";
import { isAdminProof, type AdminProof } from "@/lib/calls/admin-proof";
import { nannyInvoicesEnabled } from "@/lib/features/flags";
import { formatHours, formatInvoiceMoney } from "./money";
import { readFamilyRows, readPlacementWeekRows, type FamilyRow } from "./store";
import { readAdminInvoiceRows, type InvoiceDeliveries } from "./store-admin";
import { InvoiceReadError, type CancelReason, type InvoiceKind, type InvoiceResult, type IssuedStatus, type VatMode } from "./types";
import { isLondonMonday } from "./week";

export interface WeekHoursInvoice {
  readonly invoiceId: string;
  readonly number: string; // "BB-SophieTaylor-270215-0003", as stored at insert
  readonly nannyName: string;
  readonly hours: number; // quarter-hour steps: the invoice's shifts dated in that week, from the placement's start
}

/**
 * R21's `{ hours, invoiceId, number }` plus `invoices`. `hours` is the sum of every live invoice for the week (brief
 * §11 Q9); `invoiceId` / `number` name the LATEST of them only — when `invoices` has more than one, 07 must show
 * them all (brief 07 §5: "the panel lists both"), never "N h from <latest>".
 */
export interface PlacementWeekHours {
  readonly hours: number;
  readonly invoiceId: string;
  readonly number: string;
  readonly invoices: readonly WeekHoursInvoice[];
}

export interface FamilyInvoice {
  readonly invoiceId: string;
  readonly number: string;
  readonly nannyId: string;
  readonly nannyName: string;
  /** The link's type: `regular_week` for a placement, `trial_shift` for a connection (derived, never chosen). */
  readonly kind: InvoiceKind;
  /** The period: its first and last shift dates (for an invoice of expenses only, its send date both times). */
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly hours: number;
  /** The single hourly rate when every shift on the invoice has it; null when the rates differ (14.7). */
  readonly ratePence: number | null;
  /** The childcare subtotal (VAT inside it when she includes VAT). */
  readonly shiftsPence: number;
  /** Reimbursed expenses: never a line on the family's BabyBloom bill (brief §0a A). */
  readonly expensesPence: number;
  readonly vatPence: number;
  /** The invoice's total: childcare, any VAT on top, and expenses. */
  readonly totalPence: number;
  readonly status: IssuedStatus;
  readonly sentAt: string;
  readonly cancelledAt: string | null;
  readonly cancelReason: CancelReason | null;
  readonly replacesNumber: string | null;
  readonly replacedByNumber: string | null;
}

/** One invoice on BAI's read-only list (06c): a family's invoice, with the family, its VAT mode and its deliveries. */
export interface AdminInvoice extends FamilyInvoice {
  readonly parentUserId: string;
  readonly familyName: string;
  readonly vatMode: VatMode;
  /** Each email's delivery, both recipients (brief §3 admin 2); never an address. */
  readonly delivery: InvoiceDeliveries;
}

/** R18 / R21: all invoices that went out, the live ones, the cancelled ones; hours and total of the live ones. */
export interface FamilyInvoiceSummary {
  readonly invoiceCount: number;
  readonly activeCount: number;
  readonly cancelledCount: number;
  /** The live invoices' hours, whatever they link to (07 reads a week's hours from `getPlacementWeekHours`). */
  readonly hours: number;
  /**
   * What the family was invoiced by her, in total (14.7): childcare, any VAT added on top, and her expenses. Not a
   * BabyBloom amount and never a line on the family's BabyBloom bill — expenses are hers to reclaim (brief §0a A).
   */
  readonly totalPence: number;
}

function requireProof(proof: AdminProof): void {
  if (!isAdminProof(proof)) throw new TypeError("an admin proof is required (proveAdmin)");
}

/** A store result's rows, or a throw: `invalid` is the caller's mistake, anything else a failed read. */
function rowsOf<T>(what: string, result: InvoiceResult<T>): T {
  if (result.ok) return result.value;
  if (result.error === "invalid") throw new TypeError(`${what}: invalid input`);
  throw new InvoiceReadError(what);
}

/** The hours of one placement's live invoices' shifts in one London week, from its start; null when there are none. */
export async function getPlacementWeekHours(proof: AdminProof, placementId: string, weekStart: string): Promise<PlacementWeekHours | null> {
  if (!nannyInvoicesEnabled()) return null;
  requireProof(proof);
  if (!isLondonMonday(weekStart)) throw new TypeError("weekStart must be a London Monday (londonWeekStart)");
  const rows = rowsOf("placement week hours", await readPlacementWeekRows(proof, placementId, weekStart));
  if (rows.length === 0) return null;
  const invoices = rows.map((r): WeekHoursInvoice => ({ invoiceId: r.invoiceId, number: r.number, nannyName: r.nannyName, hours: r.hours }));
  const latest = rows.reduce((a, b) => (b.seq > a.seq ? b : a));
  return {
    hours: rows.reduce((sum, r) => sum + r.hours, 0),
    invoiceId: latest.invoiceId,
    number: latest.number,
    invoices,
  };
}

/** Rows as invoices, each with `withMore`'s fields on top; the correction links are read within `rows`; newest first. */
function toInvoices<R extends FamilyRow, T extends FamilyInvoice>(rows: readonly R[], withMore: (invoice: FamilyInvoice, row: R) => T): T[] {
  const numberOf = new Map(rows.map((r) => [r.invoiceId, r.number]));
  const replacedBy = new Map(rows.flatMap((r) => (r.replacesInvoiceId ? [[r.replacesInvoiceId, r.number] as const] : [])));
  return rows
    .map((r) => withMore({
      invoiceId: r.invoiceId,
      number: r.number,
      nannyId: r.nannyId,
      nannyName: r.nannyName,
      kind: r.kind,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      hours: r.hours,
      ratePence: r.ratePence,
      shiftsPence: r.shiftsPence,
      expensesPence: r.expensesPence,
      vatPence: r.vatPence,
      totalPence: r.totalPence,
      status: r.status,
      sentAt: r.sentAt,
      cancelledAt: r.cancelledAt,
      cancelReason: r.cancelReason,
      replacesNumber: r.replacesInvoiceId ? numberOf.get(r.replacesInvoiceId) ?? null : null,
      replacedByNumber: replacedBy.get(r.invoiceId) ?? null,
    }, r))
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt) || b.invoiceId.localeCompare(a.invoiceId));
}

const toFamilyInvoices = (rows: readonly FamilyRow[]): FamilyInvoice[] => toInvoices(rows, (invoice) => invoice);

/** Every invoice that went out to one family (cancelled ones marked), newest first. [] with the switch off (R18). */
export async function listFamilyInvoices(proof: AdminProof, parentUserId: string): Promise<readonly FamilyInvoice[]> {
  if (!nannyInvoicesEnabled()) return [];
  requireProof(proof);
  return toFamilyInvoices(rowsOf("family invoices", await readFamilyRows(proof, parentUserId)));
}

/** Pure: the counts, and the hours and total of the live (non-cancelled) invoices. Seeds from config's zero (R10). */
export function summarise(invoices: readonly FamilyInvoice[]): FamilyInvoiceSummary {
  const live = invoices.filter((i) => i.status === "sent");
  return {
    invoiceCount: invoices.length,
    activeCount: live.length,
    cancelledCount: invoices.filter((i) => i.status === "cancelled").length,
    hours: live.reduce((sum, i) => sum + i.hours, 0),
    totalPence: live.reduce((sum, i) => sum + i.totalPence, NO_PENCE),
  };
}

/** "2 invoices · 1 cancelled · 28 h · <live total>" — the summary line of brief §0.11 (worked example in the test). */
export function formatFamilySummary(s: FamilyInvoiceSummary): string {
  const invoices = `${s.invoiceCount} ${s.invoiceCount === 1 ? "invoice" : "invoices"}`;
  return `${invoices} · ${s.cancelledCount} cancelled · ${formatHours(s.hours)} h · ${formatInvoiceMoney(s.totalPence)}`;
}

/** One family's summary (R21: never null); all zeros with the switch off, with nothing read. */
export async function getFamilyInvoiceSummary(proof: AdminProof, parentUserId: string): Promise<FamilyInvoiceSummary> {
  if (!nannyInvoicesEnabled()) return summarise([]);
  return summarise(await listFamilyInvoices(proof, parentUserId));
}

/**
 * BAI's read-only `/admin/invoices` (06c, plan 06 step 17): every invoice that went out, to any family, newest sent
 * first — the newest `INVOICE_RULES.adminListLimit` — each a family's invoice with the family's name, the VAT mode and
 * both recipients' deliveries. A family's summary is `summarise()` over its invoices here. [] with the switch off.
 */
export async function listAdminInvoices(proof: AdminProof): Promise<readonly AdminInvoice[]> {
  if (!nannyInvoicesEnabled()) return [];
  requireProof(proof);
  return toInvoices(rowsOf("admin invoices", await readAdminInvoiceRows(proof)), (invoice, r): AdminInvoice => ({
    ...invoice,
    parentUserId: r.parentUserId,
    familyName: r.familyName,
    vatMode: r.vatMode,
    delivery: r.delivery,
  }));
}
