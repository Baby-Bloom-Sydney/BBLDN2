/**
 * The Business section's view of who she is on her invoices (plan 06 §14.6 b3.3; brief §0a B, C): pure helpers that
 * turn her effective issuer (`readIssuer`, defaults included) into what the screen shows and back into what a save
 * sends. The defaults are shown with their source (06b-2 handoff); a limited company's registered office is its one
 * address (BAI 2026-11-07); a trading name she enters replaces the business's name.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */
import { describe, expect, it } from "vitest";
import type { Issuer } from "@/lib/invoices/store-map-lines";
import { businessDetailsSchema } from "@/lib/invoices/validation-business";
import {
  bankSummary,
  businessTypeLabel,
  fieldIssues,
  percentText,
  saveInput,
  toBankView,
  toBusinessView,
  vatSummary,
  type BusinessView,
} from "./business-view";

const DEFAULTS: Issuer = {
  businessType: "sole_trader", name: "Sophie Taylor", tradingName: "Sophie Taylor", tradingNameSource: "name",
  address: "1 Upper Street\nLondon\nN1 0AA", addressSource: "verification", companyName: null, companyNumber: null,
  registeredOffice: null, partnershipName: null, vat: { mode: "none", rateBp: null, number: null },
};
const LTD: Issuer = {
  ...DEFAULTS, businessType: "limited_company", tradingName: "Little Steps", tradingNameSource: "business",
  address: "9 Home Lane\nLondon\nE8 1AA", addressSource: "business", companyName: "Taylor Childcare Ltd",
  companyNumber: "SC123456", registeredOffice: "2 Office Row\nLondon\nEC1A 1AA",
  vat: { mode: "added", rateBp: 2000, number: "GB123456789" },
};

describe("toBusinessView", () => {
  it("zero setup: a sole trader under her own name (not entered), her verification address, not VAT registered", () => {
    expect(toBusinessView(DEFAULTS)).toEqual({
      businessType: "sole_trader", name: "Sophie Taylor", tradingName: null, address: "1 Upper Street\nLondon\nN1 0AA",
      addressSource: "verification", companyName: null, companyNumber: null, registeredOffice: null, partnershipName: null,
      vatMode: "none", vatNumber: null, vatRateBp: null,
    });
  });

  it("keeps what she entered", () => {
    const v = toBusinessView(LTD);
    expect(v).toMatchObject({ tradingName: "Little Steps", address: "9 Home Lane\nLondon\nE8 1AA", addressSource: "business" });
    expect(v).toMatchObject({ companyName: "Taylor Childcare Ltd", companyNumber: "SC123456", vatMode: "added", vatRateBp: 2000 });
  });

  it("carries no field the screen doesn't need (pinned)", () => {
    expect(Object.keys(toBusinessView(LTD)).sort()).toEqual([
      "address", "addressSource", "businessType", "companyName", "companyNumber", "name", "partnershipName",
      "registeredOffice", "tradingName", "vatMode", "vatNumber", "vatRateBp",
    ]);
  });
});

describe("toBankView and bankSummary", () => {
  it("none saved → null → 'Not added yet'", () => {
    expect(toBankView(null)).toBeNull();
    expect(bankSummary(null)).toBe("Not added yet");
  });

  it("masks only, whatever the read carried", () => {
    const masked = { accountName: "Sophie Taylor", sortCodeLast2: "33", accountLast4: "4321", updatedAt: "2027-02-15T10:00:00.000Z" };
    const bank = toBankView({ ...masked, sortCode: "112233", accountNumber: "87654321" } as typeof masked);
    expect(bank).toEqual({ accountName: "Sophie Taylor", sortCodeLast2: "33", accountLast4: "4321" });
    expect(bankSummary(bank)).toBe("Sophie Taylor · sort code ••-••-33, account ending 4321");
  });
});

describe("labels", () => {
  it("business types", () => {
    expect(businessTypeLabel("sole_trader")).toBe("Sole trader");
    expect(businessTypeLabel("limited_company")).toBe("Limited company");
    expect(businessTypeLabel("partnership")).toBe("Partnership");
  });

  it.each([[2000, "20"], [1750, "17.5"], [505, "5.05"], [1, "0.01"], [1000, "10"]])("percentText(%i) = %s", (bp, text) => {
    expect(percentText(bp)).toBe(text);
  });

  it("VAT: not registered; included (the default); added on top — with the number as it prints", () => {
    const view = (over: Partial<BusinessView>): BusinessView => ({ ...toBusinessView(DEFAULTS), ...over });
    expect(vatSummary(view({}))).toEqual({ value: "Not VAT registered", caption: null });
    expect(vatSummary(view({ vatMode: "included", vatRateBp: 2000, vatNumber: "GB123456789" }))).toEqual({
      value: "VAT included in my rates · 20%", caption: "VAT no. GB 123 4567 89",
    });
    expect(vatSummary(view({ vatMode: "added", vatRateBp: 500, vatNumber: "GB123456789012" }))).toEqual({
      value: "VAT added on top · 5%", caption: "VAT no. GB 123 4567 89 012",
    });
  });
});

describe("saveInput", () => {
  it("re-sends what she has, with blanks for the defaults, so a save changes only what a dialog changed", () => {
    expect(saveInput(toBusinessView(DEFAULTS))).toEqual({
      businessType: "sole_trader", tradingName: "", businessAddress: "", companyName: "", companyNumber: "",
      registeredOffice: "", partnershipName: "", vatMode: "none", vatNumber: "", vatRate: "",
    });
    const parsed = businessDetailsSchema.parse(saveInput(toBusinessView(LTD)));
    expect(parsed).toEqual({
      businessType: "limited_company", tradingName: "Little Steps", businessAddress: "9 Home Lane\nLondon\nE8 1AA",
      companyName: "Taylor Childcare Ltd", companyNumber: "SC123456", registeredOffice: "2 Office Row\nLondon\nEC1A 1AA",
      partnershipName: null, vatMode: "added", vatNumber: "GB123456789", vatRateBp: 2000,
    });
  });

  it("the defaults re-sent are still defaults (null), never her name or verification address stored as her own", () => {
    expect(businessDetailsSchema.parse(saveInput(toBusinessView(DEFAULTS)))).toMatchObject({ tradingName: null, businessAddress: null });
  });

  it("a patch overrides only its fields", () => {
    expect(saveInput(toBusinessView(DEFAULTS), { tradingName: "Little Steps" })).toMatchObject({
      businessType: "sole_trader", tradingName: "Little Steps", businessAddress: "",
    });
  });
});

describe("fieldIssues", () => {
  it("the first plain message per field, never what she typed", () => {
    const parsed = businessDetailsSchema.safeParse({ ...saveInput(toBusinessView(DEFAULTS)), businessType: "limited_company", companyNumber: "<b>12</b>" });
    if (parsed.success) throw new Error("expected a refusal");
    const issues = fieldIssues(parsed.error);
    expect(issues.companyName).toBe("Enter the company's registered name");
    expect(issues.companyNumber).toBe("Enter the company number — 8 characters, like 12345678 or SC123456");
    expect(issues.registeredOffice).toBe("Enter the registered office address");
    expect(JSON.stringify(issues)).not.toContain("<b>");
  });

  it("an issue with no field path files under 'form'", () => {
    const parsed = businessDetailsSchema.safeParse("nonsense");
    if (parsed.success) throw new Error("expected a refusal");
    expect(Object.keys(fieldIssues(parsed.error))).toEqual(["form"]);
  });
});
