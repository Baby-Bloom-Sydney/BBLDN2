/**
 * Stripe webhook handlers — the outcome each kept handler returns (LDN2 unit 4d).
 *
 * Every one of the seven kept handlers returns `"applied"` when it changed state and
 * `"ignored"` on its early-return branches (ADR-146/156). `charge.refunded` keeps
 * the existing stamping when a `refund_requests` row matches, and in London (refund made
 * by hand in the Stripe Dashboard, offer §3) inserts the row itself. A refund never
 * touches access (offer §4 G2).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

import { ACCESS_AGE_YEARS, GRACE_DAYS } from "@/config/prices";
import {
  type AdminClient,
  accessHorizonIso,
  recomputeUpfrontHorizon,
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
    for (const m of ["eq", "in", "is", "not", "lt", "order", "limit", "returns"]) b[m] = chain(m);
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

  it("throws (→ unresolved) when the subscription read fails — never mistaken for 'no row'", async () => {
    stripeState.retrieveSub.mockResolvedValue({ current_period_end: 1 });
    const { admin, calls } = fakeAdmin({ "parent_subscriptions.select": [{ error: { message: "down" } }] });
    await expect(
      handleInvoiceSucceeded(admin, invoice({ subscription: "sub_1", amount_paid: 1 })),
    ).rejects.toThrow(/invoice.succeeded/);
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

describe("handleChargeRefunded — existing stamp and London Dashboard refund", () => {
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

  it("applied, existing path: a matching refund_requests row is stamped and nothing is inserted", async () => {
    const { admin, calls } = fakeAdmin({
      "refund_requests.select": [{ data: { id: "rr1", refund_processed_at: null } }],
      "refund_requests.update": [{ data: { id: "rr1", parent_user_id: "u1" } }],
    });
    expect(await handleChargeRefunded(admin, charge())).toBe("applied");
    expect(calls.some((c) => c.table === "refund_requests" && c.op === "insert")).toBe(false);
  });

  it("applied, London: no matching row → a Dashboard refund row is inserted from the charge", async () => {
    const { admin, calls } = fakeAdmin({
      "refund_requests.select": [{ data: null }],
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
      "refund_requests.select": [{ data: null }],
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
      "refund_requests.select": [{ data: null }],
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
      "refund_requests.select": [{ data: null }],
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
      "refund_requests.select": [{ data: null }],
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
      "refund_requests.select": [{ data: { id: "rr1", refund_processed_at: null } }],
      "refund_requests.update": [{ data: { id: "rr1", parent_user_id: "u1" } }],
    });
    expect(await handleChargeRefunded(admin, charge({ refunds: undefined }))).toBe("applied");
    expect(stripeState.listRefunds).toHaveBeenCalledWith({ charge: "ch_1", limit: 10 });
    const stamp = calls.find((c) => c.table === "refund_requests" && c.op === "update");
    expect(stamp?.filters).toContainEqual(["eq", "stripe_refund_id", "re_1"]);
  });

  it("ignored when the refund is already recorded and processed (a later event re-seeing it)", async () => {
    const { admin, calls } = fakeAdmin({
      "refund_requests.select": [{ data: { id: "rr1", refund_processed_at: "2026-10-15T00:00:00Z" } }],
    });
    expect(await handleChargeRefunded(admin, charge())).toBe("ignored");
    expect(calls.some((c) => c.table === "refund_requests" && c.op !== "select")).toBe(false);
  });

  it("records every unrecorded refund on the charge, not only the newest", async () => {
    const second = { id: "re_2", amount: 50, currency: "gbp", status: "succeeded" };
    const { admin, calls } = fakeAdmin({
      "refund_requests.select": [{ data: null }, { data: { id: "rr1", refund_processed_at: "x" } }],
      "parent_subscriptions.select": [{ data: { id: "ps1", parent_user_id: "u1" } }],
    });
    expect(await handleChargeRefunded(admin, charge({ refunds: { data: [second, refund] } }))).toBe(
      "applied",
    );
    const inserts = calls.filter((c) => c.table === "refund_requests" && c.op === "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].payload).toMatchObject({ stripe_refund_id: "re_2", approved_amount_aud_cents: 50 });
  });

  it("skips failed / cancelled refunds (no money moved)", async () => {
    const failed = { ...refund, status: "failed" };
    const { admin, calls } = fakeAdmin();
    expect(await handleChargeRefunded(admin, charge({ refunds: { data: [failed] } }))).toBe("ignored");
    expect(calls).toHaveLength(0);
  });

  it("a failed deposit stamp is logged, not thrown (the refund row is already written)", async () => {
    const { admin } = fakeAdmin({
      "refund_requests.select": [{ data: null }],
      "parent_subscriptions.select": [
        { data: { id: "ps1", parent_user_id: "u1" } },
        { data: { deposit_stripe_payment_intent_id: "pi_1" } },
      ],
      "parent_subscriptions.update": [{ error: { message: "boom" } }],
    });
    expect(await handleChargeRefunded(admin, charge())).toBe("applied");
    expect(console.error).toHaveBeenCalled();
  });

  it("throws (→ unresolved) when the refund_requests read fails", async () => {
    const { admin } = fakeAdmin({ "refund_requests.select": [{ error: { message: "down" } }] });
    await expect(handleChargeRefunded(admin, charge())).rejects.toThrow(/refund_requests read/);
  });

  it("ignored when no refund can be found at all", async () => {
    stripeState.listRefunds.mockResolvedValue({ data: [] });
    const { admin } = fakeAdmin();
    expect(await handleChargeRefunded(admin, charge({ refunds: undefined }))).toBe("ignored");
  });

  it("throws (→ unresolved) when the refund_requests insert fails", async () => {
    const { admin } = fakeAdmin({
      "refund_requests.select": [{ data: null }],
      "parent_subscriptions.select": [{ data: { id: "ps1", parent_user_id: "u1" } }],
      "refund_requests.insert": [{ error: { message: "boom" } }],
    });
    await expect(handleChargeRefunded(admin, charge())).rejects.toThrow(/refund_requests insert/);
  });
});

// ---------------------------------------------------------------------------
// 4b — access horizon (ADR-083/084, B1): youngest linked child's DOB + ACCESS_AGE_YEARS,
// recomputed on child link; past-due grace from GRACE_DAYS (card 3a).
// ---------------------------------------------------------------------------

const OLDER_DOB = "2024-03-10";
const YOUNGER_DOB = "2025-08-20";
const plusYears = (dob: string, years: number) => {
  const d = new Date(dob);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString();
};

describe("accessHorizonIso — youngest child's 3rd birthday", () => {
  it("is the youngest child's DOB + ACCESS_AGE_YEARS, whatever order the rows come in", async () => {
    const { admin, calls } = fakeAdmin({
      "child_client.select": [
        { data: [{ date_of_birth: YOUNGER_DOB }, { date_of_birth: OLDER_DOB }] },
        { data: [{ date_of_birth: OLDER_DOB }, { date_of_birth: YOUNGER_DOB }] },
      ],
    });
    const expected = plusYears(YOUNGER_DOB, ACCESS_AGE_YEARS);
    expect(await accessHorizonIso(admin, "u1")).toBe(expected);
    expect(await accessHorizonIso(admin, "u1")).toBe(expected);
    expect(expected).toBe("2028-08-20T00:00:00.000Z");
    expect(calls[0].filters).toContainEqual(["eq", "parent_user_id", "u1"]);
  });

  it("falls back to now + ACCESS_AGE_YEARS when no child has a DOB", async () => {
    const now = new Date("2026-10-15T03:00:00Z");
    const { admin } = fakeAdmin({ "child_client.select": [{ data: [] }] });
    expect(await accessHorizonIso(admin, "u1", now)).toBe(plusYears(now.toISOString(), ACCESS_AGE_YEARS));
  });

  it("throws on a DB error so Stripe retries rather than locking in a wrong period", async () => {
    const { admin } = fakeAdmin({ "child_client.select": [{ error: { message: "boom" } }] });
    await expect(accessHorizonIso(admin, "u1")).rejects.toThrow(/child_client lookup/);
  });

  it("the upfront checkout writes the youngest child's horizon to paid_period_ends_at", async () => {
    const { admin, calls } = fakeAdmin({
      "parent_subscriptions.select": [{ data: null }, { data: { id: "ps1" } }],
      "child_client.select": [{ data: [{ date_of_birth: OLDER_DOB }, { date_of_birth: YOUNGER_DOB }] }],
    });
    const e = evt<Stripe.CheckoutSessionCompletedEvent>({
      id: "cs_1",
      metadata: { user_id: "u1", plan: "upfront" },
      customer: "cus_1",
      subscription: null,
      payment_intent: "pi_1",
    });
    expect(await handleCheckoutCompleted(admin, e)).toBe("applied");
    const upsert = calls.find((c) => c.table === "parent_subscriptions" && c.op === "upsert");
    expect((upsert?.payload as { paid_period_ends_at: string }).paid_period_ends_at).toBe(
      plusYears(YOUNGER_DOB, ACCESS_AGE_YEARS),
    );
  });
});

describe("recomputeUpfrontHorizon — on child link", () => {
  const upfrontRow = (paidEnds: string | null, status = "active_upfront") => ({
    data: { id: "ps1", status, paid_period_ends_at: paidEnds },
  });

  it("linking a younger child moves the date forward", async () => {
    const before = plusYears(OLDER_DOB, ACCESS_AGE_YEARS);
    const { admin, calls } = fakeAdmin({
      "parent_subscriptions.select": [upfrontRow(before)],
      "child_client.select": [{ data: [{ date_of_birth: OLDER_DOB }, { date_of_birth: YOUNGER_DOB }] }],
    });
    expect(await recomputeUpfrontHorizon(admin, "u1")).toBe("updated");
    const update = calls.find((c) => c.table === "parent_subscriptions" && c.op === "update");
    expect(update?.payload).toEqual({ paid_period_ends_at: "2028-08-20T00:00:00.000Z" });
    expect(update?.filters).toContainEqual(["eq", "id", "ps1"]);
    // forward-only under a race: the write is conditional on the stored date being earlier
    expect(update?.filters).toContainEqual(["lt", "paid_period_ends_at", "2028-08-20T00:00:00.000Z"]);
  });

  it("linking an older child leaves the date where it is", async () => {
    const before = plusYears(YOUNGER_DOB, ACCESS_AGE_YEARS);
    const { admin, calls } = fakeAdmin({
      "parent_subscriptions.select": [upfrontRow(before)],
      "child_client.select": [{ data: [{ date_of_birth: YOUNGER_DOB }, { date_of_birth: OLDER_DOB }] }],
    });
    expect(await recomputeUpfrontHorizon(admin, "u1")).toBe("unchanged");
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it("never shortens a paid horizon", async () => {
    const later = "2031-01-01T00:00:00.000Z";
    const { admin, calls } = fakeAdmin({
      "parent_subscriptions.select": [upfrontRow(later)],
      "child_client.select": [{ data: [{ date_of_birth: YOUNGER_DOB }] }],
    });
    expect(await recomputeUpfrontHorizon(admin, "u1")).toBe("unchanged");
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it.each(["trial", "active_monthly", "cancelled", "placed", "deposit_paid"])(
    "does nothing for a %s row",
    async (status) => {
      const { admin, calls } = fakeAdmin({
        "parent_subscriptions.select": [upfrontRow("2027-01-01T00:00:00.000Z", status)],
      });
      expect(await recomputeUpfrontHorizon(admin, "u1")).toBe("not_upfront");
      expect(calls.map((c) => c.table)).toEqual(["parent_subscriptions"]);
    },
  );

  it("a 29 Feb birthday's horizon is 1 Mar in a non-leap year", async () => {
    const { admin } = fakeAdmin({ "child_client.select": [{ data: [{ date_of_birth: "2024-02-29" }] }] });
    expect(await accessHorizonIso(admin, "u1")).toBe("2027-03-01T00:00:00.000Z");
  });

  it("no child with a DOB: nothing moves (the now + N fallback is checkout-only)", async () => {
    const { admin, calls } = fakeAdmin({
      "parent_subscriptions.select": [upfrontRow("2027-01-01T00:00:00.000Z")],
      "child_client.select": [{ data: [] }],
    });
    expect(await recomputeUpfrontHorizon(admin, "u1")).toBe("unchanged");
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it("does nothing when the parent has no row", async () => {
    const { admin } = fakeAdmin({ "parent_subscriptions.select": [{ data: null }] });
    expect(await recomputeUpfrontHorizon(admin, "u1")).toBe("not_upfront");
  });

  it("throws on a failed update (the caller logs it; the link stands)", async () => {
    const { admin } = fakeAdmin({
      "parent_subscriptions.select": [upfrontRow(plusYears(OLDER_DOB, ACCESS_AGE_YEARS))],
      "child_client.select": [{ data: [{ date_of_birth: YOUNGER_DOB }] }],
      "parent_subscriptions.update": [{ error: { message: "boom" } }],
    });
    await expect(recomputeUpfrontHorizon(admin, "u1")).rejects.toThrow(/horizon/);
  });
});

describe("handleInvoiceFailed — grace window from GRACE_DAYS (card 3a)", () => {
  it("sets past_due_grace_ends_at to now + GRACE_DAYS days", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T03:00:00Z"));
    try {
      const { admin, calls } = fakeAdmin({
        "parent_subscriptions.update": [{ data: { id: "ps1", parent_user_id: "u1" } }],
      });
      const e = evt<Stripe.InvoicePaymentFailedEvent>({ id: "in_1", subscription: "sub_1" });
      expect(await handleInvoiceFailed(admin, e)).toBe("applied");
      const update = calls.find((c) => c.table === "parent_subscriptions" && c.op === "update");
      const dayMs = 24 * 60 * 60 * 1000;
      expect((update?.payload as { past_due_grace_ends_at: string }).past_due_grace_ends_at).toBe(
        new Date(Date.parse("2026-10-15T03:00:00Z") + GRACE_DAYS * dayMs).toISOString(),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// 4-w5fix (W5-M1): commission / payout calls from kept self-serve flows run only
// when PAYOUTS_ENABLED (P-23 hide — the engine code stays).
// ---------------------------------------------------------------------------

describe("commission calls are behind PAYOUTS_ENABLED (4-w5fix, W5-M1)", () => {
  const checkout = evt<Stripe.CheckoutSessionCompletedEvent>({
    id: "cs_1",
    metadata: { user_id: "u1", plan: "upfront" },
    customer: "cus_1",
    subscription: null,
    payment_intent: "pi_1",
  });
  const checkoutScript = () => ({
    "parent_subscriptions.select": [{ data: null }, { data: { id: "ps1" } }],
    "child_client.select": [{ data: [] }],
  });
  const renewalScript = () => ({
    "parent_subscriptions.select": [
      { data: { status: "active_monthly", parent_user_id: "u1" } },
      { data: { id: "ps1" } },
    ],
  });
  const renewal = evt<Stripe.InvoicePaymentSucceededEvent>({ id: "in_1", subscription: "sub_1", amount_paid: 1 });
  const deleted = evt<Stripe.CustomerSubscriptionDeletedEvent>({ id: "sub_1" });
  const failed = evt<Stripe.InvoicePaymentFailedEvent>({ id: "in_1", subscription: "sub_1" });
  const rowScript = () => ({ "parent_subscriptions.update": [{ data: { id: "ps1", parent_user_id: "u1" } }] });

  beforeEach(async () => {
    const { scheduleCommissionFor } = await import("@/lib/payments/commission-scheduler");
    const { cancelInFlightCommission } = await import("@/lib/payments/commission-cancel");
    vi.mocked(scheduleCommissionFor).mockClear();
    vi.mocked(cancelInFlightCommission).mockClear();
    stripeState.retrieveSub.mockResolvedValue({ current_period_end: 1 });
  });
  afterEach(() => vi.unstubAllEnvs());

  const mocks = async () => ({
    schedule: vi.mocked((await import("@/lib/payments/commission-scheduler")).scheduleCommissionFor),
    cancel: vi.mocked((await import("@/lib/payments/commission-cancel")).cancelInFlightCommission),
  });

  it("flag off: a paid self-serve checkout schedules no commission (no nanny_payouts row)", async () => {
    vi.stubEnv("PAYOUTS_ENABLED", "");
    const { admin, calls } = fakeAdmin(checkoutScript());
    expect(await handleCheckoutCompleted(admin, checkout)).toBe("applied");
    expect((await mocks()).schedule).not.toHaveBeenCalled();
    expect(calls.some((c) => c.table === "nanny_payouts")).toBe(false);
  });

  it("flag on: the same checkout schedules cycle 1 as before", async () => {
    vi.stubEnv("PAYOUTS_ENABLED", "true");
    const { admin } = fakeAdmin(checkoutScript());
    expect(await handleCheckoutCompleted(admin, checkout)).toBe("applied");
    expect((await mocks()).schedule).toHaveBeenCalledWith({ parentSubscriptionId: "ps1", cycleIndex: 1 });
  });

  it("flag off: a renewal schedules no commission; flag on: it does", async () => {
    vi.stubEnv("PAYOUTS_ENABLED", "");
    expect(await handleInvoiceSucceeded(fakeAdmin(renewalScript()).admin, renewal)).toBe("applied");
    expect((await mocks()).schedule).not.toHaveBeenCalled();
    vi.stubEnv("PAYOUTS_ENABLED", "true");
    await handleInvoiceSucceeded(fakeAdmin(renewalScript()).admin, renewal);
    expect((await mocks()).schedule).toHaveBeenCalledWith({ parentSubscriptionId: "ps1", cycleIndex: 1 });
  });

  it("flag off: a deleted subscription freezes no commission; flag on: it does", async () => {
    vi.stubEnv("PAYOUTS_ENABLED", "");
    expect(await handleSubscriptionDeleted(fakeAdmin(rowScript()).admin, deleted)).toBe("applied");
    expect((await mocks()).cancel).not.toHaveBeenCalled();
    vi.stubEnv("PAYOUTS_ENABLED", "true");
    await handleSubscriptionDeleted(fakeAdmin(rowScript()).admin, deleted);
    expect((await mocks()).cancel).toHaveBeenCalledWith("ps1", "parent_cancelled");
  });

  it("flag off: a failed invoice defers no nanny_payouts row; flag on: it does", async () => {
    vi.stubEnv("PAYOUTS_ENABLED", "");
    const off = fakeAdmin(rowScript());
    expect(await handleInvoiceFailed(off.admin, failed)).toBe("applied");
    expect(off.calls.some((c) => c.table === "nanny_payouts")).toBe(false);
    vi.stubEnv("PAYOUTS_ENABLED", "true");
    const on = fakeAdmin(rowScript());
    await handleInvoiceFailed(on.admin, failed);
    expect(on.calls.filter((c) => c.table === "nanny_payouts" && c.op === "update")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 4-w5fix (W5-M3): a DFY refund resolves the family by customer, or else by the
// refunded payment intent against the deposit / bill intent.
// ---------------------------------------------------------------------------

describe("handleChargeRefunded — DFY family by payment intent (4-w5fix, W5-M3)", () => {
  const refund = { id: "re_dfy", amount: 15_000, currency: "gbp" };
  const charge = (fields: Record<string, unknown> = {}) =>
    evt<Stripe.ChargeRefundedEvent>({
      id: "ch_dfy",
      customer: null,
      payment_intent: "pi_dfy_dep",
      currency: "gbp",
      refunds: { data: [refund] },
      ...fields,
    });

  it("deposit refund with no customer: found by deposit intent → refund_requests row + deposit_refunded_at", async () => {
    const { admin, calls } = fakeAdmin({
      "refund_requests.select": [{ data: null }],
      "parent_subscriptions.select": [
        { data: { id: "ps1", parent_user_id: "u1" } }, // by deposit intent
        { data: { deposit_stripe_payment_intent_id: "pi_dfy_dep" } }, // stamp read
      ],
    });
    expect(await handleChargeRefunded(admin, charge())).toBe("applied");
    const lookup = calls.filter((c) => c.table === "parent_subscriptions" && c.op === "select")[0];
    expect(lookup.filters).toContainEqual(["eq", "deposit_stripe_payment_intent_id", "pi_dfy_dep"]);
    const insert = calls.find((c) => c.table === "refund_requests" && c.op === "insert");
    expect(insert?.payload).toMatchObject({
      parent_subscription_id: "ps1",
      parent_user_id: "u1",
      reason_category: "other",
      reason_text: "Refund issued in the Stripe Dashboard",
      stripe_refund_id: "re_dfy",
    });
    const stamp = calls.find((c) => c.table === "parent_subscriptions" && c.op === "update");
    expect(Object.keys(stamp?.payload as object)).toEqual(["deposit_refunded_at"]);
  });

  it("bill refund: customer unknown, not the deposit → found by bill intent → row written, no stamp, no access write", async () => {
    const { admin, calls } = fakeAdmin({
      "refund_requests.select": [{ data: null }],
      "parent_subscriptions.select": [
        { data: null }, // by customer
        { data: null }, // by deposit intent
        { data: { id: "ps1", parent_user_id: "u1" } }, // by bill intent
        { data: { deposit_stripe_payment_intent_id: "pi_dfy_dep" } },
      ],
    });
    const res = await handleChargeRefunded(admin, charge({ customer: "cus_unknown", payment_intent: "pi_dfy_bill" }));
    expect(res).toBe("applied");
    const lookups = calls.filter((c) => c.table === "parent_subscriptions" && c.op === "select");
    expect(lookups[2].filters).toContainEqual(["eq", "bill_stripe_payment_intent_id", "pi_dfy_bill"]);
    expect(calls.some((c) => c.table === "refund_requests" && c.op === "insert")).toBe(true);
    expect(calls.some((c) => c.table === "parent_subscriptions" && ["update", "upsert"].includes(c.op))).toBe(false);
  });

  it("the customer still wins when it resolves: no intent lookup is made", async () => {
    const { admin, calls } = fakeAdmin({
      "refund_requests.select": [{ data: null }],
      "parent_subscriptions.select": [{ data: { id: "ps1", parent_user_id: "u1" } }, { data: null }],
    });
    await handleChargeRefunded(admin, charge({ customer: "cus_1" }));
    const lookups = calls.filter((c) => c.table === "parent_subscriptions" && c.op === "select");
    expect(lookups[0].filters).toContainEqual(["eq", "stripe_customer_id", "cus_1"]);
    expect(lookups.some((c) => c.filters.some(([, col]) => col.endsWith("_payment_intent_id")))).toBe(false);
  });

  it("no customer and no matching intent → ignored, nothing inserted", async () => {
    const { admin, calls } = fakeAdmin({ "refund_requests.select": [{ data: null }] });
    expect(await handleChargeRefunded(admin, charge())).toBe("ignored");
    expect(calls.some((c) => c.table === "refund_requests" && c.op === "insert")).toBe(false);
  });

  it("an intent lookup error throws (→ unresolved), never mistaken for 'no family'", async () => {
    const { admin } = fakeAdmin({
      "refund_requests.select": [{ data: null }],
      "parent_subscriptions.select": [{ error: { message: "down" } }],
    });
    await expect(handleChargeRefunded(admin, charge())).rejects.toThrow(/lookup failed/);
  });
});
