/**
 * `config/invoices.ts` holds every limit of the nanny invoice generator (brief 06 §11 Q4–Q6, Q11; plan 06 step 2),
 * inside `config/` so the money-literal spec holds. Pins the values and the rate bounds' tie to the profile bounds.
 *
 * BB-wave1-041126/06a-build, 2026-11-04.
 */
import { describe, expect, it } from "vitest";
import { HOURLY_RATE_BOUNDS } from "@/lib/constants";
import { INVOICE_RULES, NO_PENCE } from "./invoices";

describe("INVOICE_RULES", () => {
  it("pins the accepted defaults (brief §11 Q4–Q6, Q11; plan R1)", () => {
    expect(INVOICE_RULES.hourStep).toBe(0.5);
    expect(INVOICE_RULES.maxHours).toBe(168);
    expect(INVOICE_RULES.dailySendCap).toBe(10);
    expect(INVOICE_RULES.pdfLinkSeconds).toBe(60);
    expect(INVOICE_RULES.numberPrefix).toBe("INV-");
    expect(INVOICE_RULES.numberPad).toBe(4);
    expect(INVOICE_RULES.staleSendingMinutes).toBe(10);
  });

  it("bounds the rate by the profile's hourly bounds, in pence, so the two can't drift (Q5)", () => {
    expect(INVOICE_RULES.ratePence.min).toBe(HOURLY_RATE_BOUNDS.min * 100);
    expect(INVOICE_RULES.ratePence.max).toBe(HOURLY_RATE_BOUNDS.max * 100);
  });

  it("limits what prints on her invoice (plan §9 surface 5)", () => {
    expect(INVOICE_RULES.text).toEqual({ accountNameMax: 70, tradingNameMax: 70, addressMax: 200 });
  });

  it("whole half-hours fit the maximum, so hours × a whole-pence rate is always a whole or half penny", () => {
    expect(Number.isInteger(INVOICE_RULES.maxHours / INVOICE_RULES.hourStep)).toBe(true);
    expect(1 / INVOICE_RULES.hourStep).toBe(2);
  });

  it("is frozen at every level", () => {
    expect(Object.isFrozen(INVOICE_RULES)).toBe(true);
    expect(Object.isFrozen(INVOICE_RULES.ratePence)).toBe(true);
    expect(Object.isFrozen(INVOICE_RULES.text)).toBe(true);
  });
});

describe("NO_PENCE", () => {
  it("is the named zero sums start from (plan R10)", () => {
    expect(NO_PENCE).toBe(0);
  });
});
