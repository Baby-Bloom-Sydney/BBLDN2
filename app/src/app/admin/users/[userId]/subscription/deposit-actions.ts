"use server";

/**
 * BAI's deposit actions in the family's "Done for you" panel (plan 03 row B2, D10, D15; brief 03 §3 Admin 3–6;
 * contract-03b). Every export of a `"use server"` file is a public action, so this file exports exactly the six
 * actions (and types); every helper stays unexported.
 *
 * Each action, in this order:
 * 1. The switch (`depositLinkEnabled()`, which needs `COHORTS_ENABLED` too): off → `deposit_disabled`, with no auth
 *    call and no read.
 * 2. `proveAdmin()`: no admin → `not_admin`.
 * 3. The parent id (a uuid) and the request, parsed with zod → `invalid`.
 * 4. 03a's domain calls (`src/lib/deposit/*`, 02's `ensureCohort`) on the service-role client, then
 *    `revalidatePath` of this page after a write only.
 *
 * Rules (contract-03b):
 * - Paid (`readDepositPanel(...).canTakeDeposit === false`) → `already_paid` before a link is made or emailed.
 * - Goodwill only when `cohorts.canOfferGoodwill` (D10); its date is `cohorts.next.start`, read here, never sent by
 *   the client, and pinned with `ensureCohort` before a link or a mark uses it (a refusal → `goodwill_not_offered`).
 * - An open link for another target or pin → `target_differs` with nothing written, until BAI chooses `send_as_is`
 *   (that link, unchanged) or `replace` (cancelled, then a new code).
 * - Send: one stable code; a second send needs `confirmResend`. The email goes first; only once it is out is the link
 *   stamped and one `deposit.link_sent` row written (never the address). A failed send → `email_failed` + the URL.
 * - Take payment now (D15): the open link (any target), or a new current one; no email, no stamp, no history row.
 * - URLs only via `depositLinkUrl(code)`. Unexpected failures → `error`, logged by code only — never an address, a
 *   name, a code or a message.
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { proveAdmin, type AdminProof } from "@/lib/calls/admin-proof";
import { uuid } from "@/lib/calls/zod-parts";
import { dbOk, DB_FAILED, logFailure, type AdminClient, type DbResult } from "@/lib/cohorts/db";
import { ensureCohort } from "@/lib/cohorts/places";
import { EMAIL_MAX, NOTE_MAX, NOTE_MIN, REFUND_REASON_MAX, REFUND_REASON_MIN } from "@/lib/deposit/constants";
import { maskEmail } from "@/lib/deposit/copy";
import { cancelOpenLink, depositLinkUrl, getOrCreateOpenLink, stampLinkSent, type DepositLink, type OpenLinkRequest } from "@/lib/deposit/links";
import { readDepositPanel, type DepositPanel, type PanelCohorts } from "@/lib/deposit/panel";
import { markBankTransfer, recordBankRefund, type BankTransferResult } from "@/lib/deposit/record";
import { DEPOSIT_TARGETS, type DepositTarget as Target } from "@/lib/deposit/types";
import { sendEmail } from "@/lib/email/resend";
import { depositLinkEmail } from "@/lib/email/templates/deposit-link";
import { depositLinkEnabled } from "@/lib/features/flags";
import { createAdminClient } from "@/lib/supabase/admin";

const TARGET_DIFFERS_CHOICES = ["send_as_is", "replace"] as const;

export type DepositTarget = Target;
/** `replace` = cancel the open link, make a new one. */
export type TargetDiffersChoice = (typeof TARGET_DIFFERS_CHOICES)[number];

type Fail<E extends string> = { readonly ok: false; readonly error: E };
type Common = "deposit_disabled" | "not_admin" | "invalid" | "error";

export type TargetDiffersResult = {
  readonly ok: false;
  readonly error: "target_differs";
  readonly openTarget: DepositTarget;
  readonly openGoodwillStartDate: string | null;
};

export interface SendDepositLinkRequest {
  readonly target: DepositTarget;
  readonly confirmResend?: boolean;
  readonly onTargetDiffers?: TargetDiffersChoice;
}
export interface CopyDepositLinkRequest {
  readonly target: DepositTarget;
  readonly onTargetDiffers?: TargetDiffersChoice;
}
export interface MarkDepositPaidRequest {
  readonly target: DepositTarget;
  readonly note: string;
}
export interface RecordDepositBankRefundRequest {
  readonly reason: string;
}

export type SendDepositLinkResult =
  | { readonly ok: true; readonly sentAt: string; readonly to: string }
  | { readonly ok: false; readonly error: "confirm_resend"; readonly sentAt: string }
  | TargetDiffersResult
  | { readonly ok: false; readonly error: "email_failed"; readonly url: string }
  | Fail<Common | "already_paid" | "goodwill_not_offered" | "no_email">;
export type CopyDepositLinkResult = { readonly ok: true; readonly url: string } | TargetDiffersResult | Fail<Common | "already_paid" | "goodwill_not_offered">;
export type TakeDepositPaymentNowResult = { readonly ok: true; readonly url: string } | Fail<Common | "already_paid">;
export type CancelDepositLinkResult = { readonly ok: true; readonly cancelled: boolean } | Fail<Common>;
export type MarkDepositPaidResult =
  | { readonly ok: true }
  | Fail<Common | "already_paid" | "cohort_full" | "being_paid" | "not_bookable" | "not_a_cohort" | "already_taken" | "goodwill_not_offered">;
export type RecordDepositBankRefundResult = { readonly ok: true } | Fail<Common | "not_bank_transfer" | "already_refunded">;

const fail = <E extends string>(error: E): Fail<E> => Object.freeze({ ok: false as const, error });
const INVALID = fail("invalid");
const ERROR = fail("error");
const OK = Object.freeze({ ok: true as const });
const EMAIL_TYPE = "deposit_link";
const LINK_SENT = "deposit.link_sent";
const ADDRESS = /^[^\s@]+@[^\s@]+$/;

const target = z.enum(DEPOSIT_TARGETS);
const choice = z.enum(TARGET_DIFFERS_CHOICES).optional();
const sendRequest = z.object({ target, confirmResend: z.boolean().optional(), onTargetDiffers: choice });
const copyRequest = z.object({ target, onTargetDiffers: choice });
const markPaidRequest = z.object({ target, note: z.string().trim().min(NOTE_MIN).max(NOTE_MAX) });
const refundRequest = z.object({ reason: z.string().trim().min(REFUND_REASON_MIN).max(REFUND_REASON_MAX) });
const contactRow = z.object({ email: z.string().nullable(), first_name: z.string().nullable() });

type LinkChoice = z.infer<typeof copyRequest>;
type Wanted = Pick<OpenLinkRequest, "target" | "goodwillStartDate">;
type LinkFailure = TargetDiffersResult | Fail<"goodwill_not_offered" | "invalid" | "error">;
/** A link to send or copy, or why not; `wrote` = a link was made or cancelled on the way (revalidate). */
type Resolved =
  | { readonly link: DepositLink; readonly wrote: boolean }
  | { readonly link: null; readonly wrote: boolean; readonly failure: LinkFailure };
interface Contact {
  readonly email: string;
  readonly firstName: string | null;
}

// ── the gates ──

type Gate = { readonly ok: true; readonly proof: AdminProof } | { readonly ok: false; readonly result: Fail<"deposit_disabled" | "not_admin"> };

/** The switch before anything else (no auth call, no read), then the admin. */
async function gate(): Promise<Gate> {
  if (!depositLinkEnabled()) return { ok: false, result: fail("deposit_disabled") };
  const proof = await proveAdmin();
  return proof === null ? { ok: false, result: fail("not_admin") } : { ok: true, proof };
}

const isParentId = (value: unknown): value is string => uuid.safeParse(value).success;

/** Run an action's body; a throw is `error`, logged by its name only. */
async function attempt<T>(label: string, run: () => Promise<T>): Promise<T | Fail<"error">> {
  try {
    return await run();
  } catch (thrown) {
    logFailure(`deposit action ${label}`, thrown);
    return ERROR;
  }
}

/** Revalidate the family's page when something was written; the result passes through. */
function settle<T>(parentUserId: string, wrote: boolean, result: T): T {
  if (wrote) revalidatePath(`/admin/users/${parentUserId}/subscription`);
  return result;
}

const isoOf = (at: string): string => {
  const time = new Date(at);
  return Number.isNaN(time.getTime()) ? at : time.toISOString();
};

// ── reads ──

type Unpaid = { readonly ok: true; readonly panel: DepositPanel } | { readonly ok: false; readonly result: Fail<"invalid" | "error" | "already_paid"> };

/** The family's panel, refused once anything is paid (or refunded): one deposit per family. */
async function unpaidPanel(proof: AdminProof, admin: AdminClient, parentUserId: string): Promise<Unpaid> {
  const read = await readDepositPanel(proof, admin, parentUserId, new Date());
  if (!read.ok) return { ok: false, result: fail(read.status) };
  if (!read.value.canTakeDeposit) return { ok: false, result: fail("already_paid") };
  return { ok: true, panel: read.value };
}

/** Her account email (`user_profiles.email`) and first name; `null` when there is no usable address. */
async function readContact(admin: AdminClient, parentUserId: string): Promise<DbResult<Contact | null>> {
  const { data, error } = await admin.from("user_profiles").select("email, first_name").eq("user_id", parentUserId).maybeSingle();
  if (error) {
    logFailure("deposit contact read", error);
    return DB_FAILED;
  }
  if (data === null) return dbOk(null);
  const row = contactRow.safeParse(data);
  if (!row.success) {
    logFailure("deposit contact read", { code: "unexpected_row" });
    return DB_FAILED;
  }
  const email = row.data.email?.trim() ?? "";
  return dbOk(email.length <= EMAIL_MAX && ADDRESS.test(email) ? { email, firstName: row.data.first_name } : null);
}

// ── the link: target, pin, target_differs ──

/** The current cohort, or goodwill only when offered (D10), dated by the server. Null = goodwill not offered. */
function wantedFor(cohorts: PanelCohorts, wanted: DepositTarget): Wanted | null {
  if (wanted === "current") return { target: "current", goodwillStartDate: null };
  return cohorts.canOfferGoodwill && cohorts.next !== null ? { target: "goodwill", goodwillStartDate: cohorts.next.start } : null;
}

/** Pin a goodwill date with 02's `ensureCohort` before it is used; its refusal = goodwill not offered. */
async function pinned(admin: AdminClient, wanted: Wanted): Promise<"ok" | "goodwill_not_offered" | "error"> {
  if (wanted.goodwillStartDate === null) return "ok";
  const ensured = await ensureCohort(admin, wanted.goodwillStartDate);
  if (ensured.ok) return "ok";
  return ensured.status === "error" ? "error" : "goodwill_not_offered";
}

const differsFrom = (open: Wanted): TargetDiffersResult =>
  Object.freeze({ ok: false as const, error: "target_differs" as const, openTarget: open.target, openGoodwillStartDate: open.goodwillStartDate });
const refused = (failure: LinkFailure, wrote: boolean): Resolved => ({ link: null, wrote, failure });

/** 03a's get-or-create. Another target there now (a concurrent change): `send_as_is` takes it, else it's answered. */
async function openLink(proof: AdminProof, admin: AdminClient, req: OpenLinkRequest, how: LinkChoice["onTargetDiffers"], wrote: boolean): Promise<Resolved> {
  const got = await getOrCreateOpenLink(proof, admin, req);
  if (got.status === "ok") return { link: got.link, wrote: wrote || got.created };
  if (got.status === "target_differs") return how === "send_as_is" ? { link: got.link, wrote } : refused(differsFrom(got.link), wrote);
  return refused(fail(got.status), wrote);
}

/** `replace`: pin first (so a refusal cancels nothing), then cancel the open link, then make a new code. */
async function replaceOpen(proof: AdminProof, admin: AdminClient, parentUserId: string, wanted: Wanted): Promise<Resolved> {
  const pin = await pinned(admin, wanted);
  if (pin !== "ok") return refused(fail(pin), false);
  const cancelled = await cancelOpenLink(proof, admin, parentUserId);
  if (cancelled.status === "invalid" || cancelled.status === "error") return refused(fail(cancelled.status), false);
  return openLink(proof, admin, { parentUserId, ...wanted }, "replace", cancelled.status === "cancelled");
}

/** The link BAI sends or copies: the family's open one when it matches, else per BAI's choice. */
async function resolveLink(proof: AdminProof, admin: AdminClient, panel: DepositPanel, req: LinkChoice): Promise<Resolved> {
  const wanted = wantedFor(panel.cohorts, req.target);
  if (wanted === null) return refused(fail("goodwill_not_offered"), false);
  const open = panel.link;
  const base = { parentUserId: panel.parentUserId, ...wanted };
  if (open !== null && (open.target !== wanted.target || open.goodwillStartDate !== wanted.goodwillStartDate)) {
    if (req.onTargetDiffers === undefined) return refused(differsFrom(open), false);
    if (req.onTargetDiffers === "replace") return replaceOpen(proof, admin, panel.parentUserId, wanted);
    return openLink(proof, admin, { parentUserId: panel.parentUserId, target: open.target, goodwillStartDate: open.goodwillStartDate }, "send_as_is", false);
  }
  if (open === null) {
    const pin = await pinned(admin, wanted);
    if (pin !== "ok") return refused(fail(pin), false);
  }
  return openLink(proof, admin, base, req.onTargetDiffers, false);
}

// ── send ──

/** The email; false when it didn't go (logged by code; `sendEmail` has written its failed `email_logs` row). */
async function emailLink(parentUserId: string, contact: Contact, url: string): Promise<boolean> {
  const { subject, html } = depositLinkEmail({ firstName: contact.firstName, url });
  try {
    const sent = await sendEmail({ to: contact.email, subject, html, emailType: EMAIL_TYPE, recipientUserId: parentUserId });
    if (!sent.success) logFailure("deposit link email", { code: "send_failed" });
    return sent.success;
  } catch (thrown) {
    logFailure("deposit link email", thrown);
    return false;
  }
}

/** After the email is out: the sent stamp and one history row (no address). A failure is logged, not answered. */
async function recordSent(proof: AdminProof, admin: AdminClient, link: DepositLink, to: string): Promise<void> {
  const stamped = await stampLinkSent(proof, admin, { linkId: link.id, to });
  if (stamped.status !== "stamped") logFailure("deposit link sent stamp", { code: stamped.status });
  try {
    const { error } = await admin.from("activity_logs").insert({
      user_id: link.parentUserId,
      action_type: LINK_SENT,
      action_details: { link_id: link.id, target: link.target, goodwill_cohort_start_date: link.goodwillStartDate, actor: proof.userId },
    });
    if (error) logFailure("deposit.link_sent activity", error);
  } catch (thrown) {
    logFailure("deposit.link_sent activity", thrown);
  }
}

async function send(proof: AdminProof, admin: AdminClient, parentUserId: string, req: z.infer<typeof sendRequest>): Promise<SendDepositLinkResult> {
  const unpaid = await unpaidPanel(proof, admin, parentUserId);
  if (!unpaid.ok) return unpaid.result;
  const contact = await readContact(admin, parentUserId);
  if (!contact.ok) return ERROR;
  if (contact.value === null) return fail("no_email");
  const resolved = await resolveLink(proof, admin, unpaid.panel, req);
  if (resolved.link === null) return settle(parentUserId, resolved.wrote, resolved.failure);
  const { link } = resolved;
  if (link.lastEmailedAt !== null && req.confirmResend !== true) {
    return settle(parentUserId, resolved.wrote, { ok: false, error: "confirm_resend", sentAt: isoOf(link.lastEmailedAt) });
  }
  const url = depositLinkUrl(link.code);
  if (!(await emailLink(parentUserId, contact.value, url))) return settle(parentUserId, resolved.wrote, { ok: false, error: "email_failed", url });
  const sentAt = new Date().toISOString();
  await recordSent(proof, admin, link, contact.value.email);
  return settle(parentUserId, true, { ok: true, sentAt, to: maskEmail(contact.value.email) });
}

/** Email the family's deposit link (brief §3 Admin 3). */
export async function sendDepositLink(parentUserId: string, req: SendDepositLinkRequest): Promise<SendDepositLinkResult> {
  const gated = await gate();
  if (!gated.ok) return gated.result;
  const input = sendRequest.safeParse(req);
  if (!isParentId(parentUserId) || !input.success) return INVALID;
  return attempt("send", () => send(gated.proof, createAdminClient(), parentUserId, input.data));
}

// ── copy, take payment now, cancel ──

/** The link for a text (brief §3 Admin 4): made if none is open; no email. */
export async function copyDepositLink(parentUserId: string, req: CopyDepositLinkRequest): Promise<CopyDepositLinkResult> {
  const gated = await gate();
  if (!gated.ok) return gated.result;
  const input = copyRequest.safeParse(req);
  if (!isParentId(parentUserId) || !input.success) return INVALID;
  return attempt("copy", async () => {
    const admin = createAdminClient();
    const unpaid = await unpaidPanel(gated.proof, admin, parentUserId);
    if (!unpaid.ok) return unpaid.result;
    const resolved = await resolveLink(gated.proof, admin, unpaid.panel, input.data);
    if (resolved.link === null) return settle(parentUserId, resolved.wrote, resolved.failure);
    return settle(parentUserId, resolved.wrote, { ok: true as const, url: depositLinkUrl(resolved.link.code) });
  });
}

/** D15: BAI opens the family's page to type the card. The open link (any target) or a new current one; no email. */
export async function takeDepositPaymentNow(parentUserId: string): Promise<TakeDepositPaymentNowResult> {
  const gated = await gate();
  if (!gated.ok) return gated.result;
  if (!isParentId(parentUserId)) return INVALID;
  return attempt("take payment", async () => {
    const admin = createAdminClient();
    const unpaid = await unpaidPanel(gated.proof, admin, parentUserId);
    if (!unpaid.ok) return unpaid.result;
    const open = unpaid.panel.link;
    const wanted: Wanted = open === null ? { target: "current", goodwillStartDate: null } : { target: open.target, goodwillStartDate: open.goodwillStartDate };
    const resolved = await openLink(gated.proof, admin, { parentUserId, ...wanted }, "send_as_is", false);
    if (resolved.link === null) return settle(parentUserId, resolved.wrote, resolved.failure.error === "invalid" ? INVALID : ERROR);
    return settle(parentUserId, resolved.wrote, { ok: true as const, url: depositLinkUrl(resolved.link.code) });
  });
}

/** Stop the open link (a wrong address or a leak); the next send makes a new code. */
export async function cancelDepositLink(parentUserId: string): Promise<CancelDepositLinkResult> {
  const gated = await gate();
  if (!gated.ok) return gated.result;
  if (!isParentId(parentUserId)) return INVALID;
  return attempt("cancel", async () => {
    const cancelled = await cancelOpenLink(gated.proof, createAdminClient(), parentUserId);
    if (cancelled.status === "invalid" || cancelled.status === "error") return fail(cancelled.status);
    const done = cancelled.status === "cancelled";
    return settle(parentUserId, done, { ok: true as const, cancelled: done });
  });
}

// ── bank transfer: mark paid, record refund ──

function markReply(parentUserId: string, marked: BankTransferResult): MarkDepositPaidResult {
  if (marked.status === "marked") return settle(parentUserId, true, OK);
  if (marked.status === "full") return fail(marked.reason === "being_paid" ? "being_paid" : "cohort_full");
  return fail(marked.status);
}

async function markPaid(proof: AdminProof, admin: AdminClient, parentUserId: string, req: z.infer<typeof markPaidRequest>): Promise<MarkDepositPaidResult> {
  const unpaid = await unpaidPanel(proof, admin, parentUserId);
  if (!unpaid.ok) return unpaid.result;
  const wanted = wantedFor(unpaid.panel.cohorts, req.target);
  if (wanted === null) return fail("goodwill_not_offered");
  const startDate = wanted.goodwillStartDate ?? unpaid.panel.cohorts.current?.start ?? null;
  if (startDate === null) return fail("not_bookable");
  const pin = await pinned(admin, wanted);
  if (pin !== "ok") return fail(pin);
  const marked = await markBankTransfer(proof, admin, { parentUserId, startDate, goodwill: wanted.target === "goodwill", note: req.note });
  return markReply(parentUserId, marked);
}

/** Mark the deposit paid by bank transfer (brief §3 Admin 5): the place is taken in the same step, or nothing. */
export async function markDepositPaid(parentUserId: string, req: MarkDepositPaidRequest): Promise<MarkDepositPaidResult> {
  const gated = await gate();
  if (!gated.ok) return gated.result;
  const input = markPaidRequest.safeParse(req);
  if (!isParentId(parentUserId) || !input.success) return INVALID;
  return attempt("mark paid", () => markPaid(gated.proof, createAdminClient(), parentUserId, input.data));
}

/** Record a bank-transfer deposit's refund (brief §3 Admin 6): the stamp, the refund row, the place re-opened. */
export async function recordDepositBankRefund(parentUserId: string, req: RecordDepositBankRefundRequest): Promise<RecordDepositBankRefundResult> {
  const gated = await gate();
  if (!gated.ok) return gated.result;
  const input = refundRequest.safeParse(req);
  if (!isParentId(parentUserId) || !input.success) return INVALID;
  return attempt("bank refund", async () => {
    const refunded = await recordBankRefund(gated.proof, createAdminClient(), { parentUserId, reason: input.data.reason });
    return refunded.status === "refunded" ? settle(parentUserId, true, OK) : fail(refunded.status);
  });
}
