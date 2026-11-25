/**
 * The family's deposit panel read (plan 03 row A5 "panel: all §3 admin 1 states"; brief 03 §3 Admin 1–7). Admin data
 * (the code, a masked email), so a real AdminProof first — nothing is read without one. One parallel set of bounded
 * reads; any failed or malformed read fails the whole panel (it never shows a wrong state).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({ result: { userId: "a0000000-0000-4000-8000-000000000031", error: null as string | null } }));
vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin: async () => gate.result }));

import { PRICES } from "@/config/prices";
import { proveAdmin, type AdminProof } from "@/lib/calls/admin-proof";
import { fakeAdmin, type FakeAdmin, type Op } from "@/lib/payments/fake-admin.test-util";
import { depositAmount, depositStateLine, depositWarningLines, linkLine, prebookedLine } from "./copy";
import { readDepositPanel } from "./panel";

const NOW = new Date("2027-02-03T10:00:00Z");
const PARENT = "b0300000-0000-4000-8000-000000000001";
const OTHER = "b0300000-0000-4000-8000-000000000002";
const LINK = "d0300000-0000-4000-8000-000000000001";
const PREBOOKING = "e0300000-0000-4000-8000-000000000001";
const CODE = "Ab0_-".repeat(8) + "xyz";
const PRICE = PRICES.dfy.depositPence;
const SECRET = "Sarah Jones sarah@gmail.com";

const subscription = (over: Record<string, unknown> = {}) => ({
  deposit_pence: PRICE,
  deposit_paid_at: "2027-02-03T09:00:00+00:00",
  deposit_refunded_at: null,
  deposit_method: "card",
  deposit_stripe_payment_intent_id: "pi_3Test",
  ...over,
});
const CARD = { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 };
const link = (over: Record<string, unknown> = {}) => ({
  id: LINK,
  code: CODE,
  target: "current",
  goodwill_cohort_start_date: null,
  created_at: "2027-02-03T08:59:00+00:00",
  last_emailed_at: "2027-02-03T09:02:00+00:00",
  last_emailed_to: "sarah@gmail.com",
  ...over,
});
const herPlace = (over: Record<string, unknown> = {}) => ({
  cohort_start_date: "2027-02-01",
  state: "taken",
  is_goodwill: false,
  taken_at: "2027-02-03T09:00:05+00:00",
  reopened_at: null,
  ...over,
});
const counted = (n: number, start: string) => ({
  id: `c0300000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
  cohort_start_date: start,
  parent_user_id: `b0300000-0000-4000-8000-0000000009${String(n).padStart(2, "0")}`,
  state: "taken",
  is_goodwill: false,
  hold_expires_at: null,
  paid_by: "card",
  taken_at: "2027-01-30T09:00:00Z",
  reopened_at: null,
  reopen_reason: null,
});
const NO_WARNINGS = { refunded_but_held: [], paid_without_place: [] };

let fake: FakeAdmin;
let herPlaces: unknown[];
let countedPlaces: unknown[];
let proof: AdminProof;
let log: ReturnType<typeof vi.spyOn>;

const isHers = (op: Op) => op.filters.some(([f, c, v]) => f === "eq" && c === "parent_user_id" && v === PARENT);

beforeEach(async () => {
  herPlaces = [herPlace()];
  countedPlaces = [];
  fake = fakeAdmin({
    parent_subscriptions: subscription(),
    family_saved_cards: CARD,
    deposit_bank_transfers: null,
    deposit_links: link(),
    deposit_prebookings: null,
    cohort_schedule: { first_start_date: "2027-01-25", repeat_weeks: 1, default_places: 5, created_at: "2026-11-04T05:00:00Z" },
    cohorts: [{ start_date: "2027-02-01", places: 5 }, { start_date: "2027-02-08", places: 5 }],
    cohort_places: (op: Op) => (isHers(op) ? herPlaces : countedPlaces),
  });
  fake.counts.deposit_duplicate_payments = 0;
  fake.rpcResults.cohort_warnings = { data: NO_WARNINGS, error: null };
  const proved = await proveAdmin();
  if (proved === null) throw new Error("expected an admin proof");
  proof = proved;
  log = vi.spyOn(console, "error").mockImplementation(() => {});
});

async function panel() {
  const r = await readDepositPanel(proof, fake.client, PARENT, NOW);
  if (!r.ok) throw new Error(`expected a panel, got ${r.status}`);
  return r.value;
}

describe("readDepositPanel — refused before any read", () => {
  it.each([
    ["no proof", null],
    ["a look-alike", { kind: "admin_proof", userId: "a0000000-0000-4000-8000-000000000031" }],
  ])("%s → invalid with zero reads", async (_label, notProof) => {
    expect(await readDepositPanel(notProof as unknown as AdminProof, fake.client, PARENT, NOW)).toEqual({ ok: false, status: "invalid" });
    expect(fake.ops).toHaveLength(0);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it.each([["not a uuid", "sarah"], ["empty", ""], ["not a string", 7]])("a parent id that is %s → invalid with zero reads", async (_label, id) => {
    expect(await readDepositPanel(proof, fake.client, id as unknown as string, NOW)).toEqual({ ok: false, status: "invalid" });
    expect(fake.ops).toHaveLength(0);
  });
});

describe("readDepositPanel — the reads", () => {
  it("each read is hers and bounded: one row by her id, the open link and pre-booking, a head count, paged places", async () => {
    await panel();
    const byTable = (t: string) => fake.ops.filter((o) => o.table === t);
    for (const t of ["parent_subscriptions", "family_saved_cards", "deposit_bank_transfers", "deposit_duplicate_payments"]) {
      expect([t, byTable(t).map((o) => o.filters)]).toEqual([t, [[["eq", "parent_user_id", PARENT]]]]);
    }
    for (const t of ["deposit_links", "deposit_prebookings"]) {
      expect([t, byTable(t).map((o) => o.filters)]).toEqual([t, [[["eq", "parent_user_id", PARENT], ["eq", "state", "open"]]]]);
    }
    const hers = byTable("cohort_places").filter(isHers);
    expect(hers).toHaveLength(1);
    expect(hers[0].filters).toEqual(expect.arrayContaining([["in", "state", ["taken", "reopened"]], ["range", 0, 499]]));
    expect(fake.rpcCalls).toEqual([{ fn: "cohort_warnings", args: {} }]);
    expect(fake.ops.every((o) => o.kind === "select")).toBe(true);
  });

  it("the result is frozen all the way down", async () => {
    const p = await panel();
    for (const part of [p, p.payment, p.card, p.place, p.link, p.warnings, p.cohorts]) expect(Object.isFrozen(part)).toBe(true);
  });
});

describe("readDepositPanel — every state brief §3 Admin 1 names", () => {
  it("not paid (no subscription row): nothing paid, she can be sent a link or have one taken", async () => {
    fake.reads.parent_subscriptions = null;
    fake.reads.family_saved_cards = null;
    fake.reads.deposit_links = null;
    herPlaces = [];
    const p = await panel();
    expect(p).toMatchObject({ state: "not_paid", payment: null, card: null, place: null, link: null, canTakeDeposit: true, canRecordBankRefund: false });
    expect(depositStateLine(p)).toBe("Not paid");
    expect(linkLine(p)).toBe("No deposit link yet");
  });

  it("not paid (a row with no deposit) is the same", async () => {
    fake.reads.parent_subscriptions = subscription({ deposit_pence: null, deposit_paid_at: null, deposit_method: null, deposit_stripe_payment_intent_id: null });
    expect(await panel()).toMatchObject({ state: "not_paid", payment: null, canTakeDeposit: true });
  });

  it("paid by card, card saved, place taken", async () => {
    const p = await panel();
    expect(p).toEqual({
      parentUserId: PARENT,
      today: "2027-02-03",
      state: "paid_card",
      payment: { pence: PRICE, paidAt: "2027-02-03T09:00:00.000Z", refundedAt: null, method: "card", paymentIntentId: "pi_3Test" },
      card: { brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 },
      bankTransfer: null,
      place: { cohortStartDate: "2027-02-01", isGoodwill: false, state: "taken" },
      link: {
        id: LINK,
        code: CODE,
        target: "current",
        goodwillStartDate: null,
        createdAt: "2027-02-03T08:59:00.000Z",
        lastEmailedAt: "2027-02-03T09:02:00.000Z",
        lastEmailedTo: "sarah@gmail.com",
      },
      prebooking: null,
      duplicatePayments: 0,
      warnings: [],
      cohorts: {
        current: { start: "2027-02-01", places: 5, taken: 0, beingPaid: 0, left: 5, overBy: 0 },
        next: { start: "2027-02-08", places: 5, taken: 0, beingPaid: 0, left: 5, overBy: 0 },
        canOfferGoodwill: false,
      },
      canTakeDeposit: false,
      canRecordBankRefund: false,
    });
    expect(depositStateLine(p)).toBe(`Paid ${depositAmount()} by card, 3 Feb · Card saved Visa •••• 4242 (12/30) · Cohort Mon 1 Feb`);
    expect(linkLine(p)).toBe("Sent 09:02 to s•••@gmail.com");
  });

  it("paid by card but no card row (the card read failed in the webhook, D7) → 'Card: not recorded'", async () => {
    fake.reads.family_saved_cards = null;
    const p = await panel();
    expect(p.card).toBeNull();
    expect(depositStateLine(p)).toBe(`Paid ${depositAmount()} by card, 3 Feb · Card: not recorded · Cohort Mon 1 Feb`);
  });

  it("paid by bank transfer, no card saved: the bank refund can be recorded", async () => {
    fake.reads.parent_subscriptions = subscription({ deposit_method: "bank_transfer", deposit_stripe_payment_intent_id: null });
    fake.reads.family_saved_cards = null;
    fake.reads.deposit_bank_transfers = { marked_at: "2027-02-03T09:00:00+00:00", refunded_at: null };
    const p = await panel();
    expect(p).toMatchObject({
      state: "paid_bank_transfer",
      bankTransfer: { markedAt: "2027-02-03T09:00:00.000Z", refundedAt: null },
      canTakeDeposit: false,
      canRecordBankRefund: true,
    });
    expect(depositStateLine(p)).toBe(`Paid ${depositAmount()} by bank transfer · no card saved · Cohort Mon 1 Feb`);
  });

  it("an old preset deposit (method NULL)", async () => {
    fake.reads.parent_subscriptions = subscription({ deposit_method: null });
    fake.reads.family_saved_cards = null;
    herPlaces = [];
    const p = await panel();
    expect(p).toMatchObject({ state: "paid_preset", place: null, canTakeDeposit: false, canRecordBankRefund: false });
    expect(depositStateLine(p)).toBe(`Paid ${depositAmount()}, 3 Feb (old payment link) · no card saved`);
  });

  it("refunded: the date, and no bank refund to record again", async () => {
    fake.reads.parent_subscriptions = subscription({ deposit_method: "bank_transfer", deposit_refunded_at: "2027-02-10T12:00:00+00:00" });
    fake.reads.deposit_bank_transfers = { marked_at: "2027-02-03T09:00:00+00:00", refunded_at: "2027-02-10T12:00:00+00:00" };
    herPlaces = [herPlace({ state: "reopened", reopened_at: "2027-02-10T12:00:01+00:00" })];
    const p = await panel();
    expect(p).toMatchObject({ state: "refunded", place: { state: "reopened" }, canTakeDeposit: false, canRecordBankRefund: false });
    expect(depositStateLine(p)).toBe("Refunded 10 Feb");
  });

  it("her place: a taken one wins over an older re-opened one; a goodwill place says so", async () => {
    herPlaces = [
      herPlace({ cohort_start_date: "2027-01-25", state: "reopened", reopened_at: "2027-01-26T10:00:00Z" }),
      herPlace({ cohort_start_date: "2027-02-08", is_goodwill: true }),
    ];
    const p = await panel();
    expect(p.place).toEqual({ cohortStartDate: "2027-02-08", isGoodwill: true, state: "taken" });
    expect(depositStateLine(p)).toContain("· Cohort Mon 8 Feb (goodwill)");
  });

  it("the latest of two re-opened places", async () => {
    herPlaces = [
      herPlace({ cohort_start_date: "2027-01-25", state: "reopened", reopened_at: "2027-01-26T10:00:00Z" }),
      herPlace({ cohort_start_date: "2027-02-01", state: "reopened", reopened_at: "2027-02-02T10:00:00Z" }),
      herPlace({ cohort_start_date: "2027-01-18", state: "reopened", reopened_at: "2027-01-20T10:00:00Z" }),
    ];
    expect((await panel()).place).toEqual({ cohortStartDate: "2027-02-01", isGoodwill: false, state: "reopened" });
  });

  it("pre-booked for a cohort, or with none set up", async () => {
    fake.reads.parent_subscriptions = null;
    fake.reads.deposit_prebookings = { id: PREBOOKING, parent_user_id: PARENT, cohort_start_date: "2027-02-08", call_booking_id: null, created_at: "2027-02-03T09:30:00+00:00" };
    const p = await panel();
    expect(p.prebooking).toEqual({ id: PREBOOKING, parentUserId: PARENT, cohortStartDate: "2027-02-08", callBookingId: null, createdAt: "2027-02-03T09:30:00.000Z" });
    expect(prebookedLine(p)).toBe("Pre-booked for Mon 8 Feb");
    fake.reads.deposit_prebookings = { id: PREBOOKING, parent_user_id: PARENT, cohort_start_date: null, call_booking_id: null, created_at: "2027-02-03T09:30:00+00:00" };
    expect(prebookedLine(await panel())).toBe("Pre-booked (no cohort set up yet)");
  });

  it("a link never emailed, and a goodwill link", async () => {
    fake.reads.deposit_links = link({ last_emailed_at: null, last_emailed_to: null, target: "goodwill", goodwill_cohort_start_date: "2027-02-08" });
    const p = await panel();
    expect(p.link).toMatchObject({ target: "goodwill", goodwillStartDate: "2027-02-08", lastEmailedAt: null, lastEmailedTo: null });
    expect(linkLine(p)).toBe("Link made, not emailed yet · goodwill Mon 8 Feb");
  });

  it("warnings: a duplicate deposit, and 02's refunded-but-held for her only", async () => {
    fake.counts.deposit_duplicate_payments = 2;
    fake.rpcResults.cohort_warnings = {
      data: {
        refunded_but_held: [
          { place_id: "c0300000-0000-4000-8000-000000000001", parent_user_id: OTHER, cohort_start_date: "2027-02-01" },
          { place_id: "c0300000-0000-4000-8000-000000000002", parent_user_id: PARENT, cohort_start_date: "2027-02-01" },
        ],
        paid_without_place: [{ parent_user_id: PARENT, deposit_paid_at: "2027-02-03T09:00:00Z" }],
      },
      error: null,
    };
    const p = await panel();
    expect(p).toMatchObject({ duplicatePayments: 2, warnings: ["duplicate_payment", "refunded_but_held"] });
    expect(depositWarningLines(p)).toEqual(["Second deposit received. Refund one in Stripe", "Deposit refunded but place still held"]);
  });

  it("another family's refunded-but-held is not hers", async () => {
    fake.rpcResults.cohort_warnings = {
      data: { refunded_but_held: [{ place_id: "c0300000-0000-4000-8000-000000000001", parent_user_id: OTHER, cohort_start_date: "2027-02-01" }], paid_without_place: [] },
      error: null,
    };
    expect((await panel()).warnings).toEqual([]);
  });

  it("goodwill can be offered only when the current cohort is full and the next has a place (D10)", async () => {
    countedPlaces = [1, 2, 3, 4, 5].map((n) => counted(n, "2027-02-01"));
    const p = await panel();
    expect(p.cohorts).toMatchObject({ current: { left: 0 }, next: { left: 5 }, canOfferGoodwill: true });
  });

  it("no cohorts set up: none current or next, no goodwill", async () => {
    fake.reads.cohort_schedule = null;
    fake.reads.cohorts = [];
    expect((await panel()).cohorts).toEqual({ current: null, next: null, canOfferGoodwill: false });
  });
});

describe("readDepositPanel — any failed read fails the panel (never a wrong state)", () => {
  it.each([
    "parent_subscriptions",
    "family_saved_cards",
    "deposit_bank_transfers",
    "deposit_links",
    "deposit_prebookings",
    "deposit_duplicate_payments",
    "cohort_places",
    "cohort_schedule",
  ])("%s can't be read → error, logged by code only", async (table) => {
    fake.readErrors[table] = { message: SECRET, code: "XX000" };
    expect(await readDepositPanel(proof, fake.client, PARENT, NOW)).toEqual({ ok: false, status: "error" });
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("Sarah");
  });

  it.each([
    ["02's warnings can't be read", () => (fake.rpcResults.cohort_warnings = { data: null, error: { message: SECRET, code: "XX000" } })],
    ["02's warnings reply doesn't fit", () => (fake.rpcResults.cohort_warnings = { data: { refunded_but_held: "x" }, error: null })],
    ["no duplicate count comes back", () => (fake.counts.deposit_duplicate_payments = undefined)],
    ["a subscription row doesn't fit", () => (fake.reads.parent_subscriptions = subscription({ deposit_method: "cash" }))],
    ["a card row doesn't fit", () => (fake.reads.family_saved_cards = { ...CARD, last4: "42" })],
    ["a bank row doesn't fit", () => (fake.reads.deposit_bank_transfers = { marked_at: "never", refunded_at: null })],
    ["a link row doesn't fit", () => (fake.reads.deposit_links = link({ code: "short" }))],
    ["a pre-booking row doesn't fit", () => (fake.reads.deposit_prebookings = { id: "x" })],
    ["a place row doesn't fit", () => (herPlaces = [herPlace({ state: "held" })])],
  ])("%s → error", async (_label, arrange) => {
    arrange();
    expect(await readDepositPanel(proof, fake.client, PARENT, NOW)).toEqual({ ok: false, status: "error" });
    expect(log).toHaveBeenCalled();
  });

  it("a throw → error", async () => {
    fake.client.from = (() => {
      throw new TypeError(SECRET);
    }) as never;
    expect(await readDepositPanel(proof, fake.client, PARENT, NOW)).toEqual({ ok: false, status: "error" });
  });
});

// ── The client view (03b review M1; BB-wave2-231126/03-build, 2026-11-25) ─────────────────────────────────────────────
import { sendAgainQuestion } from "./copy";
import { toClientPanel } from "./panel";

describe("toClientPanel — what the admin page hands its client block", () => {
  async function both() {
    const read = await readDepositPanel(proof, fake.client, PARENT, NOW);
    const view = toClientPanel(read);
    if (!read.ok || !view.ok) throw new Error("expected a panel");
    return { full: read.value, view: view.value, whole: view };
  }

  it("no link code, no payment intent id, the address masked — nothing else changes", async () => {
    const { full, view } = await both();
    const text = JSON.stringify(view);
    expect(text).not.toContain(CODE);
    expect(text).not.toMatch(/pi_/);
    expect(text).not.toContain("sarah@gmail.com");
    expect(view.link).toEqual({
      target: "current",
      goodwillStartDate: null,
      createdAt: "2027-02-03T08:59:00.000Z",
      lastEmailedAt: "2027-02-03T09:02:00.000Z",
      lastEmailedTo: "s•••@gmail.com",
    });
    expect(view.payment).toEqual({ pence: PRICE, paidAt: "2027-02-03T09:00:00.000Z", refundedAt: null, method: "card" });
    const { link: _link, payment: _payment, ...rest } = full;
    expect(view).toEqual({ ...rest, link: view.link, payment: view.payment });
  });

  it("the panel's words are the same from the client view", async () => {
    fake.reads.parent_subscriptions = null;
    const { full, view } = await both();
    for (const words of [depositStateLine, linkLine, prebookedLine, depositWarningLines, sendAgainQuestion] as const) {
      expect(words(view)).toEqual(words(full));
    }
    expect(linkLine(view)).toBe("Sent 09:02 to s•••@gmail.com");
  });

  it("a goodwill link never emailed: its pin kept, no address; no link and no payment stay null; frozen", async () => {
    fake.reads.deposit_links = link({ target: "goodwill", goodwill_cohort_start_date: "2027-02-08", last_emailed_at: null, last_emailed_to: null });
    const { view, whole } = await both();
    expect(view.link).toEqual({ target: "goodwill", goodwillStartDate: "2027-02-08", createdAt: "2027-02-03T08:59:00.000Z", lastEmailedAt: null, lastEmailedTo: null });
    for (const part of [whole, view, view.link, view.payment]) expect(Object.isFrozen(part)).toBe(true);
    fake.reads.deposit_links = null;
    fake.reads.parent_subscriptions = null;
    expect((await both()).view).toMatchObject({ link: null, payment: null });
  });

  it("a failed read passes through as it is", () => {
    expect(toClientPanel({ ok: false, status: "error" })).toEqual({ ok: false, status: "error" });
    expect(toClientPanel({ ok: false, status: "invalid" })).toEqual({ ok: false, status: "invalid" });
  });
});
