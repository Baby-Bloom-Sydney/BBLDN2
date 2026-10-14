/**
 * W6-D5 (3w6fix, BB-LDN-3w6fix-141026) — one passport-country list for the two identity screens, London first:
 * `BRAND.country` leads (the old copies led with Australia), the rest stay alphabetical.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PASSPORT_COUNTRIES } from "./passport-countries";
import { BRAND } from "./constants";

describe("PASSPORT_COUNTRIES", () => {
  it("leads with the brand's own country", () => {
    expect(PASSPORT_COUNTRIES[0]).toBe(BRAND.country);
  });

  it("lists every other country once, alphabetically", () => {
    const rest = PASSPORT_COUNTRIES.slice(1);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));
    expect(new Set(PASSPORT_COUNTRIES).size).toBe(PASSPORT_COUNTRIES.length);
    expect(PASSPORT_COUNTRIES).toHaveLength(176);
  });

  it("is the only copy — both identity screens import it", () => {
    for (const file of [
      "app/nanny/verification/sections/IdentitySection.tsx",
      "app/nanny/onboarding-verification/OnboardingVerificationClient.tsx",
    ]) {
      const src = readFileSync(resolve(__dirname, "..", file), "utf8");
      expect(src).not.toMatch(/const PASSPORT_COUNTRIES\s*=/);
      expect(src).toContain('from "@/lib/passport-countries"');
    }
  });
});
