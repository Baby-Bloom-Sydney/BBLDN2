/**
 * What the new-invoice page starts from (plan 06 old step 14, §14.3, §14.6 b4.4; §16.7 b5.8). Server-only: it reads
 * through the feature's own server modules (`families.ts`, `store.ts`), each gated and hers by the proof; not a
 * `"use server"` file, so nothing here is callable from a browser.
 *
 * - **The page's parameters** (it owns `?placement=`, `?connection=` and `?replaces=`; the `week` parameter is 06b-5's
 *   and isn't read): a correction first, then a placement (Regular week), then a trial connection (Trial Shift). An id
 *   that isn't one, or a repeated parameter, is ignored — the plain page.
 * - **Her families** for the picker: name, area, the placement a Regular week uses (the first: active, then paused,
 *   then ended), the trial dates. No family id leaves the server.
 * - **A placement:** resolved as hers (`resolveInvoiceTarget`) with *last* week's pre-fill — a week with no future day —
 *   which becomes her usual pattern, so any week she picks starts the same way (`invoice-form.ts`). The weeks: this
 *   one back to the placement's first (at most 26); this week first.
 * - **A trial:** its date, fixed. **A correction** (R4): her own cancelled invoice that no live invoice corrects yet —
 *   its family, kind and period, its lines as the rows and expenses, and "Replaces …".
 * - A refusal (not hers, no trial date …) → the plain page; a failed read → `error` (the page says so).
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { z } from "zod";
import { resolveInvoiceTarget, type InvoiceableFamily, type InvoiceTarget } from "@/lib/invoices/families";
import type { NannyProof } from "@/lib/invoices/nanny-proof";
import { correctionPrefill } from "@/lib/invoices/prefill";
import { shownStatus } from "@/lib/invoices/status";
import { readMyInvoiceLines, readMyInvoices } from "@/lib/invoices/store";
import type { MyInvoice } from "@/lib/invoices/store-map-lines";
import { FAILED, invoiceOk, type InvoiceKind, type InvoiceResult } from "@/lib/invoices/types";
import { addLondonDays, londonMondayOf, londonToday } from "@/lib/timezone";
import { patternOf, poundsOfPence, weekOptions, type ExpenseRowValue, type FamilyOption, type InvoiceTargetView, type PatternShift } from "./invoice-form";

export type { FamilyOption, InvoiceTargetView } from "./invoice-form";

export type TargetRequest = { readonly kind: InvoiceKind; readonly targetId: string } | { readonly replaces: string } | null;

const guid = z.guid();
const one = (value: string | string[] | undefined): string | null =>
  typeof value === "string" && guid.safeParse(value).success ? value : null;

/** The page's request: `?replaces=`, else `?placement=`, else `?connection=`; anything else → null. */
export function targetRequestOf(params: Readonly<Record<string, string | string[] | undefined>> | undefined): TargetRequest {
  const replaces = one(params?.replaces);
  if (replaces) return { replaces };
  const placement = one(params?.placement);
  if (placement) return { kind: "regular_week", targetId: placement };
  const connection = one(params?.connection);
  return connection ? { kind: "trial_shift", targetId: connection } : null;
}

export function familyOptions(families: readonly InvoiceableFamily[]): readonly FamilyOption[] {
  return families.map((f, i) => ({
    key: String(i),
    familyName: f.familyName,
    area: f.area,
    placementId: f.placements[0]?.placementId ?? null,
    trials: f.trials.map((t) => ({ connectionId: t.connectionId, date: t.trialDate })),
  }));
}

const familyIndexOf = (families: readonly InvoiceableFamily[], targetId: string): number =>
  families.findIndex((f) => f.placements.some((p) => p.placementId === targetId) || f.trials.some((t) => t.connectionId === targetId));

interface Start {
  readonly periodStart: string;
  readonly pattern: readonly PatternShift[];
  readonly expenses: readonly ExpenseRowValue[];
  readonly replaces: InvoiceTargetView["replaces"];
}

function viewOf(kind: InvoiceKind, targetId: string, target: InvoiceTarget, families: readonly InvoiceableFamily[], start: Start, now: Date): InvoiceTargetView {
  const index = familyIndexOf(families, targetId);
  const startDate = families[index]?.placements.find((p) => p.placementId === targetId)?.startDate ?? null;
  const today = londonToday(now);
  return {
    kind,
    targetId,
    familyKey: index === -1 ? "" : String(index),
    familyName: target.familyName,
    area: target.area,
    weeks: kind === "regular_week" ? weekOptions({ today, startDate, include: start.replaces ? start.periodStart : null }) : [],
    ...start,
    ratePence: target.prefill.ratePence,
  };
}

/** A refusal is the plain page; a failed read is an error. */
const plainOrFailed = (error: string): InvoiceResult<null> => (error === "error" ? FAILED : invoiceOk(null));

async function placementOrTrial(proof: NannyProof, kind: InvoiceKind, targetId: string, families: readonly InvoiceableFamily[], now: Date) {
  const thisMonday = londonMondayOf(londonToday(now));
  const lastMonday = addLondonDays(thisMonday, -7);
  const resolved = await resolveInvoiceTarget(proof, kind, targetId, kind === "regular_week" ? lastMonday : null, now);
  if (!resolved.ok) return plainOrFailed(resolved.error);
  const trialDate = resolved.value.prefill.shifts[0]?.date;
  if (kind === "trial_shift" && trialDate === undefined) return invoiceOk(null);
  const start = kind === "regular_week"
    ? { periodStart: thisMonday, pattern: patternOf(resolved.value.prefill.shifts, lastMonday) }
    : { periodStart: trialDate ?? "", pattern: patternOf(resolved.value.prefill.shifts, trialDate ?? "") };
  return invoiceOk(viewOf(kind, targetId, resolved.value, families, { ...start, expenses: [], replaces: null }, now));
}

/** Her cancelled invoice that no live invoice corrects yet (R4), else undefined. */
function correctable(mine: readonly MyInvoice[], invoiceId: string, now: Date): MyInvoice | undefined {
  const old = mine.find((i) => i.invoiceId === invoiceId);
  if (!old || old.status !== "cancelled") return undefined;
  return mine.some((i) => i.replacesInvoiceId === old.invoiceId && shownStatus(i, now) !== "failed") ? undefined : old;
}

async function correction(proof: NannyProof, invoiceId: string, families: readonly InvoiceableFamily[], now: Date) {
  const mine = await readMyInvoices(proof);
  if (!mine.ok) return FAILED;
  const old = correctable(mine.value, invoiceId, now);
  const targetId = old?.kind === "regular_week" ? old.placementId : old?.connectionRequestId;
  if (!old || !targetId) return invoiceOk(null);
  const [lines, resolved] = await Promise.all([
    readMyInvoiceLines(proof, old.invoiceId),
    resolveInvoiceTarget(proof, old.kind, targetId, old.kind === "regular_week" ? old.periodStart : null, now),
  ]);
  if (!lines.ok) return plainOrFailed(lines.error);
  if (!resolved.ok) return plainOrFailed(resolved.error);
  const rows = correctionPrefill(lines.value);
  return invoiceOk(viewOf(old.kind, targetId, resolved.value, families, {
    periodStart: old.periodStart,
    pattern: patternOf(rows.shifts, old.periodStart),
    expenses: rows.expenses.map((e) => ({ expenseType: e.expenseType, amount: poundsOfPence(e.amountPence), description: e.description ?? "" })),
    replaces: { invoiceId: old.invoiceId, number: old.number },
  }, now));
}

/** The target the form starts from (null = the plain page), or `error` when a read failed. */
export async function loadTarget(
  proof: NannyProof,
  request: TargetRequest,
  families: readonly InvoiceableFamily[],
  now: Date,
): Promise<InvoiceResult<InvoiceTargetView | null>> {
  if (request === null) return invoiceOk(null);
  if ("replaces" in request) return correction(proof, request.replaces, families, now);
  return placementOrTrial(proof, request.kind, request.targetId, families, now);
}
