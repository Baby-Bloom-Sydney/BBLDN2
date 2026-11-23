/**
 * What the new-invoice page starts from (plan 06 old step 14, §14.3, §14.6 b4.4; §16.7 b5.8; 06b-4 rework, BAI
 * 2026-11-12: one family picker, no week and no kind, the form starts empty). Server-only: it reads through the
 * feature's own server modules (`families.ts`, `store.ts`), each gated and hers by the proof; not a `"use server"`
 * file, so nothing here is callable from a browser.
 *
 * - **The page's parameters** (it owns `?placement=`, `?connection=` and `?replaces=`; the `week` parameter is 06b-5's
 *   and isn't read): a correction first, then any of her ids for a family (`?placement=`, then `?connection=`). An id
 *   that isn't one, or a repeated parameter, is ignored — the plain page.
 * - **Her families** for the picker (`familyOptions`): name, area, the family's link id, its earliest date and its
 *   rate. No family id and no kind leave the server.
 * - **A family's id** — her placement (any, not dismissed) or her trial connection — is resolved as hers
 *   (`resolveInvoiceTarget`), and that family is pre-selected. Nothing is pre-filled: the form starts empty.
 * - **A correction** (R4; ledger reading 8): her own cancelled invoice that no live invoice corrects yet — its family
 *   (resolved from its link, then fixed), its lines with their own dates, its expenses, and "Replaces …".
 * - A refusal (not hers …) or a family no longer in her list → the plain page; a failed read → `error`.
 *
 * BB-wave1-041126/06b4, 2026-11-12; BB-wave1-041126/06b4-ui, 2026-11-12 (rework).
 */

import { z } from "zod";
import { resolveInvoiceTarget, type InvoiceableFamily, type InvoiceTarget } from "@/lib/invoices/families";
import type { NannyProof } from "@/lib/invoices/nanny-proof";
import { correctionPrefill } from "@/lib/invoices/prefill";
import { shownStatus } from "@/lib/invoices/status";
import { readMyInvoiceLines, readMyInvoices } from "@/lib/invoices/store";
import type { MyInvoice } from "@/lib/invoices/store-map-lines";
import { FAILED, invoiceOk, type InvoiceError, type InvoiceResult } from "@/lib/invoices/types";
import { correctionRows, type FamilyOption, type InvoiceTargetView } from "./invoice-form";

export type { FamilyOption, InvoiceTargetView } from "./invoice-form";

export type TargetRequest = { readonly targetId: string } | { readonly replaces: string } | null;

const guid = z.guid();
const one = (value: string | string[] | undefined): string | null =>
  typeof value === "string" && guid.safeParse(value).success ? value : null;

/** The page's request: `?replaces=`, else `?placement=`, else `?connection=`; anything else → null. */
export function targetRequestOf(params: Readonly<Record<string, string | string[] | undefined>> | undefined): TargetRequest {
  const replaces = one(params?.replaces);
  if (replaces) return { replaces };
  const targetId = one(params?.placement) ?? one(params?.connection);
  return targetId ? { targetId } : null;
}

/** Her families as the picker holds them (client-safe: no family id, no kind). */
export function familyOptions(families: readonly InvoiceableFamily[]): readonly FamilyOption[] {
  return families.map((f, i) => ({ key: String(i), familyName: f.familyName, area: f.area, targetId: f.targetId, earliest: f.earliest, ratePence: f.ratePence }));
}

/** A refusal is the plain page; a failed read is an error. */
const plainOrFailed = (error: InvoiceError): InvoiceResult<null> => (error === "error" ? FAILED : invoiceOk(null));

type Start = Omit<InvoiceTargetView, "familyKey">;
const EMPTY: Start = { shifts: [], expenses: [], replaces: null };

/** Open on the resolved family (by its option's key); a refusal, or a family not in her list, is the plain page. */
function familyStart(resolved: InvoiceResult<InvoiceTarget>, families: readonly InvoiceableFamily[], start: Start): InvoiceResult<InvoiceTargetView | null> {
  if (!resolved.ok) return plainOrFailed(resolved.error);
  const index = families.findIndex((f) => f.parentUserId === resolved.value.parentUserId);
  return invoiceOk(index === -1 ? null : { familyKey: String(index), ...start });
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
  const targetId = old?.placementId ?? old?.connectionRequestId;
  if (!old || !targetId) return invoiceOk(null);
  const [lines, resolved] = await Promise.all([readMyInvoiceLines(proof, old.invoiceId), resolveInvoiceTarget(proof, targetId, now)]);
  if (!lines.ok) return plainOrFailed(lines.error);
  const rows = correctionRows(correctionPrefill(lines.value));
  return familyStart(resolved, families, { ...rows, replaces: { invoiceId: old.invoiceId, number: old.number } });
}

/** What the form opens on (null = the plain page), or `error` when a read failed. */
export async function loadTarget(
  proof: NannyProof,
  request: TargetRequest,
  families: readonly InvoiceableFamily[],
  now: Date,
): Promise<InvoiceResult<InvoiceTargetView | null>> {
  if (request === null) return invoiceOk(null);
  if ("replaces" in request) return correction(proof, request.replaces, families, now);
  return familyStart(await resolveInvoiceTarget(proof, request.targetId, now), families, EMPTY);
}
