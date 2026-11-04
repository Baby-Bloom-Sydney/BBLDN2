/**
 * The invoice store (plan 06 step 6; R1) — **the only module that touches `nanny_payment_details` and
 * `nanny_invoices`** (amendment 21). Server-only, and deliberately NOT a `"use server"` file: every async export of
 * one becomes a browser-callable action, and this module reads bank details with the service role.
 *
 * - Every operation checks the switch first (`invoices_disabled`, before a client is even made), then its proof:
 *   a `NannyProof` for her own details and invoices — the nanny id always comes from the proof, never from input —
 *   or an `AdminProof` for the readers' rows. Anything else answers `invalid` before a read.
 * - Screens read the masks only (`readMaskedDetails`); the full numbers come back from one named read,
 *   `readFullDetailsForInvoicePdf`, for her PDF.
 * - Writes go only through amendment 21's functions, which lock per nanny, take the family and the snapshots from
 *   her own placement or trial connection, and never delete (R1).
 * - The readers' rows are what went out, with a PDF (R1), re-checked here whatever the query returned.
 * - Failures are logged by code only (`db.ts`); results are closed codes, nothing is thrown to callers.
 *
 * BB-wave1-041126/06a-build, 2026-11-04.
 */

import { z } from "zod";
import { INVOICE_RULES } from "@/config/invoices";
import { isAdminProof, type AdminProof } from "@/lib/calls/admin-proof";
import { nannyInvoicesEnabled } from "@/lib/features/flags";
import { createAdminClient } from "@/lib/supabase/admin";
import { allPages, callRpc, logFailure, type AdminClient, type DbResult } from "./db";
import { isNannyProof, type NannyProof } from "./nanny-proof";
import { countsAsIssued, countsAsSent } from "./status";
import {
  createdReply,
  FAMILY_COLUMNS,
  familyRow,
  finishedReply,
  FULL_COLUMNS,
  fullRow,
  MASK_COLUMNS,
  maskedRow,
  refusalReply,
  savedReply,
  toFamilyRow,
  toWeekRow,
  WEEK_COLUMNS,
  weekRow,
  type CreatedInvoice,
  type FamilyRow,
  type MaskedPaymentDetails,
  type SavedDetails,
  type StoredPaymentDetails,
  type WeekRow,
} from "./store-map";
import { INVOICES_DISABLED, invoiceOk, refused, type EmailDelivery, type InvoiceResult } from "./types";
import { invoiceDraftSchema, paymentDetailsSchema, VALIDATION_MESSAGES } from "./validation";
import { isLondonMonday, londonDayRange } from "./week";

export type { CreatedInvoice, FamilyRow, MaskedPaymentDetails, SavedDetails, StoredPaymentDetails, WeekRow } from "./store-map";

export type FinishOutcome =
  | { readonly kind: "sent"; readonly family: EmailDelivery; readonly nanny: EmailDelivery }
  | { readonly kind: "failed" };

const ERROR = refused("error");
const INVALID = refused("invalid");
const guid = z.guid();
const delivery = z.enum(["sent", "failed"]);
const finishOutcome = z.union([
  z.object({ kind: z.literal("sent"), family: delivery, nanny: delivery }),
  z.object({ kind: z.literal("failed") }),
]);

/** The switch, then the proof: a refusal, or null to go on. Neither reads anything. */
function nannyGate(proof: unknown): InvoiceResult<never> | null {
  if (!nannyInvoicesEnabled()) return INVOICES_DISABLED;
  return isNannyProof(proof) ? null : INVALID;
}

function adminGate(proof: unknown): InvoiceResult<never> | null {
  if (!nannyInvoicesEnabled()) return INVOICES_DISABLED;
  return isAdminProof(proof) ? null : INVALID;
}

/** The service-role client, made only after the gate (a missing key is logged, not thrown). */
function client(): AdminClient | null {
  try {
    return createAdminClient();
  } catch (thrown) {
    logFailure("createAdminClient", thrown);
    return null;
  }
}

/** A function's reply: the success shape, one of its refusal codes, or `error` for anything else. */
function mapReply<S extends z.ZodType>(label: string, reply: DbResult<unknown>, success: S): InvoiceResult<z.output<S>> {
  if (!reply.ok) return ERROR;
  const ok = success.safeParse(reply.value);
  if (ok.success) return invoiceOk(ok.data);
  const no = refusalReply.safeParse(reply.value);
  if (no.success) return refused(no.data.status);
  logFailure(label, { code: "unexpected_reply" });
  return ERROR;
}

async function readDetails<S extends z.ZodType>(
  label: string,
  proof: NannyProof,
  columns: string,
  schema: S,
): Promise<InvoiceResult<z.output<S> | null>> {
  const admin = client();
  if (!admin) return ERROR;
  try {
    const { data, error } = await admin.from("nanny_payment_details").select(columns).eq("nanny_id", proof.nannyId).maybeSingle();
    if (error) {
      logFailure(label, error);
      return ERROR;
    }
    if (data === null) return invoiceOk(null);
    const row = schema.safeParse(data);
    if (row.success) return invoiceOk(row.data);
    logFailure(label, { code: "unexpected_row" });
    return ERROR;
  } catch (thrown) {
    logFailure(label, thrown);
    return ERROR;
  }
}

/** Her details as any screen may show them: masks only (brief §0.2). null = none saved yet. */
export async function readMaskedDetails(proof: NannyProof): Promise<InvoiceResult<MaskedPaymentDetails | null>> {
  return nannyGate(proof) ?? readDetails("readMaskedDetails", proof, MASK_COLUMNS, maskedRow);
}

/** Her full details, for rendering her PDF only (brief D12). Never pass the result to a client or a log. */
export async function readFullDetailsForInvoicePdf(proof: NannyProof): Promise<InvoiceResult<StoredPaymentDetails | null>> {
  return nannyGate(proof) ?? readDetails("readFullDetailsForInvoicePdf", proof, FULL_COLUMNS, fullRow);
}

/** Save or replace her details (parsed again here); the reply carries masks only. */
export async function saveDetails(proof: NannyProof, input: unknown): Promise<InvoiceResult<SavedDetails>> {
  const gate = nannyGate(proof);
  if (gate) return gate;
  const parsed = paymentDetailsSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  const admin = client();
  if (!admin) return ERROR;
  const d = parsed.data;
  const reply = await callRpc(admin, "nanny_payment_details_save", {
    p_nanny: proof.nannyId,
    p_account_name: d.accountName,
    p_sort_code: d.sortCode,
    p_account_number: d.accountNumber,
    p_trading_name: d.tradingName,
    p_invoice_address: d.invoiceAddress,
  });
  return mapReply("nanny_payment_details_save", reply, savedReply);
}

/**
 * Create an invoice (status `sending`, the next per-nanny number) from a draft and the last 4 of the account her PDF
 * will print. The draft's `invoiceId` is the caller's: the same id again returns the same row (`replay`).
 * The family, its name and email come from her own placement or trial connection, in the database.
 */
export async function createInvoice(proof: NannyProof, draft: unknown, accountLast4: string, now: Date = new Date()): Promise<InvoiceResult<CreatedInvoice>> {
  const gate = nannyGate(proof);
  if (gate) return gate;
  const parsed = invoiceDraftSchema(now).safeParse(draft);
  if (!parsed.success) {
    return refused(parsed.error.issues.some((i) => i.message === VALIDATION_MESSAGES.future) ? "future" : "invalid");
  }
  if (!/^\d{4}$/.test(accountLast4)) return INVALID;
  const admin = client();
  if (!admin) return ERROR;
  const d = parsed.data;
  const reply = await callRpc(admin, "nanny_invoice_create", {
    p_id: d.invoiceId,
    p_nanny: proof.nannyId,
    p_kind: d.kind,
    p_target: d.targetId,
    p_period_start: d.periodStart,
    p_hours: d.hours,
    p_rate_pence: d.ratePence,
    p_replaces: d.replacesInvoiceId,
    p_account_last4: accountLast4,
  });
  return mapReply("nanny_invoice_create", reply, createdReply);
}

/** sending → sent (both deliveries recorded) or failed (the PDF wasn't made or stored). Never deletes (R1). */
export async function finishInvoice(proof: NannyProof, invoiceId: string, outcome: FinishOutcome): Promise<InvoiceResult<"sent" | "failed">> {
  const gate = nannyGate(proof);
  if (gate) return gate;
  const checked = finishOutcome.safeParse(outcome);
  if (!guid.safeParse(invoiceId).success || !checked.success) return INVALID;
  const admin = client();
  if (!admin) return ERROR;
  const o = checked.data;
  const reply = await callRpc(admin, "nanny_invoice_finish", {
    p_id: invoiceId,
    p_nanny: proof.nannyId,
    p_outcome: o.kind,
    p_family_email_status: o.kind === "sent" ? o.family : null,
    p_nanny_email_status: o.kind === "sent" ? o.nanny : null,
  });
  const result = mapReply("nanny_invoice_finish", reply, finishedReply);
  if (!result.ok) return result;
  if (result.value.status !== o.kind) {
    logFailure("nanny_invoice_finish", { code: "unexpected_reply" });
    return ERROR;
  }
  return invoiceOk(result.value.status);
}

/** Her invoices sent in London's day, for the daily cap (R1: sent with a PDF). Reads at most cap + 1 ids. */
export async function countSentToday(proof: NannyProof, now: Date = new Date()): Promise<InvoiceResult<number>> {
  const gate = nannyGate(proof);
  if (gate) return gate;
  const admin = client();
  if (!admin) return ERROR;
  const day = londonDayRange(now);
  try {
    const { data, error } = await admin
      .from("nanny_invoices")
      .select("id")
      .eq("nanny_id", proof.nannyId)
      .eq("status", "sent")
      .not("pdf_path", "is", null)
      .gte("sent_at", day.fromUtc)
      .lt("sent_at", day.toUtc)
      .limit(INVOICE_RULES.dailySendCap + 1);
    if (error || !Array.isArray(data)) {
      logFailure("countSentToday", error ?? { code: "unexpected_rows" });
      return ERROR;
    }
    return invoiceOk(data.length);
  } catch (thrown) {
    logFailure("countSentToday", thrown);
    return ERROR;
  }
}

/** Parse every row or fail the read: a row that doesn't fit is never silently dropped (the 02 rule). */
function parseRows<S extends z.ZodType>(label: string, rows: DbResult<readonly unknown[]>, schema: S): InvoiceResult<readonly z.output<S>[]> {
  if (!rows.ok) return ERROR;
  const parsed = z.array(schema).safeParse(rows.value);
  if (parsed.success) return invoiceOk(parsed.data);
  logFailure(label, { code: "unexpected_row" });
  return ERROR;
}

/** 07's rows: one placement's sent Regular-week invoices for a London week, oldest number first. */
export async function readPlacementWeekRows(proof: AdminProof, placementId: string, weekStart: string): Promise<InvoiceResult<readonly WeekRow[]>> {
  const gate = adminGate(proof);
  if (gate) return gate;
  if (!guid.safeParse(placementId).success || !isLondonMonday(weekStart)) return INVALID;
  const admin = client();
  if (!admin) return ERROR;
  const rows = await allPages("readPlacementWeekRows", (from, to) =>
    admin.from("nanny_invoices").select(WEEK_COLUMNS).eq("placement_id", placementId).eq("period_start", weekStart)
      .eq("kind", "regular_week").eq("status", "sent").not("pdf_path", "is", null)
      .order("invoice_seq", { ascending: true }).order("id", { ascending: true }).range(from, to),
  );
  const parsed = parseRows("readPlacementWeekRows", rows, weekRow);
  if (!parsed.ok) return parsed;
  return invoiceOk(parsed.value.flatMap((r) =>
    countsAsSent({ status: r.status, pdfPath: r.pdf_path }) && r.sent_at !== null ? [toWeekRow(r, r.sent_at)] : []));
}

/** The family readers' rows: every invoice that went out to one family (sent or cancelled, with a PDF), oldest first. */
export async function readFamilyRows(proof: AdminProof, parentUserId: string): Promise<InvoiceResult<readonly FamilyRow[]>> {
  const gate = adminGate(proof);
  if (gate) return gate;
  if (!guid.safeParse(parentUserId).success) return INVALID;
  const admin = client();
  if (!admin) return ERROR;
  const rows = await allPages("readFamilyRows", (from, to) =>
    admin.from("nanny_invoices").select(FAMILY_COLUMNS).eq("parent_user_id", parentUserId).in("status", ["sent", "cancelled"])
      .not("pdf_path", "is", null).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to),
  );
  const parsed = parseRows("readFamilyRows", rows, familyRow);
  if (!parsed.ok) return parsed;
  return invoiceOk(parsed.value.flatMap((r) =>
    countsAsIssued({ status: r.status, pdfPath: r.pdf_path }) && (r.status === "sent" || r.status === "cancelled") && r.sent_at !== null
      ? [toFamilyRow(r, r.status, r.sent_at)]
      : []));
}
