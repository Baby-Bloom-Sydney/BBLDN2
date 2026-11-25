/**
 * Amendment 18's three money functions, typed (plan 03 §3, §5; contract-18). Each writes the deposit and the place
 * together in one database step, so nothing here writes a table itself.
 *
 * - `recordCardPayment` — the webhook's card deposit (`deposit_record_card_payment`). The caller has verified the
 *   Stripe event; the amount is what Stripe charged (`amount_total`), never metadata.
 * - `markBankTransfer` / `recordBankRefund` — BAI's bank-transfer mark and refund. They take an `AdminProof`; the
 *   amount is `PRICES.dfy.depositPence` (never an input) and the actor is the proof's user.
 * - `keepStatusFor` — the ONE status rule (plan 03 §3 "Status rule"): a `placed` family, or a live self-serve one,
 *   keeps its status; the SQL takes the answer as `p_keep_status`, so the rule has no SQL copy.
 * - Input is checked before any call (`invalid`). Every reply is zod-parsed into a closed, frozen union; an RPC
 *   error, a throw or a reply that doesn't fit is `error`, logged by code only. Nothing here throws.
 * - Server-only, deliberately NOT `"use server"` (`src/lib/invite/mint.ts:1-9`).
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */

import { z } from "zod";
import { PRICES } from "@/config/prices";
import { isAdminProof, type AdminProof } from "@/lib/calls/admin-proof";
import { callRpc, logFailure, type AdminClient } from "@/lib/cohorts/db";
import { isLondonDate } from "@/lib/cohorts/dates";
import { isLiveSelfServe } from "@/lib/payments/dfy-access";
import { NOTE_MAX, NOTE_MIN, REFUND_REASON_MAX, REFUND_REASON_MIN } from "./constants";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const STRIPE_ID_MAX = 255;
const isStripeId = (v: unknown): v is string => typeof v === "string" && v.length >= 1 && v.length <= STRIPE_ID_MAX;

const INVALID = Object.freeze({ status: "invalid" } as const);
const ERROR = Object.freeze({ status: "error" } as const);
type Failed = typeof INVALID | typeof ERROR;

// ── the status rule ──

/** The family-row columns the status rule reads (`parent_subscriptions`). */
export type StatusRow = Parameters<typeof isLiveSelfServe>[0];

/** Keep the family's status? Exactly `dfy-webhook.ts`'s rule: placed, or a live self-serve state. No row → false. */
export function keepStatusFor(row: StatusRow | null): boolean {
  return row !== null && (row.status === "placed" || isLiveSelfServe(row));
}

// ── reply parsing ──

/** Parse a reply with the first schema that fits; nothing fits → `error`, logged. */
function parseReply<T>(fn: string, data: unknown, readers: ReadonlyArray<(d: unknown) => T | null>): T | typeof ERROR {
  for (const read of readers) {
    const value = read(data);
    if (value !== null) return Object.freeze(value);
  }
  logFailure(fn, { code: "unexpected_reply" });
  return ERROR;
}

const via = <S extends z.ZodType, T>(schema: S, map: (v: z.infer<S>) => T) => (d: unknown): T | null => {
  const parsed = schema.safeParse(d);
  return parsed.success ? map(parsed.data) : null;
};

const statusOnly = <S extends string>(statuses: readonly [S, ...S[]]) =>
  via(z.object({ status: z.enum(statuses) }), (v) => ({ status: v.status }));

async function run<T>(admin: AdminClient, fn: string, args: Readonly<Record<string, unknown>>, read: (data: unknown) => T): Promise<T | typeof ERROR> {
  const called = await callRpc(admin, fn, args);
  return called.ok ? read(called.value) : ERROR;
}

// ── card ──

export interface CardPaymentRequest {
  readonly parentUserId: string;
  readonly linkId: string;
  readonly holdId: string;
  readonly sessionId: string;
  readonly paymentIntentId: string;
  /** What Stripe charged (`amount_total`). */
  readonly pence: number;
  /** The session's Stripe customer; stored on the family only where it has none. */
  readonly customerId: string | null;
  readonly keepStatus: boolean;
}

/** `cohort_take_place`'s statuses, as the card function passes them back. */
export const PLACE_STATUSES = Object.freeze(
  ["taken", "already_recorded", "full", "already_taken", "hold_not_found", "not_bookable", "not_a_cohort", "invalid"] as const,
);
export type PlaceStatus = (typeof PLACE_STATUSES)[number];

export interface CardPlace {
  readonly status: PlaceStatus;
  readonly placeId?: string;
  readonly cohortStartDate?: string;
  readonly overBy?: number;
}

export type CardPaymentResult =
  | { readonly status: "recorded"; readonly place: CardPlace }
  | { readonly status: "already_recorded" | "duplicate" }
  | Failed;

const recordedReply = z.object({
  status: z.literal("recorded"),
  place: z.enum(PLACE_STATUSES),
  place_id: z.string().min(1).nullish(),
  cohort_start_date: z.string().min(1).nullish(),
  over_by: z.number().int().min(0).nullish(),
});

function placeOf(v: z.infer<typeof recordedReply>): CardPlace {
  return Object.freeze({
    status: v.place,
    ...(v.place_id ? { placeId: v.place_id } : {}),
    ...(v.cohort_start_date ? { cohortStartDate: v.cohort_start_date } : {}),
    ...(typeof v.over_by === "number" ? { overBy: v.over_by } : {}),
  });
}

function isCardRequest(req: CardPaymentRequest): boolean {
  return isUuid(req.parentUserId) && isUuid(req.linkId) && isUuid(req.holdId) && isStripeId(req.sessionId)
    && isStripeId(req.paymentIntentId) && Number.isInteger(req.pence) && req.pence >= 0
    && (req.customerId === null || isStripeId(req.customerId)) && typeof req.keepStatus === "boolean";
}

/** The card deposit and its place, in one step. A place refusal still records the money (02 R3). */
export async function recordCardPayment(admin: AdminClient, req: CardPaymentRequest): Promise<CardPaymentResult> {
  if (!isCardRequest(req)) return INVALID;
  const args = {
    p_parent: req.parentUserId, p_link_id: req.linkId, p_hold_id: req.holdId, p_session_id: req.sessionId,
    p_payment_intent: req.paymentIntentId, p_pence: req.pence, p_customer: req.customerId, p_keep_status: req.keepStatus,
  };
  return run(admin, "deposit_record_card_payment", args, (data) =>
    parseReply<CardPaymentResult>("deposit_record_card_payment", data, [
      via(recordedReply, (v) => ({ status: "recorded", place: placeOf(v) })),
      statusOnly(["already_recorded", "duplicate", "invalid"]),
    ]),
  );
}

// ── bank transfer ──

export interface BankTransferRequest {
  readonly parentUserId: string;
  readonly startDate: string;
  readonly goodwill: boolean;
  /** BAI's note, e.g. "transfer ref JONES": 1–500 characters once trimmed. */
  readonly note: string;
}

export type BankTransferResult =
  | { readonly status: "marked"; readonly placeId: string; readonly cohortStartDate: string; readonly isGoodwill: boolean }
  | { readonly status: "full"; readonly reason: "all_taken" | "being_paid" }
  | { readonly status: "already_paid" | "not_bookable" | "not_a_cohort" | "already_taken" }
  | Failed;

const statusRow = z.object({
  status: z.string(),
  family_type: z.string().nullable(),
  trial_ends_at: z.string().nullable(),
  paid_period_ends_at: z.string().nullable(),
  past_due_grace_ends_at: z.string().nullable(),
});
const STATUS_COLUMNS = "status, family_type, trial_ends_at, paid_period_ends_at, past_due_grace_ends_at";

const trimmedWithin = (value: unknown, min: number, max: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= min && trimmed.length <= max ? trimmed : null;
};

/** The family's status rule, read from her row; null when the read fails (logged). */
async function readKeepStatus(admin: AdminClient, parentUserId: string): Promise<boolean | null> {
  const { data, error } = await admin.from("parent_subscriptions").select(STATUS_COLUMNS).eq("parent_user_id", parentUserId).maybeSingle();
  if (error) {
    logFailure("deposit family read", error);
    return null;
  }
  if (data === null) return keepStatusFor(null);
  const row = statusRow.safeParse(data);
  if (!row.success) {
    logFailure("deposit family read", { code: "unexpected_row" });
    return null;
  }
  return keepStatusFor(row.data);
}

/** BAI marks the deposit paid by bank transfer: the place is taken in the same step, or nothing is written. */
export async function markBankTransfer(proof: AdminProof, admin: AdminClient, req: BankTransferRequest): Promise<BankTransferResult> {
  const note = trimmedWithin(req.note, NOTE_MIN, NOTE_MAX);
  if (!isAdminProof(proof) || !isUuid(req.parentUserId) || !isLondonDate(req.startDate) || typeof req.goodwill !== "boolean" || note === null) {
    return INVALID;
  }
  try {
    const keepStatus = await readKeepStatus(admin, req.parentUserId);
    if (keepStatus === null) return ERROR;
    const args = {
      p_parent: req.parentUserId, p_start: req.startDate, p_goodwill: req.goodwill, p_pence: PRICES.dfy.depositPence,
      p_note: note, p_actor: proof.userId, p_keep_status: keepStatus,
    };
    return await run(admin, "deposit_mark_bank_transfer", args, (data) =>
      parseReply<BankTransferResult>("deposit_mark_bank_transfer", data, [
        via(z.object({ status: z.literal("marked"), place_id: z.string().min(1), cohort_start_date: z.string().min(1), is_goodwill: z.boolean() }),
          (v) => ({ status: "marked", placeId: v.place_id, cohortStartDate: v.cohort_start_date, isGoodwill: v.is_goodwill })),
        via(z.object({ status: z.literal("full"), reason: z.enum(["all_taken", "being_paid"]) }), (v) => ({ status: "full", reason: v.reason })),
        statusOnly(["already_paid", "not_bookable", "not_a_cohort", "already_taken", "invalid"]),
      ]),
    );
  } catch (thrown) {
    logFailure("markBankTransfer", thrown);
    return ERROR;
  }
}

/** `cohort_reopen_place`'s statuses, or `not_found` when she had no taken bank-transfer place. */
export const REOPEN_STATUSES = Object.freeze(["reopened", "already_reopened", "not_taken", "not_found", "invalid"] as const);

export type BankRefundResult =
  | { readonly status: "refunded"; readonly place: (typeof REOPEN_STATUSES)[number] }
  | { readonly status: "not_bank_transfer" | "already_refunded" }
  | Failed;

/** BAI records a bank-transfer refund: the stamp, the refund row and the re-opened place, in one step. */
export async function recordBankRefund(
  proof: AdminProof,
  admin: AdminClient,
  req: { readonly parentUserId: string; readonly reason: string },
): Promise<BankRefundResult> {
  const reason = trimmedWithin(req.reason, REFUND_REASON_MIN, REFUND_REASON_MAX);
  if (!isAdminProof(proof) || !isUuid(req.parentUserId) || reason === null) return INVALID;
  return run(admin, "deposit_record_bank_refund", { p_parent: req.parentUserId, p_reason: reason, p_actor: proof.userId }, (data) =>
    parseReply<BankRefundResult>("deposit_record_bank_refund", data, [
      via(z.object({ status: z.literal("refunded"), place: z.enum(REOPEN_STATUSES) }), (v) => ({ status: "refunded", place: v.place })),
      statusOnly(["not_bank_transfer", "already_refunded", "invalid"]),
    ]),
  );
}
