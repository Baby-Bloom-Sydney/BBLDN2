/**
 * The invoice store (plan 06 step 6; R1; §14.4 b2.4) — **with `store-business.ts`, the only modules that touch
 * amendment 21's four tables** (bank details, business details, invoices, lines). Server-only, and deliberately NOT
 * a `"use server"` file: every async export of one becomes a browser-callable action, and this module reads bank
 * details with the service role.
 *
 * - Every operation passes `gate.ts` first: the switch (`invoices_disabled`, before a client is even made), then its proof:
 *   a `NannyProof` for her own details and invoices — the nanny id always comes from the proof, never from input —
 *   or an `AdminProof` for the readers' rows. Anything else answers `invalid` before a read.
 * - Screens read the masks only (`readMaskedDetails`); the full numbers come back from two named reads:
 *   `readFullDetailsForInvoicePdf`, for her PDF, and `readBankDetailsForSettings`, for her own Settings page only
 *   (06b-3 rework R3, BAI 2026-11-09: "We are completely fine to show them their banking information in their
 *   settings"). Everywhere else — the invoice review, replies, logs, emails — stays masked.
 * - A Settings save carries the version she loaded (`expectedUpdatedAt`, null = she saw none); the database answers
 *   `stale` and writes nothing when the row changed since.
 * - Writes go only through amendment 21's functions, which lock per nanny, take the family and the snapshots from
 *   her own placement or trial connection, the issuer and VAT from her business details, and never delete (R1). An
 *   invoice goes as its lines (`p_lines`) with the total her review showed; the database works out every figure
 *   again and answers `changed` when it differs.
 * - Her own list and an invoice's lines (her correction's pre-fill) are hers only: filtered by the proof's nanny,
 *   and re-checked here.
 * - The readers' rows are what went out, with a PDF (R1), re-checked here whatever the query returned.
 * - Failures are logged by code only (`db.ts`); results are closed codes, nothing is thrown to callers.
 *
 * BB-wave1-041126/06a-build, 2026-11-04; BB-wave1-041126/06b2-build, 2026-11-06; BB-wave1-041126/06b3-rework, 2026-11-09.
 */

import { z } from "zod";
import { INVOICE_RULES } from "@/config/invoices";
import type { AdminProof } from "@/lib/calls/admin-proof";
import { allPages, callRpc, LOCK_TIMEOUT, logFailure, parseRows, readOne, serviceClient, type DbResult } from "./db";
import { adminGate, nannyGate } from "./gate";
import type { NannyProof } from "./nanny-proof";
import { countsAsIssued, countsAsSent } from "./status";
import {
  capRow,
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
  SETTINGS_BANK_COLUMNS,
  settingsBankRow,
  toFamilyRow,
  toWeekRow,
  WEEK_COLUMNS,
  weekRow,
  type CreatedInvoice,
  type FamilyRow,
  type MaskedPaymentDetails,
  type SavedDetails,
  type SettingsBankDetails,
  type StoredPaymentDetails,
  type WeekRow,
} from "./store-map";
import {
  linesArg,
  linesInOrder,
  MY_INVOICE_COLUMNS,
  MY_LINES_COLUMNS,
  myInvoiceRow,
  myLinesRow,
  version,
  type MyInvoice,
  type StoredLine,
} from "./store-map-lines";
import { FAILED, INVALID, invoiceOk, refused, type EmailDelivery, type InvoiceError, type InvoiceResult } from "./types";
import { paymentDetailsSchema } from "./validation";
import { FUTURE_ISSUE, invoiceDraftSchema } from "./validation-lines";
import { isLondonMonday, londonDayRange } from "./week";

export type { CreatedInvoice, FamilyRow, IssuerSnapshot, MaskedPaymentDetails, SavedDetails, SettingsBankDetails, StoredPaymentDetails, WeekRow } from "./store-map";
export type { MyInvoice, StoredLine } from "./store-map-lines";

export type FinishOutcome =
  | { readonly kind: "sent"; readonly family: EmailDelivery; readonly nanny: EmailDelivery }
  | { readonly kind: "failed" };

const MINUTE_MS = 60_000;
/** A Postgres integer: an expected total beyond it can't be an invoice's. */
const MAX_TOTAL_PENCE = 2_147_483_647;
const guid = z.guid();
const delivery = z.enum(["sent", "failed"]);
const finishOutcome = z.union([
  z.object({ kind: z.literal("sent"), family: delivery, nanny: delivery }),
  z.object({ kind: z.literal("failed") }),
]);

/** A function's reply: the success shape, one of its refusal codes, `busy` for a lock timeout, else `error`. */
function mapReply<S extends z.ZodType>(label: string, reply: DbResult<unknown>, success: S): InvoiceResult<z.output<S>> {
  if (!reply.ok) return reply.code === LOCK_TIMEOUT ? refused("busy") : FAILED;
  const ok = success.safeParse(reply.value);
  if (ok.success) return invoiceOk(ok.data);
  const no = refusalReply.safeParse(reply.value);
  if (no.success) return refused(no.data.status);
  logFailure(label, { code: "unexpected_reply" });
  return FAILED;
}

async function readDetails<S extends z.ZodType>(label: string, proof: NannyProof, columns: string, schema: S): Promise<InvoiceResult<z.output<S> | null>> {
  const admin = serviceClient();
  if (!admin) return FAILED;
  return readOne(label, () => admin.from("nanny_payment_details").select(columns).eq("nanny_id", proof.nannyId).maybeSingle(), schema);
}

/** Her details as any screen may show them: masks only (brief §0.2). null = none saved yet. */
export async function readMaskedDetails(proof: NannyProof): Promise<InvoiceResult<MaskedPaymentDetails | null>> {
  return nannyGate(proof) ?? readDetails("readMaskedDetails", proof, MASK_COLUMNS, maskedRow);
}

/** Her full details, for rendering her PDF only (brief D12). Never pass the result to a client or a log. */
export async function readFullDetailsForInvoicePdf(proof: NannyProof): Promise<InvoiceResult<StoredPaymentDetails | null>> {
  return nannyGate(proof) ?? readDetails("readFullDetailsForInvoicePdf", proof, FULL_COLUMNS, fullRow);
}

/** Her full details and their version, for her own Settings page only (06b-3 rework R3). Never for any other screen. */
export async function readBankDetailsForSettings(proof: NannyProof): Promise<InvoiceResult<SettingsBankDetails | null>> {
  return nannyGate(proof) ?? readDetails("readBankDetailsForSettings", proof, SETTINGS_BANK_COLUMNS, settingsBankRow);
}

/** Save or replace her details (parsed again here) if the row is still the version she loaded; masks in the reply. */
export async function saveDetails(proof: NannyProof, input: unknown, expectedUpdatedAt: string | null): Promise<InvoiceResult<SavedDetails>> {
  const gate = nannyGate(proof);
  if (gate) return gate;
  const parsed = paymentDetailsSchema.safeParse(input);
  if (!parsed.success || !version.nullable().safeParse(expectedUpdatedAt).success) return INVALID;
  const admin = serviceClient();
  if (!admin) return FAILED;
  const d = parsed.data;
  const reply = await callRpc(admin, "nanny_payment_details_save", {
    p_nanny: proof.nannyId,
    p_account_name: d.accountName,
    p_sort_code: d.sortCode,
    p_account_number: d.accountNumber,
    p_expected_updated_at: expectedUpdatedAt,
  });
  return mapReply("nanny_payment_details_save", reply, savedReply);
}

/** A draft the schema refused: a future week or day, a line it can't take, or anything else (by issue code). */
function draftRefusal(issues: readonly z.core.$ZodIssue[]): InvoiceError {
  if (issues.some((i) => i.code === "custom" && i.params?.issue === FUTURE_ISSUE)) return "future";
  return issues.some((i) => i.path[0] === "lines") ? "bad_lines" : "invalid";
}

/**
 * Create an invoice (status `sending`, the next per-nanny number) from a draft — a header and her lines in order —
 * the last 4 of the account her PDF will print, and the total her review showed (`expectedTotalPence`, from
 * `totals.ts` and her issuer). The database decides, under her lock: the family and its name and email (from her own
 * placement — not dismissed — or her trial connection, on its trial date), the daily cap, her account status, the
 * correction rules, who she is on the invoice (her business details now: `no_address` when there's none), every
 * figure (`bad_lines`, and `changed` when the total isn't the one she saw). The draft's `invoiceId` is the caller's:
 * sending the same id again never makes a second invoice or a second send — it answers `in_progress` or
 * `already_done`. Only a fresh `ok` may be rendered, uploaded, emailed and finished.
 */
export async function createInvoice(
  proof: NannyProof,
  draft: unknown,
  accountLast4: string,
  expectedTotalPence: number,
  now: Date = new Date(),
): Promise<InvoiceResult<CreatedInvoice>> {
  const gate = nannyGate(proof);
  if (gate) return gate;
  const parsed = invoiceDraftSchema(now).safeParse(draft);
  if (!parsed.success) return refused(draftRefusal(parsed.error.issues));
  const totalOk = Number.isSafeInteger(expectedTotalPence) && expectedTotalPence > 0 && expectedTotalPence <= MAX_TOTAL_PENCE;
  if (!/^\d{4}$/.test(accountLast4) || !totalOk) return INVALID;
  const admin = serviceClient();
  if (!admin) return FAILED;
  const d = parsed.data;
  const reply = await callRpc(admin, "nanny_invoice_create", {
    p_id: d.invoiceId,
    p_nanny: proof.nannyId,
    p_kind: d.kind,
    p_target: d.targetId,
    p_period_start: d.periodStart,
    p_lines: linesArg(d.lines),
    p_expected_total_pence: expectedTotalPence,
    p_replaces: d.replacesInvoiceId,
    p_account_last4: accountLast4,
    p_daily_cap: INVOICE_RULES.dailySendCap,
    p_stale_minutes: INVOICE_RULES.staleSendingMinutes,
  });
  return mapReply("nanny_invoice_create", reply, createdReply);
}

/**
 * sending → sent, with both deliveries, once its PDF is uploaded (the database answers `no_pdf` before that), or
 * failed (the PDF wasn't made or stored, so nothing was emailed). Never deletes (R1).
 */
export async function finishInvoice(proof: NannyProof, invoiceId: string, outcome: FinishOutcome): Promise<InvoiceResult<"sent" | "failed">> {
  const gate = nannyGate(proof);
  if (gate) return gate;
  const checked = finishOutcome.safeParse(outcome);
  if (!guid.safeParse(invoiceId).success || !checked.success) return INVALID;
  const admin = serviceClient();
  if (!admin) return FAILED;
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
    return FAILED;
  }
  return invoiceOk(result.value.status);
}

/**
 * What counts towards her daily cap today (security M2) — the database's own rule, told here so 06b can say so
 * before a send: invoices created since London's midnight that aren't failed (sending, sent, cancelled; a send
 * stuck over `staleSendingMinutes` counts as failed, as the database's sweep makes it). The database counts again,
 * under her lock, when it creates; this count is advisory.
 */
export async function countTowardsDailyCap(proof: NannyProof, now: Date = new Date()): Promise<InvoiceResult<number>> {
  const gate = nannyGate(proof);
  if (gate) return gate;
  const admin = serviceClient();
  if (!admin) return FAILED;
  const day = londonDayRange(now);
  const staleBefore = new Date(now.getTime() - INVOICE_RULES.staleSendingMinutes * MINUTE_MS).toISOString();
  try {
    // stale sends are dropped in the query, so the limit counts live rows only
    const { data, error } = await admin.from("nanny_invoices").select("id, status, created_at").eq("nanny_id", proof.nannyId)
      .in("status", ["sending", "sent", "cancelled"]).or(`status.neq.sending,created_at.gte.${staleBefore}`)
      .gte("created_at", day.fromUtc).lt("created_at", day.toUtc).limit(INVOICE_RULES.dailySendCap + 1);
    if (error || !Array.isArray(data)) {
      logFailure("countTowardsDailyCap", error ?? { code: "unexpected_rows" });
      return FAILED;
    }
    const rows = parseRows("countTowardsDailyCap", { ok: true, value: data }, capRow);
    return rows.ok ? invoiceOk(rows.value.length) : rows;
  } catch (thrown) {
    logFailure("countTowardsDailyCap", thrown);
    return FAILED;
  }
}

/** 07's rows: one placement's sent Regular-week invoices for a London week, oldest number first. */
export async function readPlacementWeekRows(proof: AdminProof, placementId: string, weekStart: string): Promise<InvoiceResult<readonly WeekRow[]>> {
  const gate = adminGate(proof);
  if (gate) return gate;
  if (!guid.safeParse(placementId).success || !isLondonMonday(weekStart)) return INVALID;
  const admin = serviceClient();
  if (!admin) return FAILED;
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
  const admin = serviceClient();
  if (!admin) return FAILED;
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

/** Her own invoices, newest first, for her list (no email, bank or PDF field); rows not hers are dropped again. */
export async function readMyInvoices(proof: NannyProof): Promise<InvoiceResult<readonly MyInvoice[]>> {
  const gate = nannyGate(proof);
  if (gate) return gate;
  const admin = serviceClient();
  if (!admin) return FAILED;
  const rows = await allPages("readMyInvoices", (from, to) =>
    admin.from("nanny_invoices").select(MY_INVOICE_COLUMNS).eq("nanny_id", proof.nannyId)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to),
  );
  const parsed = parseRows("readMyInvoices", rows, myInvoiceRow);
  if (!parsed.ok) return parsed;
  return invoiceOk(parsed.value.filter((r) => r.nannyId === proof.nannyId));
}

/** One of her invoices' lines, in her order (the correction's pre-fill, plan 14.3): `not_found` when it isn't hers. */
export async function readMyInvoiceLines(proof: NannyProof, invoiceId: string): Promise<InvoiceResult<readonly StoredLine[]>> {
  const gate = nannyGate(proof);
  if (gate) return gate;
  if (!guid.safeParse(invoiceId).success) return INVALID;
  const admin = serviceClient();
  if (!admin) return FAILED;
  const row = await readOne("readMyInvoiceLines", () =>
    admin.from("nanny_invoices").select(MY_LINES_COLUMNS).eq("id", invoiceId).eq("nanny_id", proof.nannyId).maybeSingle(), myLinesRow);
  if (!row.ok) return row;
  if (row.value === null || row.value.nanny_id !== proof.nannyId) return refused("not_found");
  return invoiceOk(linesInOrder(row.value.nanny_invoice_lines));
}
