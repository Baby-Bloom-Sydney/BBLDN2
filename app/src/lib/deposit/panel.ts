/**
 * The family's deposit panel read (plan 03 row A5, §8; brief 03 §3 Admin 1–7): everything 03b's block in the
 * Done-for-you panel shows, read once on the server. Read-only. Server-only, deliberately NOT `"use server"`
 * (`src/lib/invite/mint.ts:1-9`), and no session is read here: it returns the family's link code and email, so the
 * caller passes an `AdminProof`, checked before any read.
 *
 * One parallel set of bounded reads: her subscription row, saved card, bank-transfer row, open link, open
 * pre-booking, a head count of duplicate deposits, her taken / re-opened places (paged), 02's `cohort_warnings()`
 * filtered to her (that function returns at most 100 rows a list), and 02's `findCohorts` (current, next, and
 * whether goodwill can be offered — D10). Any failed or malformed read fails the whole panel: it never shows a wrong
 * state (02 §0.12's rule). Failures are logged by code only. The words are `copy.ts`'s, from this view model.
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */

import { z } from "zod";
import { isAdminProof, type AdminProof } from "@/lib/calls/admin-proof";
import { instant, uuid } from "@/lib/calls/zod-parts";
import { isLondonDate } from "@/lib/cohorts/dates";
import { allPages, callRpc, dbOk, DB_FAILED, logFailure, type AdminClient, type DbResult } from "@/lib/cohorts/db";
import { findCohorts } from "@/lib/cohorts/read";
import { canOfferGoodwill } from "@/lib/cohorts/rules";
import type { CohortView } from "@/lib/cohorts/types";
import { londonToday } from "@/lib/timezone";
import { isDepositCode } from "./code";
import { EMAIL_MAX } from "./constants";
import { maskEmail } from "./copy";
import { readOpenPrebooking, type Prebooking } from "./prebook";
import { DEPOSIT_TARGETS, type DepositTarget } from "./types";

export type DepositMethod = "card" | "bank_transfer";

/** The panel's state line (brief §3 Admin 1). `paid_preset` = an old preset deposit (method NULL). */
export type DepositPanelState = "not_paid" | "paid_card" | "paid_bank_transfer" | "paid_preset" | "refunded";

export interface DepositPayment {
  /** What she paid (`deposit_pence`); null only on an old row that never recorded it. */
  readonly pence: number | null;
  readonly paidAt: string;
  readonly refundedAt: string | null;
  readonly method: DepositMethod | null;
  readonly paymentIntentId: string | null;
}

/** `family_saved_cards`: never a card number (brand, last four, expiry). */
export interface SavedCard {
  readonly brand: string;
  readonly last4: string;
  readonly expMonth: number;
  readonly expYear: number;
}

export interface BankTransfer { readonly markedAt: string; readonly refundedAt: string | null }

/** Her place: a taken one, else her latest re-opened one. */
export interface PanelPlace {
  readonly cohortStartDate: string;
  readonly isGoodwill: boolean;
  readonly state: "taken" | "reopened";
}

/** Her open link, as the server reads it. The code and the full address stay on the server: `toClientPanel`. */
export interface PanelLink {
  readonly id: string;
  readonly code: string;
  readonly target: DepositTarget;
  readonly goodwillStartDate: string | null;
  readonly createdAt: string;
  readonly lastEmailedAt: string | null;
  readonly lastEmailedTo: string | null;
}

export type DepositWarning = "duplicate_payment" | "refunded_but_held";

/** 03b's target choice (D10): goodwill only when `canOfferGoodwill`. */
export interface PanelCohorts {
  readonly current: CohortView | null;
  readonly next: CohortView | null;
  readonly canOfferGoodwill: boolean;
}

export interface DepositPanel {
  readonly parentUserId: string;
  /** London's today, for "Sent 14:02" (today) against "Sent 1 Feb 18:30". */
  readonly today: string;
  readonly state: DepositPanelState;
  readonly payment: DepositPayment | null;
  readonly card: SavedCard | null;
  readonly bankTransfer: BankTransfer | null;
  readonly place: PanelPlace | null;
  readonly link: PanelLink | null;
  readonly prebooking: Prebooking | null;
  readonly duplicatePayments: number;
  readonly warnings: readonly DepositWarning[];
  readonly cohorts: PanelCohorts;
  /** Send / copy / take payment now / mark paid: only while nothing is paid (one deposit per family, Q8). */
  readonly canTakeDeposit: boolean;
  /** Record refund (bank transfer): a bank-transfer deposit not yet refunded. */
  readonly canRecordBankRefund: boolean;
}

export type DepositPanelResult = { readonly ok: true; readonly value: DepositPanel } | { readonly ok: false; readonly status: "invalid" | "error" };

const INVALID = Object.freeze({ ok: false, status: "invalid" } as const);
const ERROR = Object.freeze({ ok: false, status: "error" } as const);
const LINK_COLUMNS = "id, code, target, goodwill_cohort_start_date, created_at, last_emailed_at, last_emailed_to";
const PLACE_COLUMNS = "cohort_start_date, state, is_goodwill, taken_at, reopened_at";

const cohortDate = z.string().refine(isLondonDate);

const paymentRow = z
  .object({
    deposit_pence: z.number().int().min(0).nullable(),
    deposit_paid_at: instant.nullable(),
    deposit_refunded_at: instant.nullable(),
    deposit_method: z.enum(["card", "bank_transfer"]).nullable(),
    deposit_stripe_payment_intent_id: z.string().min(1).nullable(),
  })
  .transform((r): DepositPayment | null =>
    r.deposit_paid_at === null
      ? null
      : Object.freeze({ pence: r.deposit_pence, paidAt: r.deposit_paid_at, refundedAt: r.deposit_refunded_at, method: r.deposit_method, paymentIntentId: r.deposit_stripe_payment_intent_id }),
  );

const cardRow = z
  .object({ brand: z.string().min(1).max(40), last4: z.string().regex(/^[0-9]{4}$/), exp_month: z.number().int().min(1).max(12), exp_year: z.number().int().min(2000).max(2100) })
  .transform((r): SavedCard => Object.freeze({ brand: r.brand, last4: r.last4, expMonth: r.exp_month, expYear: r.exp_year }));

const bankRow = z
  .object({ marked_at: instant, refunded_at: instant.nullable() })
  .transform((r): BankTransfer => Object.freeze({ markedAt: r.marked_at, refundedAt: r.refunded_at }));

const linkRow = z
  .object({
    id: uuid,
    code: z.string().refine(isDepositCode),
    target: z.enum(DEPOSIT_TARGETS),
    goodwill_cohort_start_date: cohortDate.nullable(),
    created_at: instant,
    last_emailed_at: instant.nullable(),
    last_emailed_to: z.string().max(EMAIL_MAX).nullable(),
  })
  .refine((r) => (r.target === "goodwill") === (r.goodwill_cohort_start_date !== null))
  .transform(
    (r): PanelLink =>
      Object.freeze({ id: r.id, code: r.code, target: r.target, goodwillStartDate: r.goodwill_cohort_start_date, createdAt: r.created_at, lastEmailedAt: r.last_emailed_at, lastEmailedTo: r.last_emailed_to }),
  );

const placeRow = z.object({ cohort_start_date: cohortDate, state: z.enum(["taken", "reopened"]), is_goodwill: z.boolean(), taken_at: instant.nullable(), reopened_at: instant.nullable() });
type PlaceRow = z.infer<typeof placeRow>;

const warningsReply = z.object({ refunded_but_held: z.array(z.object({ parent_user_id: z.string() })) });

type Reply = PromiseLike<{ readonly data: unknown; readonly error: { readonly message: string; readonly code?: string } | null }>;

/** One row (or none) by her id, parsed; a read error or a row that doesn't fit fails. */
async function readOne<S extends z.ZodType>(label: string, query: Reply, schema: S): Promise<DbResult<z.output<S> | null>> {
  const { data, error } = await query;
  if (error) {
    logFailure(label, error);
    return DB_FAILED;
  }
  if (data === null) return dbOk(null);
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    logFailure(label, { code: "unexpected_row" });
    return DB_FAILED;
  }
  return dbOk(parsed.data);
}

async function readDuplicateCount(admin: AdminClient, parentUserId: string): Promise<DbResult<number>> {
  const { count, error } = await admin.from("deposit_duplicate_payments").select("id", { count: "exact", head: true }).eq("parent_user_id", parentUserId);
  if (error || typeof count !== "number" || !Number.isInteger(count) || count < 0) {
    logFailure("deposit.panel.duplicates", error ?? { code: "no_count" });
    return DB_FAILED;
  }
  return dbOk(count);
}

/** The latest row in a state, by one of its times. */
function latestIn(rows: readonly PlaceRow[], state: PlaceRow["state"], at: (r: PlaceRow) => string | null): PlaceRow | null {
  return rows.filter((r) => r.state === state).reduce<PlaceRow | null>((best, r) => (best === null || (at(r) ?? "") > (at(best) ?? "") ? r : best), null);
}

async function readPlace(admin: AdminClient, parentUserId: string): Promise<DbResult<PanelPlace | null>> {
  const rows = await allPages("deposit.panel.places", (from, to) =>
    admin.from("cohort_places").select(PLACE_COLUMNS).eq("parent_user_id", parentUserId).in("state", ["taken", "reopened"])
      .order("id", { ascending: true }).range(from, to),
  );
  if (!rows.ok) return rows;
  const parsed = z.array(placeRow).safeParse(rows.value);
  if (!parsed.success) {
    logFailure("deposit.panel.places", { code: "unexpected_row" });
    return DB_FAILED;
  }
  const row = latestIn(parsed.data, "taken", (r) => r.taken_at) ?? latestIn(parsed.data, "reopened", (r) => r.reopened_at);
  return dbOk(row === null ? null : Object.freeze({ cohortStartDate: row.cohort_start_date, isGoodwill: row.is_goodwill, state: row.state }));
}

/** 02's "Deposit refunded but place still held", for her. */
async function readRefundedButHeld(admin: AdminClient, parentUserId: string): Promise<DbResult<boolean>> {
  const called = await callRpc(admin, "cohort_warnings", {});
  if (!called.ok) return called;
  const parsed = warningsReply.safeParse(called.value);
  if (!parsed.success) {
    logFailure("deposit.panel.warnings", { code: "unexpected_reply" });
    return DB_FAILED;
  }
  return dbOk(parsed.data.refunded_but_held.some((w) => w.parent_user_id === parentUserId));
}

async function readCohorts(admin: AdminClient, now: Date): Promise<DbResult<PanelCohorts>> {
  const found = await findCohorts(admin, now);
  if (!found.ok) return found;
  const { current, next } = found.value;
  return dbOk(Object.freeze({ current, next, canOfferGoodwill: canOfferGoodwill(current, next) }));
}

interface PanelReads {
  readonly payment: DepositPayment | null;
  readonly card: SavedCard | null;
  readonly bank: BankTransfer | null;
  readonly link: PanelLink | null;
  readonly prebooking: Prebooking | null;
  readonly duplicates: number;
  readonly place: PanelPlace | null;
  readonly refundedButHeld: boolean;
  readonly cohorts: PanelCohorts;
}

/** Every read at once; null when any of them failed. */
async function readAll(admin: AdminClient, parentUserId: string, now: Date): Promise<PanelReads | null> {
  const hers = (table: string, columns: string) => admin.from(table).select(columns).eq("parent_user_id", parentUserId);
  const [payment, card, bank, link, prebooking, duplicates, place, refundedButHeld, cohorts] = await Promise.all([
    readOne("deposit.panel.subscription", hers("parent_subscriptions", "deposit_pence, deposit_paid_at, deposit_refunded_at, deposit_method, deposit_stripe_payment_intent_id").maybeSingle(), paymentRow),
    readOne("deposit.panel.card", hers("family_saved_cards", "brand, last4, exp_month, exp_year").maybeSingle(), cardRow),
    readOne("deposit.panel.bank", hers("deposit_bank_transfers", "marked_at, refunded_at").maybeSingle(), bankRow),
    readOne("deposit.panel.link", hers("deposit_links", LINK_COLUMNS).eq("state", "open").maybeSingle(), linkRow),
    readOpenPrebooking(admin, parentUserId),
    readDuplicateCount(admin, parentUserId),
    readPlace(admin, parentUserId),
    readRefundedButHeld(admin, parentUserId),
    readCohorts(admin, now),
  ]);
  if (!payment.ok || !card.ok || !bank.ok || !link.ok || !prebooking.ok || !duplicates.ok || !place.ok || !refundedButHeld.ok || !cohorts.ok) return null;
  return { payment: payment.value, card: card.value, bank: bank.value, link: link.value, prebooking: prebooking.value,
    duplicates: duplicates.value, place: place.value, refundedButHeld: refundedButHeld.value, cohorts: cohorts.value };
}

function stateOf(payment: DepositPayment | null): DepositPanelState {
  if (payment === null) return "not_paid";
  if (payment.refundedAt !== null) return "refunded";
  if (payment.method === "card") return "paid_card";
  return payment.method === "bank_transfer" ? "paid_bank_transfer" : "paid_preset";
}

function panelOf(parentUserId: string, now: Date, r: PanelReads): DepositPanel {
  const state = stateOf(r.payment);
  const warnings: readonly DepositWarning[] = [
    ...(r.duplicates > 0 ? (["duplicate_payment"] as const) : []),
    ...(r.refundedButHeld ? (["refunded_but_held"] as const) : []),
  ];
  return Object.freeze({
    parentUserId,
    today: londonToday(now),
    state,
    payment: r.payment,
    card: r.card,
    bankTransfer: r.bank,
    place: r.place,
    link: r.link,
    prebooking: r.prebooking,
    duplicatePayments: r.duplicates,
    warnings: Object.freeze(warnings),
    cohorts: r.cohorts,
    canTakeDeposit: state === "not_paid",
    canRecordBankRefund: state === "paid_bank_transfer",
  });
}

/** The family's deposit panel. `invalid` before any read without a real admin proof or a user id. */
export async function readDepositPanel(proof: AdminProof, admin: AdminClient, parentUserId: string, now: Date): Promise<DepositPanelResult> {
  if (!isAdminProof(proof)) return INVALID;
  if (!uuid.safeParse(parentUserId).success) return INVALID;
  try {
    const reads = await readAll(admin, parentUserId, now);
    return reads === null ? ERROR : Object.freeze({ ok: true, value: panelOf(parentUserId, now, reads) });
  } catch (thrown) {
    logFailure("deposit.panel", thrown);
    return ERROR;
  }
}

// ── What the admin page hands its client block (03b review M1; BB-wave2-231126/03-build, 2026-11-25) ──────────────
// The page (a server component) passes the panel to `SubscriptionDetailHeader`, a client component, so all of it is
// sent to the browser. The block never needs the link's code (Copy and Take payment get the URL from the server
// actions) or the payment intent id, and shows the address only masked: `toClientPanel` leaves them out.

/** Her open link as the client block gets it: no id, no code, the address masked ("s•••@gmail.com"). */
export interface ClientPanelLink {
  readonly target: DepositTarget;
  readonly goodwillStartDate: string | null;
  readonly createdAt: string;
  readonly lastEmailedAt: string | null;
  /** Masked (`maskEmail`). */
  readonly lastEmailedTo: string | null;
}

export type ClientDepositPayment = Omit<DepositPayment, "paymentIntentId">;

export type ClientDepositPanel = Omit<DepositPanel, "link" | "payment"> & {
  readonly link: ClientPanelLink | null;
  readonly payment: ClientDepositPayment | null;
};

export type ClientDepositPanelResult = { readonly ok: true; readonly value: ClientDepositPanel } | Extract<DepositPanelResult, { readonly ok: false }>;

const clientLink = (link: PanelLink): ClientPanelLink =>
  Object.freeze({
    target: link.target,
    goodwillStartDate: link.goodwillStartDate,
    createdAt: link.createdAt,
    lastEmailedAt: link.lastEmailedAt,
    lastEmailedTo: link.lastEmailedTo === null ? null : maskEmail(link.lastEmailedTo),
  });

const clientPayment = (payment: DepositPayment): ClientDepositPayment =>
  Object.freeze({ pence: payment.pence, paidAt: payment.paidAt, refundedAt: payment.refundedAt, method: payment.method });

/** The page's read, for the client block: the same panel less the code, the payment intent id and the full address. */
export function toClientPanel(result: DepositPanelResult): ClientDepositPanelResult {
  if (!result.ok) return result;
  const { link, payment, ...rest } = result.value;
  const value: ClientDepositPanel = Object.freeze({
    ...rest,
    link: link === null ? null : clientLink(link),
    payment: payment === null ? null : clientPayment(payment),
  });
  return Object.freeze({ ok: true as const, value });
}
