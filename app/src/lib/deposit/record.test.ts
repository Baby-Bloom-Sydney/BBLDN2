/**
 * Amendment 18's three money functions, typed (plan 03 row A5 `record`, §3 "Status rule"; contract-18). Each wrapper
 * sends the contract's exact parameter names, checks its input before any call, and maps every jsonb reply to a
 * closed, frozen union; an RPC error or a reply that doesn't fit is `error`, logged by code. The amount for a bank
 * transfer is `PRICES.dfy.depositPence` — never an input. `keepStatusFor` is the one status rule, the same answer
 * as `dfy-webhook.ts`'s old inline `row.status === "placed" || isLiveSelfServe(row)`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({ result: { userId: "a0300000-0000-4000-8000-000000000041", error: null as string | null } }));
vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin: async () => gate.result }));

import { PRICES } from "@/config/prices";
import { proveAdmin, type AdminProof } from "@/lib/calls/admin-proof";
import { isLiveSelfServe } from "@/lib/payments/dfy-access";
import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";
import { NOTE_MAX, REFUND_REASON_MAX } from "./constants";
import { keepStatusFor, markBankTransfer, recordBankRefund, recordCardPayment, type CardPaymentRequest } from "./record";

const ADMIN = "a0300000-0000-4000-8000-000000000041";
const PARENT = "b0300000-0000-4000-8000-000000000041";
const LINK = "d0300000-0000-4000-8000-000000000041";
const HOLD = "c0300000-0000-4000-8000-000000000041";
const DAY = 86_400_000;
const FUTURE = new Date(Date.now() + DAY).toISOString();
const PAST = new Date(Date.now() - DAY).toISOString();

let admin: AdminProof;
let fake: FakeAdmin;
let log: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  log = vi.spyOn(console, "error").mockImplementation(() => {});
  log.mockClear();
  const p = await proveAdmin();
  if (!p) throw new Error("no admin proof");
  admin = p;
  fake = fakeAdmin();
});

const LOOK_ALIKE = Object.freeze({ kind: "admin_proof", userId: ADMIN }) as unknown as AdminProof;
const answer = (fn: string, data: unknown) => {
  fake.rpcResults[fn] = { data, error: null };
};
const logged = () => JSON.stringify(log.mock.calls);

const CARD: CardPaymentRequest = {
  parentUserId: PARENT,
  linkId: LINK,
  holdId: HOLD,
  sessionId: "cs_test_dep03",
  paymentIntentId: "pi_test_dep03",
  pence: PRICES.dfy.depositPence,
  customerId: "cus_test_fam",
  keepStatus: false,
};

describe("recordCardPayment", () => {
  it("sends exactly the contract's parameters to deposit_record_card_payment", async () => {
    answer("deposit_record_card_payment", { status: "already_recorded" });
    await recordCardPayment(fake.client, { ...CARD, keepStatus: true });
    expect(fake.rpcCalls).toEqual([
      {
        fn: "deposit_record_card_payment",
        args: {
          p_parent: PARENT, p_link_id: LINK, p_hold_id: HOLD, p_session_id: "cs_test_dep03", p_payment_intent: "pi_test_dep03",
          p_pence: PRICES.dfy.depositPence, p_customer: "cus_test_fam", p_keep_status: true,
        },
      },
    ]);
  });

  it("recorded with the place taken → the place's id, cohort and over-by", async () => {
    answer("deposit_record_card_payment", { status: "recorded", place: "taken", place_id: HOLD, cohort_start_date: "2027-02-01", over_by: 0 });
    const r = await recordCardPayment(fake.client, CARD);
    expect(r).toEqual({ status: "recorded", place: { status: "taken", placeId: HOLD, cohortStartDate: "2027-02-01", overBy: 0 } });
    expect(Object.isFrozen(r)).toBe(true);
  });

  it.each(["hold_not_found", "already_taken", "invalid"])("recorded with the place refused (%s) → the money still recorded, the status kept", async (place) => {
    answer("deposit_record_card_payment", { status: "recorded", place });
    expect(await recordCardPayment(fake.client, CARD)).toEqual({ status: "recorded", place: { status: place } });
  });

  it.each(["already_recorded", "duplicate", "invalid"])("%s → that status", async (status) => {
    answer("deposit_record_card_payment", { status });
    expect(await recordCardPayment(fake.client, CARD)).toEqual({ status });
  });

  it("a null customer is sent as null (the function allows it)", async () => {
    answer("deposit_record_card_payment", { status: "already_recorded" });
    await recordCardPayment(fake.client, { ...CARD, customerId: null });
    expect(fake.rpcCalls[0].args).toMatchObject({ p_customer: null });
  });

  it("an RPC error → error, logged by its code and never the message", async () => {
    fake.rpcResults.deposit_record_card_payment = { data: null, error: { message: "secret detail", code: "40P01" } };
    expect(await recordCardPayment(fake.client, CARD)).toEqual({ status: "error" });
    expect(logged()).toContain("40P01");
    expect(logged()).not.toContain("secret detail");
  });

  it.each([
    ["null", null],
    ["an unknown status", { status: "weird" }],
    ["an unknown place status", { status: "recorded", place: "lost" }],
    ["recorded with no place", { status: "recorded" }],
  ])("an unexpected reply (%s) → error, logged", async (_label, data) => {
    answer("deposit_record_card_payment", data);
    expect(await recordCardPayment(fake.client, CARD)).toEqual({ status: "error" });
    expect(logged()).toContain("unexpected_reply");
  });

  it.each([
    ["a parent that isn't a uuid", { parentUserId: "nope" }],
    ["a link that isn't a uuid", { linkId: "nope" }],
    ["a hold that isn't a uuid", { holdId: "" }],
    ["an empty session id", { sessionId: "" }],
    ["a session id over 255", { sessionId: `cs_${"a".repeat(253)}` }],
    ["an empty intent", { paymentIntentId: "" }],
    ["negative pence", { pence: -1 }],
    ["fractional pence", { pence: 1.5 }],
    ["an empty customer", { customerId: "" }],
    ["a non-boolean keep", { keepStatus: "yes" }],
  ])("%s → invalid with no call", async (_label, over) => {
    expect(await recordCardPayment(fake.client, { ...CARD, ...over } as never)).toEqual({ status: "invalid" });
    expect(fake.rpcCalls).toHaveLength(0);
  });
});

const BANK = { parentUserId: PARENT, startDate: "2027-02-01", goodwill: false, note: "  transfer ref JONES  " };
const familyRow = (over: Record<string, unknown> = {}) => ({
  status: "lapsed", family_type: "self_serve", trial_ends_at: null, paid_period_ends_at: null, past_due_grace_ends_at: null, ...over,
});

describe("markBankTransfer", () => {
  it("reads the family's row for the status rule, then sends the contract's parameters (amount from PRICES, actor from the proof)", async () => {
    fake.reads.parent_subscriptions = familyRow({ status: "placed", family_type: "dfy" });
    answer("deposit_mark_bank_transfer", { status: "marked", place_id: HOLD, cohort_start_date: "2027-02-01", is_goodwill: false });
    const r = await markBankTransfer(admin, fake.client, BANK);
    expect(r).toEqual({ status: "marked", placeId: HOLD, cohortStartDate: "2027-02-01", isGoodwill: false });
    expect(fake.ops[0]).toMatchObject({ table: "parent_subscriptions", kind: "select", filters: [["eq", "parent_user_id", PARENT]] });
    expect(fake.rpcCalls).toEqual([
      {
        fn: "deposit_mark_bank_transfer",
        args: {
          p_parent: PARENT, p_start: "2027-02-01", p_goodwill: false, p_pence: PRICES.dfy.depositPence,
          p_note: "transfer ref JONES", p_actor: ADMIN, p_keep_status: true,
        },
      },
    ]);
  });

  it.each([
    ["no row", null, false],
    ["a lapsed self-serve row", familyRow(), false],
    ["a live self-serve trial", familyRow({ status: "trial", trial_ends_at: FUTURE }), true],
    ["an ended trial", familyRow({ status: "trial", trial_ends_at: PAST }), false],
  ])("the status rule from the family's row: %s → keep %s", async (_label, row, keep) => {
    fake.reads.parent_subscriptions = row;
    answer("deposit_mark_bank_transfer", { status: "already_paid" });
    await markBankTransfer(admin, fake.client, BANK);
    expect(fake.rpcCalls[0].args).toMatchObject({ p_keep_status: keep });
  });

  it.each([
    [{ status: "already_paid" }, { status: "already_paid" }],
    [{ status: "full", reason: "all_taken", places: 5, taken: 5, being_paid: 0 }, { status: "full", reason: "all_taken" }],
    [{ status: "full", reason: "being_paid", places: 5, taken: 4, being_paid: 1 }, { status: "full", reason: "being_paid" }],
    [{ status: "not_bookable" }, { status: "not_bookable" }],
    [{ status: "not_a_cohort" }, { status: "not_a_cohort" }],
    [{ status: "already_taken" }, { status: "already_taken" }],
    [{ status: "invalid" }, { status: "invalid" }],
  ])("reply %j → %j", async (data, expected) => {
    fake.reads.parent_subscriptions = null;
    answer("deposit_mark_bank_transfer", data);
    expect(await markBankTransfer(admin, fake.client, BANK)).toEqual(expected);
  });

  it.each([
    ["a look-alike proof", LOOK_ALIKE, {}],
    ["an empty note", null, { note: "   " }],
    ["a note over 500", null, { note: "x".repeat(NOTE_MAX + 1) }],
    ["a non-string note", null, { note: 7 }],
    ["a non-date", null, { startDate: "2027-02-30" }],
    ["a parent that isn't a uuid", null, { parentUserId: "nope" }],
    ["a non-boolean goodwill", null, { goodwill: "false" }],
  ])("%s → invalid with zero database calls", async (_label, proof, over) => {
    expect(await markBankTransfer(proof ?? admin, fake.client, { ...BANK, ...over } as never)).toEqual({ status: "invalid" });
    expect(fake.ops).toHaveLength(0);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("a note of exactly 500 once trimmed is accepted", async () => {
    answer("deposit_mark_bank_transfer", { status: "already_paid" });
    await markBankTransfer(admin, fake.client, { ...BANK, note: ` ${"x".repeat(NOTE_MAX)} ` });
    expect(fake.rpcCalls[0].args).toMatchObject({ p_note: "x".repeat(NOTE_MAX) });
  });

  it("the family read fails → error with no call; a row that doesn't fit → error", async () => {
    fake.readErrors.parent_subscriptions = { message: "boom", code: "XX000" };
    expect(await markBankTransfer(admin, fake.client, BANK)).toEqual({ status: "error" });
    expect(fake.rpcCalls).toHaveLength(0);
    const odd = fakeAdmin({ parent_subscriptions: { status: 7 } });
    expect(await markBankTransfer(admin, odd.client, BANK)).toEqual({ status: "error" });
    expect(odd.rpcCalls).toHaveLength(0);
  });

  it("an RPC error or an unexpected reply → error", async () => {
    fake.rpcResults.deposit_mark_bank_transfer = { data: null, error: { message: "boom", code: "55P03" } };
    expect(await markBankTransfer(admin, fake.client, BANK)).toEqual({ status: "error" });
    const odd = fakeAdmin();
    odd.rpcResults.deposit_mark_bank_transfer = { data: { status: "marked" }, error: null };
    expect(await markBankTransfer(admin, odd.client, BANK)).toEqual({ status: "error" });
  });

  it("a throw → error", async () => {
    const broken = { from: () => { throw new TypeError("kaput"); } } as unknown as FakeAdmin["client"];
    expect(await markBankTransfer(admin, broken, BANK)).toEqual({ status: "error" });
  });
});

describe("recordBankRefund", () => {
  const REFUND = { parentUserId: PARENT, reason: "  family moved away  " };

  it("sends the trimmed reason and the proof's user", async () => {
    answer("deposit_record_bank_refund", { status: "refunded", place: "reopened" });
    expect(await recordBankRefund(admin, fake.client, REFUND)).toEqual({ status: "refunded", place: "reopened" });
    expect(fake.rpcCalls).toEqual([{ fn: "deposit_record_bank_refund", args: { p_parent: PARENT, p_reason: "family moved away", p_actor: ADMIN } }]);
    expect(fake.ops).toHaveLength(0);
  });

  it.each([
    [{ status: "refunded", place: "not_found" }, { status: "refunded", place: "not_found" }],
    [{ status: "not_bank_transfer" }, { status: "not_bank_transfer" }],
    [{ status: "already_refunded" }, { status: "already_refunded" }],
    [{ status: "invalid" }, { status: "invalid" }],
  ])("reply %j → %j", async (data, expected) => {
    answer("deposit_record_bank_refund", data);
    expect(await recordBankRefund(admin, fake.client, REFUND)).toEqual(expected);
  });

  it.each([
    ["a look-alike proof", LOOK_ALIKE, {}],
    ["a reason under 3 once trimmed", null, { reason: "  ab  " }],
    ["a reason over 500", null, { reason: "x".repeat(REFUND_REASON_MAX + 1) }],
    ["a non-string reason", null, { reason: null }],
    ["a parent that isn't a uuid", null, { parentUserId: "nope" }],
  ])("%s → invalid with no call", async (_label, proof, over) => {
    expect(await recordBankRefund(proof ?? admin, fake.client, { ...REFUND, ...over } as never)).toEqual({ status: "invalid" });
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("an RPC error or an unexpected reply → error", async () => {
    fake.rpcResults.deposit_record_bank_refund = { data: null, error: { message: "boom", code: "55P03" } };
    expect(await recordBankRefund(admin, fake.client, REFUND)).toEqual({ status: "error" });
    answer("deposit_record_bank_refund", { status: "refunded", place: "gone" });
    expect(await recordBankRefund(admin, fake.client, REFUND)).toEqual({ status: "error" });
  });
});

describe("keepStatusFor — the one status rule (plan 03 §3)", () => {
  const rows = [
    familyRow(),
    familyRow({ status: "placed", family_type: "dfy" }),
    familyRow({ status: "deposit_paid", family_type: "dfy" }),
    familyRow({ status: "trial", trial_ends_at: FUTURE }),
    familyRow({ status: "trial", trial_ends_at: PAST }),
    familyRow({ status: "active_monthly", paid_period_ends_at: FUTURE }),
    familyRow({ status: "active_upfront", paid_period_ends_at: PAST }),
    familyRow({ status: "cancelled", paid_period_ends_at: FUTURE }),
    familyRow({ status: "past_due", past_due_grace_ends_at: FUTURE }),
    familyRow({ status: "trial", family_type: "dfy", trial_ends_at: FUTURE }),
    familyRow({ status: "placed", family_type: null }),
  ];

  it("no row → false (a new family becomes deposit_paid)", () => {
    expect(keepStatusFor(null)).toBe(false);
  });

  it.each(rows)("gives the old inline rule's answer for %j", (row) => {
    expect(keepStatusFor(row)).toBe(row.status === "placed" || isLiveSelfServe(row));
  });

  it("placed and live self-serve keep; lapsed and deposit_paid don't", () => {
    expect([rows[0], rows[1], rows[2], rows[3]].map(keepStatusFor)).toEqual([false, true, false, true]);
  });
});
