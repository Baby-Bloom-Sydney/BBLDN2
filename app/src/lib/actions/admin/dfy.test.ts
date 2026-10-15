/**
 * Admin DFY actions — createDfyPaymentLink (brief step 4; cards 5a, M-1 1c) and setFamilyAccess
 * (brief step 7; card 7b, ADR-093). BB-LDN-4c-151026.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRICES, VAT } from "@/config/prices";
import { FIRST_WEEK_DISCOUNT_CAP } from "@/config/offer";
import { fakeAdmin, writesTo, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";

const h = vi.hoisted(() => ({
  admin: { userId: "admin-1", error: null as string | null },
  fake: null as unknown as FakeAdmin,
  create: vi.fn(),
  createCustomer: vi.fn(),
}));

vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin: async () => h.admin }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.fake.client }));
vi.mock("@/lib/stripe/client", () => ({
  getStripeClient: () => ({
    checkout: { sessions: { create: h.create } },
    customers: { create: h.createCustomer },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createDfyPaymentLink, setFamilyAccess, type DfyLinkResult } from "./dfy";

const errOf = (r: DfyLinkResult) => ("error" in r ? r.error : null);

const PARENT = "11111111-1111-4111-8111-111111111111";
const DAY = 86_400_000;
const PAST = new Date(Date.now() - DAY).toISOString();
const FUTURE = new Date(Date.now() + DAY).toISOString();

function sub(over: Record<string, unknown> = {}) {
  return {
    id: "s1",
    status: "placed",
    family_type: "dfy",
    deposit_paid_at: PAST,
    payment_due_at: PAST,
    bill_paid_at: null,
    stripe_customer_id: null,
    placement_id: "pl1",
    access_toggled_on: null,
    ...over,
  };
}

beforeEach(() => {
  h.admin = { userId: "admin-1", error: null };
  h.fake = fakeAdmin({ parent_subscriptions: sub(), user_profiles: { email: "parent@example.com" } });
  h.create.mockReset();
  h.create.mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" });
  h.createCustomer.mockReset();
  h.createCustomer.mockResolvedValue({ id: "cus_new_1" });
});

describe("createDfyPaymentLink", () => {
  it("refuses a non-admin before any read or Stripe call", async () => {
    h.admin = { userId: "", error: "Not authorized — admin role required" };
    const res = await createDfyPaymentLink(PARENT, "deposit");
    expect(res).toEqual({ success: false, error: "Not authorized — admin role required" });
    expect(h.fake.ops).toHaveLength(0);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("refuses an unknown preset and a malformed parent id", async () => {
    expect((await createDfyPaymentLink(PARENT, "instalment" as never)).success).toBe(false);
    expect((await createDfyPaymentLink("not-a-uuid", "deposit")).success).toBe(false);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("deposit → a payment-mode Checkout Session for PRICES.dfy.depositPence, gbp, Stripe Tax on, no price id", async () => {
    h.fake.reads.parent_subscriptions = null; // a family with no row yet can pay a deposit
    const res = await createDfyPaymentLink(PARENT, "deposit");
    expect(res).toEqual({
      success: true,
      data: { url: "https://checkout.stripe.com/c/pay/cs_test_1", pence: PRICES.dfy.depositPence },
    });
    const params = h.create.mock.calls[0][0];
    expect(params).toMatchObject({
      mode: "payment",
      client_reference_id: PARENT,
      automatic_tax: { enabled: VAT.stripeTaxEnabled },
      metadata: { user_id: PARENT, link_kind: "deposit", pence: String(PRICES.dfy.depositPence) },
    });
    expect(params.line_items[0].price_data).toMatchObject({
      currency: PRICES.currency,
      unit_amount: PRICES.dfy.depositPence,
    });
    expect(params.line_items[0].price_data.tax_behavior).toBe("inclusive");
    expect(params.line_items[0]).not.toHaveProperty("price");
  });

  it("balance before payment_due_at → payment_not_due, no Stripe call", async () => {
    h.fake.reads.parent_subscriptions = sub({ payment_due_at: FUTURE });
    expect(await createDfyPaymentLink(PARENT, "balance-after-week-1", { firstWeekWagesPence: 30_000 })).toEqual({
      success: false,
      error: "payment_not_due",
    });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("balance with no due date (not placed) → payment_not_due", async () => {
    h.fake.reads.parent_subscriptions = sub({ payment_due_at: null, status: "deposit_paid" });
    expect(errOf(await createDfyPaymentLink(PARENT, "balance-after-week-1", { firstWeekWagesPence: 0 }))).toBe(
      "payment_not_due",
    );
  });

  it("balance after due, wages 30000 → fee − deposit − 30000 (walk step 4)", async () => {
    const res = await createDfyPaymentLink(PARENT, "balance-after-week-1", { firstWeekWagesPence: 30_000 });
    const expected = PRICES.dfy.feePence - PRICES.dfy.depositPence - 30_000;
    expect(res).toMatchObject({ success: true, data: { pence: expected } });
    expect(h.create.mock.calls[0][0].metadata).toEqual({
      user_id: PARENT,
      link_kind: "balance-after-week-1",
      pence: String(expected),
      first_week_wages_pence: "30000",
    });
  });

  it("balance without a deposit paid credits no deposit", async () => {
    h.fake.reads.parent_subscriptions = sub({ deposit_paid_at: null });
    const res = await createDfyPaymentLink(PARENT, "balance-after-week-1", { firstWeekWagesPence: 0 });
    expect(res).toMatchObject({ data: { pence: PRICES.dfy.feePence } });
  });

  it("balance wages default to the placement snapshot (weekly_hours × hourly_rate)", async () => {
    h.fake.reads.nanny_placements = { weekly_hours: 20, hourly_rate: 16 };
    const res = await createDfyPaymentLink(PARENT, "balance-after-week-1");
    const wages = Math.min(20 * 16 * 100, FIRST_WEEK_DISCOUNT_CAP.hourlyPence * FIRST_WEEK_DISCOUNT_CAP.maxHours);
    expect(res).toMatchObject({ data: { pence: PRICES.dfy.feePence - PRICES.dfy.depositPence - wages } });
  });

  it("balance with no wages and no snapshot → wages_required", async () => {
    h.fake.reads.nanny_placements = { weekly_hours: null, hourly_rate: null };
    expect(errOf(await createDfyPaymentLink(PARENT, "balance-after-week-1"))).toBe("wages_required");
  });

  it("custom → the admin's pence; refuses zero, fractions and no subscription row", async () => {
    expect(await createDfyPaymentLink(PARENT, "custom", { customPence: 12_345 })).toMatchObject({
      success: true,
      data: { pence: 12_345 },
    });
    expect((await createDfyPaymentLink(PARENT, "custom", { customPence: 0 })).success).toBe(false);
    expect((await createDfyPaymentLink(PARENT, "custom", { customPence: 1.5 })).success).toBe(false);
    h.fake.reads.parent_subscriptions = null;
    expect(errOf(await createDfyPaymentLink(PARENT, "custom", { customPence: 100 }))).toBe("no_subscription_row");
  });

  it("uses the family's Stripe customer when it has one", async () => {
    h.fake.reads.parent_subscriptions = sub({ stripe_customer_id: "cus_test_1", deposit_paid_at: null });
    await createDfyPaymentLink(PARENT, "deposit");
    expect(h.create.mock.calls[0][0]).toMatchObject({ customer: "cus_test_1" });
    expect(h.create.mock.calls[0][0]).not.toHaveProperty("customer_email");
  });

  // 4-w5fix (W5-M3): every link carries a Stripe customer, so a refund of it can be traced to the family.
  it("a family with no row: creates a customer with the parent's email and mints the link on it", async () => {
    h.fake.reads.parent_subscriptions = null;
    await createDfyPaymentLink(PARENT, "deposit");
    expect(h.createCustomer).toHaveBeenCalledTimes(1);
    const [params, opts] = h.createCustomer.mock.calls[0];
    expect(params).toMatchObject({ email: "parent@example.com", metadata: { user_id: PARENT } });
    expect(opts).toMatchObject({ idempotencyKey: expect.stringContaining(PARENT) });
    expect(h.create.mock.calls[0][0]).toMatchObject({ customer: "cus_new_1" });
    expect(h.create.mock.calls[0][0]).not.toHaveProperty("customer_email");
    expect(writesTo(h.fake, "parent_subscriptions")).toHaveLength(0); // no row to store it on yet
  });

  it("a row with no customer: creates one, stores it on the row, mints the link on it", async () => {
    await createDfyPaymentLink(PARENT, "balance-after-week-1", { firstWeekWagesPence: 30_000 });
    expect(h.createCustomer).toHaveBeenCalledTimes(1);
    const writes = writesTo(h.fake, "parent_subscriptions");
    expect(writes).toHaveLength(1);
    expect(writes[0].payload).toEqual({ stripe_customer_id: "cus_new_1" });
    expect(writes[0].filters).toContainEqual(["eq", "id", "s1"]);
    expect(writes[0].filters).toContainEqual(["is", "stripe_customer_id", null]);
    expect(h.create.mock.calls[0][0]).toMatchObject({ customer: "cus_new_1" });
  });

  it("a row that already has a customer: no customer is created and the row is not written", async () => {
    h.fake.reads.parent_subscriptions = sub({ stripe_customer_id: "cus_test_1" });
    await createDfyPaymentLink(PARENT, "balance-after-week-1", { firstWeekWagesPence: 30_000 });
    expect(h.createCustomer).not.toHaveBeenCalled();
    expect(writesTo(h.fake, "parent_subscriptions")).toHaveLength(0);
  });

  it("a failed customer store is reported, not swallowed: no link is minted", async () => {
    h.fake.writeErrors.parent_subscriptions = { message: "boom" };
    const res = await createDfyPaymentLink(PARENT, "balance-after-week-1", { firstWeekWagesPence: 30_000 });
    expect(res).toEqual({ success: false, error: "stripe_error" });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("refuses a second deposit or a second bill (review MEDIUM — no double charge)", async () => {
    expect(errOf(await createDfyPaymentLink(PARENT, "deposit"))).toBe("deposit_already_paid");
    h.fake.reads.parent_subscriptions = sub({ bill_paid_at: PAST });
    expect(errOf(await createDfyPaymentLink(PARENT, "balance-after-week-1", { firstWeekWagesPence: 0 }))).toBe(
      "bill_already_paid",
    );
    expect(h.create).not.toHaveBeenCalled();
  });

  it("a Stripe failure is returned, not thrown", async () => {
    h.fake.reads.parent_subscriptions = null;
    h.create.mockRejectedValue(new Error("stripe down"));
    expect(await createDfyPaymentLink(PARENT, "deposit")).toEqual({ success: false, error: "stripe_error" });
  });
});

describe("setFamilyAccess", () => {
  it("refuses a non-admin before any write", async () => {
    h.admin = { userId: "", error: "Not authenticated" };
    expect(await setFamilyAccess(PARENT, false, "refund agreed")).toEqual({ success: false, error: "Not authenticated" });
    expect(h.fake.ops).toHaveLength(0);
  });

  it("requires a reason", async () => {
    expect((await setFamilyAccess(PARENT, false, " ")).success).toBe(false);
    expect(writesTo(h.fake, "parent_subscriptions")).toHaveLength(0);
  });

  it.each([
    [false, "access off — refund agreed"],
    [true, "G5 — keep working"],
    [null, "back to the family's state"],
  ])("toggle %s writes the toggle columns and an access.toggled row", async (on, reason) => {
    expect(await setFamilyAccess(PARENT, on, reason)).toEqual({ success: true, error: null });
    const [up] = writesTo(h.fake, "parent_subscriptions");
    expect(up.payload).toMatchObject({
      access_toggled_on: on,
      access_toggled_by: "admin-1",
      access_toggle_reason: reason,
    });
    expect((up.payload as Record<string, unknown>).access_toggled_at).toEqual(expect.any(String));
    expect(writesTo(h.fake, "activity_logs")[0].payload).toMatchObject({
      user_id: PARENT,
      action_type: "access.toggled",
      action_details: { admin_id: "admin-1", previous: null, next: on, reason },
    });
  });

  it("no subscription row → no_subscription_row", async () => {
    h.fake.reads.parent_subscriptions = null;
    expect(await setFamilyAccess(PARENT, true, "grant")).toEqual({ success: false, error: "no_subscription_row" });
  });
});
