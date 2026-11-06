/**
 * The new-invoice form's pre-fill (plan 06 §14.3, b2.5; brief §0a A): pure rules.
 * - The rate on every new shift row: Regular week — the placement's rate, then the position's, then her profile
 *   rate (`nannies.hourly_rate_min`), else blank; Trial Shift — the position's, then her profile's. A null or ≤ 0
 *   value is skipped.
 * - Shift rows for a Regular week: one for each of her usual days (`position_schedule.schedule`'s keys, else the
 *   position's `days_required`), the placement's weekly hours split evenly in quarter hours, the remainder to the
 *   first days, at most 24 each; days after London's today dropped; no usual days → one blank Monday row.
 * - A Trial Shift: one blank row on its date. A correction: the cancelled invoice's lines.
 * Rates positionally (a test file).
 *
 * BB-wave1-041126/06b2-build, 2026-11-06.
 */
import { describe, expect, it } from "vitest";
import { correctionPrefill, pickRate, splitHours, trialPrefill, usualDays, weekPrefill } from "./prefill";

const MONDAY = "2027-02-08";
const AFTER_THE_WEEK = new Date("2027-02-15T10:00:00Z");

describe("pickRate", () => {
  it("Regular week: placement, then position, then her profile, else blank — each null or ≤ 0 skipped", () => {
    expect(pickRate("regular_week", { placement: "18.00", position: 17.5, profile: 16 })).toEqual({ ratePence: 1800, rateSource: "placement" });
    expect(pickRate("regular_week", { placement: null, position: "17.50", profile: 16 })).toEqual({ ratePence: 1750, rateSource: "position" });
    expect(pickRate("regular_week", { placement: 0, position: null, profile: "16.00" })).toEqual({ ratePence: 1600, rateSource: "profile" });
    expect(pickRate("regular_week", { placement: -3, position: 0, profile: null })).toEqual({ ratePence: null, rateSource: null });
  });

  it("skips a rate the form would refuse: over the typo ceiling, or under a penny (review TS L6)", () => {
    expect(pickRate("regular_week", { placement: 1800, position: 0.001, profile: 16 })).toEqual({ ratePence: 1600, rateSource: "profile" });
    expect(pickRate("regular_week", { placement: "250.00", position: null, profile: null })).toEqual({ ratePence: 25_000, rateSource: "placement" });
  });

  it("Trial Shift: the position, then her profile — a placement's rate never applies", () => {
    expect(pickRate("trial_shift", { placement: 25, position: 17.5, profile: 16 })).toEqual({ ratePence: 1750, rateSource: "position" });
    expect(pickRate("trial_shift", { placement: 25, position: null, profile: 16 })).toEqual({ ratePence: 1600, rateSource: "profile" });
    expect(pickRate("trial_shift", { placement: 25, position: null, profile: undefined })).toEqual({ ratePence: null, rateSource: null });
  });
});

describe("usualDays (weekday offsets from Monday)", () => {
  it("reads the schedule's keys (buildScheduleJson: { monday: [\"morning\"], … }), in weekday order", () => {
    expect(usualDays({ wednesday: ["morning"], monday: ["morning", "afternoon"], friday: ["evening"] }, ["Tuesday"])).toEqual([0, 2, 4]);
  });

  it("skips a day with no times and a key that isn't a day", () => {
    expect(usualDays({ monday: [], tuesday: ["morning"], someday: ["morning"] }, null)).toEqual([1]);
  });

  it("falls back to days_required (full or short names, any case) when the schedule names no day", () => {
    expect(usualDays(null, ["Thursday", "Monday", "monday", "Sat"])).toEqual([0, 3, 5]);
    expect(usualDays({}, ["Mon", "Wed", "Fri"])).toEqual([0, 2, 4]);
    expect(usualDays("not a schedule", ["Sun"])).toEqual([6]);
  });

  it("is empty when neither names a day — a word that merely starts like one isn't one (review TS L7)", () => {
    expect(usualDays({ monkey: ["morning"], sunshine: ["morning"] }, ["month", "Satur", "Wednes"])).toEqual([]);
    expect(usualDays(null, null)).toEqual([]);
    expect(usualDays({ monday: "morning" }, ["Someday"])).toEqual([]);
  });
});

describe("splitHours (the weekly hours over her usual days, in quarter hours)", () => {
  it("30 h over 5 days is 6 each; 25 h over 3 days is 8.5, 8.25, 8.25; 60 h over 2 days caps at 24 each", () => {
    expect(splitHours(30, 5)).toEqual([6, 6, 6, 6, 6]);
    expect(splitHours(25, 3)).toEqual([8.5, 8.25, 8.25]);
    expect(splitHours(60, 2)).toEqual([24, 24]);
  });

  it("no weekly hours (or none to share) leaves the hours blank; a day that gets nothing is blank too", () => {
    expect(splitHours(null, 3)).toEqual([null, null, null]);
    expect(splitHours(0, 2)).toEqual([null, null]);
    expect(splitHours(0.5, 3)).toEqual([0.25, 0.25, null]);
    expect(splitHours(37.5, 0)).toEqual([]);
  });
});

describe("weekPrefill", () => {
  it("one row per usual day with its share of the weekly hours and her rate", () => {
    expect(weekPrefill({ weekStart: MONDAY, days: [0, 1, 2, 3, 4], weeklyHours: 30, ratePence: 1800, now: AFTER_THE_WEEK })).toEqual([
      { date: "2027-02-08", hours: 6, ratePence: 1800, description: null },
      { date: "2027-02-09", hours: 6, ratePence: 1800, description: null },
      { date: "2027-02-10", hours: 6, ratePence: 1800, description: null },
      { date: "2027-02-11", hours: 6, ratePence: 1800, description: null },
      { date: "2027-02-12", hours: 6, ratePence: 1800, description: null },
    ]);
  });

  it("drops the days after London's today (the current week), after splitting the week's hours", () => {
    const wednesday = new Date("2027-02-10T12:00:00Z");
    expect(weekPrefill({ weekStart: MONDAY, days: [0, 2, 4], weeklyHours: 25, ratePence: null, now: wednesday })).toEqual([
      { date: "2027-02-08", hours: 8.5, ratePence: null, description: null },
      { date: "2027-02-10", hours: 8.25, ratePence: null, description: null },
    ]);
  });

  it("no usual days — or none up to today — gives one row on the Monday with the hours blank", () => {
    expect(weekPrefill({ weekStart: MONDAY, days: [], weeklyHours: 30, ratePence: 1800, now: AFTER_THE_WEEK })).toEqual([
      { date: "2027-02-08", hours: null, ratePence: 1800, description: null },
    ]);
    const mondayMorning = new Date("2027-02-08T08:00:00Z");
    expect(weekPrefill({ weekStart: MONDAY, days: [3, 4], weeklyHours: 16, ratePence: 1800, now: mondayMorning })).toEqual([
      { date: "2027-02-08", hours: null, ratePence: 1800, description: null },
    ]);
  });

  it("refuses a week start that isn't a London Monday", () => {
    expect(() => weekPrefill({ weekStart: "2027-02-10", days: [0], weeklyHours: 30, ratePence: 1800, now: AFTER_THE_WEEK })).toThrow(RangeError);
  });
});

describe("trialPrefill", () => {
  it("one row on the trial date, hours blank (no trial length is stored)", () => {
    expect(trialPrefill("2027-02-03", 1750)).toEqual([{ date: "2027-02-03", hours: null, ratePence: 1750, description: null }]);
  });
});

describe("correctionPrefill (\"Send a corrected invoice\": the cancelled invoice's lines)", () => {
  it("brings back every shift with its own rate and description, and every expense, in her order", () => {
    expect(correctionPrefill([
      { lineNo: 2, kind: "shift", date: "2027-02-10", hours: 2, ratePence: 2200, description: "evening, agreed rate", amountPence: 4400 },
      { lineNo: 3, kind: "expense", expenseType: "activities", description: "Soft play", amountPence: 1250 },
      { lineNo: 1, kind: "shift", date: "2027-02-08", hours: 6, ratePence: 1800, description: null, amountPence: 10_800 },
    ])).toEqual({
      shifts: [
        { date: "2027-02-08", hours: 6, ratePence: 1800, description: null },
        { date: "2027-02-10", hours: 2, ratePence: 2200, description: "evening, agreed rate" },
      ],
      expenses: [{ expenseType: "activities", amountPence: 1250, description: "Soft play" }],
    });
  });
});
