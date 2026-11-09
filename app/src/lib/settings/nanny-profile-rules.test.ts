/**
 * The nanny's Profile and Contact rules (ledger B06 §9.1 R2, R4): what may never be saved empty, shared by the Settings
 * pages (checked before Save calls the server) and `updateNannyAccountSettings` (checked again), so both refuse the
 * same things with the same plain messages. Zod-free on purpose: these run in the Settings page's own bundle.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */
import { describe, expect, it } from "vitest";
import {
  checkDateOfBirth,
  checkHomeAddress,
  checkMobile,
  checkName,
  hasStreetAndPostcode,
  homeFromParsed,
  homeLines,
  PROFILE_MESSAGES as M,
  sameHome,
} from "./nanny-profile-rules";

const HOME = { line1: "1 Upper Street", line2: "", town: "London", postcode: "N1 0AA" };

describe("the address (R2: one record, her profile)", () => {
  it("a picked address keeps the verification shape: the street line is line 1 + line 2; no second line is stored", () => {
    expect(homeFromParsed({ line1: "Flat 2, 1 Upper Street", line2: "Islington", town: "London", postcode: "N1 0AA" }))
      .toEqual({ line1: "Flat 2, 1 Upper Street, Islington", line2: "", town: "London", postcode: "N1 0AA" });
  });

  it("shows in full, one part per line, skipping blanks", () => {
    expect(homeLines(HOME)).toEqual(["1 Upper Street", "London", "N1 0AA"]);
    expect(homeLines({ ...HOME, line2: "Islington" })).toEqual(["1 Upper Street", "Islington", "London", "N1 0AA"]);
    expect(homeLines({ line1: "", line2: "", town: "Camden", postcode: "NW1 0AA" })).toEqual(["Camden", "NW1 0AA"]);
    expect(homeLines(null)).toEqual([]);
  });

  it("is on file only with a street line and a postcode (what an invoice needs)", () => {
    expect(hasStreetAndPostcode(HOME)).toBe(true);
    expect(hasStreetAndPostcode({ ...HOME, line1: "  " })).toBe(false);
    expect(hasStreetAndPostcode({ ...HOME, postcode: "" })).toBe(false);
    expect(hasStreetAndPostcode(null)).toBe(false);
  });

  it("compares two addresses part by part, trimmed", () => {
    expect(sameHome(HOME, { ...HOME, line1: " 1 Upper Street " })).toBe(true);
    expect(sameHome(HOME, { ...HOME, postcode: "N1 0AB" })).toBe(false);
    expect(sameHome(null, null)).toBe(true);
    expect(sameHome(HOME, null)).toBe(false);
  });

  it.each([
    ["nothing", null],
    ["no street line", { ...HOME, line1: "" }],
    ["no postcode", { ...HOME, postcode: " " }],
    ["a postcode that isn't one", { ...HOME, postcode: "NOT A CODE" }],
    ["a control character", { ...HOME, line1: "1 Upper\tStreet" }],
    ["a zero-width space", { ...HOME, line1: "1 Upper\u200bStreet" }],
    ["a bidi override", { ...HOME, town: "Lon\u202edon" }],
    ["a line separator", { ...HOME, line1: "1 Upper\u2028Street" }],
    ["no town", { ...HOME, town: " " }],
    ["a missing part", { line1: "1 Upper Street", postcode: "N1 0AA" }],
    ["a number for a part", { ...HOME, town: 7 }],
    ["not an object", "1 Upper Street, London N1 0AA"],
  ])("refuses %s with one plain message", (_label, value) => {
    expect(checkHomeAddress(value)).toBe(M.address);
  });

  it("refuses a part over 200 characters", () => {
    expect(checkHomeAddress({ ...HOME, line1: "a".repeat(201) })).toBe(M.tooLong);
  });

  it("accepts a whole UK address", () => {
    expect(checkHomeAddress(HOME)).toBeNull();
    expect(checkHomeAddress({ ...HOME, postcode: "sw1a1aa" })).toBeNull();
  });
});

describe("names, date of birth and mobile (R4; today's rules)", () => {
  it("a name is plain text: no control, invisible or bidi characters (a joiner, which some scripts need, is kept)", () => {
    expect(checkName("Sophie\u202eTaylor", M.firstName)).toBe(M.plain);
    expect(checkName("Sophie\u200b", M.firstName)).toBe(M.plain);
    expect(checkName("Sophie\nTaylor", M.firstName)).toBe(M.plain);
    expect(checkName("\u0928\u094d\u200d\u0928", M.firstName)).toBeNull();
    expect(M.plain).toBe("Use plain text, without special characters");
  });

  it("a name is required and at most 100 characters", () => {
    expect(checkName("Sophie", M.firstName)).toBeNull();
    expect(checkName("   ", M.firstName)).toBe(M.firstName);
    expect(checkName(undefined, M.lastName)).toBe(M.lastName);
    expect(checkName("a".repeat(101), M.lastName)).toBe(M.tooLong);
  });

  it("the date of birth is required and a real date", () => {
    expect(checkDateOfBirth("1995-03-12")).toBeNull();
    expect(checkDateOfBirth("")).toBe(M.dateOfBirth);
    expect(checkDateOfBirth(null)).toBe(M.dateOfBirth);
    expect(checkDateOfBirth("1995-02-30")).toBe(M.dateOfBirth);
    expect(checkDateOfBirth("12/03/1995")).toBe(M.dateOfBirth);
  });

  it("the mobile is required and a UK mobile", () => {
    expect(checkMobile("07700 900123")).toBeNull();
    expect(checkMobile("+44 7700 900123")).toBeNull();
    expect(checkMobile("  ")).toBe(M.mobileRequired);
    expect(checkMobile(undefined)).toBe(M.mobileRequired);
    expect(checkMobile("0207 946 0000")).toBe(M.mobile);
  });

  it("the messages are plain and fixed", () => {
    expect(M).toMatchObject({
      firstName: "Enter your first name",
      lastName: "Enter your last name",
      dateOfBirth: "Enter your date of birth",
      address: "Choose your address",
      mobileRequired: "Mobile number is required.",
      mobile: "Enter a valid UK mobile number.",
    });
  });
});
