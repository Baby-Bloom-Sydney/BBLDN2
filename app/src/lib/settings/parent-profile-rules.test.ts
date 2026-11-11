/**
 * The parent's Profile and Contact rules: today's rules only, checked on what she sends. The Settings pages check
 * with these before Save calls the server, and `updateParentAccountSettings` checks again with the same function.
 * Nothing new becomes required: no name length or plain-text rule (a parent's name prints on no invoice), and a date
 * of birth she never sends is never checked.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkParentProfileInput } from "./parent-profile-rules";

describe("names", () => {
  it("a blank first or last name is refused with its message", () => {
    expect(checkParentProfileInput({ first_name: "", last_name: "   " })).toEqual({
      firstName: "Enter your first name",
      lastName: "Enter your last name",
    });
  });

  it("a name that isn't text counts as blank", () => {
    expect(checkParentProfileInput({ first_name: 7 as unknown as string })).toEqual({ firstName: "Enter your first name" });
  });

  it("no new rule: a 150-character name with an accent passes, and so does one with unusual characters", () => {
    const long = `Zoë ${"a".repeat(146)}`;
    expect(long).toHaveLength(150);
    expect(checkParentProfileInput({ first_name: long, last_name: "Hartley-Reed" })).toEqual({});
    expect(checkParentProfileInput({ last_name: "O​Brien" })).toEqual({});
  });
});

describe("date of birth", () => {
  it.each([
    ["cleared", ""],
    ["null", null],
    ["not a real date", "2023-02-30"],
    ["not a date", "yesterday"],
  ])("%s → refused", (_label, value) => {
    expect(checkParentProfileInput({ date_of_birth: value })).toEqual({ dateOfBirth: "Enter your date of birth" });
  });

  it("a real date passes", () => {
    expect(checkParentProfileInput({ date_of_birth: "1994-03-02" })).toEqual({});
  });

  it("one never sent is not checked (empty on file and untouched: nothing refused)", () => {
    expect(checkParentProfileInput({ last_name: "Hartley-Reed" })).toEqual({});
    expect(checkParentProfileInput({})).toEqual({});
  });
});

describe("mobile", () => {
  it("empty → required; not a UK mobile → refused", () => {
    expect(checkParentProfileInput({ mobile_number: "" })).toEqual({ mobile: "Mobile number is required." });
    expect(checkParentProfileInput({ mobile_number: null })).toEqual({ mobile: "Mobile number is required." });
    expect(checkParentProfileInput({ mobile_number: "12345" })).toEqual({ mobile: "Enter a valid UK mobile number." });
  });

  it("a UK mobile passes, either way it is written", () => {
    expect(checkParentProfileInput({ mobile_number: "07700 900123" })).toEqual({});
    expect(checkParentProfileInput({ mobile_number: "+447700900123" })).toEqual({});
  });
});

describe("the address", () => {
  it("is not checked here: it changes only by a pick, town and postcode as the search gives them", () => {
    expect(checkParentProfileInput({ suburb: "London", postcode: "N1 1AA" })).toEqual({});
  });
});

describe("every refusal at once", () => {
  it("each field sent, each message under its own key", () => {
    expect(checkParentProfileInput({ first_name: "", last_name: "", date_of_birth: "", mobile_number: "1" })).toEqual({
      firstName: "Enter your first name",
      lastName: "Enter your last name",
      dateOfBirth: "Enter your date of birth",
      mobile: "Enter a valid UK mobile number.",
    });
  });
});

describe("the Settings bundle", () => {
  it("is zod-free and imports nothing server-side", () => {
    const source = readFileSync(join(__dirname, "parent-profile-rules.ts"), "utf8");
    const imports = source.split("\n").filter((line) => line.startsWith("import"));
    expect(imports.join("\n")).not.toMatch(/zod|supabase|next\//);
  });
});
