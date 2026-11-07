/**
 * Invoice money (plan 06 step 4; R23: the guarantees page's `formatPence`, imported, not copied).
 * BB-wave1-041126/06a-build, 2026-11-04.
 */
import { describe, expect, it } from "vitest";
import { formatPence } from "@/app/admin/guarantees/format";
import { formatHours, formatInvoiceMoney, poundsToPence } from "./money";

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
  it("prints whole, half and quarter hours without trailing zeros", () => {
    expect(formatHours(30)).toBe("30");
    expect(formatHours(0.5)).toBe("0.5");
    expect(formatHours(37.5)).toBe("37.5");
    expect(formatHours(8.75)).toBe("8.75");
    expect(formatHours(0.25)).toBe("0.25");
  });
});
