/**
 * Invoice money (plan 06 step 4; R23: the guarantees page's `formatPence`, imported, not copied).
 * BB-wave1-041126/06a-build, 2026-11-04.
 */
import { describe, expect, it } from "vitest";
import { formatPence } from "@/app/admin/guarantees/format";
import { formatHours, formatInvoiceMoney, invoiceTotalPence, poundsToPence } from "./money";

describe("invoiceTotalPence", () => {
  it("is hours × rate in whole pence (brief §0.3: 30 h × 1800 p = 54000 p)", () => {
    expect(invoiceTotalPence(30, 1800)).toBe(54000);
    expect(invoiceTotalPence(28, 1800)).toBe(50400);
    expect(invoiceTotalPence(4, 1800)).toBe(7200);
  });

  it("rounds a half penny up, as Postgres round() does (amendment 21's total CHECK)", () => {
    expect(invoiceTotalPence(0.5, 1801)).toBe(901);
    expect(invoiceTotalPence(37.5, 1999)).toBe(74963);
  });

  it("refuses hours or a rate that can't make an invoice (hours only in half steps, as the database's round() assumes)", () => {
    for (const [h, r] of [[0, 1800], [-1, 1800], [Number.NaN, 1800], [30, 0], [30, 18.5], [Number.POSITIVE_INFINITY, 1800], [0.25, 1800], [30.1, 1800]]) {
      expect(() => invoiceTotalPence(h, r)).toThrow(RangeError);
    }
  });
});

describe("poundsToPence (the placement and position rates are pounds, numeric)", () => {
  it.each([
    [18, 1800],
    ["18.00", 1800],
    [17.5, 1750],
    ["20.555", 2056],
    [19.99, 1999],
  ])("%s → %s", (pounds, pence) => {
    expect(poundsToPence(pounds)).toBe(pence);
  });

  it("is null when there's no usable rate (the form then asks for one)", () => {
    for (const bad of [null, undefined, "", "abc", Number.NaN, -5, 0]) expect(poundsToPence(bad)).toBeNull();
  });
});

describe("formatInvoiceMoney", () => {
  it("is the guarantees page's formatPence (one money format in the app)", () => {
    expect(formatInvoiceMoney).toBe(formatPence);
    expect(formatInvoiceMoney(54000)).toBe(formatPence(54000));
    expect(formatInvoiceMoney(54000)).toMatch(/^£540\.00$/);
  });
});

describe("formatHours", () => {
  it("prints whole and half hours without trailing zeros", () => {
    expect(formatHours(30)).toBe("30");
    expect(formatHours(0.5)).toBe("0.5");
    expect(formatHours(37.5)).toBe("37.5");
  });
});
