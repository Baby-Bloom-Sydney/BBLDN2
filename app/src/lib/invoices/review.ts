/**
 * The review (plan 06 §14.6 b4.2; brief §3 nanny 6, §0a A, C; 06b-4 rework, BAI 2026-11-12: no week, no kind): what
 * the preview shows and what Send checks again. Server-only, and deliberately NOT a `"use server"` file (its exports
 * would become browser-callable actions).
 *
 * - **Every figure is the server's:** her lines (already parsed by the draft schema) through `totals.ts` with her
 *   VAT setting from her issuer — never a figure from the client (plan 14.5, X2).
 * - **The family is the server's:** `resolveInvoiceTarget` gives its link (her placement, else her latest trial
 *   connection), the link's kind and the earliest date she can invoice it for — as the database works them out.
 * - **The period** is the earliest to the latest shift date, with no cap; for an invoice of expenses only, London's
 *   today (its send date) for both ends (`invoicePeriodOf`).
 * - `readReview` (the preview): the family (hers, or refused), her issuer (read-only; a null address means the setup
 *   asks for one), the masks only (never the full numbers; none saved means the setup asks), the totals, the period,
 *   a shift dated before the family's earliest allowed date (`too_early`, naming each line — a future date the draft
 *   schema has refused already), the duplicate warning (below), the correction rules (R4: her own cancelled invoice to
 *   the same family, not already corrected), and the daily cap (advisory: the database counts again under her lock).
 *   Nothing is written.
 * - **The duplicate warning:** her live invoices (sent, or still sending) to the same family whose period overlaps
 *   this one on any date — both periods inclusive, whatever each links to. An invoice of expenses only overlaps
 *   one whose period covers its send date.
 * - `reviewKey` seals what she reviewed — her lines and correction, the family's link and its kind, the period, who
 *   she is on it, VAT, the account its PDF will name and every figure — as a hash; `checkSend` works it out again at
 *   Send from the family's link, her issuer and her full bank details, so any change since (another tab, the setup,
 *   a hire made after a trial, midnight for an invoice of expenses only) answers `changed` before anything is
 *   created. The database checks the total once more, under her lock (`p_expected_total_pence`).
 * - Refusals are closed codes; reads log by code only (the store's `db.ts`).
 *
 * BB-wave1-041126/06b4, 2026-11-12; BB-wave1-041126/06b4-server, 2026-11-12.
 */

import { createHash, randomUUID } from "node:crypto";
import { INVOICE_RULES } from "@/config/invoices";
import { londonToday } from "@/lib/timezone";
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
import { FAILED, invoiceOk, refused, type InvoiceKind, type InvoiceResult } from "./types";
import { invoicePeriodOf, type InvoiceDraft, type InvoiceLine, type InvoicePeriod } from "./validation-lines";

export interface ReviewFacts {
  readonly target: InvoiceTarget;
  readonly issuer: Issuer;
  /** Null when she has no bank details saved. */
  readonly masks: MaskedPaymentDetails | null;
  readonly totals: InvoiceTotals;
  readonly period: InvoicePeriod;
  readonly key: string;
  readonly duplicates: readonly InvoiceRef[];
  readonly replaces: InvoiceRef | null;
}

/** What the review sealed, sent back with Send. */
export interface Reviewed {
  readonly totalPence: number;
  readonly reviewKey: string;
}

/** Shifts dated before the family's earliest allowed date: their indexes in the draft's lines. */
export interface TooEarly {
  readonly ok: false;
  readonly error: "too_early";
  readonly lines: readonly number[];
}

/** A review's answer: its facts, a closed refusal, or the lines dated too early. */
export type ReviewResult<T> = InvoiceResult<T> | TooEarly;

/** The family's link, as sealed: her placement or connection id and its type. */
export interface ReviewLink {
  readonly targetId: string;
  readonly kind: InvoiceKind;
}

/** An invoice id for a new review: the database treats the same id again as the same invoice (never a second send). */
export const newInvoiceId = (): string => randomUUID();

type DraftCore = Omit<InvoiceDraft, "invoiceId">;

/**
 * The hash of what she reviewed. The invoice id, the id she picked the family by (any of hers resolves to its link)
 * and her business details' version don't count; what prints, and where it goes, does.
 */
export function reviewKey(facts: {
  readonly draft: DraftCore;
  readonly link: ReviewLink;
  readonly period: InvoicePeriod;
  readonly issuer: Issuer;
  readonly accountLast4: string | null;
  readonly totals: InvoiceTotals;
}): string {
  const { draft: d, link, period, issuer: i, totals: t } = facts;
  const lines = d.lines.map((l) =>
    l.kind === "shift" ? ["shift", l.date, l.hours, l.ratePence, l.description] : ["expense", l.expenseType, l.amountPence, l.description]);
  const sealed = [
    link.targetId, link.kind, period.start, period.end, d.replacesInvoiceId, lines,
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

/** Pure: the indexes of the shifts dated before `earliest` (the family's first allowed date). */
export function tooEarlyLines(lines: readonly InvoiceLine[], earliest: string): readonly number[] {
  return lines.flatMap((l, i) => (l.kind === "shift" && l.date < earliest ? [i] : []));
}

const tooEarly = (lines: readonly number[]): TooEarly => Object.freeze({ ok: false, error: "too_early", lines: Object.freeze([...lines]) });
const ref = (i: MyInvoice): InvoiceRef => ({ invoiceId: i.invoiceId, number: i.number });
const isLive = (i: MyInvoice, now: Date): boolean => {
  const shown = shownStatus(i, now);
  return shown === "sent" || shown === "sending";
};

/** Her live invoices to this family whose period overlaps this one on any date (both inclusive). */
function duplicatesOf(mine: readonly MyInvoice[], period: InvoicePeriod, parentUserId: string, now: Date): readonly InvoiceRef[] {
  return mine
    .filter((i) => i.parentUserId === parentUserId && i.periodStart <= period.end && i.periodEnd >= period.start && isLive(i, now))
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

interface Reads {
  readonly target: InvoiceTarget;
  readonly issuer: Issuer;
  readonly masks: MaskedPaymentDetails | null;
  readonly mine: readonly MyInvoice[];
  readonly todayCount: number;
}

async function readAll(proof: NannyProof, draft: DraftCore, now: Date): Promise<InvoiceResult<Reads>> {
  const [target, issuer, masks, mine, today] = await Promise.all([
    resolveInvoiceTarget(proof, draft.targetId, now),
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
export async function readReview(proof: NannyProof, draft: InvoiceDraft, now: Date): Promise<ReviewResult<ReviewFacts>> {
  const gate = nannyGate(proof);
  if (gate) return gate;
  const reads = await readAll(proof, draft, now);
  if (!reads.ok) return reads;
  const { target, issuer, masks, mine, todayCount } = reads.value;
  const early = tooEarlyLines(draft.lines, target.earliest);
  if (early.length > 0) return tooEarly(early);
  if (todayCount >= INVOICE_RULES.dailySendCap) return refused("cap");
  if (issuer.tradingName === null) return refused("no_contact");
  const replaces = replacesOf(mine, draft, target.parentUserId, now);
  if (!replaces.ok) return replaces;
  const totals = totalsOf(draft, issuer);
  if (!totals.ok) return totals;
  const period = invoicePeriodOf(draft.lines, londonToday(now));
  const link = { targetId: target.targetId, kind: target.kind };
  return invoiceOk({
    target,
    issuer,
    masks,
    totals: totals.value,
    period,
    key: reviewKey({ draft, link, period, issuer, accountLast4: masks?.accountLast4 ?? null, totals: totals.value }),
    duplicates: duplicatesOf(mine, period, target.parentUserId, now),
    replaces: replaces.value,
  });
}

/** What Send needs once the check passes: who she is, her full bank details (the PDF), and the family's link. */
export interface SendFacts {
  readonly issuer: Issuer;
  readonly details: StoredPaymentDetails;
  readonly target: InvoiceTarget;
}

/**
 * Send's check, before anything is created: the family's link, her issuer and full bank details now (the PDF needs
 * both), no shift before the family's earliest allowed date, and what she reviewed still what it would be — the
 * server's total and the review key (the link and the period included). `no_details`, `no_address`, `no_contact`
 * send her back to the setup or Settings; `changed` back to the review; `too_early` to the dates.
 */
export async function checkSend(proof: NannyProof, draft: InvoiceDraft, reviewed: Reviewed, now: Date): Promise<ReviewResult<SendFacts>> {
  const gate = nannyGate(proof);
  if (gate) return gate;
  const [target, issuer, details] = await Promise.all([
    resolveInvoiceTarget(proof, draft.targetId, now), readIssuer(proof), readFullDetailsForInvoicePdf(proof),
  ]);
  if (!target.ok) return target;
  if (!issuer.ok) return issuer;
  if (!details.ok) return details;
  const early = tooEarlyLines(draft.lines, target.value.earliest);
  if (early.length > 0) return tooEarly(early);
  if (details.value === null) return refused("no_details");
  if (issuer.value.address === null) return refused("no_address");
  if (issuer.value.tradingName === null) return refused("no_contact");
  const totals = totalsOf(draft, issuer.value);
  if (!totals.ok) return totals;
  const link = { targetId: target.value.targetId, kind: target.value.kind };
  const period = invoicePeriodOf(draft.lines, londonToday(now));
  const key = reviewKey({ draft, link, period, issuer: issuer.value, accountLast4: details.value.accountLast4, totals: totals.value });
  if (totals.value.totalPence !== reviewed.totalPence || key !== reviewed.reviewKey) return refused("changed");
  return invoiceOk({ issuer: issuer.value, details: details.value, target: target.value });
}
