/**
 * The parent's Pay, Back and Done (plan 03 row A5 `session`, §3 "Pay", "Session", "Back", "Done"; brief 03 §3
 * parent 2–4, §5). The family comes only from the `DepositParentProof` (D15): a non-proof is refused before any read
 * or Stripe call. Pay re-resolves the page state, holds a place, and makes ONE Checkout session per hold (idempotency
 * key `deposit-session-<holdId>`) with the exact §3 parameters — the amount from `PRICES` only. A second press reuses
 * the first session; a double tap waits for it. A sessionless hold older than `SESSIONLESS_HOLD_STALE_SECONDS` (its
 * press is gone) is released and held once more, with the new hold's key. A Stripe failure releases the hold. Back
 * expires an open session and releases the hold; Done checks the session belongs to this link and parent, and writes
 * nothing.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const h = vi.hoisted(() => ({
  create: vi.fn(),
  retrieve: vi.fn(),
  expire: vi.fn(),
  createCustomer: vi.fn(),
  findCohorts: vi.fn(),
}));
vi.mock("@/lib/stripe/client", () => ({
  getStripeClient: () => ({
    checkout: { sessions: { create: h.create, retrieve: h.retrieve, expire: h.expire } },
    customers: { create: h.createCustomer },
  }),
}));
vi.mock("@/lib/cohorts/read", () => ({ findCohorts: h.findCohorts }));

import { PRICES, VAT } from "@/config/prices";
import type { CohortView } from "@/lib/cohorts/types";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import { fakeAdmin, type FakeAdmin, type Op } from "@/lib/payments/fake-admin.test-util";
import {
  CHECKOUT_SESSION_MINUTES, HOLD_MINUTES, PAY_REREAD_DELAY_MS, PAY_REREAD_TRIES, SESSIONLESS_HOLD_STALE_SECONDS,
} from "./constants";
import { PAGE_COPY } from "./copy";
import { proveDepositCode, type DepositParentProof } from "./proof";
import { checkDepositDone, returnFromCheckout, startDepositCheckout } from "./session";

const PARENT = "b0300000-0000-4000-8000-000000000051";
const OTHER_PARENT = "b0300000-0000-4000-8000-000000000052";
const LINK = "d0300000-0000-4000-8000-000000000051";
const OTHER_LINK = "d0300000-0000-4000-8000-000000000052";
const HOLD = "c0300000-0000-4000-8000-000000000051";
const CODE = "Ab0_-".repeat(8) + "xyz";
const NOW = new Date("2027-02-02T10:00:00.000Z");
const EXPIRES = "2027-02-02T10:30:00+00:00";
const SESSION_URL = "https://checkout.stripe.com/c/pay/cs_test_dep51";

const view = (start: string, places: number, taken: number, beingPaid = 0): CohortView => ({
  start, places, taken, beingPaid, left: Math.max(0, places - taken - beingPaid), overBy: Math.max(0, taken - places),
});
const CURRENT_OPEN = view("2027-02-01", 5, 2);
const CURRENT_FULL = view("2027-02-01", 5, 5);
const CURRENT_BEING_PAID = view("2027-02-01", 5, 4, 1);
const NEXT_OPEN = view("2027-02-08", 5, 0);

const linkRow = (over: Record<string, unknown> = {}) => ({
  id: LINK, parent_user_id: PARENT, code: CODE, state: "open", target: "current", goodwill_cohort_start_date: null, ...over,
});
const holdRow = (over: Record<string, unknown> = {}) => ({
  id: HOLD, cohort_start_date: "2027-02-01", is_goodwill: false, stripe_checkout_session_id: null, state: "held", ...over,
});
const heldReply = (over: Record<string, unknown> = {}) => ({
  status: "held", place_id: HOLD, cohort_start_date: "2027-02-01", hold_expires_at: EXPIRES, is_goodwill: false, ...over,
});

/** cohort_places answers her own live hold (filtered by state) and the double tap's re-read (filtered by id). */
let ownHold: Record<string, unknown> | null;
let rereads: Array<Record<string, unknown> | null>;
const placesRead = (op: Op) => {
  if (op.filters.some(([f, col]) => f === "eq" && col === "id")) return rereads.shift() ?? null;
  return ownHold;
};

let fake: FakeAdmin;
let proof: DepositParentProof;
let wait: Mock<(ms: number) => Promise<void>>;

async function proofFor(parent: string, link: string): Promise<DepositParentProof> {
  const links = fakeAdmin({
    deposit_links: { id: link, parent_user_id: parent, state: "open", target: "current", goodwill_cohort_start_date: null, last_opened_at: null },
  });
  const proven = await proveDepositCode(links.client, CODE);
  if (!proven.ok) throw new Error("no deposit proof");
  return proven.proof;
}

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  ownHold = null;
  rereads = [];
  fake = fakeAdmin({
    deposit_links: linkRow(),
    parent_subscriptions: { id: "s1", stripe_customer_id: "cus_test_fam", deposit_paid_at: null },
    cohort_places: placesRead,
    user_profiles: { email: "sarah@example.com" },
  });
  fake.rpcResults.cohort_hold_place = { data: heldReply(), error: null };
  fake.rpcResults.cohort_attach_session = { data: { status: "attached", place_id: HOLD }, error: null };
  fake.rpcResults.cohort_release_hold = { data: { status: "released" }, error: null };
  for (const m of [h.create, h.retrieve, h.expire, h.createCustomer, h.findCohorts]) m.mockReset();
  h.findCohorts.mockResolvedValue({ ok: true, value: { current: CURRENT_OPEN, next: NEXT_OPEN, nextAvailable: NEXT_OPEN, upcoming: [NEXT_OPEN] } });
  h.create.mockResolvedValue({ id: "cs_test_dep51", url: SESSION_URL, status: "open" });
  h.expire.mockResolvedValue({ id: "cs_test_dep51", status: "expired" });
  h.createCustomer.mockResolvedValue({ id: "cus_test_new" });
  wait = vi.fn(async (_ms: number) => {});
  proof = await proofFor(PARENT, LINK);
});

const rpcNames = () => fake.rpcCalls.map((c) => c.fn);
/** cohort_hold_place answers these replies in turn; the last one repeats. */
const holdReplies = (...replies: Array<Record<string, unknown>>) => {
  Object.defineProperty(fake.rpcResults, "cohort_hold_place", {
    configurable: true,
    get: () => ({ data: replies.length > 1 ? replies.shift() : replies[0], error: null }),
  });
};
/** The hold's expiry for a hold made `ageSeconds` before NOW (its start = expiry − HOLD_MINUTES). */
const expiresFor = (ageSeconds: number) => new Date(NOW.getTime() + (HOLD_MINUTES * 60 - ageSeconds) * 1000).toISOString();
const stripeCalls = () => h.create.mock.calls.length + h.retrieve.mock.calls.length + h.expire.mock.calls.length + h.createCustomer.mock.calls.length;
const pay = () => startDepositCheckout(fake.client, proof, NOW, { wait });

function expectedParams(over: { cohort?: string; goodwill?: "true" | "false"; customer?: string } = {}) {
  const metadata = {
    user_id: PARENT,
    link_kind: "deposit",
    pence: String(PRICES.dfy.depositPence),
    deposit_link_id: LINK,
    hold_id: HOLD,
    cohort_start_date: over.cohort ?? "2027-02-01",
    goodwill: over.goodwill ?? "false",
  };
  return {
    mode: "payment",
    customer: over.customer ?? "cus_test_fam",
    customer_update: { address: "auto", name: "auto" },
    client_reference_id: PARENT,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: PRICES.currency,
          unit_amount: PRICES.dfy.depositPence,
          tax_behavior: VAT.inclusive ? "inclusive" : "exclusive",
          product_data: { name: `${SITE_NAME} — Deposit` },
        },
      },
    ],
    automatic_tax: { enabled: VAT.stripeTaxEnabled },
    billing_address_collection: "required",
    payment_method_types: ["card"],
    payment_intent_data: { setup_future_usage: "off_session", metadata },
    metadata,
    custom_text: { submit: { message: PAGE_COPY.consent } },
    expires_at: Math.floor(NOW.getTime() / 1000) + (CHECKOUT_SESSION_MINUTES + 1) * 60,
    success_url: `${SITE_URL}/deposit/${CODE}/done?session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE_URL}/deposit/${CODE}?cancelled=1`,
  };
}

describe("startDepositCheckout — the proof comes first (D15)", () => {
  it("a look-alike proof → invalid with zero reads and zero Stripe calls", async () => {
    const lookAlike = Object.freeze({ kind: "deposit_parent_proof", parentUserId: PARENT, linkId: LINK }) as unknown as DepositParentProof;
    expect(await startDepositCheckout(fake.client, lookAlike, NOW, { wait })).toEqual({ kind: "invalid" });
    expect(fake.ops).toHaveLength(0);
    expect(fake.rpcCalls).toHaveLength(0);
    expect(stripeCalls()).toBe(0);
    expect(h.findCohorts).not.toHaveBeenCalled();
  });

  it.each([
    ["a cancelled link", linkRow({ state: "cancelled" })],
    ["no link row", null],
    ["a link of another parent", linkRow({ parent_user_id: OTHER_PARENT })],
  ])("%s → invalid, no hold and no Stripe call", async (_label, row) => {
    fake.reads.deposit_links = row;
    expect(await pay()).toEqual({ kind: "invalid" });
    expect(fake.rpcCalls).toHaveLength(0);
    expect(stripeCalls()).toBe(0);
  });

  it("the link is re-read by the proof's link id", async () => {
    await pay();
    expect(fake.ops.find((o) => o.table === "deposit_links")?.filters).toEqual([["eq", "id", LINK]]);
  });
});

describe("startDepositCheckout — the creator path", () => {
  it("holds a place, makes one session with exactly the plan's parameters, attaches it, and redirects", async () => {
    const r = await pay();
    expect(r).toEqual({ kind: "redirect", url: SESSION_URL });
    expect(fake.rpcCalls[0]).toEqual({ fn: "cohort_hold_place", args: { p_parent: PARENT, p_start: "2027-02-01", p_minutes: 30, p_goodwill: false } });
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.create).toHaveBeenCalledWith(expectedParams(), { idempotencyKey: `deposit-session-${HOLD}` });
    expect(fake.rpcCalls[1]).toEqual({ fn: "cohort_attach_session", args: { p_place_id: HOLD, p_parent: PARENT, p_session_id: "cs_test_dep51" } });
    expect(h.createCustomer).not.toHaveBeenCalled();
    expect(fake.ops.some((o) => o.table === "user_profiles")).toBe(false);
  });

  it("the metadata is the same object on the session and its payment, and no amount comes from any input", async () => {
    await pay();
    const [params] = h.create.mock.calls[0];
    expect(params.payment_intent_data.metadata).toEqual(params.metadata);
    expect(params.line_items[0].price_data.unit_amount).toBe(PRICES.dfy.depositPence);
    expect(params.payment_method_types).toEqual(["card"]);
  });

  it("a family with no Stripe customer → one made with her account email, then the session on it", async () => {
    fake.reads.parent_subscriptions = null;
    await pay();
    expect(h.createCustomer).toHaveBeenCalledWith(
      { email: "sarah@example.com", metadata: { user_id: PARENT } },
      { idempotencyKey: `dfy-customer-${PARENT}` },
    );
    expect(h.create).toHaveBeenCalledWith(expectedParams({ customer: "cus_test_new" }), expect.anything());
  });

  it("a goodwill link with the current cohort full → holds the pinned next cohort as goodwill", async () => {
    fake.reads.deposit_links = linkRow({ target: "goodwill", goodwill_cohort_start_date: "2027-02-08" });
    h.findCohorts.mockResolvedValue({ ok: true, value: { current: CURRENT_FULL, next: NEXT_OPEN, nextAvailable: NEXT_OPEN, upcoming: [NEXT_OPEN] } });
    fake.rpcResults.cohort_hold_place = { data: heldReply({ cohort_start_date: "2027-02-08", is_goodwill: true }), error: null };
    await pay();
    expect(fake.rpcCalls[0].args).toMatchObject({ p_start: "2027-02-08", p_goodwill: true });
    expect(h.create).toHaveBeenCalledWith(expectedParams({ cohort: "2027-02-08", goodwill: "true" }), expect.anything());
  });
});

describe("startDepositCheckout — not bookable, or the hold refused", () => {
  it("already paid → the paid state, with no hold and no Stripe call", async () => {
    fake.reads.parent_subscriptions = { id: "s1", stripe_customer_id: "cus_test_fam", deposit_paid_at: "2027-02-01T09:00:00+00:00" };
    expect(await pay()).toEqual({ kind: "state", state: { kind: "paid" } });
    expect(fake.rpcCalls).toHaveLength(0);
    expect(stripeCalls()).toBe(0);
  });

  it("the cohort full → the full state naming the next available cohort", async () => {
    h.findCohorts.mockResolvedValue({ ok: true, value: { current: CURRENT_FULL, next: NEXT_OPEN, nextAvailable: NEXT_OPEN, upcoming: [NEXT_OPEN] } });
    expect(await pay()).toEqual({ kind: "state", state: { kind: "full", nextAvailable: "2027-02-08" } });
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it.each([
    [{ status: "full", reason: "being_paid" }, { kind: "state", state: { kind: "being_paid", nextAvailable: "2027-02-08" } }],
    [{ status: "full", reason: "all_taken" }, { kind: "state", state: { kind: "full", nextAvailable: "2027-02-08" } }],
    [{ status: "already_taken" }, { kind: "state", state: { kind: "paid" } }],
    [{ status: "not_bookable" }, { kind: "try_again" }],
    [{ status: "already_holding" }, { kind: "try_again" }],
    [{ status: "weird" }, { kind: "try_again" }],
  ])("hold reply %j → %j, with no Stripe call", async (data, expected) => {
    fake.rpcResults.cohort_hold_place = { data, error: null };
    expect(await pay()).toEqual(expected);
    expect(stripeCalls()).toBe(0);
  });

  it("a cohort being paid for when the page re-resolves → being_paid", async () => {
    h.findCohorts.mockResolvedValue({ ok: true, value: { current: CURRENT_BEING_PAID, next: NEXT_OPEN, nextAvailable: NEXT_OPEN, upcoming: [NEXT_OPEN] } });
    expect(await pay()).toEqual({ kind: "state", state: { kind: "being_paid", nextAvailable: "2027-02-08" } });
  });

  it.each([
    ["the link read", (f: FakeAdmin) => { f.readErrors.deposit_links = { message: "boom", code: "XX000" }; }],
    ["the family read", (f: FakeAdmin) => { f.readErrors.parent_subscriptions = { message: "boom", code: "XX000" }; }],
    ["the hold read", (f: FakeAdmin) => { f.readErrors.cohort_places = { message: "boom", code: "XX000" }; }],
    ["the cohorts", () => { h.findCohorts.mockResolvedValue({ ok: false }); }],
    ["a link row that doesn't fit", (f: FakeAdmin) => { f.reads.deposit_links = linkRow({ code: "short" }); }],
    // the one deposit_links parser (proof's): a goodwill pin must be a real London date
    ["a goodwill link whose pin isn't a real date", (f: FakeAdmin) => {
      f.reads.deposit_links = linkRow({ target: "goodwill", goodwill_cohort_start_date: "2027-02-30" });
    }],
    ["a goodwill link whose pin isn't a date at all", (f: FakeAdmin) => {
      f.reads.deposit_links = linkRow({ target: "goodwill", goodwill_cohort_start_date: "next week" });
    }],
    ["her hold row in a state that doesn't exist", () => { ownHold = holdRow({ state: "lost" }); }],
  ])("%s failing → try_again, with no hold", async (_label, arrange) => {
    arrange(fake);
    expect(await pay()).toEqual({ kind: "try_again" });
    expect(fake.rpcCalls).toHaveLength(0);
    expect(stripeCalls()).toBe(0);
  });
});

describe("startDepositCheckout — a Stripe or attach failure releases the hold", () => {
  it("the session create fails → the hold is released → try_again", async () => {
    h.create.mockRejectedValue(new Error("stripe down"));
    expect(await pay()).toEqual({ kind: "try_again" });
    expect(rpcNames()).toEqual(["cohort_hold_place", "cohort_release_hold"]);
    expect(fake.rpcCalls[1].args).toEqual({ p_place_id: HOLD, p_parent: PARENT });
  });

  it("the customer create fails → released → try_again, no session made", async () => {
    fake.reads.parent_subscriptions = null;
    h.createCustomer.mockRejectedValue(new Error("stripe down"));
    expect(await pay()).toEqual({ kind: "try_again" });
    expect(h.create).not.toHaveBeenCalled();
    expect(rpcNames()).toEqual(["cohort_hold_place", "cohort_release_hold"]);
  });

  it("the email read fails while a customer is needed → released → try_again", async () => {
    fake.reads.parent_subscriptions = null;
    fake.readErrors.user_profiles = { message: "boom", code: "XX000" };
    expect(await pay()).toEqual({ kind: "try_again" });
    expect(h.createCustomer).not.toHaveBeenCalled();
    expect(rpcNames()).toEqual(["cohort_hold_place", "cohort_release_hold"]);
  });

  it("a session with no URL → expired, released → try_again", async () => {
    h.create.mockResolvedValue({ id: "cs_test_dep51", url: null, status: "open" });
    expect(await pay()).toEqual({ kind: "try_again" });
    expect(h.expire).toHaveBeenCalledWith("cs_test_dep51");
    expect(rpcNames()).toEqual(["cohort_hold_place", "cohort_release_hold"]);
  });

  it("the attach refused → the session is expired, the hold released → try_again", async () => {
    fake.rpcResults.cohort_attach_session = { data: { status: "hold_expired" }, error: null };
    expect(await pay()).toEqual({ kind: "try_again" });
    expect(h.expire).toHaveBeenCalledWith("cs_test_dep51");
    expect(rpcNames()).toEqual(["cohort_hold_place", "cohort_attach_session", "cohort_release_hold"]);
  });

  it("the attach refused and the expire fails too → still released → try_again", async () => {
    fake.rpcResults.cohort_attach_session = { data: { status: "session_mismatch" }, error: null };
    h.expire.mockRejectedValue(new Error("stripe down"));
    expect(await pay()).toEqual({ kind: "try_again" });
    expect(rpcNames()).toContain("cohort_release_hold");
  });
});

describe("startDepositCheckout — a second press reuses the first session", () => {
  const existing = (sessionId: string | null) => {
    fake.rpcResults.cohort_hold_place = { data: heldReply({ status: "existing_hold", stripe_checkout_session_id: sessionId }), error: null };
  };

  it("open → the same URL, and no new session", async () => {
    existing("cs_test_dep51");
    h.retrieve.mockResolvedValue({ id: "cs_test_dep51", status: "open", url: SESSION_URL });
    expect(await pay()).toEqual({ kind: "redirect", url: SESSION_URL });
    expect(h.retrieve).toHaveBeenCalledWith("cs_test_dep51");
    expect(h.create).not.toHaveBeenCalled();
  });

  it("complete → the done page for that session", async () => {
    existing("cs_test_dep51");
    h.retrieve.mockResolvedValue({ id: "cs_test_dep51", status: "complete", url: null });
    expect(await pay()).toEqual({ kind: "redirect", url: `${SITE_URL}/deposit/${CODE}/done?session=cs_test_dep51` });
  });

  it("expired → the hold is released → try_again", async () => {
    existing("cs_test_dep51");
    h.retrieve.mockResolvedValue({ id: "cs_test_dep51", status: "expired", url: null });
    expect(await pay()).toEqual({ kind: "try_again" });
    expect(rpcNames()).toEqual(["cohort_hold_place", "cohort_release_hold"]);
  });

  it("the retrieve fails → try_again, and the hold is kept (the session may be paid)", async () => {
    existing("cs_test_dep51");
    h.retrieve.mockRejectedValue(new Error("stripe down"));
    expect(await pay()).toEqual({ kind: "try_again" });
    expect(rpcNames()).toEqual(["cohort_hold_place"]);
  });

  it("a double tap: no session yet → waits, finds the first press's session on try 2, reuses it", async () => {
    existing(null);
    rereads = [holdRow(), holdRow({ stripe_checkout_session_id: "cs_test_dep51" })];
    h.retrieve.mockResolvedValue({ id: "cs_test_dep51", status: "open", url: SESSION_URL });
    expect(await pay()).toEqual({ kind: "redirect", url: SESSION_URL });
    expect(wait).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(PAY_REREAD_DELAY_MS);
    expect(h.create).not.toHaveBeenCalled();
    const reread = fake.ops.filter((o) => o.table === "cohort_places" && o.filters.some(([, col]) => col === "id"));
    expect(reread[0].filters).toEqual([["eq", "id", HOLD], ["eq", "parent_user_id", PARENT]]);
  });

  it("a double tap that never sees a session → try_again_soon after every re-read", async () => {
    existing(null);
    rereads = Array.from({ length: PAY_REREAD_TRIES }, () => holdRow());
    expect(await pay()).toEqual({ kind: "try_again_soon" });
    expect(wait).toHaveBeenCalledTimes(PAY_REREAD_TRIES);
    expect(h.create).not.toHaveBeenCalled();
    expect(h.retrieve).not.toHaveBeenCalled();
  });

  it.each([
    ["released meanwhile", holdRow({ state: "hold_released" })],
    ["gone", null],
  ])("a double tap whose hold is %s → try_again", async (_label, row) => {
    existing(null);
    rereads = [row];
    expect(await pay()).toEqual({ kind: "try_again" });
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it("a double tap whose re-read hold is in a state that doesn't exist → try_again, logged as an unexpected row", async () => {
    existing(null);
    rereads = [holdRow({ state: "lost" })];
    expect(await pay()).toEqual({ kind: "try_again" });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("deposit hold reread"), { code: "unexpected_row" });
  });

  it("the default wait really waits (no injected wait)", async () => {
    vi.useFakeTimers();
    try {
      existing(null);
      rereads = Array.from({ length: PAY_REREAD_TRIES }, () => holdRow());
      const pending = startDepositCheckout(fake.client, proof, NOW);
      await vi.advanceTimersByTimeAsync(PAY_REREAD_TRIES * PAY_REREAD_DELAY_MS);
      expect(await pending).toEqual({ kind: "try_again_soon" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("startDepositCheckout — a sessionless hold whose press is gone (code review M1)", () => {
  const NEW_HOLD = "c0300000-0000-4000-8000-000000000053";
  const sessionless = (ageSeconds: number) =>
    heldReply({ status: "existing_hold", stripe_checkout_session_id: null, hold_expires_at: expiresFor(ageSeconds) });
  const STALE = sessionless(SESSIONLESS_HOLD_STALE_SECONDS + 1);
  const FRESH = heldReply({ place_id: NEW_HOLD });

  beforeEach(() => {
    rereads = Array.from({ length: 2 * PAY_REREAD_TRIES }, () => holdRow());
  });

  it("older than the threshold → released, held again, ONE session on the new hold's key, attached → its page", async () => {
    holdReplies(STALE, FRESH);
    expect(await pay()).toEqual({ kind: "redirect", url: SESSION_URL });
    expect(rpcNames()).toEqual(["cohort_hold_place", "cohort_release_hold", "cohort_hold_place", "cohort_attach_session"]);
    expect(fake.rpcCalls[1].args).toEqual({ p_place_id: HOLD, p_parent: PARENT });
    expect(fake.rpcCalls[2].args).toEqual(fake.rpcCalls[0].args);
    expect(h.create).toHaveBeenCalledTimes(1);
    const [params, options] = h.create.mock.calls[0];
    expect(options).toEqual({ idempotencyKey: `deposit-session-${NEW_HOLD}` });
    expect(params.metadata.hold_id).toBe(NEW_HOLD);
    expect(fake.rpcCalls[3].args).toEqual({ p_place_id: NEW_HOLD, p_parent: PARENT, p_session_id: "cs_test_dep51" });
    expect(wait).toHaveBeenCalledTimes(PAY_REREAD_TRIES);
  });

  it.each([
    ["just made", sessionless(0)],
    ["exactly at the threshold", sessionless(SESSIONLESS_HOLD_STALE_SECONDS)],
    ["with an expiry that isn't a time", heldReply({ status: "existing_hold", stripe_checkout_session_id: null, hold_expires_at: "soon" })],
  ])("a sessionless hold %s → try_again_soon, nothing released, no session", async (_label, reply) => {
    holdReplies(reply, FRESH);
    expect(await pay()).toEqual({ kind: "try_again_soon" });
    expect(rpcNames()).toEqual(["cohort_hold_place"]);
    expect(h.create).not.toHaveBeenCalled();
  });

  it.each([
    ["refused", { data: { status: "not_a_hold" }, error: null }],
    ["failing", { data: null, error: { message: "boom", code: "55P03" } }],
  ])("the release %s → try_again, with no new hold and no session", async (_label, reply) => {
    holdReplies(STALE, FRESH);
    fake.rpcResults.cohort_release_hold = reply;
    expect(await pay()).toEqual({ kind: "try_again" });
    expect(rpcNames()).toEqual(["cohort_hold_place", "cohort_release_hold"]);
    expect(stripeCalls()).toBe(0);
  });

  it("at most one recovery a press: the new hold is sessionless and stale too → try_again_soon, one release", async () => {
    holdReplies(STALE, STALE);
    expect(await pay()).toEqual({ kind: "try_again_soon" });
    expect(rpcNames()).toEqual(["cohort_hold_place", "cohort_release_hold", "cohort_hold_place"]);
    expect(wait).toHaveBeenCalledTimes(2 * PAY_REREAD_TRIES);
    expect(h.create).not.toHaveBeenCalled();
  });

  it.each([
    ["full (being paid)", { status: "full", reason: "being_paid" }, { kind: "state", state: { kind: "being_paid", nextAvailable: "2027-02-08" } }],
    ["refused", { status: "not_bookable" }, { kind: "try_again" }],
  ])("the new hold %s → that answer, with no session", async (_label, reply, expected) => {
    holdReplies(STALE, reply);
    expect(await pay()).toEqual(expected);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("the late first press creates its session after the release: its attach answers not_a_hold → it expires that session and releases", async () => {
    fake.rpcResults.cohort_attach_session = { data: { status: "not_a_hold" }, error: null };
    fake.rpcResults.cohort_release_hold = { data: { status: "already_released" }, error: null };
    expect(await pay()).toEqual({ kind: "try_again" });
    expect(h.expire).toHaveBeenCalledWith("cs_test_dep51");
    expect(rpcNames()).toEqual(["cohort_hold_place", "cohort_attach_session", "cohort_release_hold"]);
    expect(fake.rpcCalls[2].args).toEqual({ p_place_id: HOLD, p_parent: PARENT });
  });
});

describe("returnFromCheckout — Back from Stripe (cancelled=1)", () => {
  const back = () => returnFromCheckout(fake.client, proof, NOW);

  it("a look-alike proof → invalid with zero reads", async () => {
    const lookAlike = Object.freeze({ kind: "deposit_parent_proof", parentUserId: PARENT, linkId: LINK }) as unknown as DepositParentProof;
    expect(await returnFromCheckout(fake.client, lookAlike, NOW)).toEqual({ kind: "invalid" });
    expect(fake.ops).toHaveLength(0);
  });

  it("reads her live hold only (held, not yet expired)", async () => {
    await back();
    expect(fake.ops[0]).toMatchObject({ table: "cohort_places", kind: "select" });
    expect(fake.ops[0].filters).toEqual([["eq", "parent_user_id", PARENT], ["eq", "state", "held"], ["gt", "hold_expires_at", NOW.toISOString()]]);
  });

  it("no live hold, or a hold with no session yet → nothing", async () => {
    expect(await back()).toEqual({ kind: "nothing" });
    ownHold = holdRow();
    expect(await back()).toEqual({ kind: "nothing" });
    expect(stripeCalls()).toBe(0);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("an open session → expired first, then the hold released", async () => {
    ownHold = holdRow({ stripe_checkout_session_id: "cs_test_dep51" });
    h.retrieve.mockResolvedValue({ id: "cs_test_dep51", status: "open" });
    let rpcsBeforeExpire = -1;
    h.expire.mockImplementation(async () => {
      rpcsBeforeExpire = fake.rpcCalls.length;
      return { id: "cs_test_dep51", status: "expired" };
    });
    expect(await back()).toEqual({ kind: "released" });
    expect(h.expire).toHaveBeenCalledWith("cs_test_dep51");
    expect(rpcNames()).toEqual(["cohort_release_hold"]);
    expect(rpcsBeforeExpire).toBe(0);
  });

  it("a complete session → paid, nothing expired or released", async () => {
    ownHold = holdRow({ stripe_checkout_session_id: "cs_test_dep51" });
    h.retrieve.mockResolvedValue({ id: "cs_test_dep51", status: "complete" });
    expect(await back()).toEqual({ kind: "paid" });
    expect(h.expire).not.toHaveBeenCalled();
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("an already-expired session → released, no expire call", async () => {
    ownHold = holdRow({ stripe_checkout_session_id: "cs_test_dep51" });
    h.retrieve.mockResolvedValue({ id: "cs_test_dep51", status: "expired" });
    expect(await back()).toEqual({ kind: "released" });
    expect(h.expire).not.toHaveBeenCalled();
  });

  it.each([
    ["the retrieve fails", () => h.retrieve.mockRejectedValue(new Error("down"))],
    ["the expire fails", () => {
      h.retrieve.mockResolvedValue({ id: "cs_test_dep51", status: "open" });
      h.expire.mockRejectedValue(new Error("down"));
    }],
  ])("%s → try_again, and the hold is kept (the session may still be paid)", async (_label, arrange) => {
    ownHold = holdRow({ stripe_checkout_session_id: "cs_test_dep51" });
    arrange();
    expect(await back()).toEqual({ kind: "try_again" });
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("the release fails → try_again; the hold read fails → try_again", async () => {
    ownHold = holdRow({ stripe_checkout_session_id: "cs_test_dep51" });
    h.retrieve.mockResolvedValue({ id: "cs_test_dep51", status: "expired" });
    fake.rpcResults.cohort_release_hold = { data: null, error: { message: "boom", code: "55P03" } };
    expect(await back()).toEqual({ kind: "try_again" });
    const failing = fakeAdmin();
    failing.readErrors.cohort_places = { message: "boom", code: "XX000" };
    expect(await returnFromCheckout(failing.client, proof, NOW)).toEqual({ kind: "try_again" });
  });
});

describe("checkDepositDone — the done page asks Stripe, and writes nothing", () => {
  const paidSession = (over: Record<string, unknown> = {}) => ({
    id: "cs_test_dep51",
    payment_status: "paid",
    client_reference_id: PARENT,
    metadata: { link_kind: "deposit", deposit_link_id: LINK, user_id: PARENT },
    ...over,
  });

  it("this link's and this parent's paid session → paid", async () => {
    h.retrieve.mockResolvedValue(paidSession());
    expect(await checkDepositDone(proof, "cs_test_dep51")).toBe("paid");
    expect(h.retrieve).toHaveBeenCalledWith("cs_test_dep51");
    expect(h.expire).not.toHaveBeenCalled();
  });

  it("not paid yet → not_paid; a Stripe error → not_paid", async () => {
    h.retrieve.mockResolvedValue(paidSession({ payment_status: "unpaid" }));
    expect(await checkDepositDone(proof, "cs_test_dep51")).toBe("not_paid");
    h.retrieve.mockRejectedValue(new Error("down"));
    expect(await checkDepositDone(proof, "cs_test_dep51")).toBe("not_paid");
  });

  it.each([
    ["another link", paidSession({ metadata: { link_kind: "deposit", deposit_link_id: OTHER_LINK, user_id: PARENT } })],
    ["another parent", paidSession({ client_reference_id: OTHER_PARENT })],
    ["not a deposit", paidSession({ metadata: { link_kind: "custom", deposit_link_id: LINK, user_id: PARENT } })],
    ["no metadata", paidSession({ metadata: null })],
  ])("%s → foreign", async (_label, session) => {
    h.retrieve.mockResolvedValue(session);
    expect(await checkDepositDone(proof, "cs_test_dep51")).toBe("foreign");
  });

  it.each([
    ["not a session id", "pi_test_1"],
    ["too long", `cs_${"a".repeat(253)}`],
    ["a path", "cs_test/../x"],
    ["empty", ""],
    ["a number", 7],
    ["missing", undefined],
  ])("a bad id (%s) → invalid with zero Stripe calls", async (_label, id) => {
    expect(await checkDepositDone(proof, id)).toBe("invalid");
    expect(stripeCalls()).toBe(0);
  });

  it("a look-alike proof → invalid with zero Stripe calls", async () => {
    const lookAlike = Object.freeze({ kind: "deposit_parent_proof", parentUserId: PARENT, linkId: LINK }) as unknown as DepositParentProof;
    expect(await checkDepositDone(lookAlike, "cs_test_dep51")).toBe("invalid");
    expect(stripeCalls()).toBe(0);
  });

  it("a proof for another link sees this link's session as foreign", async () => {
    h.retrieve.mockResolvedValue(paidSession());
    const other = await proofFor(PARENT, OTHER_LINK);
    expect(await checkDepositDone(other, "cs_test_dep51")).toBe("foreign");
  });
});
