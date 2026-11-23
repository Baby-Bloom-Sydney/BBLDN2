/**
 * `config/invoices.ts` holds every limit of the nanny invoice generator (brief 06 §0a A–B, §11 Q4, Q11; plan 06 §14.3),
 * inside `config/` so the money-literal spec holds. Pins the values (each a typo guard with the database's CHECK as
 * its backstop at the same value: amendment 21's harness header lists them), the labels, and that nothing changes
 * at run time. The rate is no longer tied to the profile's hourly bounds: any rate is hers (§0a A, replacing Q5).
 *
 * 06b-4 rework (BAI 2026-11-12): no week, so the line counts are a page-size bound (100 shifts, 40 expenses) and the
 * hours backstop is 100 shifts of 24 hours.
 *
 * 06c (plan 06 step 17): `/admin/invoices` shows the newest 500 invoices (the `/admin/guarantees` precedent).
 *
 * BB-wave1-041126/06a-build, 2026-11-04; BB-wave1-041126/06b2-build, 2026-11-06; BB-wave1-041126/06b4-server, 2026-11-12;
 * BB-wave1-041126/06c, 2026-11-23.
 */
import { describe, expect, it } from "vitest";
import { BASIS_POINTS, BASIS_POINTS_PER_PERCENT, BUSINESS_TYPES, EXPENSE_TYPES, INVOICE_RULES, NO_PENCE } from "./invoices";

describe("INVOICE_RULES", () => {
  it("pins the numbering, cap and link defaults (brief §11 Q4, Q11; plan R1; BAI 2026-11-04)", () => {
    expect(INVOICE_RULES.dailySendCap).toBe(10);
    expect(INVOICE_RULES.pdfLinkSeconds).toBe(60);
    expect(INVOICE_RULES.numberPrefix).toBe("BB");
    expect(INVOICE_RULES.numberPad).toBe(4);
    expect(INVOICE_RULES.numberNameMax).toBe(30);
    expect(INVOICE_RULES.numberNameFallback).toBe("Nanny");
    expect(INVOICE_RULES.numberMaxLength).toBe(52);
    expect(INVOICE_RULES.staleSendingMinutes).toBe(10);
  });

  it("pins the admin list's length: the newest 500 (06c; the /admin/guarantees precedent)", () => {
    expect(INVOICE_RULES.adminListLimit).toBe(500);
  });

  it("pins the typo-guard ceilings of plan 14.3 (the database repeats each)", () => {
    expect(INVOICE_RULES.hourStep).toBe(0.25);
    expect(INVOICE_RULES.maxShiftHours).toBe(24);
    expect(INVOICE_RULES.maxHours).toBe(2_400);
    expect(INVOICE_RULES.ratePence).toEqual({ min: 1, max: 25_000 });
    expect(INVOICE_RULES.expensePence).toEqual({ min: 1, max: 100_000 });
    expect(INVOICE_RULES.maxShiftLines).toBe(100);
    expect(INVOICE_RULES.maxExpenseLines).toBe(40);
    expect(INVOICE_RULES.vatRateBp).toEqual({ default: 2_000, min: 1, max: 2_000 });
  });

  it("limits what prints on her invoice (plan §9 surface 5, 14.3)", () => {
    expect(INVOICE_RULES.text).toEqual({
      accountNameMax: 70,
      tradingNameMax: 70,
      addressMax: 200,
      descriptionMax: 120,
      companyNameMax: 160,
      partnershipNameMax: 160,
      addressMaxLines: 6,
    });
  });

  it("whole quarter hours fit a shift, so a line is always a whole number of quarter pence (14.5)", () => {
    expect(1 / INVOICE_RULES.hourStep).toBe(4);
    expect(Number.isInteger(INVOICE_RULES.maxShiftHours / INVOICE_RULES.hourStep)).toBe(true);
    // the hours backstop is every shift line at its most (BAI 2026-11-12: 24 × 100)
    expect(INVOICE_RULES.maxHours).toBe(INVOICE_RULES.maxShiftLines * INVOICE_RULES.maxShiftHours);
    // the largest invoice stays far inside a Postgres integer, and the VAT sum exact in a JS number (14.5 "Range")
    const largest = INVOICE_RULES.maxHours * INVOICE_RULES.ratePence.max * 2 + INVOICE_RULES.maxExpenseLines * INVOICE_RULES.expensePence.max;
    expect(largest).toBeLessThan(2 ** 31 - 1);
    expect(INVOICE_RULES.maxHours * INVOICE_RULES.ratePence.max * INVOICE_RULES.vatRateBp.max * 2).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it("caps the lines at 100 shifts and 40 expenses, 140 in all (a page-size bound, not a period rule)", () => {
    expect(INVOICE_RULES.maxShiftLines + INVOICE_RULES.maxExpenseLines).toBe(140);
  });

  it("is frozen at every level", () => {
    expect(Object.isFrozen(INVOICE_RULES)).toBe(true);
    expect(Object.isFrozen(INVOICE_RULES.ratePence)).toBe(true);
    expect(Object.isFrozen(INVOICE_RULES.expensePence)).toBe(true);
    expect(Object.isFrozen(INVOICE_RULES.vatRateBp)).toBe(true);
    expect(Object.isFrozen(INVOICE_RULES.text)).toBe(true);
  });
});

describe("the named constants and labels", () => {
  it("NO_PENCE is the zero sums start from (plan R10); BASIS_POINTS is 100% (14.3)", () => {
    expect(NO_PENCE).toBe(0);
    expect(BASIS_POINTS).toBe(10_000);
    expect(BASIS_POINTS_PER_PERCENT).toBe(BASIS_POINTS / 100);
  });

  it("lists the five expense types and the three business types, in order, with their labels (§0a A, B)", () => {
    expect(Object.entries(EXPENSE_TYPES)).toEqual([
      ["food", "Food"],
      ["activities", "Activities"],
      ["travel", "Travel"],
      ["supplies", "Supplies"],
      ["other", "Other"],
    ]);
    expect(Object.entries(BUSINESS_TYPES)).toEqual([
      ["sole_trader", "Sole trader"],
      ["limited_company", "Limited company"],
      ["partnership", "Partnership"],
    ]);
    expect(Object.isFrozen(EXPENSE_TYPES) && Object.isFrozen(BUSINESS_TYPES)).toBe(true);
  });
});
