/**
 * Brief 02's pure rules (plan 02 step 3): the merged cohort list, current / next / next available, the counts,
 * the bookable rule (the SQL's twin, plan R11), goodwill, and every input validator.
 */
import { describe, expect, it } from "vitest";
import {
  canOfferGoodwill,
  cohortSlots,
  countsOf,
  isBookable,
  isFullyRefunded,
  isOnSchedule,
  nextAvailable,
  parsePlaces,
  scheduleDatesAfter,
  validatePlacesChange,
  validateReason,
  validateSchedule,
  viewOf,
} from "./rules";
import type { CohortPlace, CohortSchedule } from "./types";

const WEEKLY: CohortSchedule = { firstStartDate: "2027-02-01", repeatWeeks: 1, defaultPlaces: 5 };
const NOW = new Date("2027-02-03T10:00:00Z");

const place = (fields: Partial<CohortPlace> & Pick<CohortPlace, "state">): CohortPlace => ({
  id: fields.id ?? `p-${Math.random()}`,
  cohortStartDate: "2027-02-01",
  parentUserId: "u",
  isGoodwill: false,
  holdExpiresAt: null,
  paidBy: fields.state === "taken" || fields.state === "reopened" ? "card" : null,
  takenAt: null,
  reopenedAt: null,
  reopenReason: null,
  ...fields,
});

describe("scheduleDatesAfter — the grid", () => {
  it("8 cohorts, 7 days apart, from 2027-02-01 (brief §0.2)", () => {
    expect(scheduleDatesAfter(WEEKLY, "2026-11-04", 8)).toEqual([
      "2027-02-01", "2027-02-08", "2027-02-15", "2027-02-22", "2027-03-01", "2027-03-08", "2027-03-15", "2027-03-22",
    ]);
  });
  it("every 2 weeks → 14 days apart, starting after today", () => {
    expect(scheduleDatesAfter({ ...WEEKLY, repeatWeeks: 2 }, "2027-02-01", 3)).toEqual(["2027-02-15", "2027-03-01", "2027-03-15"]);
  });
  it("8 dates across the clocks going forward and back stay 7 days apart (plan R8)", () => {
    expect(scheduleDatesAfter({ ...WEEKLY, firstStartDate: "2027-03-15" }, "2027-03-14", 8)).toEqual([
      "2027-03-15", "2027-03-22", "2027-03-29", "2027-04-05", "2027-04-12", "2027-04-19", "2027-04-26", "2027-05-03",
    ]);
    expect(scheduleDatesAfter({ ...WEEKLY, firstStartDate: "2027-10-18" }, "2027-10-17", 3)).toEqual([
      "2027-10-18", "2027-10-25", "2027-11-01",
    ]);
  });
});

describe("isOnSchedule", () => {
  it.each([
    ["2027-02-01", true],
    ["2027-02-22", true],
    ["2027-02-02", false],
    ["2027-01-25", false],
    ["not a date", false],
  ])("%s → %s", (date, expected) => {
    expect(isOnSchedule(WEEKLY, date)).toBe(expected);
  });
});

describe("cohortSlots — the merged list (schedule + stored rows)", () => {
  it("no schedule, nothing stored → nothing", () => {
    expect(cohortSlots(null, [], "2027-02-03", 8)).toEqual({ current: null, upcoming: [], past: [] });
  });

  it("first date ahead: no current; 8 upcoming with the schedule's places", () => {
    const s = cohortSlots(WEEKLY, [], "2026-11-04", 8);
    expect(s.current).toBeNull();
    expect(s.upcoming).toHaveLength(8);
    expect(s.upcoming[0]).toEqual({ startDate: "2027-02-01", places: 5, stored: false });
  });

  it("on 3 Feb the 1 Feb cohort is current; stored places win", () => {
    const s = cohortSlots(WEEKLY, [{ startDate: "2027-02-01", places: 7 }], "2027-02-03", 8);
    expect(s.current).toEqual({ startDate: "2027-02-01", places: 7, stored: true });
    expect(s.upcoming[0].startDate).toBe("2027-02-08");
  });

  it("Sunday 31 Jan is before the first cohort; Monday 1 Feb makes it current (plan R8)", () => {
    expect(cohortSlots(WEEKLY, [], "2027-01-31", 8).current).toBeNull();
    expect(cohortSlots(WEEKLY, [], "2027-02-01", 8).current?.startDate).toBe("2027-02-01");
  });

  it("an off-grid stored cohort (the schedule moved) keeps its date, in order", () => {
    const moved: CohortSchedule = { firstStartDate: "2027-02-03", repeatWeeks: 1, defaultPlaces: 4 };
    const s = cohortSlots(moved, [{ startDate: "2027-02-08", places: 5 }], "2027-02-04", 3);
    expect(s.current).toEqual({ startDate: "2027-02-03", places: 4, stored: false });
    expect(s.upcoming.map((u) => u.startDate)).toEqual(["2027-02-08", "2027-02-10", "2027-02-17"]);
  });

  it("a stored cohort after the grid's current one is current", () => {
    const s = cohortSlots(WEEKLY, [{ startDate: "2027-02-02", places: 3 }], "2027-02-03", 1);
    expect(s.current).toEqual({ startDate: "2027-02-02", places: 3, stored: true });
  });

  it("past = stored cohorts before the current one, newest first", () => {
    const stored = [{ startDate: "2027-01-18", places: 5 }, { startDate: "2027-01-25", places: 6 }, { startDate: "2027-02-01", places: 5 }];
    const s = cohortSlots({ ...WEEKLY, firstStartDate: "2027-01-18" }, stored, "2027-02-03", 8);
    expect(s.past.map((p) => p.startDate)).toEqual(["2027-01-25", "2027-01-18"]);
  });
});

describe("countsOf / viewOf", () => {
  const places = [
    place({ state: "taken" }),
    place({ state: "taken", isGoodwill: true }),
    place({ state: "taken" }),
    place({ state: "held", holdExpiresAt: "2027-02-03T10:20:00Z" }),
    place({ state: "held", holdExpiresAt: "2027-02-03T09:00:00Z" }),
    place({ state: "hold_released" }),
    place({ state: "reopened", reopenedAt: "2027-02-02T10:00:00Z", reopenReason: "moved abroad" }),
    place({ state: "taken", cohortStartDate: "2027-02-08" }),
  ];

  it("counts one cohort: taken, live holds only, goodwill, re-opened", () => {
    expect(countsOf(places, "2027-02-01", NOW)).toEqual({ taken: 3, beingPaid: 1, goodwillTaken: 1, reopened: 1 });
  });

  it("3 taken of 5 → 2 left (brief §0.3)", () => {
    expect(viewOf("2027-02-01", 5, { taken: 3, beingPaid: 0 })).toEqual({ start: "2027-02-01", places: 5, taken: 3, beingPaid: 0, left: 2, overBy: 0 });
  });

  it("left never shows below 0; over by counts taken past places", () => {
    expect(viewOf("2027-02-01", 5, { taken: 6, beingPaid: 1 })).toMatchObject({ left: 0, overBy: 1 });
    expect(viewOf("2027-02-01", 5, { taken: 4, beingPaid: 2 })).toMatchObject({ left: 0, overBy: 0 });
  });
});

describe("nextAvailable — the first upcoming cohort with a place left", () => {
  const v = (start: string, left: number) => ({ start, places: 5, taken: 5 - left, beingPaid: 0, left, overBy: 0 });
  it("skips a full one", () => {
    expect(nextAvailable([v("2027-02-08", 0), v("2027-02-15", 2)])?.start).toBe("2027-02-15");
  });
  it("none when every one is full or there are none", () => {
    expect(nextAvailable([v("2027-02-08", 0)])).toBeNull();
    expect(nextAvailable([])).toBeNull();
  });
});

describe("isBookable — the SQL's twin (plan R11)", () => {
  it("the current cohort without goodwill; the next only as goodwill", () => {
    expect(isBookable("2027-02-01", false, "2027-02-01", "2027-02-08")).toBe(true);
    expect(isBookable("2027-02-08", true, "2027-02-01", "2027-02-08")).toBe(true);
    expect(isBookable("2027-02-08", false, "2027-02-01", "2027-02-08")).toBe(false);
    expect(isBookable("2027-02-01", true, "2027-02-01", "2027-02-08")).toBe(false);
    expect(isBookable("2027-02-15", true, "2027-02-01", "2027-02-08")).toBe(false);
  });
  it("nothing is bookable before the first cohort starts", () => {
    expect(isBookable("2027-02-01", false, null, "2027-02-01")).toBe(false);
    expect(isBookable("2027-02-01", true, null, "2027-02-01")).toBe(false);
  });
});

describe("canOfferGoodwill — current full, next has a place", () => {
  const v = (left: number) => ({ start: "x", places: 5, taken: 5 - left, beingPaid: 0, left, overBy: 0 });
  it.each([
    [v(0), v(2), true],
    [v(1), v(2), false],
    [v(0), v(0), false],
    [null, v(2), false],
    [v(0), null, false],
  ])("current %o, next %o → %s", (current, next, expected) => {
    expect(canOfferGoodwill(current, next)).toBe(expected);
  });
});

describe("parsePlaces — a whole number from 0 to 99", () => {
  it.each([["0", 0], ["7", 7], [" 99 ", 99], [5, 5]])("%s → %s", (raw, expected) => {
    expect(parsePlaces(raw)).toBe(expected);
  });
  it.each(["", "100", "-1", "2.5", "abc", "1e1", null, undefined, Number.NaN, 3.2])("%s → null", (raw) => {
    expect(parsePlaces(raw)).toBeNull();
  });
});

describe("validatePlacesChange — never below taken + being paid (brief §0.4)", () => {
  it("2 with 3 taken → the exact refusal", () => {
    expect(validatePlacesChange("2", 3)).toEqual({ ok: false, error: "below_taken", message: "3 places are already taken or being paid for. Set at least 3." });
  });
  it("singular: 0 with 1 taken", () => {
    expect(validatePlacesChange("0", 1)).toEqual({ ok: false, error: "below_taken", message: "1 place is already taken or being paid for. Set at least 1." });
  });
  it("7 with 3 taken is fine; bad input is refused", () => {
    expect(validatePlacesChange("7", 3)).toEqual({ ok: true, places: 7 });
    expect(validatePlacesChange("100", 0)).toEqual({ ok: false, error: "invalid_places", message: "Places must be a whole number from 0 to 99." });
  });
});

describe("validateSchedule", () => {
  it("a good schedule", () => {
    expect(validateSchedule({ firstStartDate: "2027-02-01", repeatWeeks: "1", defaultPlaces: "5" })).toEqual({
      ok: true,
      schedule: { firstStartDate: "2027-02-01", repeatWeeks: 1, defaultPlaces: 5 },
    });
  });
  it.each([
    [{ firstStartDate: "2027-02-30", repeatWeeks: 1, defaultPlaces: 5 }, "invalid_date"],
    [{ firstStartDate: "", repeatWeeks: 1, defaultPlaces: 5 }, "invalid_date"],
    [{ firstStartDate: "2027-02-01", repeatWeeks: 0, defaultPlaces: 5 }, "invalid_repeat"],
    [{ firstStartDate: "2027-02-01", repeatWeeks: 13, defaultPlaces: 5 }, "invalid_repeat"],
    [{ firstStartDate: "2027-02-01", repeatWeeks: 1.5, defaultPlaces: 5 }, "invalid_repeat"],
    [{ firstStartDate: "2027-02-01", repeatWeeks: 1, defaultPlaces: 100 }, "invalid_places"],
    [null, "invalid_date"],
    ["2027-02-01", "invalid_date"],
  ])("%o → %s", (input, error) => {
    expect(validateSchedule(input)).toMatchObject({ ok: false, error });
  });
});

describe("validateReason — at least 3 characters, at most 500 (the access toggle's rule)", () => {
  it.each([["moved abroad", "moved abroad"], ["  abc  ", "abc"]])("%s → ok", (raw, reason) => {
    expect(validateReason(raw)).toEqual({ ok: true, reason });
  });
  it.each(["ab", "   ", "x".repeat(501), null, 3])("%s → refused", (raw) => {
    expect(validateReason(raw)).toEqual({ ok: false, error: "invalid_reason", message: "A short reason is required (3 to 500 characters)." });
  });
});

describe("isFullyRefunded — Stripe's charge.refunded, true only for a full refund (brief Q5)", () => {
  it.each([
    [{ refunded: true }, true],
    [{ refunded: false }, false],
    [{}, false],
    [{ refunded: null }, false],
  ])("%o → %s", (charge, expected) => {
    expect(isFullyRefunded(charge)).toBe(expected);
  });
});
