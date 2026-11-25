/**
 * The deposit-link webhook branch (plan 03 row A7, D4, D6, D7; brief 03 §4 "Retries"). A paid 03 session is recorded
 * in ONE database step (`deposit_record_card_payment`) with the amount `dfy-webhook` computed from `amount_total` —
 * never metadata. A replay changes nothing; a second, different payment is kept as a duplicate; a refused place
 * still records the money and is logged by status. A malformed session or a database refusal THROWS, so the route
 * records the event unresolved. After a recorded payment the card is read from Stripe and saved with brand, last four
 * and expiry only; any failure there is logged by code and never throws.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const h = vi.hoisted(() => ({ retrieveIntent: vi.fn() }));
vi.mock("@/lib/stripe/client", () => ({ getStripeClient: () => ({ paymentIntents: { retrieve: h.retrieveIntent } }) }));

import { PRICES } from "@/config/prices";
import { fakeAdmin, writesTo, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";
import { keepStatusFor as fromRecord } from "./record";
import { keepStatusFor, recordDepositLinkPayment } from "./webhook";

const PARENT = "b0300000-0000-4000-8000-000000000061";
const LINK = "d0300000-0000-4000-8000-000000000061";
const HOLD = "c0300000-0000-4000-8000-000000000061";
const PI = "pi_test_dep61";

function session(over: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: "cs_test_dep61",
    object: "checkout.session",
    mode: "payment",
    payment_status: "paid",
    status: "complete",
    amount_total: PRICES.dfy.depositPence,
    client_reference_id: PARENT,
    customer: "cus_test_fam",
    payment_intent: PI,
    metadata: {
      user_id: PARENT, link_kind: "deposit", pence: String(PRICES.dfy.depositPence), deposit_link_id: LINK, hold_id: HOLD,
      cohort_start_date: "2027-02-01", goodwill: "false",
    },
    ...over,
  } as Stripe.Checkout.Session;
}

const FACTS = { userId: PARENT, paymentIntentId: PI, pence: PRICES.dfy.depositPence, keepStatus: false };
const CARD_METHOD = {
  id: "pm_test_card61",
  object: "payment_method",
  type: "card",
  customer: "cus_test_fam",
  billing_details: { name: "Sarah Jones", email: "sarah@example.com" },
  card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030, fingerprint: "fp_secret", country: "GB", funding: "credit" },
};

let fake: FakeAdmin;
let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  log = vi.spyOn(console, "error").mockImplementation(() => {});
  log.mockClear();
  fake = fakeAdmin();
  fake.rpcResults.deposit_record_card_payment = {
    data: { status: "recorded", place: "taken", place_id: HOLD, cohort_start_date: "2027-02-01", over_by: 0 },
    error: null,
  };
  h.retrieveIntent.mockReset();
  h.retrieveIntent.mockResolvedValue({ id: PI, payment_method: CARD_METHOD });
});

const answer = (data: unknown) => {
  fake.rpcResults.deposit_record_card_payment = { data, error: null };
};
const logged = () => JSON.stringify(log.mock.calls);

describe("recordDepositLinkPayment — the money and the place in one step", () => {
  it("sends the session's ids, the computed amount and the session's customer → applied", async () => {
    const s = session({ metadata: { ...session().metadata, pence: "1" } });
    expect(await recordDepositLinkPayment(fake.client, s, { ...FACTS, keepStatus: true })).toBe("applied");
    expect(fake.rpcCalls).toEqual([
      {
        fn: "deposit_record_card_payment",
        args: {
          p_parent: PARENT, p_link_id: LINK, p_hold_id: HOLD, p_session_id: "cs_test_dep61", p_payment_intent: PI,
          p_pence: PRICES.dfy.depositPence, p_customer: "cus_test_fam", p_keep_status: true,
        },
      },
    ]);
    expect(writesTo(fake, "parent_subscriptions")).toHaveLength(0);
  });

  it("an expanded customer object → its id; no customer → null", async () => {
    await recordDepositLinkPayment(fake.client, session({ customer: { id: "cus_test_obj" } as Stripe.Customer }), FACTS);
    expect(fake.rpcCalls[0].args).toMatchObject({ p_customer: "cus_test_obj" });
    await recordDepositLinkPayment(fake.client, session({ customer: null }), FACTS);
    expect(fake.rpcCalls[1].args).toMatchObject({ p_customer: null });
  });

  it("a replay (already recorded) → ignored; the card is not read again", async () => {
    answer({ status: "already_recorded" });
    expect(await recordDepositLinkPayment(fake.client, session(), FACTS)).toBe("ignored");
    expect(h.retrieveIntent).not.toHaveBeenCalled();
  });

  it("a second, different payment → duplicate → applied (the first unchanged); no card saved", async () => {
    answer({ status: "duplicate" });
    expect(await recordDepositLinkPayment(fake.client, session(), FACTS)).toBe("applied");
    expect(h.retrieveIntent).not.toHaveBeenCalled();
    expect(writesTo(fake, "family_saved_cards")).toHaveLength(0);
  });

  it.each(["hold_not_found", "already_taken", "invalid"])("the place refused (%s) → still applied, logged like every failure (its status as the code), card saved", async (place) => {
    answer({ status: "recorded", place });
    expect(await recordDepositLinkPayment(fake.client, session(), FACTS)).toBe("applied");
    expect(log).toHaveBeenCalledWith("[cohorts] deposit webhook place failed", { code: place });
    expect(writesTo(fake, "family_saved_cards")).toHaveLength(1);
  });

  it("the place taken → no place warning, nothing logged", async () => {
    await recordDepositLinkPayment(fake.client, session(), FACTS);
    expect(log).not.toHaveBeenCalled();
  });

  it("the function answers invalid → throws (the route records the event unresolved)", async () => {
    answer({ status: "invalid" });
    await expect(recordDepositLinkPayment(fake.client, session(), FACTS)).rejects.toThrow(/deposit/);
    expect(h.retrieveIntent).not.toHaveBeenCalled();
  });

  it("an RPC error or an unexpected reply → throws, with no detail of the family in the message", async () => {
    fake.rpcResults.deposit_record_card_payment = { data: null, error: { message: "secret detail", code: "40P01" } };
    const err = await recordDepositLinkPayment(fake.client, session(), FACTS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err)).not.toMatch(/secret detail|b0300000|pi_test|cs_test/);
    answer({ status: "weird" });
    await expect(recordDepositLinkPayment(fake.client, session(), FACTS)).rejects.toThrow();
  });

  it.each([
    ["a hold id that isn't a uuid", { hold_id: "not-a-uuid" }],
    ["no hold id", { hold_id: undefined }],
    ["a link id that isn't a uuid", { deposit_link_id: "x" }],
  ])("malformed metadata (%s) → throws before any call", async (_label, over) => {
    const metadata = Object.fromEntries(Object.entries({ ...session().metadata, ...over }).filter(([, v]) => v !== undefined)) as Stripe.Metadata;
    await expect(recordDepositLinkPayment(fake.client, session({ metadata }), FACTS)).rejects.toThrow();
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("a session id of the wrong shape → throws before any call", async () => {
    await expect(recordDepositLinkPayment(fake.client, session({ id: "evt_123" }), FACTS)).rejects.toThrow();
    expect(fake.rpcCalls).toHaveLength(0);
  });
});

describe("recordDepositLinkPayment — the card is saved after the money (D7), never throwing", () => {
  it("reads the payment's card from Stripe and saves brand, last four and expiry only", async () => {
    expect(await recordDepositLinkPayment(fake.client, session(), FACTS)).toBe("applied");
    expect(h.retrieveIntent).toHaveBeenCalledWith(PI, { expand: ["payment_method"] });
    const [up] = writesTo(fake, "family_saved_cards");
    expect(up.kind).toBe("upsert");
    expect(up.options).toEqual({ onConflict: "parent_user_id" });
    expect(up.payload).toEqual({
      parent_user_id: PARENT,
      stripe_customer_id: "cus_test_fam",
      stripe_payment_method_id: "pm_test_card61",
      brand: "visa",
      last4: "4242",
      exp_month: 12,
      exp_year: 2030,
      source_payment_intent_id: PI,
      saved_at: expect.any(String),
    });
    expect(JSON.stringify(up.payload)).not.toMatch(/fp_secret|Sarah|sarah@|GB|credit/);
  });

  it("no customer on the session → the card isn't saved, logged, still applied", async () => {
    expect(await recordDepositLinkPayment(fake.client, session({ customer: null }), FACTS)).toBe("applied");
    expect(h.retrieveIntent).not.toHaveBeenCalled();
    expect(writesTo(fake, "family_saved_cards")).toHaveLength(0);
    expect(logged()).toContain("no_customer");
  });

  it.each([
    ["Stripe fails", () => h.retrieveIntent.mockRejectedValue(new TypeError("network down"))],
    ["the method isn't expanded", () => h.retrieveIntent.mockResolvedValue({ id: PI, payment_method: "pm_test_card61" })],
    ["no method", () => h.retrieveIntent.mockResolvedValue({ id: PI, payment_method: null })],
    ["not a card", () => h.retrieveIntent.mockResolvedValue({ id: PI, payment_method: { ...CARD_METHOD, type: "sepa_debit", card: null } })],
    ["a card of an unexpected shape", () => h.retrieveIntent.mockResolvedValue({ id: PI, payment_method: { ...CARD_METHOD, card: { ...CARD_METHOD.card, last4: "42" } } })],
  ])("%s → nothing saved, logged by code, still applied", async (_label, arrange) => {
    arrange();
    expect(await recordDepositLinkPayment(fake.client, session(), FACTS)).toBe("applied");
    expect(writesTo(fake, "family_saved_cards")).toHaveLength(0);
    expect(log).toHaveBeenCalled();
    expect(logged()).not.toMatch(/network down|sarah@|4242/);
  });

  it("the save write fails → logged by code, still applied", async () => {
    fake.writeErrors.family_saved_cards = { message: "secret detail", code: "23514" };
    expect(await recordDepositLinkPayment(fake.client, session(), FACTS)).toBe("applied");
    expect(logged()).toContain("23514");
    expect(logged()).not.toContain("secret detail");
  });

  it("the payment's card is saved against the session's customer object id", async () => {
    await recordDepositLinkPayment(fake.client, session({ customer: { id: "cus_test_obj" } as Stripe.Customer }), FACTS);
    expect(writesTo(fake, "family_saved_cards")[0].payload).toMatchObject({ stripe_customer_id: "cus_test_obj" });
  });
});

describe("keepStatusFor is re-exported for dfy-webhook's one import", () => {
  it("is record's rule", () => {
    expect(keepStatusFor).toBe(fromRecord);
  });
});
