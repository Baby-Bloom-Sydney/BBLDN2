/**
 * The invoice's words that both the PDF and the review screen print (plan 06 §14.8; BAI 2026-11-07's three columns),
 * in one client-safe module so the review shows exactly what the PDF will — without bundling the PDF renderer:
 * - From: her name and one address (a limited company's registered office instead of her address).
 * - Business: one name — her trading name when she entered one, else the company's or partnership's — then
 *   "Company no. …" and "VAT no. GB 123 4567 89"; nothing for a sole trader with neither.
 * - Totals: "Childcare", "VAT at 20%" (added) or "Childcare (including VAT)" with "of which VAT at 20%" (included),
 *   "Expenses" when there are any; a VAT rate in basis points as a percent.
 *
 * BB-wave1-041126/06b4, 2026-11-12 (moved unchanged from `pdf/sections/{issuer,totals}.tsx`, which re-export them).
 */
import { describe, expect, it } from "vitest";
import { businessLines, businessName, fromLines, totalsLines, vatRateLabel } from "./invoice-text";
import * as issuerSection from "./pdf/sections/issuer";
import * as totalsSection from "./pdf/sections/totals";

const SOLE = {
  businessType: "sole_trader" as const, name: "Sophie Taylor", tradingName: "Sophie Taylor", address: "1 Upper Street\nLondon\nN1 0AA",
  companyName: null, companyNumber: null, registeredOffice: null, partnershipName: null, vatNumber: null,
};
const LTD = {
  ...SOLE, businessType: "limited_company" as const, tradingName: "Sophie Taylor", companyName: "Little Steps Ltd", companyNumber: "12345678",
  registeredOffice: "2 Office Row\nLondon\nEC1A 1AA", address: "2 Office Row\nLondon\nEC1A 1AA", vatNumber: "GB123456789",
};

describe("the parties", () => {
  it("a sole trader with no trading name: From only", () => {
    expect(fromLines(SOLE)).toEqual(["Sophie Taylor", "1 Upper Street\nLondon\nN1 0AA"]);
    expect(businessName(SOLE)).toBeNull();
    expect(businessLines(SOLE)).toEqual([]);
  });

  it("a limited company: its registered office as the address; its name, number and VAT number", () => {
    expect(fromLines({ ...LTD, address: "" })).toEqual(["Sophie Taylor", "2 Office Row\nLondon\nEC1A 1AA"]);
    expect(businessName(LTD)).toBe("Little Steps Ltd");
    expect(businessLines(LTD)).toEqual(["Company no. 12345678", "VAT no. GB 123 4567 89"]);
  });

  it("a trading name she entered replaces the registered name; no address yet leaves her name only", () => {
    expect(businessName({ ...LTD, tradingName: "Little Steps" })).toBe("Little Steps");
    expect(businessName({ ...SOLE, businessType: "partnership", partnershipName: "Taylor & Co" })).toBe("Taylor & Co");
    expect(fromLines({ ...SOLE, address: "" })).toEqual(["Sophie Taylor"]);
  });
});

describe("the totals", () => {
  const base = { shiftsPence: 58_400, expensesPence: 1_250 };
  it("per VAT mode; expenses only when there are any", () => {
    expect(totalsLines({ ...base, vat: { mode: "none", rateBp: null, pence: 0 } })).toEqual([
      { label: "Childcare", pence: 58_400 }, { label: "Expenses", pence: 1_250 },
    ]);
    expect(totalsLines({ ...base, vat: { mode: "added", rateBp: 2000, pence: 11_680 } })).toEqual([
      { label: "Childcare", pence: 58_400 }, { label: "VAT at 20%", pence: 11_680 }, { label: "Expenses", pence: 1_250 },
    ]);
    expect(totalsLines({ shiftsPence: 58_400, expensesPence: 0, vat: { mode: "included", rateBp: 1750, pence: 8_698 } })).toEqual([
      { label: "Childcare (including VAT)", pence: 58_400 }, { label: "of which VAT at 17.5%", pence: 8_698 },
    ]);
  });

  it("a rate as a percent", () => {
    expect([vatRateLabel(2000), vatRateLabel(1750), vatRateLabel(1)]).toEqual(["20%", "17.5%", "0.01%"]);
  });
});

describe("one copy: the PDF sections print with these very functions", () => {
  it("re-exported unchanged", () => {
    expect(issuerSection.fromLines).toBe(fromLines);
    expect(issuerSection.businessName).toBe(businessName);
    expect(issuerSection.businessLines).toBe(businessLines);
    expect(totalsSection.vatRateLabel).toBe(vatRateLabel);
  });
});
