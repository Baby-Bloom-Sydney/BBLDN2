/**
 * The Business page's model (ledger B06 §9.1 R2, R3, R5): pure helpers from her issuer, her bank details and her
 * profile address to the page's rows and edit form, and back to the one Save — only the records she changed, each
 * with the version she loaded, and the whole page for the check.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07; rewritten for edit mode by BB-wave1-041126/06b3-rework, 2026-11-09.
 */
import { describe, expect, it } from "vitest";
import type { Issuer } from "@/lib/invoices/store-map-lines";
import {
  accountNameShown,
  bankRows,
  rebased,
  businessTypeLabel,
  changedParts,
  formFrom,
  toBankView,
  toBusinessView,
  vatChargedLabel,
  wholePage,
  type BusinessForm,
  type BusinessView,
  type Versions,
} from "./business-view";

const SOLE: Issuer = {
  businessType: "sole_trader", name: "Sophie Taylor", tradingName: "Sophie Taylor", tradingNameSource: "name",
  address: "1 Upper Street\nLondon\nN1 0AA", companyName: null, companyNumber: null, registeredOffice: null,
  partnershipName: null, vat: { mode: "none", rateBp: null, number: null }, businessUpdatedAt: null,
};
const LTD: Issuer = {
  ...SOLE, businessType: "limited_company", tradingName: "Little Steps", tradingNameSource: "business",
  address: "2 Office Row\nLondon\nEC1A 1AA", companyName: "Taylor Childcare Ltd", companyNumber: "SC123456",
  registeredOffice: "2 Office Row\nLondon\nEC1A 1AA", vat: { mode: "added", rateBp: 2000, number: "GB123456789" },
  businessUpdatedAt: "2027-02-15T10:00:00.111111+00:00",
};
const HOME = { line1: "1 Upper Street", line2: "", town: "London", postcode: "N1 0AA" };
const BANK = { accountName: "Sophie Taylor", sortCode: "112233", accountNumber: "87654321" };
const VERSIONS: Versions = { business: null, bank: null, home: "2027-02-15T10:00:00.333333+00:00" };

describe("from the reads", () => {
  it("her business details: the trading name only when she entered one", () => {
    expect(toBusinessView(SOLE)).toEqual({
      businessType: "sole_trader", name: "Sophie Taylor", tradingName: null, companyName: null, companyNumber: null,
      registeredOffice: null, partnershipName: null, vatMode: "none", vatNumber: null,
    });
    expect(toBusinessView(LTD)).toMatchObject({ tradingName: "Little Steps", companyNumber: "SC123456", vatMode: "added" });
  });

  it("her bank details in full for her own page; none → null; nothing else carried", () => {
    const read = { ...BANK, updatedAt: "2027-02-15T10:00:00.2+00:00" }; // the Settings read also carries its version
    expect(toBankView(read)).toEqual(BANK);
    expect(toBankView(null)).toBeNull();
  });
});

describe("the rows (R3, R5)", () => {
  it("labels and values as agreed", () => {
    expect(businessTypeLabel("limited_company")).toBe("Limited company");
    expect(vatChargedLabel("included")).toBe("Included in rates");
    expect(vatChargedLabel("added")).toBe("Added to rates");
    expect(bankRows(BANK)).toEqual([
      { label: "Name on account", value: "Sophie Taylor" },
      { label: "Sort code", value: "11-22-33" },
      { label: "Account number", value: "87654321" },
    ]);
  });
});

describe("the edit form", () => {
  it("starts with what is saved; VAT charged defaults to included; bank details as saved", () => {
    const form = formFrom(toBusinessView(LTD), BANK, HOME);
    expect(form).toMatchObject({
      businessType: "limited_company", tradingName: "Little Steps", companyName: "Taylor Childcare Ltd", vatRegistered: true,
      vatCharged: "added", vatNumber: "GB 123 4567 89", home: HOME, accountName: "Sophie Taylor", sortCode: "11-22-33", accountNumber: "87654321",
    });
    expect(formFrom(toBusinessView(SOLE), null, HOME)).toMatchObject({ vatRegistered: false, vatCharged: "included", sortCode: "", accountNumber: "" });
  });

  it("Name on account with none saved: the company's or partnership's name, else hers — until she types her own", () => {
    const view = toBusinessView(SOLE);
    const form = formFrom(view, null, HOME);
    expect(accountNameShown(form, view)).toBe("Sophie Taylor");
    expect(accountNameShown({ ...form, businessType: "limited_company", companyName: "Taylor Ltd" }, view)).toBe("Taylor Ltd");
    expect(accountNameShown({ ...form, businessType: "partnership", partnershipName: "Taylor & Shah" }, view)).toBe("Taylor & Shah");
    expect(accountNameShown({ ...form, accountName: "S Taylor", accountNameTouched: true }, view)).toBe("S Taylor");
    expect(accountNameShown(formFrom(view, { ...BANK, accountName: "Saved Name" }, HOME), view)).toBe("Saved Name");
  });
});

describe("the Save", () => {
  const view = toBusinessView(SOLE);
  const initial = formFrom(view, null, HOME);
  const edit = (patch: Partial<BusinessForm>): BusinessForm => ({ ...initial, ...patch });

  it("nothing changed → nothing to send", () => {
    expect(changedParts(initial, initial, view, null, VERSIONS)).toEqual({});
  });

  it("sends only what changed, each with its version; VAT as mode and number, never a rate", () => {
    const parts = changedParts(edit({ vatRegistered: true, vatNumber: "123 4567 89" }), initial, view, null, VERSIONS);
    expect(parts).toEqual({
      business: {
        businessType: "sole_trader", tradingName: "", companyName: "", companyNumber: "", registeredOffice: "", partnershipName: "",
        vatMode: "included", vatNumber: "123 4567 89", expectedUpdatedAt: null,
      },
    });
  });

  it("fields of another type, or a VAT number when not registered, don't count as changes", () => {
    expect(changedParts(edit({ companyName: "Typed then left" }), initial, view, null, VERSIONS)).toEqual({});
    expect(changedParts(edit({ vatNumber: "GB1" }), initial, view, null, VERSIONS)).toEqual({});
  });

  it("a picked address is sent with her profile's version", () => {
    const home = { line1: "7 New Road", line2: "", town: "London", postcode: "N1 1AA" };
    expect(changedParts(edit({ home }), initial, view, null, VERSIONS)).toEqual({ address: { ...home, expectedUpdatedAt: VERSIONS.home } });
  });

  it("bank details: the pre-filled name alone saves nothing; once a number is typed all three go, with the shown name", () => {
    expect(changedParts(initial, initial, view, null, VERSIONS)).toEqual({});
    expect(changedParts(edit({ sortCode: "20-00-56" }), initial, view, null, VERSIONS)).toEqual({
      bank: { accountName: "Sophie Taylor", sortCode: "20-00-56", accountNumber: "", expectedUpdatedAt: null },
    });
  });

  it("saved bank details re-typed the same are no change (spaces and hyphens ignored)", () => {
    const saved = formFrom(view, BANK, HOME);
    expect(changedParts({ ...saved, sortCode: "11 22 33" }, saved, view, BANK, VERSIONS)).toEqual({});
  });

  it("a limited company never sends an address (its field is hidden), even one picked before switching", () => {
    const home = { line1: "7 New Road", line2: "", town: "London", postcode: "N1 1AA" };
    const ltd = edit({ home, businessType: "limited_company", companyName: "T Ltd", companyNumber: "12345678", registeredOffice: "2 Office Row" });
    expect(changedParts(ltd, initial, view, null, VERSIONS)).not.toHaveProperty("address");
    expect(wholePage(ltd, initial, view, null, VERSIONS)).not.toHaveProperty("address");
  });

  it("after a refusal that followed a write, the saved records are re-based: their values and versions (review round 1)", () => {
    const submitted = edit({ tradingName: "Little Steps", sortCode: "11-22-33", accountNumber: "1" });
    const loaded = { form: initial, versions: VERSIONS };
    const next = rebased(loaded, submitted, { business: "2027-02-15T11:00:00.1+00:00" });
    expect(next.versions).toEqual({ ...VERSIONS, business: "2027-02-15T11:00:00.1+00:00" });
    expect(changedParts(submitted, next.form, view, null, next.versions)).toEqual({
      bank: { accountName: "Sophie Taylor", sortCode: "11-22-33", accountNumber: "1", expectedUpdatedAt: null },
    });
    const home = { line1: "7 New Road", line2: "", town: "London", postcode: "N1 1AA" };
    const withHome = rebased(loaded, edit({ home }), { home: "v-home" });
    expect(withHome.form.home).toEqual(home);
    expect(withHome.versions.home).toBe("v-home");
  });

  it("the whole page for the check: the business always, bank when saved or typed, the address only when picked", () => {
    expect(Object.keys(wholePage(initial, initial, view, null, VERSIONS))).toEqual(["business"]);
    const saved = formFrom(view, BANK, HOME);
    expect(Object.keys(wholePage({ ...saved, sortCode: "", accountNumber: "" }, saved, view, BANK, VERSIONS))).toEqual(["business", "bank"]);
  });
});

export type { BusinessView };
