/**
 * A full Stripe refund re-opens the place (brief §6, §0.9; plan 02 step 6). It runs inside the webhook after the
 * money is recorded, so it logs and never throws: a throw would leave the event unresolved and Stripe's retry is
 * answered as a duplicate (route.ts:104-107). Not flag-gated. A partial refund keeps the place (brief Q5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin } from "@/lib/payments/fake-admin.test-util";
import { reopenPlaceAfterFullRefund } from "./refund-hook";

const PLACE = "c0200000-0000-4000-8000-000000000001";
const PARENT = "b0200000-0000-4000-8000-000000000001";

function db(state: string | null = "taken") {
  const f = fakeAdmin({ cohort_places: state === null ? null : { id: PLACE, state, parent_user_id: PARENT, cohort_start_date: "2027-02-01" } });
  f.rpcResults.cohort_reopen_place = { data: { status: "reopened", place_id: PLACE, cohort_start_date: "2027-02-01" }, error: null };
  return f;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("COHORTS_ENABLED", "");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("reopenPlaceAfterFullRefund", () => {
  it("a full refund of a taken place re-opens it with no actor (flag off: not gated)", async () => {
    const f = db();
    await reopenPlaceAfterFullRefund(f.client, PARENT, { refunded: true, payment_intent: "pi_1" });
    expect(f.ops[0].filters).toContainEqual(["eq", "stripe_payment_intent_id", "pi_1"]);
    expect(f.rpcCalls).toEqual([{ fn: "cohort_reopen_place", args: { p_place_id: PLACE, p_actor: null, p_reason: "Deposit fully refunded in Stripe" } }]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("an expanded payment intent object works the same", async () => {
    const f = db();
    await reopenPlaceAfterFullRefund(f.client, PARENT, { refunded: true, payment_intent: { id: "pi_1" } });
    expect(f.rpcCalls).toHaveLength(1);
  });

  it.each([
    ["a partial refund", { refunded: false, payment_intent: "pi_1" }, "taken"],
    ["no payment intent", { refunded: true, payment_intent: null }, "taken"],
    ["no place for the payment", { refunded: true, payment_intent: "pi_1" }, null],
    ["already re-opened", { refunded: true, payment_intent: "pi_1" }, "reopened"],
  ])("%s → nothing re-opened", async (_label, charge, state) => {
    const f = db(state);
    await reopenPlaceAfterFullRefund(f.client, PARENT, charge);
    expect(f.rpcCalls).toHaveLength(0);
  });

  it("a place that isn't the refunded family's is left alone (security review L2)", async () => {
    const f = db();
    await reopenPlaceAfterFullRefund(f.client, "b0200000-0000-4000-8000-000000000099", { refunded: true, payment_intent: "pi_1" });
    expect(f.rpcCalls).toHaveLength(0);
    expect(console.error).toHaveBeenCalledWith("[cohorts/refund-hook] the payment's place belongs to another family", { status: "mismatch" });
  });

  it("a partial refund reads nothing at all", async () => {
    const f = db();
    await reopenPlaceAfterFullRefund(f.client, PARENT, { refunded: false, payment_intent: "pi_1" });
    expect(f.ops).toHaveLength(0);
  });

  it("every failure resolves and is logged (the warnings box lists the miss)", async () => {
    const lookup = db();
    lookup.readErrors.cohort_places = { message: "down", code: "XX000" };
    await expect(reopenPlaceAfterFullRefund(lookup.client, PARENT, { refunded: true, payment_intent: "pi_1" })).resolves.toBeUndefined();

    const rpc = db();
    rpc.rpcResults.cohort_reopen_place = { data: null, error: { message: "lock timeout", code: "55P03" } };
    await expect(reopenPlaceAfterFullRefund(rpc.client, PARENT, { refunded: true, payment_intent: "pi_1" })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith("[cohorts/refund-hook] the place was not re-opened", { status: "error" });

    const refused = db();
    refused.rpcResults.cohort_reopen_place = { data: { status: "not_taken" }, error: null };
    await reopenPlaceAfterFullRefund(refused.client, PARENT, { refunded: true, payment_intent: "pi_1" });
    expect(console.error).toHaveBeenCalledWith("[cohorts/refund-hook] the place was not re-opened", { status: "not_taken" });

    const thrown = db();
    thrown.client.from = (() => { throw new Error("boom"); }) as never;
    await expect(reopenPlaceAfterFullRefund(thrown.client, PARENT, { refunded: true, payment_intent: "pi_1" })).resolves.toBeUndefined();
  });

  it("an already re-opened answer from the database is fine (a race with BAI's click)", async () => {
    const f = db();
    f.rpcResults.cohort_reopen_place = { data: { status: "already_reopened", place_id: PLACE }, error: null };
    await reopenPlaceAfterFullRefund(f.client, PARENT, { refunded: true, payment_intent: "pi_1" });
    expect(console.error).not.toHaveBeenCalled();
  });
});
