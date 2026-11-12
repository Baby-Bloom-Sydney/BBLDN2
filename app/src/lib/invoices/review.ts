/**
 * The review (plan 06 §14.6 b4.2; brief §3 nanny 6, §0a A, C): what the preview shows and what Send checks again.
 * Server-only, and deliberately NOT a `"use server"` file (its exports would become browser-callable actions).
 *
 * - **Every figure is the server's:** her lines (already parsed by the draft schema) through `totals.ts` with her
 *   VAT setting from her issuer — never a figure from the client (plan 14.5, X2).
 * - `readReview` (the preview): the family through `resolveInvoiceTarget` (hers, or refused), her issuer (read-only;
 *   a null address means the setup asks for one), the masks only (never the full numbers; none saved means the
 *   setup asks), the totals, the duplicate warning (her live invoices to the same family for the same week or Trial
 *   Shift date, brief §3 nanny 6), the correction rules (R4: her own cancelled invoice to the same family, not
 *   already corrected), the daily cap (advisory: the database counts again under her lock), and a Trial Shift on its
 *   trial date. Nothing is written.
 * - `reviewKey` seals what she reviewed — the draft, who she is on it, VAT, the account its PDF will name and every
 *   figure — as a hash; `checkSend` works it out again at Send from her issuer and her full bank details, so any
 *   change since (another tab, the setup) answers `changed` before anything is created (06b-2 handoff L2: the
 *   total alone can't see a trading name or a VAT mode that changed at the same total). The database checks the
 *   total once more, under her lock (`p_expected_total_pence`).
 * - Refusals are closed codes; reads log by code only (the store's `db.ts`).
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { createHash, randomUUID } from "node:crypto";
import { INVOICE_RULES } from "@/config/invoices";
import type { InvoiceRef } from "./actions/invoice-messages";
import { logFailure } from "./db";
import { resolveInvoiceTarget, type InvoiceTarget } from "./families";
import { nannyGate } from "./gate";
import type { NannyProof } from "./nanny-proof";
import { shownStatus } from "./status";
import { countTowardsDailyCap, readFullDetailsForInvoicePdf, readMaskedDetails, readMyInvoices } from "./store";
import { readIssuer } from "./store-business";
import type { MaskedPaymentDetails, StoredPaymentDetails } from "./store-map";
import type { Issuer, MyInvoice } from "./store-map-lines";
import { invoiceTotals, type InvoiceTotals } from "./totals";
import { FAILED, invoiceOk, refused, type InvoiceResult } from "./types";
import type { InvoiceDraft } from "./validation-lines";

export interface ReviewFacts {
  readonly target: InvoiceTarget;
  readonly issuer: Issuer;
  /** Null when she has no bank details saved. */
  readonly masks: MaskedPaymentDetails | null;
  readonly totals: InvoiceTotals;
  readonly key: string;
  readonly duplicates: readonly InvoiceRef[];
  readonly replaces: InvoiceRef | null;
}

/** What the review sealed, sent back with Send. */
export interface Reviewed {
  readonly totalPence: number;
  readonly reviewKey: string;
}

/** An invoice id for a new review: the database treats the same id again as the same invoice (never a second send). */
export const newInvoiceId = (): string => randomUUID();

type DraftCore = Omit<InvoiceDraft, "invoiceId">;

/** The hash of what she reviewed. The invoice id and her business details' version don't count; what prints does. */
export function reviewKey(facts: {
  readonly draft: DraftCore;
  readonly issuer: Issuer;
  readonly accountLast4: string | null;
  readonly totals: InvoiceTotals;
}): string {
  const { draft: d, issuer: i, totals: t } = facts;
  const lines = d.lines.map((l) =>
    l.kind === "shift" ? ["shift", l.date, l.hours, l.ratePence, l.description] : ["expense", l.expenseType, l.amountPence, l.description]);
  const sealed = [
    d.kind, d.targetId, d.periodStart, d.replacesInvoiceId, lines,
    i.businessType, i.name, i.tradingName, i.address, i.companyName, i.companyNumber, i.registeredOffice, i.partnershipName,
    i.vat.mode, i.vat.rateBp, i.vat.number, facts.accountLast4,
    t.hours, t.shiftsPence, t.expensesPence, t.vatPence, t.totalPence,
  ];
  return createHash("sha256").update(JSON.stringify(sealed)).digest("hex");
}

/** The server's figures for her lines and VAT; `error` when they can't be worked out (logged by code). */
function totalsOf(draft: DraftCore, issuer: Issuer): InvoiceResult<InvoiceTotals> {
  try {
    return invoiceOk(invoiceTotals(draft.lines, { mode: issuer.vat.mode, rateBp: issuer.vat.rateBp }));
  } catch (thrown) {
    logFailure("review totals", thrown);
    return FAILED;
  }
}

const ref = (i: MyInvoice): InvoiceRef => ({ invoiceId: i.invoiceId, number: i.number });
const isLive = (i: MyInvoice, now: Date): boolean => {
  const shown = shownStatus(i, now);
  return shown === "sent" || shown === "sending";
};

/** Her live invoices to this family for the same week or Trial Shift date. */
function duplicatesOf(mine: readonly MyInvoice[], draft: DraftCore, parentUserId: string, now: Date): readonly InvoiceRef[] {
  return mine
    .filter((i) => i.parentUserId === parentUserId && i.kind === draft.kind && i.periodStart === draft.periodStart && isLive(i, now))
    .map(ref);
}

/** R4: her own cancelled invoice to the same family, not already corrected by a live one. */
function replacesOf(mine: readonly MyInvoice[], draft: DraftCore, parentUserId: string, now: Date): InvoiceResult<InvoiceRef | null> {
  if (draft.replacesInvoiceId === null) return invoiceOk(null);
  const old = mine.find((i) => i.invoiceId === draft.replacesInvoiceId);
  if (!old || old.status !== "cancelled" || old.parentUserId !== parentUserId) return refused("bad_replaces");
  const corrected = mine.some((i) => i.replacesInvoiceId === old.invoiceId && shownStatus(i, now) !== "failed");
  return corrected ? refused("already_replaced") : invoiceOk(ref(old));
}

/** A Trial Shift is invoiced on its trial date: the family read's pre-fill row is on it (`trialPrefill`). */
const offTrialDate = (draft: DraftCore, target: InvoiceTarget): boolean =>
  draft.kind === "trial_shift" && target.prefill.shifts[0]?.date !== draft.periodStart;

interface Reads {
  readonly target: InvoiceTarget;
  readonly issuer: Issuer;
  readonly masks: MaskedPaymentDetails | null;
  readonly mine: readonly MyInvoice[];
  readonly todayCount: number;
}

async function readAll(proof: NannyProof, draft: DraftCore, now: Date): Promise<InvoiceResult<Reads>> {
  const week = draft.kind === "regular_week" ? draft.periodStart : null;
  const [target, issuer, masks, mine, today] = await Promise.all([
    resolveInvoiceTarget(proof, draft.kind, draft.targetId, week, now),
    readIssuer(proof),
    readMaskedDetails(proof),
    readMyInvoices(proof),
    countTowardsDailyCap(proof, now),
  ]);
  if (!target.ok) return target;
  if (!issuer.ok) return issuer;
  if (!masks.ok) return masks;
  if (!mine.ok) return mine;
  if (!today.ok) return today;
  return invoiceOk({ target: target.value, issuer: issuer.value, masks: masks.value, mine: mine.value, todayCount: today.value });
}

/** The preview's facts (see the header). */
export async function readReview(proof: NannyProof, draft: InvoiceDraft, now: Date): Promise<InvoiceResult<ReviewFacts>> {
  const gate = nannyGate(proof);
  if (gate) return gate;
  const reads = await readAll(proof, draft, now);
  if (!reads.ok) return reads;
  const { target, issuer, masks, mine, todayCount } = reads.value;
  if (offTrialDate(draft, target)) return refused("wrong_date");
  if (todayCount >= INVOICE_RULES.dailySendCap) return refused("cap");
  if (issuer.tradingName === null) return refused("no_contact");
  const replaces = replacesOf(mine, draft, target.parentUserId, now);
  if (!replaces.ok) return replaces;
  const totals = totalsOf(draft, issuer);
  if (!totals.ok) return totals;
  return invoiceOk({
    target,
    issuer,
    masks,
    totals: totals.value,
    key: reviewKey({ draft, issuer, accountLast4: masks?.accountLast4 ?? null, totals: totals.value }),
    duplicates: duplicatesOf(mine, draft, target.parentUserId, now),
    replaces: replaces.value,
  });
}

/**
 * Send's check, before anything is created: her issuer and full bank details now (the PDF needs both), and what
 * she reviewed still what it would be — the server's total and the review key. `no_details`, `no_address`,
 * `no_contact` send her back to the setup or Settings; `changed` back to the review.
 */
export async function checkSend(
  proof: NannyProof,
  draft: InvoiceDraft,
  reviewed: Reviewed,
): Promise<InvoiceResult<{ readonly issuer: Issuer; readonly details: StoredPaymentDetails }>> {
  const gate = nannyGate(proof);
  if (gate) return gate;
  const [issuer, details] = await Promise.all([readIssuer(proof), readFullDetailsForInvoicePdf(proof)]);
  if (!issuer.ok) return issuer;
  if (!details.ok) return details;
  if (details.value === null) return refused("no_details");
  if (issuer.value.address === null) return refused("no_address");
  if (issuer.value.tradingName === null) return refused("no_contact");
  const totals = totalsOf(draft, issuer.value);
  if (!totals.ok) return totals;
  const key = reviewKey({ draft, issuer: issuer.value, accountLast4: details.value.accountLast4, totals: totals.value });
  if (totals.value.totalPence !== reviewed.totalPence || key !== reviewed.reviewKey) return refused("changed");
  return invoiceOk({ issuer: issuer.value, details: details.value });
}
