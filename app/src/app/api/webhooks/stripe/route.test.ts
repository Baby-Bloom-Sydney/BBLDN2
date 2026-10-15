/**
 * Stripe webhook route — the outcome ledger (LDN2 unit 4d; ADR-146, ADR-156, P-18).
 *
 * The route inserts the event row before dispatch (existing, kept), answers a
 * duplicate with 200, and after dispatch writes the outcome:
 *   applied    → outcome + processed_at
 *   ignored    → outcome + processed_at
 *   throw      → outcome 'unresolved' + processing_error + retry_count, processed_at
 *                left NULL, 500 so Stripe retries
 * An event type the route does not act on is `ignored`. A checkout session carrying
 * `metadata.link_kind` goes to 4c's DFY link handler.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  handleCheckoutCompleted: vi.fn(),
  handleSubscriptionUpdated: vi.fn(),
  handleSubscriptionDeleted: vi.fn(),
  handleInvoiceSucceeded: vi.fn(),
  handleInvoiceFailed: vi.fn(),
  handlePaymentIntentFailed: vi.fn(),
  handleChargeRefunded: vi.fn(),
  handleAccountUpdated: vi.fn(),
  handleAccountDeauthorized: vi.fn(),
  handleCapabilityUpdated: vi.fn(),
  handlePayoutCreated: vi.fn(),
  handlePayoutPaid: vi.fn(),
  handlePayoutFailed: vi.fn(),
  handleDfyLinkCompleted: vi.fn(),
  verify: vi.fn(),
  db: {
    insertError: null as null | { code?: string; message: string },
    insertData: { id: "row1" } as unknown,
    existingRetry: 0,
    updateError: null as null | { message: string },
    writes: [] as Array<{ op: string; payload: unknown; filters: Array<[string, unknown]> }>,
  },
}));

vi.mock("./handlers", () => ({
  handleCheckoutCompleted: h.handleCheckoutCompleted,
  handleSubscriptionUpdated: h.handleSubscriptionUpdated,
  handleSubscriptionDeleted: h.handleSubscriptionDeleted,
  handleInvoiceSucceeded: h.handleInvoiceSucceeded,
  handleInvoiceFailed: h.handleInvoiceFailed,
  handlePaymentIntentFailed: h.handlePaymentIntentFailed,
  handleChargeRefunded: h.handleChargeRefunded,
  handleAccountUpdated: h.handleAccountUpdated,
  handleAccountDeauthorized: h.handleAccountDeauthorized,
  handleCapabilityUpdated: h.handleCapabilityUpdated,
  handlePayoutCreated: h.handlePayoutCreated,
  handlePayoutPaid: h.handlePayoutPaid,
  handlePayoutFailed: h.handlePayoutFailed,
}));

vi.mock("@/lib/payments/dfy-webhook", () => ({
  handleDfyLinkCompleted: h.handleDfyLinkCompleted,
}));

vi.mock("@/lib/stripe/webhooks", () => ({
  verifyWebhookSignature: (...args: unknown[]) => h.verify(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "stripe_webhook_events") throw new Error(`unexpected table ${table}`);
      const filters: Array<[string, unknown]> = [];
      let op = "select";
      let payload: unknown;
      const b: Record<string, unknown> = {};
      b.insert = (p: unknown) => {
        op = "insert";
        payload = p;
        return b;
      };
      b.update = (p: unknown) => {
        op = "update";
        payload = p;
        return b;
      };
      b.select = () => b;
      b.eq = (col: string, v: unknown) => {
        filters.push([col, v]);
        return b;
      };
      const settle = () => {
        if (op === "insert") {
          h.db.writes.push({ op, payload, filters });
          return { data: h.db.insertError ? null : h.db.insertData, error: h.db.insertError };
        }
        if (op === "update") {
          h.db.writes.push({ op, payload, filters });
          return { data: null, error: h.db.updateError };
        }
        return { data: { retry_count: h.db.existingRetry }, error: null };
      };
      b.maybeSingle = async () => settle();
      b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(settle()).then(res, rej);
      return b;
    },
  }),
}));

const ALL = Object.values(h).filter((v) => typeof v === "function") as Array<ReturnType<typeof vi.fn>>;

beforeEach(() => {
  for (const fn of ALL) fn.mockReset();
  h.verify.mockImplementation((raw: string) => JSON.parse(raw));
  h.db.insertError = null;
  h.db.insertData = { id: "row1" };
  h.db.existingRetry = 0;
  h.db.updateError = null;
  h.db.writes = [];
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "test-webhook-secret");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => vi.unstubAllEnvs());

async function post(event: Record<string, unknown>, headers: Record<string, string> = { "stripe-signature": "t=1,v1=x" }) {
  const { POST } = await import("./route");
  const req = new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST",
    body: JSON.stringify(event),
    headers,
  });
  return POST(req);
}

const updates = () => h.db.writes.filter((w) => w.op === "update");
const lastUpdate = () => updates().at(-1)?.payload as Record<string, unknown> | undefined;

describe("stripe webhook route — outcome matrix", () => {
  it("applied: outcome 'applied' + processed_at, 200", async () => {
    h.handleChargeRefunded.mockResolvedValue("applied");
    const res = await post({ id: "evt_1", type: "charge.refunded", data: { object: {} } });
    expect(res.status).toBe(200);
    expect(lastUpdate()).toMatchObject({ outcome: "applied", processed_at: expect.any(String) });
    expect(updates()[0].filters).toContainEqual(["stripe_event_id", "evt_1"]);
  });

  it("ignored: outcome 'ignored' + processed_at, 200", async () => {
    h.handleInvoiceFailed.mockResolvedValue("ignored");
    const res = await post({ id: "evt_2", type: "invoice.payment_failed", data: { object: {} } });
    expect(res.status).toBe(200);
    expect(lastUpdate()).toMatchObject({ outcome: "ignored", processed_at: expect.any(String) });
  });

  it("unresolved: a throwing handler writes outcome + processing_error + retry_count, leaves processed_at NULL, 500", async () => {
    h.db.existingRetry = 2;
    h.handleSubscriptionDeleted.mockRejectedValue(new Error("db down"));
    const res = await post({ id: "evt_3", type: "customer.subscription.deleted", data: { object: {} } });
    expect(res.status).toBe(500);
    const p = lastUpdate();
    expect(p).toEqual({ outcome: "unresolved", processing_error: "db down", retry_count: 3 });
    expect(updates().some((u) => (u.payload as Record<string, unknown>).processed_at)).toBe(false);
  });

  it("duplicate: a replayed event id is answered 200 with the existing body and nothing is dispatched", async () => {
    h.db.insertError = { code: "23505", message: "duplicate key" };
    const res = await post({ id: "evt_1", type: "charge.refunded", data: { object: {} } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Duplicate or in-progress");
    expect(h.handleChargeRefunded).not.toHaveBeenCalled();
    expect(updates()).toHaveLength(0);
  });

  it("recorder failure with no row: 500, nothing dispatched", async () => {
    h.db.insertError = { code: "08006", message: "connection" };
    const res = await post({ id: "evt_4", type: "charge.refunded", data: { object: {} } });
    expect(res.status).toBe(500);
    expect(h.handleChargeRefunded).not.toHaveBeenCalled();
  });

  it("a failed outcome write is logged; the handler's work stands and the answer is 200", async () => {
    h.db.updateError = { message: "write failed" };
    h.handleChargeRefunded.mockResolvedValue("applied");
    const res = await post({ id: "evt_12", type: "charge.refunded", data: { object: {} } });
    expect(res.status).toBe(200);
    expect(console.error).toHaveBeenCalledWith(
      "[stripe-webhook] outcome write failed",
      "evt_12",
      "write failed",
    );
  });

  it("an event type the route does not act on is 'ignored'", async () => {
    const res = await post({ id: "evt_5", type: "payment_intent.succeeded", data: { object: {} } });
    expect(res.status).toBe(200);
    expect(lastUpdate()).toMatchObject({ outcome: "ignored", processed_at: expect.any(String) });
  });

  it("inserts the event row before dispatch", async () => {
    h.handleInvoiceSucceeded.mockImplementation(async () => {
      expect(h.db.writes[0]).toMatchObject({
        op: "insert",
        payload: { stripe_event_id: "evt_6", event_type: "invoice.payment_succeeded" },
      });
      return "applied";
    });
    await post({ id: "evt_6", type: "invoice.payment_succeeded", data: { object: {} } });
    expect(h.handleInvoiceSucceeded).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["customer.subscription.updated", "handleSubscriptionUpdated"],
    ["payment_intent.payment_failed", "handlePaymentIntentFailed"],
  ] as const)("%s passes its handler's outcome through", async (type, fn) => {
    h[fn].mockResolvedValue("ignored");
    await post({ id: `evt_${type}`, type, data: { object: {} } });
    expect(h[fn]).toHaveBeenCalledTimes(1);
    expect(lastUpdate()).toMatchObject({ outcome: "ignored" });
  });
});

describe("stripe webhook route — checkout.session.completed", () => {
  it("a session with metadata.link_kind goes to 4c's DFY handler, not the self-serve one", async () => {
    h.handleDfyLinkCompleted.mockResolvedValue("applied");
    const session = { id: "cs_1", metadata: { link_kind: "deposit" } };
    const res = await post({ id: "evt_7", type: "checkout.session.completed", data: { object: session } });
    expect(res.status).toBe(200);
    expect(h.handleDfyLinkCompleted).toHaveBeenCalledWith(expect.anything(), session);
    expect(h.handleCheckoutCompleted).not.toHaveBeenCalled();
    expect(lastUpdate()).toMatchObject({ outcome: "applied" });
  });

  it("a session without link_kind goes to the self-serve handler", async () => {
    h.handleCheckoutCompleted.mockResolvedValue("ignored");
    await post({
      id: "evt_8",
      type: "checkout.session.completed",
      data: { object: { id: "cs_2", metadata: { user_id: "u1", plan: "monthly" } } },
    });
    expect(h.handleCheckoutCompleted).toHaveBeenCalledTimes(1);
    expect(h.handleDfyLinkCompleted).not.toHaveBeenCalled();
    expect(lastUpdate()).toMatchObject({ outcome: "ignored" });
  });
});

describe("stripe webhook route — signature path (unchanged, re-asserted)", () => {
  it("400 without a signature header, no row written", async () => {
    const res = await post({ id: "evt_9", type: "charge.refunded" }, {});
    expect(res.status).toBe(400);
    expect(h.db.writes).toHaveLength(0);
  });

  it("400 when the signature does not verify, no row written", async () => {
    h.verify.mockImplementation(() => {
      throw new Error("bad sig");
    });
    const res = await post({ id: "evt_10", type: "charge.refunded" });
    expect(res.status).toBe(400);
    expect(h.db.writes).toHaveLength(0);
  });

  it("500 when the webhook secret is not configured", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    const res = await post({ id: "evt_11", type: "charge.refunded" });
    expect(res.status).toBe(500);
    expect(h.db.writes).toHaveLength(0);
  });
});
