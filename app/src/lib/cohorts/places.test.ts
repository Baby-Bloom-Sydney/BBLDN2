/**
 * The place operations (plan 02 step 4; brief §5 "operations this brief owns"). Each wrapper sends amendment 17's
 * exact parameters, maps every status the function can answer to its typed result, and turns a malformed reply
 * or an RPC error into `{ ok: false, status: "error" }` — logged by code only, never thrown. Admin operations need
 * a real `AdminProof` (04a's rule): a look-alike is refused before the database is touched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({ result: { userId: "a0000000-0000-4000-8000-000000000031", error: null as string | null } }));
vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin: async () => gate.result }));

import { proveAdmin, type AdminProof } from "@/lib/calls/admin-proof";
import { fakeAdmin } from "@/lib/payments/fake-admin.test-util";
import {
  attachHoldSession,
  ensureCohort,
  findPlaceByPaymentIntent,
  holdPlace,
  parseReopenResult,
  releaseHold,
  reopenPlace,
  saveSchedule,
  setCohortPlaces,
  takePlace,
} from "./places";

const PARENT = "b0200000-0000-4000-8000-000000000001";
const PLACE = "c0200000-0000-4000-8000-000000000001";
const ADMIN = "a0000000-0000-4000-8000-000000000031";
const EXPIRES = "2027-02-03T10:30:00+00:00";

let proof: AdminProof;
beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const p = await proveAdmin();
  if (!p) throw new Error("no proof");
  proof = p;
});

const answering = (fn: string, data: unknown, error: { message: string; code?: string } | null = null) => {
  const f = fakeAdmin();
  f.rpcResults[fn] = { data, error };
  return f;
};

describe("holdPlace", () => {
  it("sends the exact parameters with the 30-minute default", async () => {
    const f = answering("cohort_hold_place", { status: "held", place_id: PLACE, cohort_start_date: "2027-02-01", hold_expires_at: EXPIRES, is_goodwill: false });
    const r = await holdPlace(f.client, { parentUserId: PARENT, startDate: "2027-02-01", goodwill: false });
    expect(f.rpcCalls).toEqual([{ fn: "cohort_hold_place", args: { p_parent: PARENT, p_start: "2027-02-01", p_minutes: 30, p_goodwill: false } }]);
    expect(r).toEqual({ ok: true, status: "held", placeId: PLACE, cohortStartDate: "2027-02-01", holdExpiresAt: EXPIRES, isGoodwill: false, sessionId: null });
  });

  it("a second press returns the first hold with its session to reuse", async () => {
    const f = answering("cohort_hold_place", {
      status: "existing_hold", place_id: PLACE, cohort_start_date: "2027-02-01", hold_expires_at: EXPIRES, is_goodwill: false,
      stripe_checkout_session_id: "cs_1",
    });
    expect(await holdPlace(f.client, { parentUserId: PARENT, startDate: "2027-02-01", goodwill: false })).toMatchObject({
      ok: true, status: "existing_hold", sessionId: "cs_1",
    });
  });

  it.each([
    [{ status: "full", reason: "being_paid", places: 5, taken: 4, being_paid: 1 }, { ok: false, status: "full", reason: "being_paid" }],
    [{ status: "full", reason: "all_taken", places: 5, taken: 5, being_paid: 0 }, { ok: false, status: "full", reason: "all_taken" }],
    [{ status: "already_taken" }, { ok: false, status: "already_taken" }],
    [{ status: "already_holding" }, { ok: false, status: "already_holding" }],
    [{ status: "not_bookable" }, { ok: false, status: "not_bookable" }],
    [{ status: "not_a_cohort" }, { ok: false, status: "not_a_cohort" }],
    [{ status: "invalid" }, { ok: false, status: "invalid" }],
  ])("maps %o", async (data, expected) => {
    const f = answering("cohort_hold_place", data);
    expect(await holdPlace(f.client, { parentUserId: PARENT, startDate: "2027-02-01", goodwill: false })).toEqual(expected);
  });

  it("refuses bad input before the database", async () => {
    const f = fakeAdmin();
    expect(await holdPlace(f.client, { parentUserId: "nope", startDate: "2027-02-01", goodwill: false })).toEqual({ ok: false, status: "invalid" });
    expect(await holdPlace(f.client, { parentUserId: PARENT, startDate: "2027-02-30", goodwill: false })).toEqual({ ok: false, status: "invalid" });
    expect(await holdPlace(f.client, { parentUserId: PARENT, startDate: "2027-02-01", goodwill: false, minutes: 61 })).toEqual({ ok: false, status: "invalid" });
    expect(f.rpcCalls).toHaveLength(0);
  });

  it("an RPC error or a malformed reply is `error`, logged with its code only, never thrown", async () => {
    const f = answering("cohort_hold_place", null, { message: "lock timeout on row of Sarah Jones", code: "55P03" });
    expect(await holdPlace(f.client, { parentUserId: PARENT, startDate: "2027-02-01", goodwill: false })).toEqual({ ok: false, status: "error" });
    expect(console.error).toHaveBeenCalledWith("[cohorts] cohort_hold_place failed", { code: "55P03" });
    const g = answering("cohort_hold_place", { status: "held" });
    expect(await holdPlace(g.client, { parentUserId: PARENT, startDate: "2027-02-01", goodwill: false })).toEqual({ ok: false, status: "error" });
    const h = fakeAdmin();
    h.client.rpc = (() => { throw new TypeError("network"); }) as never;
    expect(await holdPlace(h.client, { parentUserId: PARENT, startDate: "2027-02-01", goodwill: false })).toEqual({ ok: false, status: "error" });
    expect(console.error).toHaveBeenCalledWith("[cohorts] cohort_hold_place failed", { code: "TypeError" });
  });
});

describe("attachHoldSession / releaseHold (03: the Stripe session, the back button)", () => {
  it("attach sends the session; every status maps", async () => {
    const f = answering("cohort_attach_session", { status: "attached", place_id: PLACE });
    expect(await attachHoldSession(f.client, { placeId: PLACE, parentUserId: PARENT, sessionId: "cs_1" })).toEqual({ ok: true, status: "attached" });
    expect(f.rpcCalls[0].args).toEqual({ p_place_id: PLACE, p_parent: PARENT, p_session_id: "cs_1" });
    for (const status of ["hold_expired", "session_mismatch", "not_found", "not_a_hold", "invalid"]) {
      const g = answering("cohort_attach_session", { status });
      expect(await attachHoldSession(g.client, { placeId: PLACE, parentUserId: PARENT, sessionId: "cs_1" })).toEqual({ ok: false, status });
    }
    expect(await attachHoldSession(fakeAdmin().client, { placeId: PLACE, parentUserId: PARENT, sessionId: "" })).toEqual({ ok: false, status: "invalid" });
  });

  it("release is idempotent", async () => {
    const f = answering("cohort_release_hold", { status: "released", place_id: PLACE });
    expect(await releaseHold(f.client, { placeId: PLACE, parentUserId: PARENT })).toEqual({ ok: true, status: "released" });
    expect(f.rpcCalls[0].args).toEqual({ p_place_id: PLACE, p_parent: PARENT });
    const g = answering("cohort_release_hold", { status: "already_released", place_id: PLACE });
    expect(await releaseHold(g.client, { placeId: PLACE, parentUserId: PARENT })).toEqual({ ok: true, status: "already_released" });
    const h = answering("cohort_release_hold", { status: "not_a_hold" });
    expect(await releaseHold(h.client, { placeId: PLACE, parentUserId: PARENT })).toEqual({ ok: false, status: "not_a_hold" });
  });
});

describe("takePlace", () => {
  const taken = { status: "taken", place_id: PLACE, cohort_start_date: "2027-02-01", is_goodwill: false, over_by: 0 };

  it("convert (the webhook, card): no actor, the hold and the session", async () => {
    const f = answering("cohort_take_place", taken);
    const r = await takePlace(f.client, { kind: "convert", parentUserId: PARENT, holdId: PLACE, paymentIntentId: "pi_1", sessionId: "cs_1" });
    expect(f.rpcCalls[0].args).toEqual({
      p_parent: PARENT, p_start: null, p_hold_id: PLACE, p_paid_by: "card", p_payment_intent: "pi_1", p_goodwill: false,
      p_session_id: "cs_1", p_actor: null,
    });
    expect(r).toEqual({ ok: true, status: "taken", placeId: PLACE, cohortStartDate: "2027-02-01", isGoodwill: false, overBy: 0 });
  });

  it("a late payment comes back over by 1 (brief §0.10)", async () => {
    const f = answering("cohort_take_place", { ...taken, over_by: 1 });
    expect(await takePlace(f.client, { kind: "convert", parentUserId: PARENT, holdId: PLACE, paymentIntentId: "pi_1" })).toMatchObject({ overBy: 1 });
  });

  it("direct (bank-transfer mark-paid) needs a real admin proof and records who", async () => {
    const f = answering("cohort_take_place", { ...taken, is_goodwill: true });
    const r = await takePlace(f.client, { kind: "direct", proof, parentUserId: PARENT, startDate: "2027-02-08", paidBy: "bank_transfer", goodwill: true });
    expect(f.rpcCalls[0].args).toEqual({
      p_parent: PARENT, p_start: "2027-02-08", p_hold_id: null, p_paid_by: "bank_transfer", p_payment_intent: null, p_goodwill: true,
      p_session_id: null, p_actor: ADMIN,
    });
    expect(r).toMatchObject({ ok: true, isGoodwill: true });
    const fake = { kind: "admin_proof", userId: ADMIN } as unknown as AdminProof;
    const g = fakeAdmin();
    expect(await takePlace(g.client, { kind: "direct", proof: fake, parentUserId: PARENT, startDate: "2027-02-01", paidBy: "bank_transfer", goodwill: false })).toEqual({
      ok: false, status: "invalid",
    });
    expect(g.rpcCalls).toHaveLength(0);
  });

  it("the same payment again → already_recorded with the place's state (never read as 'has a place')", async () => {
    const f = answering("cohort_take_place", { status: "already_recorded", place_id: PLACE, cohort_start_date: "2027-02-01", state: "reopened" });
    expect(await takePlace(f.client, { kind: "convert", parentUserId: PARENT, holdId: PLACE, paymentIntentId: "pi_1" })).toEqual({
      ok: true, status: "already_recorded", placeId: PLACE, cohortStartDate: "2027-02-01", state: "reopened",
    });
  });

  it.each([
    [{ status: "full", reason: "all_taken" }, { ok: false, status: "full", reason: "all_taken" }],
    [{ status: "already_taken" }, { ok: false, status: "already_taken" }],
    [{ status: "hold_not_found" }, { ok: false, status: "hold_not_found" }],
    [{ status: "not_bookable" }, { ok: false, status: "not_bookable" }],
    [{ status: "not_a_cohort" }, { ok: false, status: "not_a_cohort" }],
    [{ status: "invalid" }, { ok: false, status: "invalid" }],
    [{ status: "surprise" }, { ok: false, status: "error" }],
  ])("maps %o", async (data, expected) => {
    const f = answering("cohort_take_place", data);
    expect(await takePlace(f.client, { kind: "convert", parentUserId: PARENT, holdId: PLACE, paymentIntentId: "pi_1" })).toEqual(expected);
  });

  it("a convert needs a payment intent", async () => {
    const f = fakeAdmin();
    expect(await takePlace(f.client, { kind: "convert", parentUserId: PARENT, holdId: PLACE, paymentIntentId: "" })).toEqual({ ok: false, status: "invalid" });
    expect(f.rpcCalls).toHaveLength(0);
  });
});

describe("admin operations: setCohortPlaces, reopenPlace, saveSchedule", () => {
  it("set places: updated, or below_taken with the exact refusal (brief §0.4)", async () => {
    const f = answering("cohort_set_places", { status: "updated", cohort_start_date: "2027-02-01", places: 7, taken: 3, being_paid: 0, left: 4 });
    expect(await setCohortPlaces(proof, f.client, { startDate: "2027-02-01", places: 7 })).toEqual({ ok: true, status: "updated", places: 7, left: 4 });
    expect(f.rpcCalls[0].args).toEqual({ p_start: "2027-02-01", p_places: 7, p_actor: ADMIN });
    const g = answering("cohort_set_places", { status: "below_taken", taken_or_held: 3, places: 7 });
    expect(await setCohortPlaces(proof, g.client, { startDate: "2027-02-01", places: 2 })).toEqual({
      ok: false, status: "below_taken", takenOrHeld: 3, message: "3 places are already taken or being paid for. Set at least 3.",
    });
    for (const status of ["past_cohort", "not_a_cohort", "invalid"]) {
      const h = answering("cohort_set_places", { status });
      expect(await setCohortPlaces(proof, h.client, { startDate: "2027-02-01", places: 2 })).toEqual({ ok: false, status });
    }
  });

  it("re-open: reopened, then already_reopened; the reason is checked first", async () => {
    const f = answering("cohort_reopen_place", { status: "reopened", place_id: PLACE, cohort_start_date: "2027-02-01" });
    expect(await reopenPlace(proof, f.client, { placeId: PLACE, reason: " moved abroad " })).toEqual({ ok: true, status: "reopened" });
    expect(f.rpcCalls[0].args).toEqual({ p_place_id: PLACE, p_actor: ADMIN, p_reason: "moved abroad" });
    const g = answering("cohort_reopen_place", { status: "already_reopened", place_id: PLACE, reopened_at: EXPIRES, reopen_reason: "moved abroad" });
    expect(await reopenPlace(proof, g.client, { placeId: PLACE, reason: "moved abroad" })).toEqual({ ok: true, status: "already_reopened" });
    const h = fakeAdmin();
    expect(await reopenPlace(proof, h.client, { placeId: PLACE, reason: "ab" })).toEqual({ ok: false, status: "invalid" });
    expect(h.rpcCalls).toHaveLength(0);
  });

  it("save schedule: saved; a look-alike proof is refused before the database", async () => {
    const f = answering("cohort_save_schedule", { status: "saved", first_start_date: "2027-02-01", repeat_weeks: 1, default_places: 5 });
    expect(await saveSchedule(proof, f.client, { firstStartDate: "2027-02-01", repeatWeeks: 1, defaultPlaces: 5 })).toEqual({ ok: true, status: "saved" });
    expect(f.rpcCalls[0].args).toEqual({ p_first: "2027-02-01", p_repeat_weeks: 1, p_places: 5, p_actor: ADMIN });
    const g = fakeAdmin();
    const copy = { ...proof } as AdminProof;
    expect(await saveSchedule(copy, g.client, { firstStartDate: "2027-02-01", repeatWeeks: 1, defaultPlaces: 5 })).toEqual({ ok: false, status: "invalid" });
    expect(await setCohortPlaces(copy, g.client, { startDate: "2027-02-01", places: 5 })).toEqual({ ok: false, status: "invalid" });
    expect(await reopenPlace(copy, g.client, { placeId: PLACE, reason: "moved abroad" })).toEqual({ ok: false, status: "invalid" });
    expect(g.rpcCalls).toHaveLength(0);
  });
});

describe("ensureCohort (plan R10) and findPlaceByPaymentIntent (the refund hook)", () => {
  it("ensure", async () => {
    const f = answering("cohort_ensure", { status: "ensured", cohort_start_date: "2027-02-08", places: 5 });
    expect(await ensureCohort(f.client, "2027-02-08")).toEqual({ ok: true, status: "ensured", places: 5 });
    const g = answering("cohort_ensure", { status: "not_bookable" });
    expect(await ensureCohort(g.client, "2027-02-08")).toEqual({ ok: false, status: "not_bookable" });
  });

  it("finds the place a payment took", async () => {
    const f = fakeAdmin({ cohort_places: { id: PLACE, state: "taken", parent_user_id: PARENT, cohort_start_date: "2027-02-01" } });
    expect(await findPlaceByPaymentIntent(f.client, "pi_1")).toEqual({
      ok: true, value: { id: PLACE, state: "taken", parentUserId: PARENT, cohortStartDate: "2027-02-01" },
    });
    expect(f.ops[0].filters).toContainEqual(["eq", "stripe_payment_intent_id", "pi_1"]);
    expect(await findPlaceByPaymentIntent(fakeAdmin().client, "pi_1")).toEqual({ ok: true, value: null });
    const g = fakeAdmin();
    g.readErrors.cohort_places = { message: "down", code: "XX000" };
    expect(await findPlaceByPaymentIntent(g.client, "pi_1")).toEqual({ ok: false });
  });

  it("parseReopenResult reads a raw reply", () => {
    expect(parseReopenResult({ status: "reopened", place_id: PLACE })).toEqual({ ok: true, status: "reopened" });
    expect(parseReopenResult({ nope: 1 })).toEqual({ ok: false, status: "error" });
  });
});
