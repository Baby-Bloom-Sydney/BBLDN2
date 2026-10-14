/**
 * W6-D3 / dispatch D4 (3w6fix, BB-LDN-3w6fix-141026) — the admin's corrections to the AI-extracted passport details.
 * Whitelisted fields only, each validated; anything else fails closed before a write.
 */
import { describe, it, expect } from "vitest";
import { parseIdentityEdits, changedIdentityFields, IDENTITY_EDIT_FIELDS } from "./identity-edits";

describe("parseIdentityEdits", () => {
  it("accepts the whitelisted fields, trimmed, with ISO dates", () => {
    const r = parseIdentityEdits({
      extracted_surname: "  Taylor ",
      extracted_given_names: "Sophie Anne",
      extracted_dob: "1990-03-05",
      extracted_nationality: "British Citizen",
      extracted_passport_number: "123456789",
      extracted_passport_expiry: "2031-06-30",
    });
    expect(r).toEqual({
      ok: true,
      data: {
        extracted_surname: "Taylor",
        extracted_given_names: "Sophie Anne",
        extracted_dob: "1990-03-05",
        extracted_nationality: "British Citizen",
        extracted_passport_number: "123456789",
        extracted_passport_expiry: "2031-06-30",
      },
    });
  });

  it("treats undefined / null as no edits", () => {
    expect(parseIdentityEdits(undefined)).toEqual({ ok: true, data: {} });
    expect(parseIdentityEdits(null)).toEqual({ ok: true, data: {} });
    expect(parseIdentityEdits({})).toEqual({ ok: true, data: {} });
  });

  it("stores a cleared field as null", () => {
    expect(parseIdentityEdits({ extracted_nationality: "  " })).toEqual({ ok: true, data: { extracted_nationality: null } });
  });

  it("refuses a field outside the whitelist", () => {
    for (const bad of [{ identity_status: "verified" }, { verification_status: 40 }, { extracted_dob: "1990-03-05", cross_check_status: "passed" }]) {
      expect(parseIdentityEdits(bad).ok).toBe(false);
    }
  });

  it("refuses a date that is not a real YYYY-MM-DD calendar date", () => {
    for (const d of ["05/03/1990", "1990-02-30", "1990-3-5", "1990-03-05T00:00:00Z", "yesterday"]) {
      expect(parseIdentityEdits({ extracted_dob: d }).ok).toBe(false);
      expect(parseIdentityEdits({ extracted_passport_expiry: d }).ok).toBe(false);
    }
  });

  it("refuses a date of birth in the future or before 1900", () => {
    expect(parseIdentityEdits({ extracted_dob: "2999-01-01" }).ok).toBe(false);
    expect(parseIdentityEdits({ extracted_dob: "1899-12-31" }).ok).toBe(false);
  });

  it("refuses non-strings, over-long text and a non-object", () => {
    expect(parseIdentityEdits({ extracted_surname: 42 }).ok).toBe(false);
    expect(parseIdentityEdits({ extracted_surname: "x".repeat(101) }).ok).toBe(false);
    expect(parseIdentityEdits({ extracted_passport_number: "12 34;--" }).ok).toBe(false);
    expect(parseIdentityEdits("extracted_dob=1990-03-05").ok).toBe(false);
    expect(parseIdentityEdits([]).ok).toBe(false);
  });
});

describe("changedIdentityFields", () => {
  const initial = Object.fromEntries(IDENTITY_EDIT_FIELDS.map((k) => [k, ""])) as Record<string, string>;

  it("returns only the fields the admin changed", () => {
    const before = { ...initial, extracted_surname: "Taylor", extracted_dob: "" };
    const after = { ...before, extracted_dob: "1990-03-05" };
    expect(changedIdentityFields(before, after)).toEqual({ extracted_dob: "1990-03-05" });
  });

  it("returns nothing when nothing changed, and ignores keys outside the whitelist", () => {
    expect(changedIdentityFields(initial, { ...initial, identity_status: "verified" })).toEqual({});
  });
});
