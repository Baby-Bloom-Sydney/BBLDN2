/** 4c — the "Payment due" counter/filter predicate (brief step 7). BB-LDN-4c-151026. */
import { describe, expect, it } from "vitest";
import { isPaymentDue } from "./types";

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
