/**
 * What happens to an invoice after it is created (plan 06 §4 "Bucket", R1, R15; old steps 12–13; 06a handoff
 * "create → render → upload → both emails → finish"): its PDF in the private bucket. With `store.ts` and
 * `store-business.ts`, the only modules that touch amendment 21's tables and its bucket. Server-only, and
 * deliberately NOT a `"use server"` file (every async export of one becomes a browser-callable action).
 *
 * - **The PDF:** uploaded once, to the path the created row fixed (`<nanny>/<invoice>.pdf`, amendment 21's CHECK),
 *   never over an existing object (`upsert: false`), as a PDF within the bucket's 2 MB; read back for a resend
 *   (the same PDF, the same number). Only her own path: the nanny in the path is the proof's.
 * - **Her sent invoice** (`readSentInvoice`): its snapshot — the addresses it went to, the names, the figures — for
 *   the cancellation and resend emails, and what has been delivered. Hers only (`not_found` otherwise).
 * - **The writes after send** — a cancel, the cancellation's deliveries (R15), a resend's outcome — are conditional
 *   PostgREST updates whose values are checked first (06b-2 handoff, database L8): each names only columns
 *   service_role may update (amendment 21's column grants), each is filtered to her invoice in the state the write
 *   needs (`sent` → `cancelled`; a delivery not yet `sent`), so no CHECK or the write-once trigger can refuse it —
 *   a refused UPDATE would put "Failing row contains (…)" in the database's log. A filter that matches nothing
 *   answers `not_cancellable` / `not_resendable`, never a guess.
 * - **One resend at a time** (security review M1): an invoice email is claimed before it goes again — its
 *   `*_emailed_at` stamped by a conditional update that only matches while it is `failed` and was last tried over
 *   `RESEND_LEASE_SECONDS` ago, so of two resends at once only one matches (Postgres re-checks the filter on the
 *   locked row) and the other answers `too_soon`; the outcome is then recorded on that claim only. A cancellation
 *   has no attempt time to claim with (amendment 21 has no `cancel_*_emailed_at`), so its resend is recorded only
 *   from `failed` — never while its deliveries aren't recorded yet — and two resends at the same moment can still
 *   both send (recorded; a claim needs a column or a function, an SQL change).
 * - Her account's status (L1: a suspended or deactivated nanny can't cancel or resend) and whether the family still
 *   has an account (L2: an email to a closed account's address is skipped), read for the actions.
 * - The switch first (`invoices_disabled`, before a client is made), then her proof. Failures are logged by code
 *   only (`db.ts`): a storage or database error can name the path or the row.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { z } from "zod";
import { logFailure, readOne, serviceClient, type AdminClient } from "./db";
import { nannyGate } from "./gate";
import type { NannyProof } from "./nanny-proof";
import { isInvoiceNumber } from "./numbering";
import { hoursValue, londonDate, pence } from "./store-map-lines";
import {
  CANCEL_REASONS,
  FAILED,
  INVALID,
  INVOICE_KINDS,
  INVOICE_STATUSES,
  invoiceOk,
  refused,
  VAT_MODES,
  type CancelReason,
  type EmailDelivery,
  type InvoiceKind,
  type InvoiceResult,
  type InvoiceStatus,
  type VatMode,
} from "./types";

/** Amendment 21's private bucket: PDF only, 2 MB, no `storage.objects` policy (service role only). */
export const INVOICE_BUCKET = "nanny-invoices";
const PDF_MAX_BYTES = 2 * 1024 * 1024;
/** How long a claimed (or just-tried) invoice email is held before another resend may try it: past any one send. */
export const RESEND_LEASE_SECONDS = 60;
const MS_PER_SECOND = 1000;
const PDF_MAGIC = "%PDF";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The one path an invoice of hers may have: `<nanny>/<invoice>.pdf` (amendment 21's `nanny_invoices_pdf_path_check`). */
function isOwnPath(proof: NannyProof, invoiceId: string, pdfPath: string): boolean {
  return GUID.test(invoiceId) && pdfPath === `${proof.nannyId}/${invoiceId}.pdf`;
}

const isPdf = (bytes: Buffer): boolean =>
  bytes.length > PDF_MAGIC.length && bytes.length <= PDF_MAX_BYTES && bytes.subarray(0, PDF_MAGIC.length).toString("latin1") === PDF_MAGIC;

/** Store a created invoice's PDF (before any email: an invoice is "sent" only once its PDF is stored, R1). */
export async function uploadInvoicePdf(
  proof: NannyProof,
  invoice: { readonly invoiceId: string; readonly pdfPath: string },
  pdf: Buffer,
): Promise<InvoiceResult<true>> {
  const gate = nannyGate(proof);
  if (gate) return gate;
  if (!isOwnPath(proof, invoice.invoiceId, invoice.pdfPath) || !isPdf(pdf)) return INVALID;
  const admin = serviceClient();
  if (!admin) return FAILED;
  try {
    const { error } = await admin.storage.from(INVOICE_BUCKET).upload(invoice.pdfPath, pdf, { contentType: "application/pdf", upsert: false });
    if (error) {
      logFailure("uploadInvoicePdf", error);
      return FAILED;
    }
    return invoiceOk(true);
  } catch (thrown) {
    logFailure("uploadInvoicePdf", thrown);
    return FAILED;
  }
}

/** Her stored PDF, for a resend: the same bytes the family was first sent. */
export async function downloadInvoicePdf(
  proof: NannyProof,
  invoice: { readonly invoiceId: string; readonly pdfPath: string },
): Promise<InvoiceResult<Buffer>> {
  const gate = nannyGate(proof);
  if (gate) return gate;
  if (!isOwnPath(proof, invoice.invoiceId, invoice.pdfPath)) return INVALID;
  const admin = serviceClient();
  if (!admin) return FAILED;
  try {
    const { data, error } = await admin.storage.from(INVOICE_BUCKET).download(invoice.pdfPath);
    if (error || !data) {
      logFailure("downloadInvoicePdf", error ?? { code: "no_object" });
      return FAILED;
    }
    const bytes = Buffer.from(await data.arrayBuffer());
    if (isPdf(bytes)) return invoiceOk(bytes);
    logFailure("downloadInvoicePdf", { code: "not_a_pdf" });
    return FAILED;
  } catch (thrown) {
    logFailure("downloadInvoicePdf", thrown);
    return FAILED;
  }
}

/** One of her invoices as its emails need it (no bank field; the addresses are the ones it was sent to). */
export interface SentInvoice {
  readonly invoiceId: string;
  readonly number: string;
  readonly kind: InvoiceKind;
  readonly periodStart: string;
  readonly status: InvoiceStatus;
  readonly pdfPath: string;
  readonly parentUserId: string;
  readonly familyName: string;
  readonly familyEmail: string;
  readonly nannyName: string;
  readonly nannyEmail: string;
  readonly figures: { readonly hours: number; readonly expensesPence: number; readonly totalPence: number; readonly vatMode: VatMode };
  readonly replacesNumber: string | null;
  readonly cancelReason: CancelReason | null;
  readonly delivery: {
    readonly family: EmailDelivery | null;
    readonly nanny: EmailDelivery | null;
    readonly cancelFamily: EmailDelivery | null;
    readonly cancelNanny: EmailDelivery | null;
  };
}

const SENT_COLUMNS =
  "id, nanny_id, invoice_number, kind, period_start, status, pdf_path, parent_user_id, family_name, family_email, nanny_name, " +
  "nanny_email, hours, expenses_pence, total_pence, vat_mode, replaces_invoice_id, cancel_reason, family_email_status, " +
  "nanny_email_status, cancel_family_email_status, cancel_nanny_email_status";
const id = z.string().min(1);
const text = z.string().min(1);
const delivery = z.enum(["sent", "failed"]).nullable();
const invoiceNumber = z.string().refine(isInvoiceNumber);
const sentRow = z.object({
  id, nanny_id: id, invoice_number: invoiceNumber, kind: z.enum(INVOICE_KINDS), period_start: londonDate, status: z.enum(INVOICE_STATUSES),
  pdf_path: text, parent_user_id: id, family_name: text, family_email: text, nanny_name: text, nanny_email: text, hours: hoursValue,
  expenses_pence: pence.nonnegative(), total_pence: pence.positive(), vat_mode: z.enum(VAT_MODES), replaces_invoice_id: id.nullable(),
  cancel_reason: z.enum(CANCEL_REASONS).nullable(), family_email_status: delivery, nanny_email_status: delivery,
  cancel_family_email_status: delivery, cancel_nanny_email_status: delivery,
});
type SentRow = z.output<typeof sentRow>;

const toSent = (r: SentRow, replacesNumber: string | null): SentInvoice => ({
  invoiceId: r.id, number: r.invoice_number, kind: r.kind, periodStart: r.period_start, status: r.status, pdfPath: r.pdf_path,
  parentUserId: r.parent_user_id, familyName: r.family_name, familyEmail: r.family_email, nannyName: r.nanny_name,
  nannyEmail: r.nanny_email, figures: { hours: r.hours, expensesPence: r.expenses_pence, totalPence: r.total_pence, vatMode: r.vat_mode },
  replacesNumber, cancelReason: r.cancel_reason,
  delivery: { family: r.family_email_status, nanny: r.nanny_email_status, cancelFamily: r.cancel_family_email_status, cancelNanny: r.cancel_nanny_email_status },
});

/** The number of the (her own) invoice a correction replaced. */
async function replacedNumber(admin: AdminClient, nannyId: string, replacesId: string | null): Promise<InvoiceResult<string | null>> {
  if (replacesId === null) return invoiceOk(null);
  const old = await readOne("readSentInvoice.replaces", () =>
    admin.from("nanny_invoices").select("invoice_number").eq("id", replacesId).eq("nanny_id", nannyId).maybeSingle(),
    z.object({ invoice_number: invoiceNumber }));
  if (!old.ok) return old;
  return invoiceOk(old.value?.invoice_number ?? null);
}

/** Her invoice, for its cancellation or a resend: `not_found` when there's none of hers. */
export async function readSentInvoice(proof: NannyProof, invoiceId: string): Promise<InvoiceResult<SentInvoice>> {
  const gate = nannyGate(proof);
  if (gate) return gate;
  if (!GUID.test(invoiceId)) return INVALID;
  const admin = serviceClient();
  if (!admin) return FAILED;
  const row = await readOne("readSentInvoice", () =>
    admin.from("nanny_invoices").select(SENT_COLUMNS).eq("id", invoiceId).eq("nanny_id", proof.nannyId).maybeSingle(), sentRow);
  if (!row.ok) return row;
  if (row.value === null || row.value.nanny_id !== proof.nannyId) return refused("not_found");
  const replaces = await replacedNumber(admin, proof.nannyId, row.value.replaces_invoice_id);
  return replaces.ok ? invoiceOk(toSent(row.value, replaces.value)) : replaces;
}

/** A filter on the row's state: equal to a value, earlier than a time, or still null. */
type Filter = readonly ["eq", string, string] | readonly ["lt", string, string] | readonly ["is", string];
interface Write {
  readonly label: string;
  readonly invoiceId: string;
  readonly payload: Readonly<Record<string, string>>;
  readonly filters: readonly Filter[];
}

/**
 * One conditional update of her invoice: `moved` when a row matched, `none` when none did, `error` (logged by code)
 * on a failure. Every caller has checked its values first.
 */
async function writeOwn(proof: NannyProof, write: Write): Promise<"moved" | "none" | "error"> {
  const admin = serviceClient();
  if (!admin) return "error";
  try {
    const own = admin.from("nanny_invoices").update(write.payload).eq("id", write.invoiceId).eq("nanny_id", proof.nannyId);
    const query = write.filters.reduce((q, f) => (f[0] === "eq" ? q.eq(f[1], f[2]) : f[0] === "lt" ? q.lt(f[1], f[2]) : q.is(f[1], null)), own);
    const { data, error } = await query.select("id");
    if (error) {
      logFailure(write.label, error);
      return "error";
    }
    return Array.isArray(data) && data.length > 0 ? "moved" : "none";
  } catch (thrown) {
    logFailure(write.label, thrown);
    return "error";
  }
}

const isReason = (value: unknown): value is CancelReason => (CANCEL_REASONS as readonly unknown[]).includes(value);
const isDelivery = (value: unknown): value is EmailDelivery => value === "sent" || value === "failed";

/** sent → cancelled, with the reason and the time; the number is kept. `not_cancellable` when it isn't sent (now). */
export async function cancelSentInvoice(proof: NannyProof, invoiceId: string, reason: CancelReason, now: Date): Promise<InvoiceResult<"cancelled">> {
  const gate = nannyGate(proof);
  if (gate) return gate;
  if (!GUID.test(invoiceId) || !isReason(reason) || Number.isNaN(now.getTime())) return INVALID;
  const moved = await writeOwn(proof, {
    label: "cancelSentInvoice", invoiceId,
    payload: { status: "cancelled", cancelled_at: now.toISOString(), cancel_reason: reason },
    filters: [["eq", "status", "sent"]],
  });
  if (moved === "error") return FAILED;
  return moved === "moved" ? invoiceOk("cancelled") : refused("not_cancellable");
}

/** The cancellation emails' deliveries, recorded once (R15). A failure is `error`: the cancel itself stands. */
export async function recordCancelDelivery(
  proof: NannyProof,
  invoiceId: string,
  deliveries: { readonly family: EmailDelivery; readonly nanny: EmailDelivery },
): Promise<InvoiceResult<true>> {
  const gate = nannyGate(proof);
  if (gate) return gate;
  if (!GUID.test(invoiceId) || !isDelivery(deliveries.family) || !isDelivery(deliveries.nanny)) return INVALID;
  const moved = await writeOwn(proof, {
    label: "recordCancelDelivery", invoiceId,
    payload: { cancel_family_email_status: deliveries.family, cancel_nanny_email_status: deliveries.nanny },
    filters: [["eq", "status", "cancelled"], ["is", "cancel_family_email_status"], ["is", "cancel_nanny_email_status"]],
  });
  if (moved === "moved") return invoiceOk(true);
  if (moved === "none") logFailure("recordCancelDelivery", { code: "no_row" });
  return FAILED;
}

/** Which email a resend is: the invoice email or the cancellation, to the family or to her. */
export interface ResendTarget {
  readonly what: "invoice" | "cancellation";
  readonly recipient: "family" | "nanny";
}

const isRecipient = (value: unknown): value is ResendTarget["recipient"] => value === "family" || value === "nanny";

/**
 * Claim her invoice email to `recipient` for one resend (M1): stamp its attempt time while it is `failed` and was
 * last tried over `RESEND_LEASE_SECONDS` ago. The stamp is the claim, passed back to `recordResend`. `too_soon` when
 * another resend holds it, it was just tried, or it is no longer undelivered — the caller sends nothing.
 */
export async function claimInvoiceResend(
  proof: NannyProof,
  invoiceId: string,
  recipient: ResendTarget["recipient"],
  now: Date,
): Promise<InvoiceResult<string>> {
  const gate = nannyGate(proof);
  if (gate) return gate;
  if (!GUID.test(invoiceId) || !isRecipient(recipient) || Number.isNaN(now.getTime())) return INVALID;
  const claim = now.toISOString();
  const before = new Date(now.getTime() - RESEND_LEASE_SECONDS * MS_PER_SECOND).toISOString();
  const moved = await writeOwn(proof, {
    label: "claimInvoiceResend", invoiceId,
    payload: { [`${recipient}_emailed_at`]: claim },
    filters: [["eq", "status", "sent"], ["eq", `${recipient}_email_status`, "failed"], ["lt", `${recipient}_emailed_at`, before]],
  });
  if (moved === "error") return FAILED;
  return moved === "moved" ? invoiceOk(claim) : refused("too_soon");
}

/** A resend's columns: an invoice email's outcome on its own claim; a cancellation's from `failed` only. */
function resendWrite(invoiceId: string, target: ResendTarget, outcome: EmailDelivery, now: Date, claim: string): Write {
  const r = target.recipient;
  if (target.what === "invoice") {
    return {
      label: "recordResend", invoiceId,
      payload: { [`${r}_email_status`]: outcome, [`${r}_emailed_at`]: now.toISOString() },
      filters: [["eq", "status", "sent"], ["eq", `${r}_email_status`, "failed"], ["eq", `${r}_emailed_at`, claim]],
    };
  }
  return {
    label: "recordResend", invoiceId,
    payload: { [`cancel_${r}_email_status`]: outcome },
    filters: [["eq", "status", "cancelled"], ["eq", `cancel_${r}_email_status`, "failed"]],
  };
}

/**
 * A resend's outcome, recorded while that email is still `failed` — for an invoice email, only on the claim this
 * resend made (`claimedAt`, from `claimInvoiceResend`; required). `not_resendable` when nothing matched.
 */
export async function recordResend(
  proof: NannyProof,
  invoiceId: string,
  target: ResendTarget,
  outcome: EmailDelivery,
  now: Date,
  claimedAt: string | null,
): Promise<InvoiceResult<true>> {
  const gate = nannyGate(proof);
  if (gate) return gate;
  const known = (target.what === "invoice" || target.what === "cancellation") && isRecipient(target.recipient);
  const claimed = target.what === "cancellation" || (claimedAt !== null && !Number.isNaN(Date.parse(claimedAt)));
  if (!GUID.test(invoiceId) || !known || !claimed || !isDelivery(outcome) || Number.isNaN(now.getTime())) return INVALID;
  const moved = await writeOwn(proof, resendWrite(invoiceId, target, outcome, now, claimedAt ?? ""));
  if (moved === "error") return FAILED;
  return moved === "moved" ? invoiceOk(true) : refused("not_resendable");
}

const INACTIVE = new Set(["suspended", "deactivated"]);

/** Whether her nanny account may still act on her invoices (L1): not suspended or deactivated. */
export async function readNannyActive(proof: NannyProof): Promise<InvoiceResult<boolean>> {
  const gate = nannyGate(proof);
  if (gate) return gate;
  const admin = serviceClient();
  if (!admin) return FAILED;
  const row = await readOne("readNannyActive", () =>
    admin.from("nannies").select("id, status").eq("id", proof.nannyId).maybeSingle(), z.object({ id, status: z.string().nullable() }));
  if (!row.ok) return row;
  if (row.value === null) return INVALID;
  return invoiceOk(!INACTIVE.has(row.value.status ?? ""));
}

/** Whether the family still has an account (L2): their profile row is there. A closed account's address gets no email. */
export async function familyHasAccount(proof: NannyProof, parentUserId: string): Promise<InvoiceResult<boolean>> {
  const gate = nannyGate(proof);
  if (gate) return gate;
  if (!GUID.test(parentUserId)) return INVALID;
  const admin = serviceClient();
  if (!admin) return FAILED;
  const row = await readOne("familyHasAccount", () =>
    admin.from("user_profiles").select("user_id").eq("user_id", parentUserId).maybeSingle(), z.object({ user_id: id }));
  return row.ok ? invoiceOk(row.value !== null) : row;
}

/** Her invoice, for a cancel or a resend — refused with `nanny_inactive` when her account is suspended or deactivated. */
export async function readInvoiceToChange(proof: NannyProof, invoiceId: string): Promise<InvoiceResult<SentInvoice>> {
  const [active, invoice] = await Promise.all([readNannyActive(proof), readSentInvoice(proof, invoiceId)]);
  if (!active.ok) return active;
  if (!active.value) return refused("nanny_inactive");
  return invoice;
}
