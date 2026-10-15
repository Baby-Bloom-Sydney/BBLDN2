/**
 * Stripe webhook handlers — the outcome each kept handler returns (LDN2 unit 4d).
 *
 * Every one of the seven kept handlers returns `"applied"` when it changed state and
 * `"ignored"` on its early-return branches (ADR-146/156). `charge.refunded` keeps
 * Sydney's stamping when a `refund_requests` row matches, and in London (refund made
 * by hand in the Stripe Dashboard, offer §3) inserts the row itself. A refund never
 * touches access (offer §4 G2).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const stripeState = vi.hoisted(() => ({
  retrieveSub: vi.fn(),
  listRefunds: vi.fn(),
  createRefund: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/stripe/client", () => ({
  getStripeClient: () => ({
    subscriptions: { retrieve: stripeState.retrieveSub },
    refunds: { list: stripeState.listRefunds, create: stripeState.createRefund },
  }),
}));
vi.mock("@/lib/payments/commission-scheduler", () => ({
  scheduleCommissionFor: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/payments/commission-cancel", () => ({
  cancelInFlightCommission: vi.fn(async () => ({ cancelled: 0 })),
}));

import {
  type AdminClient,
  handleChargeRefunded,
  handleCheckoutCompleted,
  handleInvoiceFailed,
  handleInvoiceSucceeded,
  handlePaymentIntentFailed,
  handleSubscriptionDeleted,
  handleSubscriptionUpdated,
} from "./handlers";

// ---------------------------------------------------------------------------
// A scripted Supabase fake: results are queued per `table.op`; every call is recorded.
// ---------------------------------------------------------------------------

type Result = { data?: unknown; error?: { message: string; code?: string } | null };
interface Call {
  table: string;
  op: string;
  payload?: unknown;
  filters: Array<[string, string, unknown]>;
  select?: string;
}

function fakeAdmin(script: Record<string, Result[]> = {}) {
  const calls: Call[] = [];
  const queues = new Map(Object.entries(script).map(([k, v]) => [k, [...v]]));
  const next = (key: string): Result => queues.get(key)?.shift() ?? { data: null, error: null };

  function builder(table: string) {
    const call: Call = { table, op: "select", filters: [] };
    calls.push(call);
    const settle = () => {
      const r = next(`${table}.${call.op}`);
      return { data: r.data ?? null, error: r.error ?? null };
    };
    const b: Record<string, unknown> = {};
    const chain = (name: string) => (...args: unknown[]) => {
      call.filters.push([name, String(args[0]), args[1]]);
      return b;
    };
    for (const m of ["eq", "in", "is", "not", "order", "limit", "returns"]) b[m] = chain(m);
    b.select = (cols?: string) => {
      call.select = cols;
      return b;
    };
    for (const op of ["insert", "update", "upsert", "delete"]) {
      b[op] = (payload?: unknown) => {
        call.op = op;
        call.payload = payload;
        return b;
      };
    }
    b.maybeSingle = async () => settle();
    b.single = async () => settle();
    b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(settle()).then(resolve, reject);
    return b;
  }

  return { admin: { from: builder } as unknown as AdminClient, calls };
}

const evt = <T>(object: unknown) => ({ data: { object } }) as unknown as T;

beforeEach(() => {
  stripeState.retrieveSub.mockReset();
  stripeState.listRefunds.mockReset();
  stripeState.createRefund.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// checkout.session.completed
// ---------------------------------------------------------------------------

describe("handleCheckoutCompleted — outcome", () => {
  const checkout = (metadata: Record<string, string> | null) =>
    evt<Stripe.CheckoutSessionCompletedEvent>({
      id: "cs_1",
      metadata,
      customer: "cus_1",
      subscription: null,
      payment_intent: "pi_1",
    });

  it("ignored when metadata.user_id is missing", async () => {
    const { admin, calls } = fakeAdmin();
    expect(await handleCheckoutCompleted(admin, checkout({ plan: "upfront" }))).toBe("ignored");
    expect(calls).toHaveLength(0);
  });

  it("ignored when the plan is unknown", async () => {
    const { admin, calls } = fakeAdmin();
    expect(await handleCheckoutCompleted(admin, checkout({ user_id: "u1", plan: "weekly" }))).toBe(
      "ignored",
    );
    expect(calls).toHaveLength(0);
  });

  it("applied when the upfront subscription is written", async () => {
    const { admin, calls } = fakeAdmin({
      "parent_subscriptions.select": [{ data: null }, { data: { id: "ps1" } }],
      "child_client.select": [{ data: [] }],
    });
    expect(await handleCheckoutCompleted(admin, checkout({ user_id: "u1", plan: "upfront" }))).toBe(
      "applied",
    );
    expect(calls.some((c) => c.table === "parent_subscriptions" && c.op === "upsert")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// customer.subscription.updated / deleted
// ---------------------------------------------------------------------------

describe("handleSubscriptionUpdated — outcome", () => {
  const subEvent = (fields: Record<string, unknown>) =>
    evt<Stripe.CustomerSubscriptionUpdatedEvent>({ id: "sub_1", status: "active", ...fields });

  it("ignored when the period end cannot be read", async () => {
    const { admin } = fakeAdmin();
    expect(await handleSubscriptionUpdated(admin, subEvent({ items: { data: [] } }))).toBe("ignored");
  });

  it("ignored when no subscription row matches", async () => {
    const { admin } = fakeAdmin({ "parent_subscriptions.select": [{ data: null }] });
    expect(await handleSubscriptionUpdated(admin, subEvent({ current_period_end: 1 }))).toBe("ignored");
  });

  it("ignored when the local row is terminal", async () => {
    const { admin, calls } = fakeAdmin({
      "parent_subscriptions.select": [{ data: { status: "cancelled" } }],
    });
    expect(await handleSubscriptionUpdated(admin, subEvent({ current_period_end: 1 }))).toBe("ignored");
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it("ignored when Stripe's status is inactive", async () => {
    const { admin } = fakeAdmin({ "parent_subscriptions.select": [{ data: { status: "active_monthly" } }] });
    expect(
      await handleSubscriptionUpdated(admin, subEvent({ current_period_end: 1, status: "canceled" })),
    ).toBe("ignored");
  });

  it("applied when the period end is written", async () => {
    const { admin } = fakeAdmin({ "parent_subscriptions.select": [{ data: { status: "active_monthly" } }] });
    expect(await handleSubscriptionUpdated(admin, subEvent({ current_period_end: 1 }))).toBe("applied");
  });
});

describe("handleSubscriptionDeleted — outcome", () => {
  const deleted = evt<Stripe.CustomerSubscriptionDeletedEvent>({ id: "sub_1" });

  it("ignored when no subscription row matches", async () => {
    const { admin } = fakeAdmin({ "parent_subscriptions.update": [{ data: null }] });
    expect(await handleSubscriptionDeleted(admin, deleted)).toBe("ignored");
  });

  it("applied when the row is cancelled", async () => {
    const { admin } = fakeAdmin({
      "parent_subscriptions.update": [{ data: { id: "ps1", parent_user_id: "u1" } }],
    });
    expect(await handleSubscriptionDeleted(admin, deleted)).toBe("applied");
  });
});

// ---------------------------------------------------------------------------
// invoice.payment_succeeded / payment_failed
// ---------------------------------------------------------------------------

describe("handleInvoiceSucceeded — outcome", () => {
  const invoice = (fields: Record<string, unknown>) =>
    evt<Stripe.InvoicePaymentSucceededEvent>({ id: "in_1", ...fields });

  it("ignored when the invoice has no subscription", async () => {
    const { admin } = fakeAdmin();
    expect(await handleInvoiceSucceeded(admin, invoice({ amount_paid: 1 }))).toBe("ignored");
  });

  it("ignored when nothing was paid", async () => {
    const { admin } = fakeAdmin();
    expect(await handleInvoiceSucceeded(admin, invoice({ subscription: "sub_1", amount_paid: 0 }))).toBe(
      "ignored",
    );
    expect(stripeState.retrieveSub).not.toHaveBeenCalled();
  });

  it("ignored when no subscription row matches", async () => {
    stripeState.retrieveSub.mockResolvedValue({ current_period_end: 1 });
    const { admin, calls } = fakeAdmin({ "parent_subscriptions.select": [{ data: null }] });
    expect(await handleInvoiceSucceeded(admin, invoice({ subscription: "sub_1", amount_paid: 1 }))).toBe(
      "ignored",
    );
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it("applied when the paid period is extended", async () => {
    stripeState.retrieveSub.mockResolvedValue({ current_period_end: 1 });
    const { admin } = fakeAdmin({
      "parent_subscriptions.select": [{ data: { status: "active_monthly", parent_user_id: "u1" } }],
    });
    expect(await handleInvoiceSucceeded(admin, invoice({ subscription: "sub_1", amount_paid: 1 }))).toBe(
      "applied",
    );
  });
});

describe("handleInvoiceFailed — outcome", () => {
  const invoice = (fields: Record<string, unknown>) =>
    evt<Stripe.InvoicePaymentFailedEvent>({ id: "in_1", ...fields });

  it("ignored when the invoice has no subscription", async () => {
    const { admin } = fakeAdmin();
    expect(await handleInvoiceFailed(admin, invoice({}))).toBe("ignored");
  });

  it("ignored when no subscription row matches", async () => {
    const { admin } = fakeAdmin({ "parent_subscriptions.update": [{ data: null }] });
    expect(await handleInvoiceFailed(admin, invoice({ subscription: "sub_1" }))).toBe("ignored");
  });

  it("applied when the row goes past_due", async () => {
    const { admin } = fakeAdmin({
      "parent_subscriptions.update": [{ data: { id: "ps1", parent_user_id: "u1" } }],
    });
    expect(await handleInvoiceFailed(admin, invoice({ subscription: "sub_1" }))).toBe("applied");
  });
});

describe("handlePaymentIntentFailed — outcome", () => {
  it("ignored when the intent names no family", async () => {
    const { admin } = fakeAdmin();
    const e = evt<Stripe.PaymentIntentPaymentFailedEvent>({ id: "pi_1", metadata: {} });
    expect(await handlePaymentIntentFailed(admin, e)).toBe("ignored");
  });

  it("applied when the failure is logged against the family", async () => {
    const { admin, calls } = fakeAdmin();
    const e = evt<Stripe.PaymentIntentPaymentFailedEvent>({ id: "pi_1", metadata: { user_id: "u1" } });
    expect(await handlePaymentIntentFailed(admin, e)).toBe("applied");
    expect(calls.some((c) => c.table === "activity_logs" && c.op === "insert")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// charge.refunded
// ---------------------------------------------------------------------------

describe("handleChargeRefunded — Sydney stamp and London Dashboard refund", () => {
  const refund = { id: "re_1", amount: 100, currency: "gbp" };
  const charge = (fields: Record<string, unknown> = {}) =>
    evt<Stripe.ChargeRefundedEvent>({
      id: "ch_1",
      customer: "cus_1",
      payment_intent: "pi_1",
      currency: "gbp",
      refunds: { data: [refund] },
      ...fields,
    });

  it("applied, Sydney's path: a matching refund_requests row is stamped and nothing is inserted", async () => {
    const { admin, calls } = fakeAdmin({
      "refund_requests.update": [{ data: { id: "rr1", parent_user_id: "u1" } }],
    });
    expect(await handleChargeRefunded(admin, charge())).toBe("applied");
    expect(calls.some((c) => c.table === "refund_requests" && c.op === "insert")).toBe(false);
  });

  it("applied, London: no matching row → a Dashboard refund row is inserted from the charge", async () => {
    const { admin, calls } = fakeAdmin({
      "refund_requests.update": [{ data: null }],
      "parent_subscriptions.select": [{ data: { id: "ps1", parent_user_id: "u1" } }],
    });
    expect(await handleChargeRefunded(admin, charge())).toBe("applied");

    const insert = calls.find((c) => c.table === "refund_requests" && c.op === "insert");
    expect(insert?.payload).toMatchObject({
      parent_subscription_id: "ps1",
      parent_user_id: "u1",
      reason_category: "other",
      reason_text: "Refund issued in the Stripe Dashboard",
      calculated_refund_aud_cents: 100,
      approved_amount_aud_cents: 100,
      status: "approved",
      stripe_refund_id: "re_1",
    });
    expect((insert?.payload as { refund_processed_at?: string }).refund_processed_at).toEqual(
      expect.any(String),
    );
    const lookup = calls.find((c) => c.table === "parent_subscriptions" && c.op === "select");
    expect(lookup?.filters).toContainEqual(["eq", "stripe_customer_id", "cus_1"]);
    const log = calls.find((c) => c.table === "activity_logs" && c.op === "insert");
    expect(log?.payload).toMatchObject({ action_type: "refund_processed", user_id: "u1" });
  });

  it("a refund never touches access: no parent_subscriptions status or period is written", async () => {
    const { admin, calls } = fakeAdmin({
      "refund_requests.update": [{ data: null }],
      "parent_subscriptions.select": [
        { data: { id: "ps1", parent_user_id: "u1" } },
        { data: { deposit_stripe_payment_intent_id: "pi_other" } },
      ],
    });
    await handleChargeRefunded(admin, charge());
    const subWrites = calls.filter(
      (c) => c.table === "parent_subscriptions" && ["update", "upsert"].includes(c.op),
    );
    expect(subWrites).toHaveLength(0);
  });

  it("stamps deposit_refunded_at when the refunded payment is the deposit (4c's column)", async () => {
    const { admin, calls } = fakeAdmin({
      "refund_requests.update": [{ data: null }],
      "parent_subscriptions.select": [
        { data: { id: "ps1", parent_user_id: "u1" } },
        { data: { deposit_stripe_payment_intent_id: "pi_1" } },
      ],
    });
    expect(await handleChargeRefunded(admin, charge())).toBe("applied");
    const stamp = calls.find((c) => c.table === "parent_subscriptions" && c.op === "update");
    expect(Object.keys(stamp?.payload as object)).toEqual(["deposit_refunded_at"]);
    expect(stamp?.filters).toContainEqual(["eq", "id", "ps1"]);
  });

  it("reads the deposit column defensively: a missing column (before 4c's amendment) is skipped", async () => {
    const { admin, calls } = fakeAdmin({
      "refund_requests.update": [{ data: null }],
      "parent_subscriptions.select": [
        { data: { id: "ps1", parent_user_id: "u1" } },
        { error: { message: "column does not exist", code: "42703" } },
      ],
    });
    expect(await handleChargeRefunded(admin, charge())).toBe("applied");
    expect(calls.some((c) => c.table === "parent_subscriptions" && c.op === "update")).toBe(false);
  });

  it("ignored when no parent resolves from the charge's customer", async () => {
    const { admin, calls } = fakeAdmin({
      "refund_requests.update": [{ data: null }],
      "parent_subscriptions.select": [{ data: null }],
    });
    expect(await handleChargeRefunded(admin, charge())).toBe("ignored");
    expect(calls.some((c) => c.table === "refund_requests" && c.op === "insert")).toBe(false);
  });

  it("ignored when the charge has no customer", async () => {
    const { admin } = fakeAdmin({ "refund_requests.update": [{ data: null }] });
    expect(await handleChargeRefunded(admin, charge({ customer: null }))).toBe("ignored");
  });

  it("lists the charge's newest refund when the payload omits `refunds` (API 2024-09-30)", async () => {
    stripeState.listRefunds.mockResolvedValue({ data: [refund] });
    const { admin, calls } = fakeAdmin({
      "refund_requests.update": [{ data: { id: "rr1", parent_user_id: "u1" } }],
    });
    expect(await handleChargeRefunded(admin, charge({ refunds: undefined }))).toBe("applied");
    expect(stripeState.listRefunds).toHaveBeenCalledWith({ charge: "ch_1", limit: 1 });
    const stamp = calls.find((c) => c.table === "refund_requests" && c.op === "update");
    expect(stamp?.filters).toContainEqual(["eq", "stripe_refund_id", "re_1"]);
  });

  it("ignored when no refund can be found at all", async () => {
    stripeState.listRefunds.mockResolvedValue({ data: [] });
    const { admin } = fakeAdmin();
    expect(await handleChargeRefunded(admin, charge({ refunds: undefined }))).toBe("ignored");
  });

  it("throws (→ unresolved) when the refund_requests insert fails", async () => {
    const { admin } = fakeAdmin({
      "refund_requests.update": [{ data: null }],
      "parent_subscriptions.select": [{ data: { id: "ps1", parent_user_id: "u1" } }],
      "refund_requests.insert": [{ error: { message: "boom" } }],
    });
    await expect(handleChargeRefunded(admin, charge())).rejects.toThrow(/refund_requests insert/);
  });
});
