/**
 * The calculator (plan 06 §14.5): one set of maths for the form, the server, the PDF and the database. Integer pence,
 * half up on integers only (⌊(2a + b) / 2b⌋), VAT once on the childcare subtotal, expenses at cost. The worked
 * figures and the half-penny cases are the same as amendment 21's harness check 18, so JS and SQL agree (A7).
 * Rates are passed positionally (the money-literal rule needs no allow entry in non-test code; here it is a test).
 *
 * BB-wave1-041126/06b2-build, 2026-11-06.
 */
import { describe, expect, it } from "vitest";
import { halfUp, invoiceTotals, lineAmountPence, vatPence, type TotalsLine } from "./totals";

const shift = (hours: number, ratePence: number): TotalsLine => ({ kind: "shift", hours, ratePence });
const expense = (amountPence: number): TotalsLine => ({ kind: "expense", amountPence });

/** The worked example (14.4 harness 5): Mon–Fri 6 h × £18, Wed 2 h × £22 "evening, agreed rate", Activities £12.50. */
const EXAMPLE: readonly TotalsLine[] = [shift(6, 1800), shift(6, 1800), shift(6, 1800), shift(6, 1800), shift(6, 1800), shift(2, 2200), expense(1250)];

describe("halfUp", () => {
  it("rounds a / b to the nearest whole, a half up, on integers", () => {
    expect(halfUp(5, 2)).toBe(3); // 2.5 → 3
    expect(halfUp(7, 2)).toBe(4); // 3.5 → 4
    expect(halfUp(5403, 4)).toBe(1351); // 1350.75
    expect(halfUp(5401, 4)).toBe(1350); // 1350.25
    expect(halfUp(5402, 4)).toBe(1351); // 1350.5
    expect(halfUp(0, 7)).toBe(0);
    expect(halfUp(6000, 12_000)).toBe(1); // 0.5
    expect(halfUp(5999, 12_000)).toBe(0);
  });

  it("refuses anything that isn't a whole a ≥ 0 over a whole b > 0", () => {
    for (const [a, b] of [[1.5, 2], [1, 0], [-1, 2], [1, -2], [Number.NaN, 2], [2 ** 53, 2]]) {
      expect(() => halfUp(a, b)).toThrow(RangeError);
    }
  });
});

describe("lineAmountPence", () => {
  it("is hours × rate to the nearest penny, half up (amendment 21's round(hours × rate_pence))", () => {
    expect(lineAmountPence(6, 1800)).toBe(10_800);
    expect(lineAmountPence(2, 2200)).toBe(4400);
    expect(lineAmountPence(8.75, 1800)).toBe(15_750);
    expect(lineAmountPence(0.5, 1801)).toBe(901); // 900.5
    expect(lineAmountPence(0.25, 1801)).toBe(450); // 450.25
    expect(lineAmountPence(0.25, 12)).toBe(3);
    expect(lineAmountPence(0.25, 40)).toBe(10);
  });

  it("has no float drift: 0.75 h × 1801 p is 1351 p (1350.75), whatever a float product says", () => {
    expect(lineAmountPence(0.75, 1801)).toBe(1351);
    expect(lineAmountPence(1.25, 1999)).toBe(2499); // 2498.75
    expect(lineAmountPence(37.5, 1999)).toBe(74_963); // 74962.5
    expect(lineAmountPence(0.1 + 0.15, 1801)).toBe(450); // 0.25 built by addition is still a quarter
  });

  it("takes a line at every ceiling (24 h × 25,000 p)", () => {
    expect(lineAmountPence(24, 25_000)).toBe(600_000);
    expect(lineAmountPence(0.25, 1)).toBe(0); // a quarter of a penny rounds to nothing, as the database does
  });

  it("refuses hours off the quarter step or not positive, and a rate that isn't whole pence", () => {
    for (const [h, r] of [[0, 1800], [-1, 1800], [0.1, 1800], [6.3, 1800], [Number.NaN, 1800], [Number.POSITIVE_INFINITY, 1800], [6, 18.5], [6, 0], [6, -1]]) {
      expect(() => lineAmountPence(h, r)).toThrow(RangeError);
    }
  });
});

describe("vatPence", () => {
  it("is 0 when she isn't VAT registered", () => {
    expect(vatPence(58_400, "none", null)).toBe(0);
  });

  it("included: the VAT inside the childcare, rounded once (58,400 p at 20% → 9,733 p)", () => {
    expect(vatPence(58_400, "included", 2000)).toBe(9733); // 9733.33
    expect(vatPence(3, "included", 2000)).toBe(1); // ½ p rounds up
    expect(vatPence(1005, "included", 1000)).toBe(91); // 91.36
  });

  it("added: the VAT on top (58,400 p at 20% → 11,680 p)", () => {
    expect(vatPence(58_400, "added", 2000)).toBe(11_680);
    expect(vatPence(10, "added", 500)).toBe(1); // ½ p rounds up
    expect(vatPence(1005, "added", 1000)).toBe(101); // 100.5
    expect(vatPence(180, "added", 1750)).toBe(32); // 31.5: the float 180 × 0.175 is 31.4999… and would round to 31
    expect(vatPence(1351, "added", 500)).toBe(68); // 67.55
  });

  it("refuses a rate outside 1–2,000 bp, a missing rate when registered, and a rate when not", () => {
    expect(() => vatPence(100, "added", 0)).toThrow(RangeError);
    expect(() => vatPence(100, "added", 2001)).toThrow(RangeError);
    expect(() => vatPence(100, "included", null)).toThrow(RangeError);
    expect(() => vatPence(100, "none", 2000)).toThrow(RangeError);
    expect(() => vatPence(100.5, "added", 2000)).toThrow(RangeError);
    expect(() => vatPence(100, "reverse" as "added", 2000)).toThrow(RangeError);
  });
});

describe("invoiceTotals (the 14.5 worked figures)", () => {
  it("sole trader, no VAT: £584.00 + £12.50 = £596.50", () => {
    expect(invoiceTotals(EXAMPLE, { mode: "none", rateBp: null })).toEqual({
      hours: 32,
      shiftsPence: 58_400,
      expensesPence: 1250,
      vatPence: 0,
      netShiftsPence: 58_400,
      totalPence: 59_650,
    });
  });

  it("limited company, VAT added at 20%: £584.00 + £116.80 + £12.50 = £713.30 (expenses carry no VAT)", () => {
    expect(invoiceTotals(EXAMPLE, { mode: "added", rateBp: 2000 })).toEqual({
      hours: 32,
      shiftsPence: 58_400,
      expensesPence: 1250,
      vatPence: 11_680,
      netShiftsPence: 58_400,
      totalPence: 71_330,
    });
  });

  it("VAT included at 20%: total £596.50, of which VAT £97.33", () => {
    expect(invoiceTotals(EXAMPLE, { mode: "included", rateBp: 2000 })).toEqual({
      hours: 32,
      shiftsPence: 58_400,
      expensesPence: 1250,
      vatPence: 9733,
      netShiftsPence: 48_667,
      totalPence: 59_650,
    });
  });

  it("matches the harness's half-penny cases and its 0.75 h × 1801 p + food line", () => {
    expect(invoiceTotals([shift(0.25, 12)], { mode: "included", rateBp: 2000 })).toMatchObject({ totalPence: 3, vatPence: 1 });
    expect(invoiceTotals([shift(0.25, 40)], { mode: "added", rateBp: 500 })).toMatchObject({ shiftsPence: 10, vatPence: 1, totalPence: 11 });
    expect(invoiceTotals([shift(0.75, 1801), expense(999)], { mode: "added", rateBp: 500 })).toMatchObject({
      shiftsPence: 1351, vatPence: 68, expensesPence: 999, totalPence: 2418,
    });
  });

  it("adds hours in quarters, so many quarter-hour shifts sum exactly", () => {
    const quarters = Array.from({ length: 28 }, () => shift(0.25, 1800));
    expect(invoiceTotals(quarters, { mode: "none", rateBp: null }).hours).toBe(7);
    const odd = [shift(0.75, 1800), shift(8.75, 1800), shift(0.5, 1800)];
    expect(invoiceTotals(odd, { mode: "none", rateBp: null }).hours).toBe(10);
  });

  it("at the most lines (28 × 6 h × 25,000 p, 20 × 100,000 p, 20% added) stays a whole, exact number", () => {
    const lines = [...Array.from({ length: 28 }, () => shift(6, 25_000)), ...Array.from({ length: 20 }, () => expense(100_000))];
    expect(invoiceTotals(lines, { mode: "added", rateBp: 2000 })).toEqual({
      hours: 168,
      shiftsPence: 4_200_000,
      expensesPence: 2_000_000,
      vatPence: 840_000,
      netShiftsPence: 4_200_000,
      totalPence: 7_040_000,
    });
  });

  it("no lines is all zeros; an expense that isn't whole pence or is negative throws", () => {
    expect(invoiceTotals([], { mode: "none", rateBp: null })).toEqual({
      hours: 0, shiftsPence: 0, expensesPence: 0, vatPence: 0, netShiftsPence: 0, totalPence: 0,
    });
    expect(() => invoiceTotals([expense(12.5)], { mode: "none", rateBp: null })).toThrow(RangeError);
    expect(() => invoiceTotals([expense(-1)], { mode: "none", rateBp: null })).toThrow(RangeError);
  });
});
