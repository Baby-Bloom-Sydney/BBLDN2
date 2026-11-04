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
 * BB-wave1-041126/06a-build, 2026-11-04.
 */

import { NO_PENCE } from "@/config/invoices";
import { isAdminProof, type AdminProof } from "@/lib/calls/admin-proof";
import { nannyInvoicesEnabled } from "@/lib/features/flags";
import { formatHours, formatInvoiceMoney } from "./money";
import { invoiceNumber } from "./numbering";
import { readFamilyRows, readPlacementWeekRows, type FamilyRow } from "./store";
import { InvoiceReadError, type CancelReason, type InvoiceKind, type InvoiceResult, type IssuedStatus } from "./types";
import { isLondonMonday } from "./week";

export interface WeekHoursInvoice {
  readonly invoiceId: string;
  readonly number: string; // "INV-0003"
  readonly nannyName: string;
  readonly hours: number; // 0.5 steps
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
  readonly kind: InvoiceKind;
  readonly periodStart: string;
  readonly hours: number;
  readonly ratePence: number;
  readonly totalPence: number;
  readonly status: IssuedStatus;
  readonly sentAt: string;
  readonly cancelledAt: string | null;
  readonly cancelReason: CancelReason | null;
  readonly replacesNumber: string | null;
  readonly replacedByNumber: string | null;
}

/** R18 / R21: all invoices that went out, the live ones, the cancelled ones; hours and total of the live ones. */
export interface FamilyInvoiceSummary {
  readonly invoiceCount: number;
  readonly activeCount: number;
  readonly cancelledCount: number;
  readonly hours: number;
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

/** The hours on one placement's live Regular-week invoices for one London week; null when there are none. */
export async function getPlacementWeekHours(proof: AdminProof, placementId: string, weekStart: string): Promise<PlacementWeekHours | null> {
  if (!nannyInvoicesEnabled()) return null;
  requireProof(proof);
  if (!isLondonMonday(weekStart)) throw new TypeError("weekStart must be a London Monday (londonWeekStart)");
  const rows = rowsOf("placement week hours", await readPlacementWeekRows(proof, placementId, weekStart));
  if (rows.length === 0) return null;
  const invoices = rows.map((r): WeekHoursInvoice => ({ invoiceId: r.invoiceId, number: invoiceNumber(r.seq), nannyName: r.nannyName, hours: r.hours }));
  const latest = rows.reduce((a, b) => (b.seq > a.seq ? b : a));
  return {
    hours: rows.reduce((sum, r) => sum + r.hours, 0),
    invoiceId: latest.invoiceId,
    number: invoiceNumber(latest.seq),
    invoices,
  };
}

function toFamilyInvoices(rows: readonly FamilyRow[]): FamilyInvoice[] {
  const numberOf = new Map(rows.map((r) => [r.invoiceId, invoiceNumber(r.seq)]));
  const replacedBy = new Map(rows.flatMap((r) => (r.replacesInvoiceId ? [[r.replacesInvoiceId, invoiceNumber(r.seq)] as const] : [])));
  return rows
    .map((r): FamilyInvoice => ({
      invoiceId: r.invoiceId,
      number: invoiceNumber(r.seq),
      nannyId: r.nannyId,
      nannyName: r.nannyName,
      kind: r.kind,
      periodStart: r.periodStart,
      hours: r.hours,
      ratePence: r.ratePence,
      totalPence: r.totalPence,
      status: r.status,
      sentAt: r.sentAt,
      cancelledAt: r.cancelledAt,
      cancelReason: r.cancelReason,
      replacesNumber: r.replacesInvoiceId ? numberOf.get(r.replacesInvoiceId) ?? null : null,
      replacedByNumber: replacedBy.get(r.invoiceId) ?? null,
    }))
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt) || b.invoiceId.localeCompare(a.invoiceId));
}

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
