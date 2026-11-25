"use server";

/**
 * The parent's deposit actions on `/deposit/<code>` (plan 03 row C1, §3 "Pay", "Pre-book", D15, §10; brief 03 §3
 * parent 2, 5–6; ledger B03 § PR 03c "Carried" 1–3, 6). Every export of a `"use server"` file is a public endpoint,
 * so this file exports exactly the five actions (and types). Each takes the CODE — never a parent id, an actor or a
 * date the server can work out — and, in this order:
 *
 * 1. the switch (`depositLinkEnabled()`, which needs `COHORTS_ENABLED` too): off → `deposit_disabled`, before the
 *    admin client is made or anything is read;
 * 2. `proveDepositCode` on EVERY call (a proof is never cached): a malformed, unknown or cancelled code — or a proof
 *    read that failed — is `invalid`, with nothing written;
 * 3. 03a's domain calls with that proof; 04's call contracts (`calls/contracts.ts`) with the proof's parent as the
 *    parent AND the actor (`{ kind: "parent", userId: proof.parentUserId }`), limited to her pre-booking's day.
 *
 * No login is read anywhere (D15: BAI may open the link from his own browser to take the card). Refusals are closed
 * codes — 04's mapped to its parent codes with its own `refusalOf` — and failures are logged by code only, never a
 * deposit code, a name, an address or a message. Pre-book is accepted only in the full and being-paid states
 * (03a security LOW-2). The app has no general rate limiter, so none is built here (ledger "Carried" 4); 04's own
 * `call_rate_limited` still guards the picker's hold and confirm.
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */

import { z } from "zod";
import { confirmHoldForParent, getFreeSlots, holdSlotForParent, type BookingActor } from "@/lib/calls/contracts";
import { groupSlotGridByDay, type SlotDay } from "@/lib/calls/group-slots-by-day";
import { heldViewOf, refusalOf, type HeldCallView, type MyCallRefusal } from "@/lib/calls/parent-view";
import { logFailure, type AdminClient } from "@/lib/cohorts/db";
import { prebookBookedLine } from "@/lib/deposit/copy";
import { attachPrebookingCall, readOpenPrebooking, recordPrebooking } from "@/lib/deposit/prebook";
import { proveDepositCode, type DepositParentProof } from "@/lib/deposit/proof";
import { readDepositPage, startDepositCheckout, type PayResult } from "@/lib/deposit/session";
import type { DepositPageState } from "@/lib/deposit/types";
import { callBookingEnabled, depositLinkEnabled } from "@/lib/features/flags";
import { createAdminClient } from "@/lib/supabase/admin";
import { londonDateOf } from "@/lib/timezone";

// ── result shapes (types only: not runtime exports) ──

export type PayDepositError = "deposit_disabled" | "invalid" | "try_again" | "try_again_soon";
export type PayDepositResult =
  | { readonly ok: true; readonly kind: "redirect"; readonly url: string }
  | { readonly ok: true; readonly kind: "state"; readonly state: DepositPageState }
  | { readonly ok: false; readonly error: PayDepositError };

/** After "Pre-book": that cohort's opening day in 04's picker, or the call-on line, or the in-touch line. */
export type PrebookView =
  | { readonly kind: "picker"; readonly londonDate: string; readonly days: readonly SlotDay[] }
  | { readonly kind: "call_on"; readonly date: string }
  | { readonly kind: "in_touch" };
export type PrebookNextError = "deposit_disabled" | "invalid" | "not_offered" | "error";
export type PrebookNextResult = { readonly ok: true; readonly value: PrebookView } | { readonly ok: false; readonly error: PrebookNextError };

/** The picker's actions answer 04's parent codes, plus the switch. */
export type PrebookCallRefusal = MyCallRefusal | "deposit_disabled";
export type PrebookCallResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: PrebookCallRefusal };
export type PrebookHold = HeldCallView;
export interface PrebookBooked {
  readonly bookingId: string;
  readonly startsAt: string;
  /** "We'll call you on Monday 8 February at 10:00 to confirm your place." */
  readonly line: string;
}

// ── the gate ──

const startsAtInput = z.iso.datetime({ offset: true });
const holdIdInput = z.uuid();

const DISABLED = Object.freeze({ ok: false, error: "deposit_disabled" } as const);
const INVALID = Object.freeze({ ok: false, error: "invalid" } as const);
const ERROR = Object.freeze({ ok: false, error: "error" } as const);
const NOT_OFFERED = Object.freeze({ ok: false, error: "not_offered" } as const);

interface Proven {
  readonly ok: true;
  readonly admin: AdminClient;
  readonly proof: DepositParentProof;
}
type Gate = Proven | typeof DISABLED | typeof INVALID;

/** Steps 1–2: the switch, then the code proven now. */
async function proven(code: unknown): Promise<Gate> {
  if (!depositLinkEnabled()) return DISABLED;
  const admin = createAdminClient();
  const proof = await proveDepositCode(admin, code);
  return proof.ok ? { ok: true, admin, proof: proof.proof } : INVALID;
}

/** A throw anywhere is a closed code, logged by its name only. */
async function guarded<T>(label: string, fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (thrown) {
    logFailure(label, thrown);
    return fallback;
  }
}

function parsed<T>(schema: z.ZodType<T>, value: unknown): T | null {
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}

/** She acts for herself: the proof's parent is the parent and the actor. */
const herself = (proof: DepositParentProof): { readonly parentUserId: string; readonly actor: BookingActor } => ({
  parentUserId: proof.parentUserId,
  actor: { kind: "parent", userId: proof.parentUserId },
});

// ── Pay ──

function payResultOf(paid: PayResult): PayDepositResult {
  if (paid.kind === "redirect") return { ok: true, kind: "redirect", url: paid.url };
  if (paid.kind === "state") return { ok: true, kind: "state", state: paid.state };
  return { ok: false, error: paid.kind };
}

/** Pay: 03a holds a place and makes (or reuses) her one Checkout session; the client then goes to its URL. */
export async function payDeposit(code: unknown): Promise<PayDepositResult> {
  return guarded<PayDepositResult>("payDeposit", { ok: false, error: "try_again" }, async () => {
    const gate = await proven(code);
    if (!gate.ok) return gate;
    return payResultOf(await startDepositCheckout(gate.admin, gate.proof, new Date()));
  });
}

// ── Pre-book ──

/** One London date's free pre-book call times, as one picker row; null = they couldn't be read (logged by 04). */
async function dayTimes(londonDate: string): Promise<readonly SlotDay[] | null> {
  const free = await getFreeSlots({ londonDate, purpose: "cohort_prebook" });
  if (!free.ok) return null;
  return groupSlotGridByDay({ dates: [londonDate], slots: free.value.map((slot) => ({ ...slot, free: true })) });
}

/** What follows a recorded pre-booking: 04 on with free time that day → the picker; else the lines. */
async function prebookViewOf(cohortStartDate: string | null): Promise<PrebookView> {
  if (cohortStartDate === null) return { kind: "in_touch" };
  const callOn: PrebookView = { kind: "call_on", date: cohortStartDate };
  if (!callBookingEnabled()) return callOn;
  const days = await dayTimes(cohortStartDate);
  if (days === null || !days.some((day) => day.slots.length > 0)) return callOn;
  return { kind: "picker", londonDate: cohortStartDate, days };
}

/** "Pre-book next available cohort": only while full or being paid; records her one open pre-booking. */
export async function prebookNext(code: unknown): Promise<PrebookNextResult> {
  return guarded<PrebookNextResult>("prebookNext", ERROR, async () => {
    const gate = await proven(code);
    if (!gate.ok) return gate;
    const read = await readDepositPage(gate.admin, gate.proof, new Date());
    if (read.kind !== "ok") return read.kind === "invalid" ? INVALID : ERROR;
    const { state } = read;
    if (state.kind !== "full" && state.kind !== "being_paid") return NOT_OFFERED;
    const recorded = await recordPrebooking(gate.admin, gate.proof, state.nextAvailable);
    if (!recorded.ok) return recorded.status === "invalid" ? INVALID : ERROR;
    return { ok: true, value: await prebookViewOf(recorded.prebooking.cohortStartDate) };
  });
}

interface PrebookDay extends Proven {
  readonly prebookingId: string;
  readonly londonDate: string;
}

/** The picker's gate: the switch, the code, then her open pre-booking with a cohort day (else `invalid`). */
async function prebookGate(code: unknown): Promise<PrebookDay | { readonly ok: false; readonly error: PrebookCallRefusal }> {
  const gate = await proven(code);
  if (!gate.ok) return gate;
  const open = await readOpenPrebooking(gate.admin, gate.proof.parentUserId);
  if (!open.ok) return ERROR;
  if (open.value === null || open.value.cohortStartDate === null) return INVALID;
  return { ...gate, prebookingId: open.value.id, londonDate: open.value.cohortStartDate };
}

/** A tap on a time: 04's hold, on her pre-booking's day only. */
export async function holdPrebookTime(code: unknown, startsAt: unknown): Promise<PrebookCallResult<PrebookHold>> {
  return guarded<PrebookCallResult<PrebookHold>>("holdPrebookTime", ERROR, async () => {
    const time = parsed(startsAtInput, startsAt);
    const gate = await prebookGate(code);
    if (!gate.ok) return gate;
    if (time === null || londonDateOf(time) !== gate.londonDate) return INVALID;
    const held = await holdSlotForParent({ ...herself(gate.proof), startsAt: time, purpose: "cohort_prebook" });
    return held.ok ? { ok: true, value: heldViewOf(held.value) } : { ok: false, error: refusalOf(held.error) };
  });
}

/** Her booking id on her pre-booking. The call already stands, so a failure is logged, not answered. */
async function attachQuietly(gate: PrebookDay, callBookingId: string): Promise<void> {
  const attached = await attachPrebookingCall(gate.admin, gate.proof, { prebookingId: gate.prebookingId, callBookingId });
  if (!attached.ok) logFailure("deposit prebook call attach", { code: attached.status });
}

/** "Confirm time": 04's confirm of her hold (its id is the idempotency key), then the booking on her pre-booking. */
export async function confirmPrebookTime(code: unknown, holdId: unknown): Promise<PrebookCallResult<PrebookBooked>> {
  return guarded<PrebookCallResult<PrebookBooked>>("confirmPrebookTime", ERROR, async () => {
    const hold = parsed(holdIdInput, holdId);
    const gate = await prebookGate(code);
    if (!gate.ok) return gate;
    if (hold === null) return INVALID;
    const confirmed = await confirmHoldForParent({ ...herself(gate.proof), holdId: hold, idempotencyKey: hold });
    if (!confirmed.ok) return { ok: false, error: refusalOf(confirmed.error) };
    const { bookingId, startsAt } = confirmed.value;
    // Only a call on her pre-booked day belongs to the pre-booking; another (not this picker's hold) stays off it.
    if (londonDateOf(startsAt) === gate.londonDate) await attachQuietly(gate, bookingId);
    else logFailure("deposit prebook call attach", { code: "other_day" });
    return { ok: true, value: { bookingId, startsAt, line: prebookBookedLine(startsAt) } };
  });
}

/** The picker's Retry and refresh: that day's free times again. */
export async function reloadPrebookTimes(code: unknown): Promise<PrebookCallResult<readonly SlotDay[]>> {
  return guarded<PrebookCallResult<readonly SlotDay[]>>("reloadPrebookTimes", ERROR, async () => {
    const gate = await prebookGate(code);
    if (!gate.ok) return gate;
    const days = await dayTimes(gate.londonDate);
    return days === null ? ERROR : { ok: true, value: days };
  });
}
