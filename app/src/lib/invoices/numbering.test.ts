/**
 * Invoice numbers (brief §11 Q4: per nanny INV-0001 upward, never reused — the database allocates the sequence).
 * BB-wave1-041126/06a-build, 2026-11-04.
 */
import { describe, expect, it } from "vitest";
import { invoiceNumber } from "./numbering";

describe("invoiceNumber", () => {
  it.each([
    [1, "INV-0001"],
    [3, "INV-0003"],
    [9999, "INV-9999"],
    [10000, "INV-10000"],
  ])("%s → %s", (seq, number) => {
    expect(invoiceNumber(seq)).toBe(number);
  });

  it("refuses a sequence the database can't have made", () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => invoiceNumber(bad)).toThrow(RangeError);
  });
});
