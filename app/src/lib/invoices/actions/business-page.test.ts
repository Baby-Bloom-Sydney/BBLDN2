/**
 * The Business page's one Save (ledger B06 §9.1 R4, R5): what the page sends — only the records she changed, each with
 * the version she loaded — and the check the page and `saveBusinessSettings` both run before anything is written:
 * the business schema, her address (required unless a limited company; on file counts), and her bank details (all
 * three once added). Every refusal is by field, with the shared schemas' plain messages.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */
import { describe, expect, it } from "vitest";
import { PROFILE_MESSAGES } from "@/lib/settings/nanny-profile-rules";
import { BUSINESS_MESSAGES as B } from "../validation-business";
import { VALIDATION_MESSAGES as V } from "../validation";
import { businessPageInput, checkBusinessPage, fieldIssues, sameAsOwnName } from "./business-page";

const SOLE = {
  businessType: "sole_trader", tradingName: "", companyName: "", companyNumber: "", registeredOffice: "", partnershipName: "",
  vatMode: "none", vatNumber: "", expectedUpdatedAt: null,
};
const HOME = { line1: "1 Upper Street", line2: "", town: "London", postcode: "N1 0AA", expectedUpdatedAt: "2027-02-15T10:00:00.123456+00:00" };
const BANK = { accountName: "Sophie Taylor", sortCode: "11-22-33", accountNumber: "87654321", expectedUpdatedAt: null };

describe("businessPageInput (the envelope the action accepts)", () => {
  it("takes any of the three records, each with its version", () => {
    expect(businessPageInput.safeParse({ business: SOLE, address: HOME, bank: BANK }).success).toBe(true);
    expect(businessPageInput.safeParse({}).success).toBe(true);
  });

  it.each([
    ["not an object", "x"],
    ["a record without its version", { bank: { accountName: "a", sortCode: "1", accountNumber: "1" } }],
    ["a field that isn't text", { business: { ...SOLE, tradingName: 7 } }],
    ["text far beyond any field's limit", { business: { ...SOLE, tradingName: "t".repeat(2001) } }],
  ])("refuses %s", (_label, value) => {
    expect(businessPageInput.safeParse(value).success).toBe(false);
  });

  it("drops anything else (a nanny id, a rate)", () => {
    const parsed = businessPageInput.parse({ business: { ...SOLE, vatRate: "5", nannyId: "x" }, nannyId: "x" });
    expect(parsed).toEqual({ business: SOLE });
  });
});

describe("checkBusinessPage", () => {
  it("nothing to fix → {}", () => {
    expect(checkBusinessPage({ business: SOLE, address: HOME, bank: BANK }, false)).toEqual({});
  });

  it("the business schema's refusals, by field (a limited company without its three fields)", () => {
    expect(checkBusinessPage({ business: { ...SOLE, businessType: "limited_company" } }, true)).toEqual({
      companyName: B.companyName, companyNumber: B.companyNumber, registeredOffice: B.registeredOffice,
    });
  });

  it("VAT registered needs its number; the rate is never asked (always 20%)", () => {
    expect(checkBusinessPage({ business: { ...SOLE, vatMode: "included" } }, true)).toEqual({ vatNumber: B.vatNumber });
    expect(checkBusinessPage({ business: { ...SOLE, vatMode: "added", vatNumber: "GB 123 4567 89" } }, true)).toEqual({});
  });

  it("an address is required for a sole trader or partnership: picked now, or on file", () => {
    expect(checkBusinessPage({ business: SOLE }, false)).toEqual({ address: PROFILE_MESSAGES.address });
    expect(checkBusinessPage({ business: { ...SOLE, businessType: "partnership", partnershipName: "Taylor & Shah" } }, false))
      .toEqual({ address: PROFILE_MESSAGES.address });
    expect(checkBusinessPage({ business: SOLE }, true)).toEqual({});
    expect(checkBusinessPage({ business: SOLE, address: HOME }, false)).toEqual({});
  });

  it("a limited company needs no address of hers: its registered office is its address", () => {
    const ltd = { ...SOLE, businessType: "limited_company", companyName: "Taylor Ltd", companyNumber: "12345678", registeredOffice: "1 Upper Street" };
    expect(checkBusinessPage({ business: ltd }, false)).toEqual({});
  });

  it("an address sent is checked like Profile's", () => {
    expect(checkBusinessPage({ address: { ...HOME, line1: "" } }, true)).toEqual({ address: PROFILE_MESSAGES.address });
  });

  it("bank details: all three, each refusal by field", () => {
    expect(checkBusinessPage({ bank: { ...BANK, sortCode: "", accountNumber: "" } }, true)).toEqual({ sortCode: V.sortCode, accountNumber: V.accountNumber });
    expect(checkBusinessPage({ bank: { ...BANK, accountName: " " } }, true)).toEqual({ accountName: V.accountName });
  });
});

describe("sameAsOwnName (R5: her own name as a trading name is saved as none)", () => {
  it("matches trimmed, spaces collapsed, in any case", () => {
    expect(sameAsOwnName("  sophie   TAYLOR ", "Sophie", "Taylor")).toBe(true);
    expect(sameAsOwnName("Sophie Taylor Childcare", "Sophie", "Taylor")).toBe(false);
    expect(sameAsOwnName("", "Sophie", "Taylor")).toBe(false);
    expect(sameAsOwnName("Sophie", "Sophie", "")).toBe(true);
  });
});

describe("fieldIssues", () => {
  it("the first message for each field", () => {
    const parsed = businessPageInput.safeParse({ business: { ...SOLE, tradingName: 1, vatMode: 2 } });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(Object.keys(fieldIssues(parsed.error))).toEqual(["business"]);
  });
});
