/**
 * handleDfyLinkCompleted — 4c brief step 5 (4d wires it). Proven on a recorded
 * `checkout.session.completed` object (shape of a Stripe test-mode session, ids synthetic).
 * BB-LDN-4c-151026.
 */
import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { PRICES } from "@/config/prices";
import { handleDfyLinkCompleted } from "./dfy-webhook";
import { fakeAdmin, writesTo } from "./fake-admin.test-util";

const PARENT = "11111111-1111-4111-8111-111111111111";

/** Recorded shape — trimmed to the fields the handler reads, values as Stripe sends them. */
function recordedSession(over: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: "cs_test_a1B2c3",
    object: "checkout.session",
    mode: "payment",
    payment_status: "paid",
    status: "complete",
    currency: PRICES.currency,
    amount_total: PRICES.dfy.depositPence,
    client_reference_id: PARENT,
    payment_intent: "pi_test_dep001",
    metadata: { user_id: PARENT, link_kind: "deposit", pence: String(PRICES.dfy.depositPence) },
    ...over,
  } as Stripe.Checkout.Session;
}

describe("handleDfyLinkCompleted — deposit", () => {
  it("no row → inserts a dfy row in deposit_paid with the deposit columns, logs dfy.deposit_paid", async () => {
    const f = fakeAdmin({ parent_subscriptions: null });
    expect(await handleDfyLinkCompleted(f.client, recordedSession())).toBe("applied");
    const [ins] = writesTo(f, "parent_subscriptions");
    expect(ins.kind).toBe("insert");
    expect(ins.payload).toMatchObject({
      parent_user_id: PARENT,
      family_type: "dfy",
      status: "deposit_paid",
      deposit_pence: PRICES.dfy.depositPence,
      deposit_stripe_payment_intent_id: "pi_test_dep001",
    });
    expect((ins.payload as Record<string, unknown>).deposit_paid_at).toEqual(expect.any(String));
    // no access field is written — deposit opens nothing (ADR-097)
    expect(ins.payload).not.toHaveProperty("access_toggled_on");
    const [log] = writesTo(f, "activity_logs");
    expect(log.payload).toMatchObject({ user_id: PARENT, action_type: "dfy.deposit_paid" });
  });

  it("lapsed self-serve row → becomes dfy deposit_paid (no access, ADR-097)", async () => {
    const f = fakeAdmin({ parent_subscriptions: { id: "s1", status: "lapsed", deposit_stripe_payment_intent_id: null } });
    expect(await handleDfyLinkCompleted(f.client, recordedSession())).toBe("applied");
    const [up] = writesTo(f, "parent_subscriptions");
    expect(up.kind).toBe("update");
    expect(up.payload).toMatchObject({ status: "deposit_paid", family_type: "dfy" });
    expect(up.filters).toContainEqual(["eq", "id", "s1"]);
  });

  it.each([
    ["trial", { trial_ends_at: new Date(Date.now() + 86_400_000).toISOString() }],
    ["active_monthly", { paid_period_ends_at: new Date(Date.now() + 86_400_000).toISOString() }],
  ])("live self-serve %s → deposit recorded, family dfy, status (and its access) kept (review HIGH)", async (status, clocks) => {
    const f = fakeAdmin({ parent_subscriptions: { id: "s1", status, deposit_stripe_payment_intent_id: null, ...clocks } });
    expect(await handleDfyLinkCompleted(f.client, recordedSession())).toBe("applied");
    const [up] = writesTo(f, "parent_subscriptions");
    expect(up.payload).toMatchObject({ family_type: "dfy", deposit_pence: PRICES.dfy.depositPence });
    expect(up.payload).not.toHaveProperty("status");
  });

  // 4-w5fix (W5-M3): the deposit stores the session's Stripe customer when the family has none,
  // so a later refund of the deposit can be traced to the family.
  it("no row → the insert carries the session's customer as stripe_customer_id", async () => {
    const f = fakeAdmin({ parent_subscriptions: null });
    await handleDfyLinkCompleted(f.client, recordedSession({ customer: "cus_test_dep" }));
    expect(writesTo(f, "parent_subscriptions")[0].payload).toMatchObject({ stripe_customer_id: "cus_test_dep" });
  });

  it("a row with no customer → the update stores the session's customer", async () => {
    const f = fakeAdmin({
      parent_subscriptions: { id: "s1", status: "lapsed", stripe_customer_id: null, deposit_stripe_payment_intent_id: null },
    });
    await handleDfyLinkCompleted(f.client, recordedSession({ customer: "cus_test_dep" }));
    expect(writesTo(f, "parent_subscriptions")[0].payload).toMatchObject({ stripe_customer_id: "cus_test_dep" });
  });

  it("a row that already has a customer → it is never overwritten", async () => {
    const f = fakeAdmin({
      parent_subscriptions: { id: "s1", status: "lapsed", stripe_customer_id: "cus_old", deposit_stripe_payment_intent_id: null },
    });
    await handleDfyLinkCompleted(f.client, recordedSession({ customer: "cus_test_dep" }));
    expect(writesTo(f, "parent_subscriptions")[0].payload).not.toHaveProperty("stripe_customer_id");
  });

  it("a session with no customer → no stripe_customer_id is written", async () => {
    const f = fakeAdmin({ parent_subscriptions: null });
    await handleDfyLinkCompleted(f.client, recordedSession({ customer: null }));
    expect(writesTo(f, "parent_subscriptions")[0].payload).not.toHaveProperty("stripe_customer_id");
  });

  it("already placed → keeps placed, still records the deposit", async () => {
    const f = fakeAdmin({ parent_subscriptions: { id: "s1", status: "placed", deposit_stripe_payment_intent_id: null } });
    expect(await handleDfyLinkCompleted(f.client, recordedSession())).toBe("applied");
    const [up] = writesTo(f, "parent_subscriptions");
    expect(up.payload).not.toHaveProperty("status");
    expect(up.payload).toMatchObject({ deposit_pence: PRICES.dfy.depositPence });
  });

  it("same payment intent again (Stripe retry) → ignored, nothing written", async () => {
    const f = fakeAdmin({
      parent_subscriptions: { id: "s1", status: "deposit_paid", deposit_stripe_payment_intent_id: "pi_test_dep001" },
    });
    expect(await handleDfyLinkCompleted(f.client, recordedSession())).toBe("ignored");
    expect(f.ops.filter((o) => o.kind !== "select")).toHaveLength(0);
  });
});

describe("handleDfyLinkCompleted — bill", () => {
  const bill = (kind: string) =>
    recordedSession({
      amount_total: 105_000, // the handler stores what Stripe charged
      payment_intent: { id: "pi_test_bill01" } as Stripe.PaymentIntent,
      metadata: { user_id: PARENT, link_kind: kind, pence: "105000", first_week_wages_pence: "30000" },
    });

  it.each(["balance-after-week-1", "custom"])("%s → bill_paid_at, intent, balance_pence; logs dfy.bill_paid", async (kind) => {
    const f = fakeAdmin({ parent_subscriptions: { id: "s1", status: "placed", bill_stripe_payment_intent_id: null } });
    expect(await handleDfyLinkCompleted(f.client, bill(kind))).toBe("applied");
    const [up] = writesTo(f, "parent_subscriptions");
    expect(up.payload).toMatchObject({ bill_stripe_payment_intent_id: "pi_test_bill01", balance_pence: 105_000 });
    expect((up.payload as Record<string, unknown>).bill_paid_at).toEqual(expect.any(String));
    expect(up.payload).not.toHaveProperty("status");
    expect(writesTo(f, "activity_logs")[0].payload).toMatchObject({ action_type: "dfy.bill_paid" });
  });

  it("balance records the first week's wages it was minted with", async () => {
    const f = fakeAdmin({ parent_subscriptions: { id: "s1", status: "placed", bill_stripe_payment_intent_id: null } });
    await handleDfyLinkCompleted(f.client, bill("balance-after-week-1"));
    expect(writesTo(f, "parent_subscriptions")[0].payload).toMatchObject({ first_week_wages_pence: 30_000 });
  });

  it("no subscription row → ignored (the admin mints bills only for a family with a row)", async () => {
    const f = fakeAdmin({ parent_subscriptions: null });
    expect(await handleDfyLinkCompleted(f.client, bill("custom"))).toBe("ignored");
  });

  it("same bill intent again → ignored", async () => {
    const f = fakeAdmin({ parent_subscriptions: { id: "s1", status: "placed", bill_stripe_payment_intent_id: "pi_test_bill01" } });
    expect(await handleDfyLinkCompleted(f.client, bill("custom"))).toBe("ignored");
  });
});

describe("handleDfyLinkCompleted — refusals", () => {
  it("unknown link_kind → ignored", async () => {
    const f = fakeAdmin();
    const s = recordedSession({ metadata: { user_id: PARENT, link_kind: "instalment" } });
    expect(await handleDfyLinkCompleted(f.client, s)).toBe("ignored");
    expect(f.ops).toHaveLength(0);
  });

  it("no user_id → ignored", async () => {
    const f = fakeAdmin();
    expect(await handleDfyLinkCompleted(f.client, recordedSession({ metadata: { link_kind: "deposit" } }))).toBe("ignored");
  });

  it("not a payment-mode session, or client_reference_id ≠ user_id → ignored", async () => {
    const f = fakeAdmin();
    expect(await handleDfyLinkCompleted(f.client, recordedSession({ mode: "subscription" }))).toBe("ignored");
    expect(await handleDfyLinkCompleted(f.client, recordedSession({ client_reference_id: "someone-else" }))).toBe("ignored");
    expect(f.ops).toHaveLength(0);
  });

  it("no amount_total → ignored; metadata.pence is never used as the amount (4d security review)", async () => {
    const f = fakeAdmin({ parent_subscriptions: null });
    expect(await handleDfyLinkCompleted(f.client, recordedSession({ amount_total: null }))).toBe("ignored");
    expect(f.ops).toHaveLength(0);
  });

  it("the stored amount is Stripe's amount_total even when metadata.pence differs", async () => {
    const f = fakeAdmin({ parent_subscriptions: null });
    const s = recordedSession({ metadata: { user_id: PARENT, link_kind: "deposit", pence: "1" } });
    await handleDfyLinkCompleted(f.client, s);
    expect(writesTo(f, "parent_subscriptions")[0].payload).toMatchObject({ deposit_pence: PRICES.dfy.depositPence });
  });

  it("bill on a family with a Stripe customer: another customer → ignored, same customer → applied", async () => {
    const row = { id: "s1", status: "placed", stripe_customer_id: "cus_test_fam", bill_stripe_payment_intent_id: null };
    const billFor = (customer: string | null) =>
      recordedSession({
        customer,
        amount_total: 105_000,
        payment_intent: "pi_test_bill02",
        metadata: { user_id: PARENT, link_kind: "custom", pence: "105000" },
      });
    const other = fakeAdmin({ parent_subscriptions: row });
    expect(await handleDfyLinkCompleted(other.client, billFor("cus_test_other"))).toBe("ignored");
    expect(writesTo(other, "parent_subscriptions")).toHaveLength(0);
    const none = fakeAdmin({ parent_subscriptions: row });
    expect(await handleDfyLinkCompleted(none.client, billFor(null))).toBe("ignored");
    const same = fakeAdmin({ parent_subscriptions: row });
    expect(await handleDfyLinkCompleted(same.client, billFor("cus_test_fam"))).toBe("applied");
  });

  it("not yet paid (async method) → ignored", async () => {
    const f = fakeAdmin();
    expect(await handleDfyLinkCompleted(f.client, recordedSession({ payment_status: "unpaid" }))).toBe("ignored");
  });

  it("a database write error throws so the webhook marks it unresolved and Stripe retries", async () => {
    const f = fakeAdmin({ parent_subscriptions: null });
    f.writeErrors.parent_subscriptions = { message: "boom" };
    await expect(handleDfyLinkCompleted(f.client, recordedSession())).rejects.toThrow(/boom/);
  });
});
