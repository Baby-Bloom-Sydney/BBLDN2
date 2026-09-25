import { describe, it, expect } from "vitest";
import {
  UK_MOBILE_REGEX,
  UK_POSTCODE_REGEX,
  normaliseUkMobile,
  isUkMobile,
  formatUkMobile,
  parseUkAddress,
  formatAddressLine,
  toTitleCase,
} from "@/lib/uk-contact";

// P-5 (BAI 2026-09-25): accept 07… or +44… at input, normalise internally to
// E.164 +44…, display "+44 (0) 7xxx xxx xxx". 12.01: UK address shape, no state.

const NATIONAL = "07700900123"; // Ofcom drama range
const E164 = "+447700900123";
const DISPLAY = "+44 (0) 7700 900 123";

describe("UK_MOBILE_REGEX", () => {
  it("accepts the national mobile form 07 + 9 digits", () => {
    expect(UK_MOBILE_REGEX.test(NATIONAL)).toBe(true);
  });

  it.each([
    ["one digit short", "0770090012"],
    ["one digit long", "077009001234"],
    ["not a mobile prefix", "08700900123"],
    ["empty", ""],
    ["already E.164", E164],
  ])("rejects %s", (_label, input) => {
    expect(UK_MOBILE_REGEX.test(input)).toBe(false);
  });
});

describe("normaliseUkMobile", () => {
  it.each([
    ["national with a space", "07700 900123"],
    ["national with a dash", "07700-900123"],
    ["national, grouped", "07700 900 123"],
    ["bare trunk, no leading zero", "7700900123"],
    ["international with spaces", "+44 7700 900123"],
    ["international, no plus", "447700900123"],
    ["international, 00 prefix", "00447700900123"],
    ["this module's own display form", DISPLAY],
  ])("normalises %s to E.164", (_label, input) => {
    expect(normaliseUkMobile(input)).toBe(E164);
  });

  it("is idempotent — auth/actions.ts validates an already-normalised value", () => {
    const once = normaliseUkMobile(NATIONAL);
    expect(normaliseUkMobile(once)).toBe(once);
    expect(once).toBe(E164);
  });

  it("leaves a number it cannot place unchanged rather than promoting it", () => {
    // Fail closed: a bad number must not be silently turned into a valid one.
    expect(normaliseUkMobile("02079460958")).toBe("02079460958");
    expect(isUkMobile("02079460958")).toBe(false);
  });
});

describe("isUkMobile", () => {
  it.each([
    ["national", NATIONAL],
    ["E.164", E164],
    ["messy national", " 07700 900-123 "],
    ["display form", DISPLAY],
  ])("accepts %s", (_label, input) => {
    expect(isUkMobile(input)).toBe(true);
  });

  it.each([
    ["a ten-digit number that is not a UK mobile", "0912345678"],
    ["a UK landline", "02079460958"],
    ["empty", ""],
    ["letters", "not a number"],
    ["too short", "077009001"],
  ])("rejects %s", (_label, input) => {
    expect(isUkMobile(input)).toBe(false);
  });
});

describe("formatUkMobile", () => {
  it("renders the P-5 display form", () => {
    expect(formatUkMobile(NATIONAL)).toBe(DISPLAY);
    expect(formatUkMobile(E164)).toBe(DISPLAY);
  });

  it("returns partial input unchanged so typing is not mangled", () => {
    expect(formatUkMobile("077")).toBe("077");
    expect(formatUkMobile("")).toBe("");
  });
});

describe("round trip — input to storage to display", () => {
  // The brief's named proof: the server gate in lib/auth/actions.ts must accept
  // exactly what the client normalises to.
  it("07700 900123 → +447700900123 → +44 (0) 7700 900 123", () => {
    const typed = "07700 900123";

    expect(isUkMobile(typed)).toBe(true);

    const stored = normaliseUkMobile(typed);
    expect(stored).toBe(E164);

    // The server re-normalises and re-validates the stored value.
    expect(normaliseUkMobile(stored)).toBe(E164);
    expect(isUkMobile(stored)).toBe(true);

    expect(formatUkMobile(stored)).toBe(DISPLAY);
  });
});

describe("UK_POSTCODE_REGEX", () => {
  it.each(["E1 6AN", "NW1 6XE", "SW1A 1AA", "EC1M 5RF", "W1A 0AX", "sw4 0ln"])(
    "accepts %s",
    (input) => {
      expect(UK_POSTCODE_REGEX.test(input)).toBe(true);
    },
  );

  it.each(["2026", "NW1", "6XE", "", "NW1 6X"])("rejects %s", (input) => {
    expect(UK_POSTCODE_REGEX.test(input)).toBe(false);
  });
});

describe("parseUkAddress", () => {
  it("parses the two-segment form", () => {
    expect(parseUkAddress("12 BAKER STREET, MARYLEBONE NW1 6XE")).toEqual({
      line1: "12 Baker Street",
      line2: "",
      town: "Marylebone",
      postcode: "NW1 6XE",
    });
  });

  it("parses the three-segment form, town last", () => {
    expect(
      parseUkAddress("FLAT 4, 12 BAKER STREET, MARYLEBONE NW1 6XE"),
    ).toEqual({
      line1: "Flat 4",
      line2: "12 Baker Street",
      town: "Marylebone",
      postcode: "NW1 6XE",
    });
  });

  it("normalises the postcode to upper case with a single space", () => {
    expect(parseUkAddress("1 HIGH STREET, CLAPHAM sw40ln")?.postcode).toBe(
      "SW4 0LN",
    );
    expect(parseUkAddress("1 HIGH STREET, CLAPHAM SW4  0LN")?.postcode).toBe(
      "SW4 0LN",
    );
  });

  it.each([
    ["a short outward code", "1 HIGH STREET, WHITECHAPEL E1 6AN", "E1 6AN"],
    ["a long outward code", "1 HIGH STREET, WESTMINSTER SW1A 1AA", "SW1A 1AA"],
  ])("handles %s — the 4-digit assumption does not survive", (_l, sla, pc) => {
    expect(parseUkAddress(sla)?.postcode).toBe(pc);
  });

  it.each([
    ["an address of the shape this parser replaced", "12 GEORGE ST, BONDI NSW 2026"],
    ["no postcode", "12 BAKER STREET, MARYLEBONE"],
    ["a single segment", "MARYLEBONE NW1 6XE"],
    ["empty", ""],
  ])("returns null for %s", (_label, sla) => {
    expect(parseUkAddress(sla)).toBeNull();
  });
});

describe("toTitleCase", () => {
  it("title-cases an all-caps segment", () => {
    expect(toTitleCase("BAKER STREET")).toBe("Baker Street");
  });
});

describe("formatAddressLine", () => {
  it("joins both street lines for the single address_line column", () => {
    const parsed = parseUkAddress("FLAT 4, 12 BAKER STREET, MARYLEBONE NW1 6XE");
    expect(parsed).not.toBeNull();
    expect(formatAddressLine(parsed!)).toBe("Flat 4, 12 Baker Street");
  });

  it("omits the separator when there is no second line", () => {
    const parsed = parseUkAddress("12 BAKER STREET, MARYLEBONE NW1 6XE");
    expect(formatAddressLine(parsed!)).toBe("12 Baker Street");
  });
});
