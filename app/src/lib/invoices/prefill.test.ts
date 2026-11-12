/**
 * The new-invoice form's pre-fill (plan 06 §14.3, b2.5; brief §0a A; 06b-4 rework, BAI 2026-11-12: the form starts
 * empty): pure rules.
 * - The rate on every new shift row: the linked placement's rate, then the position's, then her profile rate
 *   (`nannies.hourly_rate_min`), else blank. A family linked through a connection has no placement rate, so it starts
 *   at the position's. A null, ≤ 0 or over-the-ceiling value is skipped.
 * - A correction: the cancelled invoice's lines, each with its own date.
 * - Nothing else is pre-filled: no week's rows and no Trial Shift row.
 * Rates positionally (a test file).
 *
 * BB-wave1-041126/06b2-build, 2026-11-06; BB-wave1-041126/06b4-server, 2026-11-12.
 */
import { describe, expect, it } from "vitest";
import * as prefill from "./prefill";
import { correctionPrefill, pickRate } from "./prefill";

describe("pickRate", () => {
  it("placement, then position, then her profile, else blank — each null or ≤ 0 skipped", () => {
    expect(pickRate({ placement: "18.00", position: 17.5, profile: 16 })).toEqual({ ratePence: 1800, rateSource: "placement" });
    expect(pickRate({ placement: null, position: "17.50", profile: 16 })).toEqual({ ratePence: 1750, rateSource: "position" });
    expect(pickRate({ placement: 0, position: null, profile: "16.00" })).toEqual({ ratePence: 1600, rateSource: "profile" });
    expect(pickRate({ placement: -3, position: 0, profile: null })).toEqual({ ratePence: null, rateSource: null });
  });

  it("a family linked through a connection (no placement) starts at the position's rate, then her profile's", () => {
    expect(pickRate({ position: 17.5, profile: 16 })).toEqual({ ratePence: 1750, rateSource: "position" });
    expect(pickRate({ position: null, profile: 16 })).toEqual({ ratePence: 1600, rateSource: "profile" });
    expect(pickRate({})).toEqual({ ratePence: null, rateSource: null });
  });

  it("skips a rate the form would refuse: over the typo ceiling, or under a penny (review TS L6)", () => {
    expect(pickRate({ placement: 1800, position: 0.001, profile: 16 })).toEqual({ ratePence: 1600, rateSource: "profile" });
    expect(pickRate({ placement: "250.00", position: null, profile: null })).toEqual({ ratePence: 25_000, rateSource: "placement" });
  });
});

describe("the form starts empty (BAI 2026-11-12)", () => {
  it("no week or Trial Shift rows are made any more", () => {
    for (const gone of ["weekPrefill", "trialPrefill", "usualDays", "splitHours"]) expect(Object.hasOwn(prefill, gone), gone).toBe(false);
  });
});

describe("correctionPrefill (\"Send a corrected invoice\": the cancelled invoice's lines)", () => {
  it("brings back every shift with its own date, rate and description, and every expense, in her order", () => {
    expect(correctionPrefill([
      { lineNo: 2, kind: "shift", date: "2027-02-10", hours: 2, ratePence: 2200, description: "evening, agreed rate", amountPence: 4400 },
      { lineNo: 3, kind: "expense", expenseType: "activities", description: "Soft play", amountPence: 1250 },
      { lineNo: 1, kind: "shift", date: "2027-01-28", hours: 6, ratePence: 1800, description: null, amountPence: 10_800 },
    ])).toEqual({
      shifts: [
        { date: "2027-01-28", hours: 6, ratePence: 1800, description: null },
        { date: "2027-02-10", hours: 2, ratePence: 2200, description: "evening, agreed rate" },
      ],
      expenses: [{ expenseType: "activities", amountPence: 1250, description: "Soft play" }],
    });
  });

  it("an invoice of expenses only comes back as expenses only", () => {
    expect(correctionPrefill([{ lineNo: 1, kind: "expense", expenseType: "travel", description: null, amountPence: 640 }]))
      .toEqual({ shifts: [], expenses: [{ expenseType: "travel", amountPence: 640, description: null }] });
  });
});
