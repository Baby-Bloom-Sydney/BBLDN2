import { describe, it, expect } from "vitest";
import {
  MAX_CHILD_AGE_MONTHS,
  earliestAllowedDobIso,
  getChildAgeMonths,
  todayIso,
  validateChildDob,
} from "./child-age";

const NOW = new Date("2026-05-15T10:00:00+01:00");

describe("getChildAgeMonths", () => {
  it("returns 0 for a child born today", () => {
    expect(getChildAgeMonths(new Date("2026-05-15"), NOW)).toBe(0);
  });

  it("returns 12 for a child whose 1st birthday is today", () => {
    expect(getChildAgeMonths(new Date("2025-05-15"), NOW)).toBe(12);
  });

  it("returns 11 the day before the 1st birthday", () => {
    expect(getChildAgeMonths(new Date("2025-05-16"), NOW)).toBe(11);
  });

  it("returns 35 the day before the 3rd birthday", () => {
    expect(getChildAgeMonths(new Date("2023-05-16"), NOW)).toBe(35);
  });

  it("returns 36 on the 3rd birthday", () => {
    expect(getChildAgeMonths(new Date("2023-05-15"), NOW)).toBe(36);
  });
});

describe("validateChildDob", () => {
  it("rejects a garbage string", () => {
    expect(validateChildDob("not-a-date", NOW)).toEqual({
      ok: false,
      error: "invalid_date_of_birth",
    });
  });

  it("rejects a future DoB", () => {
    expect(validateChildDob("2026-12-01", NOW)).toEqual({
      ok: false,
      error: "date_of_birth_in_future",
    });
  });

  it("accepts a child born today", () => {
    expect(validateChildDob("2026-05-15", NOW)).toEqual({ ok: true });
  });

  it("accepts a child one day shy of 36 months", () => {
    expect(validateChildDob("2023-05-16", NOW)).toEqual({ ok: true });
  });

  it("rejects a child on their 3rd birthday (exactly 36 months)", () => {
    expect(validateChildDob("2023-05-15", NOW)).toEqual({
      ok: false,
      error: "child_too_old",
    });
  });

  it("rejects a child clearly older than 3", () => {
    expect(validateChildDob("2020-01-01", NOW)).toEqual({
      ok: false,
      error: "child_too_old",
    });
  });
});

describe("earliestAllowedDobIso", () => {
  it("returns the day after the 3-year-ago anchor (still under 36 months)", () => {
    expect(earliestAllowedDobIso(NOW)).toBe("2023-05-16");
  });

  it("paired with validateChildDob, the boundary date is accepted", () => {
    const earliest = earliestAllowedDobIso(NOW);
    expect(validateChildDob(earliest, NOW)).toEqual({ ok: true });
  });
});

describe("todayIso", () => {
  it("returns today as YYYY-MM-DD", () => {
    expect(todayIso(NOW)).toBe("2026-05-15");
  });
});

describe("MAX_CHILD_AGE_MONTHS", () => {
  it("is 36", () => {
    expect(MAX_CHILD_AGE_MONTHS).toBe(36);
  });
});
