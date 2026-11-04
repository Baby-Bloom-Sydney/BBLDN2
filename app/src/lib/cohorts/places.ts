/**
 * The place operations (brief §5 "operations this brief owns"; plan 02 §8): briefs 03, 04 and 05 call these, and
 * nothing else writes places. Server-only, deliberately NOT `"use server"` (`src/lib/invite/mint.ts:1-9`): every
 * export here writes any family's place with the service role.
 *
 * - Every write is one amendment 17 function (`.rpc()`), which locks, checks and logs `activity_logs` itself.
 * - A parent id passed in is the subject, never proof of who acts (04a security review). Operations BAI performs
 *   take an `AdminProof` from `proveAdmin()` (imported from `@/lib/calls/admin-proof`, the module 04's
 *   `contracts.ts` re-exports; `isAdminProof` isn't re-exported there) and record its user as the actor.
 * - Results are closed unions. A refusal is its status; an RPC error, a throw or a reply that doesn't fit is
 *   `{ ok: false, status: "error" }`, logged by code. Nothing is thrown, and nothing here talks to Stripe.
 *
 * BB-wave1-041126/02-build, 2026-11-04.
 */

import { z } from "zod";
import { isAdminProof, type AdminProof } from "@/lib/calls/admin-proof";
import { HOLD_MINUTES, HOLD_MINUTES_MAX } from "./constants";
import { belowTakenMessage } from "./copy";
import { isLondonDate } from "./dates";
import { callRpc, dbOk, DB_FAILED, logFailure, type AdminClient, type DbResult } from "./db";
import { parsePlaces, validateReason, validateSchedule } from "./rules";
import type { CohortSchedule, PaidBy, PlaceState } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const isStripeId = (v: unknown): v is string => typeof v === "string" && v.length >= 1 && v.length <= 255;

const INVALID = Object.freeze({ ok: false, status: "invalid" } as const);
const ERROR = Object.freeze({ ok: false, status: "error" } as const);
type Failed = typeof INVALID | typeof ERROR;

const fullReason = z.enum(["all_taken", "being_paid"]);
const refusal = <S extends string>(statuses: readonly [S, ...S[]]) => z.object({ status: z.enum(statuses) });

/** Parse a reply with the first schema that fits; nothing fits → `error`, logged. */
function reply<T>(fn: string, data: unknown, readers: ReadonlyArray<(d: unknown) => T | null>): T | typeof ERROR {
  for (const read of readers) {
    const value = read(data);
    if (value !== null) return value;
  }
  logFailure(fn, { code: "unexpected_reply" });
  return ERROR;
}

const via = <S extends z.ZodType, T>(schema: S, map: (v: z.infer<S>) => T) => (d: unknown): T | null => {
  const parsed = schema.safeParse(d);
  return parsed.success ? map(parsed.data) : null;
};

async function run<T>(admin: AdminClient, fn: string, args: Readonly<Record<string, unknown>>, read: (data: unknown) => T): Promise<T | typeof ERROR> {
  const called = await callRpc(admin, fn, args);
  return called.ok ? read(called.value) : ERROR;
}

// ── hold, attach, release (brief 03: Pay, the Stripe session, the back button) ──

export type HoldResult =
  | {
      readonly ok: true;
      readonly status: "held" | "existing_hold";
      readonly placeId: string;
      readonly cohortStartDate: string;
      readonly holdExpiresAt: string;
      readonly isGoodwill: boolean;
      readonly sessionId: string | null;
    }
  | { readonly ok: false; readonly status: "full"; readonly reason: z.infer<typeof fullReason> }
  | { readonly ok: false; readonly status: "already_taken" | "already_holding" | "not_bookable" | "not_a_cohort" }
  | Failed;

const heldReply = z.object({
  status: z.enum(["held", "existing_hold"]),
  place_id: z.string().min(1),
  cohort_start_date: z.string().min(1),
  hold_expires_at: z.string().min(1),
  is_goodwill: z.boolean(),
  stripe_checkout_session_id: z.string().nullable().optional(),
});
const fullReply = z.object({ status: z.literal("full"), reason: fullReason });
const holdRefusal = refusal(["already_taken", "already_holding", "not_bookable", "not_a_cohort", "invalid"]);

export interface HoldRequest {
  readonly parentUserId: string;
  readonly startDate: string;
  readonly goodwill: boolean;
  readonly minutes?: number;
}

/** Hold a place for a family (check and hold in one locked step). A second press returns the first hold. */
export async function holdPlace(admin: AdminClient, req: HoldRequest): Promise<HoldResult> {
  const minutes = req.minutes ?? HOLD_MINUTES;
  if (!isUuid(req.parentUserId) || !isLondonDate(req.startDate) || typeof req.goodwill !== "boolean"
      || !Number.isInteger(minutes) || minutes < 1 || minutes > HOLD_MINUTES_MAX) return INVALID;
  const args = { p_parent: req.parentUserId, p_start: req.startDate, p_minutes: minutes, p_goodwill: req.goodwill };
  return run(admin, "cohort_hold_place", args, (data) =>
    reply<HoldResult>("cohort_hold_place", data, [
      via(heldReply, (v) => ({
        ok: true, status: v.status, placeId: v.place_id, cohortStartDate: v.cohort_start_date, holdExpiresAt: v.hold_expires_at,
        isGoodwill: v.is_goodwill, sessionId: v.stripe_checkout_session_id ?? null,
      })),
      via(fullReply, (v) => ({ ok: false, status: "full", reason: v.reason })),
      via(holdRefusal, (v) => ({ ok: false, status: v.status })),
    ]),
  );
}

export type AttachResult =
  | { readonly ok: true; readonly status: "attached" }
  | { readonly ok: false; readonly status: "hold_expired" | "session_mismatch" | "not_found" | "not_a_hold" }
  | Failed;

/** Record the Stripe Checkout session a live hold is for. Idempotent for the same session. */
export async function attachHoldSession(
  admin: AdminClient,
  req: { readonly placeId: string; readonly parentUserId: string; readonly sessionId: string },
): Promise<AttachResult> {
  if (!isUuid(req.placeId) || !isUuid(req.parentUserId) || !isStripeId(req.sessionId)) return INVALID;
  const args = { p_place_id: req.placeId, p_parent: req.parentUserId, p_session_id: req.sessionId };
  return run(admin, "cohort_attach_session", args, (data) =>
    reply<AttachResult>("cohort_attach_session", data, [
      via(refusal(["attached"]), () => ({ ok: true, status: "attached" })),
      via(refusal(["hold_expired", "session_mismatch", "not_found", "not_a_hold", "invalid"]), (v) => ({ ok: false, status: v.status })),
    ]),
  );
}

export type ReleaseResult =
  | { readonly ok: true; readonly status: "released" | "already_released" }
  | { readonly ok: false; readonly status: "not_found" | "not_a_hold" }
  | Failed;

/** Release a family's hold (Stripe back button). Idempotent. */
export async function releaseHold(
  admin: AdminClient,
  req: { readonly placeId: string; readonly parentUserId: string },
): Promise<ReleaseResult> {
  if (!isUuid(req.placeId) || !isUuid(req.parentUserId)) return INVALID;
  return run(admin, "cohort_release_hold", { p_place_id: req.placeId, p_parent: req.parentUserId }, (data) =>
    reply<ReleaseResult>("cohort_release_hold", data, [
      via(refusal(["released", "already_released"]), (v) => ({ ok: true, status: v.status })),
      via(refusal(["not_found", "not_a_hold", "invalid"]), (v) => ({ ok: false, status: v.status })),
    ]),
  );
}

// ── take (brief 03: the webhook converts a hold; BAI's bank-transfer mark-paid takes directly) ──

export type TakeRequest =
  | {
      readonly kind: "convert";
      readonly parentUserId: string;
      readonly holdId: string;
      readonly paymentIntentId: string;
      readonly sessionId?: string | null;
      readonly startDate?: string | null;
    }
  | {
      readonly kind: "direct";
      readonly proof: AdminProof;
      readonly parentUserId: string;
      readonly startDate: string;
      readonly paidBy: PaidBy;
      readonly goodwill: boolean;
      readonly paymentIntentId?: string | null;
    };

export type TakeResult =
  | {
      readonly ok: true;
      readonly status: "taken";
      readonly placeId: string;
      readonly cohortStartDate: string;
      readonly isGoodwill: boolean;
      readonly overBy: number;
    }
  | { readonly ok: true; readonly status: "already_recorded"; readonly placeId: string; readonly cohortStartDate: string; readonly state: PlaceState }
  | { readonly ok: false; readonly status: "full"; readonly reason: z.infer<typeof fullReason> }
  | { readonly ok: false; readonly status: "already_taken" | "hold_not_found" | "not_bookable" | "not_a_cohort" }
  | Failed;

const takenReply = z.object({
  status: z.literal("taken"),
  place_id: z.string().min(1),
  cohort_start_date: z.string().min(1),
  is_goodwill: z.boolean(),
  over_by: z.number().int().min(0),
});
const recordedReply = z.object({
  status: z.literal("already_recorded"),
  place_id: z.string().min(1),
  cohort_start_date: z.string().min(1),
  state: z.enum(["held", "hold_released", "taken", "reopened"]),
});

function takeArgs(req: TakeRequest): Readonly<Record<string, unknown>> | null {
  if (!isUuid(req.parentUserId)) return null;
  if (req.kind === "convert") {
    const startOk = req.startDate === undefined || req.startDate === null || isLondonDate(req.startDate);
    const sessionOk = req.sessionId === undefined || req.sessionId === null || isStripeId(req.sessionId);
    if (!isUuid(req.holdId) || !isStripeId(req.paymentIntentId) || !startOk || !sessionOk) return null;
    return { p_parent: req.parentUserId, p_start: req.startDate ?? null, p_hold_id: req.holdId, p_paid_by: "card",
      p_payment_intent: req.paymentIntentId, p_goodwill: false, p_session_id: req.sessionId ?? null, p_actor: null };
  }
  const intent = req.paymentIntentId ?? null;
  if (!isAdminProof(req.proof) || !isLondonDate(req.startDate) || (intent !== null && !isStripeId(intent))
      || (req.paidBy !== "card" && req.paidBy !== "bank_transfer") || typeof req.goodwill !== "boolean") return null;
  return { p_parent: req.parentUserId, p_start: req.startDate, p_hold_id: null, p_paid_by: req.paidBy,
    p_payment_intent: intent, p_goodwill: req.goodwill, p_session_id: null, p_actor: req.proof.userId };
}

/** Take a place: convert a paid hold (no re-check; may come back over by 1) or directly (checked). */
export async function takePlace(admin: AdminClient, req: TakeRequest): Promise<TakeResult> {
  const args = takeArgs(req);
  if (args === null) return INVALID;
  return run(admin, "cohort_take_place", args, (data) =>
    reply<TakeResult>("cohort_take_place", data, [
      via(takenReply, (v) => ({
        ok: true, status: "taken", placeId: v.place_id, cohortStartDate: v.cohort_start_date, isGoodwill: v.is_goodwill, overBy: v.over_by,
      })),
      via(recordedReply, (v) => ({ ok: true, status: "already_recorded", placeId: v.place_id, cohortStartDate: v.cohort_start_date, state: v.state })),
      via(fullReply, (v) => ({ ok: false, status: "full", reason: v.reason })),
      via(refusal(["already_taken", "hold_not_found", "not_bookable", "not_a_cohort", "invalid"]), (v) => ({ ok: false, status: v.status })),
    ]),
  );
}

// ── BAI's operations: places, re-open, the schedule ──

export type SetPlacesResult =
  | { readonly ok: true; readonly status: "updated"; readonly places: number; readonly left: number }
  | { readonly ok: false; readonly status: "below_taken"; readonly takenOrHeld: number; readonly message: string }
  | { readonly ok: false; readonly status: "past_cohort" | "not_a_cohort" }
  | Failed;

/** Set one cohort's places; refused below taken + being paid (brief §0.4). */
export async function setCohortPlaces(
  proof: AdminProof,
  admin: AdminClient,
  req: { readonly startDate: string; readonly places: number },
): Promise<SetPlacesResult> {
  const places = parsePlaces(req.places);
  if (!isAdminProof(proof) || !isLondonDate(req.startDate) || places === null) return INVALID;
  return run(admin, "cohort_set_places", { p_start: req.startDate, p_places: places, p_actor: proof.userId }, (data) =>
    reply<SetPlacesResult>("cohort_set_places", data, [
      via(z.object({ status: z.literal("updated"), places: z.number().int(), left: z.number().int() }), (v) => ({
        ok: true, status: "updated", places: v.places, left: v.left,
      })),
      via(z.object({ status: z.literal("below_taken"), taken_or_held: z.number().int().min(0) }), (v) => ({
        ok: false, status: "below_taken", takenOrHeld: v.taken_or_held, message: belowTakenMessage(v.taken_or_held),
      })),
      via(refusal(["past_cohort", "not_a_cohort", "invalid"]), (v) => ({ ok: false, status: v.status })),
    ]),
  );
}

export type ReopenResult =
  | { readonly ok: true; readonly status: "reopened" | "already_reopened" }
  | { readonly ok: false; readonly status: "not_taken" | "not_found" }
  | Failed;

/** Read `cohort_reopen_place`'s reply (also used by the refund hook, which re-opens with no actor). */
export function parseReopenResult(data: unknown): ReopenResult {
  return reply<ReopenResult>("cohort_reopen_place", data, [
    via(refusal(["reopened", "already_reopened"]), (v) => ({ ok: true, status: v.status })),
    via(refusal(["not_taken", "not_found", "invalid"]), (v) => ({ ok: false, status: v.status })),
  ]);
}

/** BAI re-opens a place with a reason (brief §0.8). Idempotent: a second click answers already_reopened. */
export async function reopenPlace(
  proof: AdminProof,
  admin: AdminClient,
  req: { readonly placeId: string; readonly reason: string },
): Promise<ReopenResult> {
  const reason = validateReason(req.reason);
  if (!isAdminProof(proof) || !isUuid(req.placeId) || !reason.ok) return INVALID;
  return run(admin, "cohort_reopen_place", { p_place_id: req.placeId, p_actor: proof.userId, p_reason: reason.reason }, parseReopenResult);
}

export type SaveScheduleResult = { readonly ok: true; readonly status: "saved" } | Failed;

/** Save the schedule; its audit row is written in the same step. */
export async function saveSchedule(proof: AdminProof, admin: AdminClient, schedule: CohortSchedule): Promise<SaveScheduleResult> {
  const valid = validateSchedule(schedule);
  if (!isAdminProof(proof) || !valid.ok) return INVALID;
  const s = valid.schedule;
  const args = { p_first: s.firstStartDate, p_repeat_weeks: s.repeatWeeks, p_places: s.defaultPlaces, p_actor: proof.userId };
  return run(admin, "cohort_save_schedule", args, (data) =>
    reply<SaveScheduleResult>("cohort_save_schedule", data, [
      via(refusal(["saved"]), () => ({ ok: true, status: "saved" })),
      via(refusal(["invalid"]), () => INVALID),
    ]),
  );
}

// ── 03's pinned goodwill date (plan R10), and the refund hook's lookup ──

export type EnsureResult =
  | { readonly ok: true; readonly status: "ensured"; readonly places: number }
  | { readonly ok: false; readonly status: "not_a_cohort" | "not_bookable" }
  | Failed;

/** Store a bookable cohort now, so a later schedule edit can't move a date 03 has pinned. */
export async function ensureCohort(admin: AdminClient, startDate: string): Promise<EnsureResult> {
  if (!isLondonDate(startDate)) return INVALID;
  return run(admin, "cohort_ensure", { p_start: startDate }, (data) =>
    reply<EnsureResult>("cohort_ensure", data, [
      via(z.object({ status: z.literal("ensured"), places: z.number().int() }), (v) => ({ ok: true, status: "ensured", places: v.places })),
      via(refusal(["not_a_cohort", "not_bookable", "invalid"]), (v) => ({ ok: false, status: v.status })),
    ]),
  );
}

export interface PaymentPlace {
  readonly id: string;
  readonly state: PlaceState;
  readonly parentUserId: string;
  readonly cohortStartDate: string;
}

const paymentPlaceRow = z.object({
  id: z.string().min(1),
  state: z.enum(["held", "hold_released", "taken", "reopened"]),
  parent_user_id: z.string().min(1),
  cohort_start_date: z.string().min(1),
});

/** The place a Stripe payment took, if any (one at most: the payment intent is unique). */
export async function findPlaceByPaymentIntent(admin: AdminClient, paymentIntentId: string): Promise<DbResult<PaymentPlace | null>> {
  if (!isStripeId(paymentIntentId)) return dbOk(null);
  try {
    const { data, error } = await admin
      .from("cohort_places")
      .select("id, state, parent_user_id, cohort_start_date")
      .eq("stripe_payment_intent_id", paymentIntentId)
      .maybeSingle();
    if (error) {
      logFailure("findPlaceByPaymentIntent", error);
      return DB_FAILED;
    }
    if (data === null) return dbOk(null);
    const row = paymentPlaceRow.safeParse(data);
    if (!row.success) {
      logFailure("findPlaceByPaymentIntent", { code: "unexpected_row" });
      return DB_FAILED;
    }
    return dbOk({ id: row.data.id, state: row.data.state, parentUserId: row.data.parent_user_id, cohortStartDate: row.data.cohort_start_date });
  } catch (thrown) {
    logFailure("findPlaceByPaymentIntent", thrown);
    return DB_FAILED;
  }
}
