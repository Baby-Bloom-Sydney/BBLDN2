import { describe, expect, it } from "vitest";
import { profileAge } from "./profile-age";

const NOW = new Date("2026-11-09T12:00:00Z");

describe("profileAge", () => {
  it("whole years, the birthday not yet reached this year counting one fewer", () => {
    expect(profileAge("1990-01-15", NOW)).toBe(36);
    expect(profileAge("1990-12-15", NOW)).toBe(35);
    expect(profileAge("1990-11-09", NOW)).toBe(36);
  });

  it("null when missing, unreadable or not plausible", () => {
    for (const dob of [null, undefined, "", "not a date", "2030-01-01", "1800-01-01", "2026-11-01"]) expect(profileAge(dob, NOW)).toBeNull();
  });
});
