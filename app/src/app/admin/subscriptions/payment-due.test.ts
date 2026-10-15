/** 4c — the "Payment due" counter/filter predicate (brief step 7). BB-LDN-4c-151026. */
import { describe, expect, it } from "vitest";
import { cumulativeSpendPence, isPaymentDue } from "./types";
import { PRICES } from "@/config/prices";

const NOW = Date.parse("2026-10-15T00:00:00Z");
const row = (over: Partial<{ status: string; payment_due_at: string | null; bill_paid_at: string | null }>) => ({
  status: "placed",
  payment_due_at: "2026-10-14T00:00:00Z",
  bill_paid_at: null,
  ...over,
});

describe("isPaymentDue", () => {
  it("placed, due date passed, bill unpaid → due", () => expect(isPaymentDue(row({}), NOW)).toBe(true));
  it("due exactly now → due", () => expect(isPaymentDue(row({ payment_due_at: "2026-10-15T00:00:00Z" }), NOW)).toBe(true));
  it("not yet due → not due", () => expect(isPaymentDue(row({ payment_due_at: "2026-10-16T00:00:00Z" }), NOW)).toBe(false));
  it("bill paid → not due", () => expect(isPaymentDue(row({ bill_paid_at: "2026-10-14T10:00:00Z" }), NOW)).toBe(false));
  it("no due date → not due", () => expect(isPaymentDue(row({ payment_due_at: null }), NOW)).toBe(false));
  it.each(["deposit_paid", "trial", "active_monthly", "lapsed"])("%s → not due", (status) =>
    expect(isPaymentDue(row({ status }), NOW)).toBe(false),
  );
});

// 4g (D3): lifetime spend from config, in pence — both admin pages call this one helper.
describe("cumulativeSpendPence", () => {
  const selfServe = { family_type: "self_serve" };
  const none = { monthlyCycles: 0, upfrontPaid: false };

  it("monthly: paid cycles × the monthly price", () =>
    expect(cumulativeSpendPence(selfServe, { monthlyCycles: 3, upfrontPaid: false })).toBe(
      3 * PRICES.selfServe.monthlyPence,
    ));
  it("upfront: the upfront price once", () =>
    expect(cumulativeSpendPence(selfServe, { monthlyCycles: 0, upfrontPaid: true })).toBe(
      PRICES.selfServe.upfrontToAge3Pence,
    ));
  it("trial / nothing paid → 0", () => expect(cumulativeSpendPence(selfServe, none)).toBe(0));
  it("a row with no family_type is self-serve", () =>
    expect(cumulativeSpendPence({}, { monthlyCycles: 1, upfrontPaid: false })).toBe(PRICES.selfServe.monthlyPence));

  const dfy = {
    family_type: "dfy",
    deposit_pence: 15_001,
    deposit_paid_at: "2026-10-01T00:00:00Z",
    balance_pence: 99_999,
    bill_paid_at: "2026-10-20T00:00:00Z",
  };
  it("dfy: deposit + balance, each only once paid (the row's own pence)", () => {
    expect(cumulativeSpendPence(dfy, none)).toBe(15_001 + 99_999);
    expect(cumulativeSpendPence({ ...dfy, bill_paid_at: null }, none)).toBe(15_001);
    expect(cumulativeSpendPence({ ...dfy, deposit_paid_at: null }, none)).toBe(99_999);
    expect(cumulativeSpendPence({ ...dfy, deposit_paid_at: null, bill_paid_at: null }, none)).toBe(0);
  });
  it("dfy: null pence counts as 0, and self-serve cycles are ignored", () => {
    expect(cumulativeSpendPence({ ...dfy, balance_pence: null }, { monthlyCycles: 4, upfrontPaid: true })).toBe(15_001);
  });
});

