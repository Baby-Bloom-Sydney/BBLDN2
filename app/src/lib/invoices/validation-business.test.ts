/**
 * Her business details (plan 06 §14.3–14.4, b2.3; brief §0a B): a union by type — a limited company needs its name,
 * number and registered office; a partnership its name; fields that don't apply are set to null. Trading, company
 * and partnership names are never BabyBloom (R8). The company and VAT numbers are normalised (spaces stripped,
 * upper-cased, "GB" added); the VAT rate is typed as a percent with up to 2 decimals and stored in basis points, 20%
 * unless she changes it. No message echoes what was typed.
 * 06b-3 rework (ledger B06 §9.1 R2, R6): no business address (her address is her profile's); the VAT-mode message's
 * wording.
 *
 * BB-wave1-041126/06b2-build, 2026-11-06; BB-wave1-041126/06b3-rework, 2026-11-09.
 */
import { describe, expect, it } from "vitest";
import { BUSINESS_MESSAGES as B, businessDetailsSchema } from "./validation-business";
import { VALIDATION_MESSAGES as V } from "./validation";

const SOLE = { businessType: "sole_trader", vatMode: "none" };
const LTD = {
  businessType: "limited_company",
  companyName: "Taylor Childcare Ltd",
  companyNumber: "12345678",
  registeredOffice: "1 Upper Street\nLondon N1 0AA",
  vatMode: "added",
  vatNumber: "GB123456789",
  vatRate: "20",
};
const NONE_FIELDS = { tradingName: null, companyName: null, companyNumber: null, registeredOffice: null, partnershipName: null };

function messagesOf(value: unknown): string[] {
  const result = businessDetailsSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((i) => i.message);
}

describe("businessDetailsSchema — the defaults and each type", () => {
  it("a sole trader with nothing else is the zero-setup default", () => {
    expect(businessDetailsSchema.parse(SOLE)).toEqual({ businessType: "sole_trader", ...NONE_FIELDS, vatMode: "none", vatNumber: null, vatRateBp: null });
  });

  it("keeps a trading name, trimmed; a blank one is none", () => {
    expect(businessDetailsSchema.parse({ ...SOLE, tradingName: "  Taylor Childcare " })).toMatchObject({ tradingName: "Taylor Childcare" });
    expect(businessDetailsSchema.parse({ ...SOLE, tradingName: "   " })).toMatchObject({ tradingName: null });
  });

  it("holds no address: hers is her profile's, so a business address sent anyway is dropped (06b-3 rework R2)", () => {
    const parsed = businessDetailsSchema.parse({ ...SOLE, businessAddress: "1 Upper Street\nLondon N1 0AA" });
    expect(parsed).not.toHaveProperty("businessAddress");
    expect(Object.keys(parsed).sort()).toEqual([
      "businessType", "companyName", "companyNumber", "partnershipName", "registeredOffice", "tradingName", "vatMode", "vatNumber", "vatRateBp",
    ]);
  });

  it("a limited company carries its three fields, its number normalised", () => {
    expect(businessDetailsSchema.parse({ ...LTD, companyNumber: " sc 123 456 " })).toEqual({
      businessType: "limited_company", tradingName: null, companyName: "Taylor Childcare Ltd",
      companyNumber: "SC123456", registeredOffice: "1 Upper Street\nLondon N1 0AA", partnershipName: null,
      vatMode: "added", vatNumber: "GB123456789", vatRateBp: 2000,
    });
  });

  it("a partnership carries its name; fields that don't apply are set to null", () => {
    const parsed = businessDetailsSchema.parse({ ...LTD, businessType: "partnership", partnershipName: "Taylor & Shah", vatMode: "none" });
    expect(parsed).toEqual({ businessType: "partnership", ...NONE_FIELDS, partnershipName: "Taylor & Shah", vatMode: "none", vatNumber: null, vatRateBp: null });
    const sole = businessDetailsSchema.parse({ ...LTD, businessType: "sole_trader", partnershipName: "x" });
    expect(sole).toMatchObject({ companyName: null, companyNumber: null, registeredOffice: null, partnershipName: null });
  });

  it.each([
    ["a limited company without its name", { ...LTD, companyName: "" }, B.companyName],
    ["a limited company without its number", { ...LTD, companyNumber: undefined }, B.companyNumber],
    ["a limited company without its registered office", { ...LTD, registeredOffice: "  " }, B.registeredOffice],
    ["a company number of 7 digits", { ...LTD, companyNumber: "1234567" }, B.companyNumber],
    ["a company number of letters only", { ...LTD, companyNumber: "ABCDEFGH" }, B.companyNumber],
    ["a partnership without its name", { ...SOLE, businessType: "partnership" }, B.partnershipName],
    ["an unknown business type", { ...SOLE, businessType: "charity" }, B.businessType],
    ["a company name of 161 characters", { ...LTD, companyName: "c".repeat(161) }, V.tooLong],
    ["a trading name of 71 characters", { ...SOLE, tradingName: "t".repeat(71) }, V.tooLong],
    ["a trading name over two lines", { ...SOLE, tradingName: "Taylor\nChildcare" }, V.oneLine],
    ["a registered office of 201 characters", { ...LTD, registeredOffice: "a".repeat(201) }, V.tooLong],
    ["a registered office with a line separator", { ...LTD, registeredOffice: `1 Upper Street${String.fromCodePoint(0x2028)}London` }, V.oneLine],
  ])("refuses %s", (_label, value, message) => {
    expect(messagesOf(value)).toContain(message);
  });
});

describe("businessDetailsSchema — BabyBloom is never a party on her invoice (R8)", () => {
  const forms = ["BabyBloom", "Baby Bloom Nannies", "baby  bloom", "BABYBLOOM childcare", "ＢａｂｙＢｌｏｏｍ"];
  it.each(forms)("refuses %s as a trading, company or partnership name", (name) => {
    expect(messagesOf({ ...SOLE, tradingName: name })).toContain(V.ownName);
    expect(messagesOf({ ...LTD, companyName: name })).toContain(V.ownName);
    expect(messagesOf({ ...SOLE, businessType: "partnership", partnershipName: name })).toContain(V.ownName);
  });
});

describe("businessDetailsSchema — VAT", () => {
  it("registered: the number normalised (spaces and hyphens stripped, upper-cased, GB added), 20% unless she changes it", () => {
    expect(businessDetailsSchema.parse({ ...SOLE, vatMode: "included", vatNumber: "gb 123 4567 89" })).toMatchObject({
      vatMode: "included", vatNumber: "GB123456789", vatRateBp: 2000,
    });
    expect(businessDetailsSchema.parse({ ...SOLE, vatMode: "added", vatNumber: "123-4567-89012", vatRate: 17.5 })).toMatchObject({
      vatNumber: "GB123456789012", vatRateBp: 1750,
    });
    expect(businessDetailsSchema.parse({ ...SOLE, vatMode: "added", vatNumber: "GB123456789", vatRate: "5.00" })).toMatchObject({ vatRateBp: 500 });
    expect(businessDetailsSchema.parse({ ...SOLE, vatMode: "added", vatNumber: "GB123456789", vatRate: "0.01" })).toMatchObject({ vatRateBp: 1 });
    expect(businessDetailsSchema.parse({ ...SOLE, vatMode: "added", vatNumber: "GB123456789", vatRate: "" })).toMatchObject({ vatRateBp: 2000 });
  });

  it("not registered: any number or rate typed is dropped", () => {
    expect(businessDetailsSchema.parse({ ...SOLE, vatMode: "none", vatNumber: "GB123456789", vatRate: "20" })).toMatchObject({
      vatMode: "none", vatNumber: null, vatRateBp: null,
    });
  });

  it.each([
    ["registered without a number", { ...SOLE, vatMode: "added" }, B.vatNumber],
    ["a number of 8 digits", { ...SOLE, vatMode: "added", vatNumber: "GB12345678" }, B.vatNumber],
    ["a number from another country", { ...SOLE, vatMode: "added", vatNumber: "IE1234567T" }, B.vatNumber],
    ["a rate of 0%", { ...SOLE, vatMode: "added", vatNumber: "GB123456789", vatRate: "0" }, B.vatRate],
    ["a rate of 20.01%", { ...SOLE, vatMode: "added", vatNumber: "GB123456789", vatRate: "20.01" }, B.vatRate],
    ["a rate of 200%", { ...SOLE, vatMode: "added", vatNumber: "GB123456789", vatRate: 200 }, B.vatRate],
    ["a rate with 3 decimals", { ...SOLE, vatMode: "added", vatNumber: "GB123456789", vatRate: "17.125" }, B.vatRate],
    ["a rate in words", { ...SOLE, vatMode: "added", vatNumber: "GB123456789", vatRate: "twenty" }, B.vatRate],
    ["an unknown VAT mode", { ...SOLE, vatMode: "reverse" }, B.vatMode],
  ])("refuses %s", (_label, value, message) => {
    expect(messagesOf(value)).toContain(message);
  });
});

describe("the plain messages (06b-3 rework R6)", () => {
  it("the VAT-mode and own-name messages read as BAI agreed", () => {
    expect(B.vatMode).toBe("Choose whether VAT is included in your rates or added to them");
    expect(V.ownName).toBe("Enter your own name or business name.");
  });
});

describe("no message echoes what was typed", () => {
  it("even when everything is wrong", () => {
    const all = messagesOf({
      businessType: "limited_company", tradingName: "Secret Trading 4321\n", companyName: "c".repeat(170), companyNumber: "XYZ987",
      registeredOffice: 7, vatMode: "added", vatNumber: "GB999", vatRate: "37.777",
    }).join(" | ");
    expect(all).not.toMatch(/Secret|4321|XYZ|987|GB999|37\.7|ccccc/);
  });
});
