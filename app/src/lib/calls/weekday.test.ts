/** ISO weekday, pinned in one module (plan A4: avoids LDN1 gap 5, Monday = 0 vs Sunday = 0). */
import { describe, expect, it } from "vitest";
import { ISO_WEEKDAYS, isIsoWeekday, isoWeekdayOf, weekdayName } from "./weekday";

describe("isoWeekdayOf — a London date's ISO weekday", () => {
  it.each([
    ["2027-02-08", 1],
    ["2027-02-09", 2],
    ["2027-02-04", 4],
    ["2027-02-06", 6],
    ["2027-02-07", 7],
    ["2027-03-28", 7],
    ["2027-10-31", 7],
  ])("%s → %i", (date, expected) => {
    expect(isoWeekdayOf(date)).toBe(expected);
  });

  it("does not depend on the host's zone", () => {
    const previous = process.env.TZ;
    try {
      for (const zone of ["UTC", "Etc/GMT-11", "America/New_York"]) {
        process.env.TZ = zone;
        expect(isoWeekdayOf("2027-02-08")).toBe(1);
      }
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});

describe("the ISO weekday set", () => {
  it("is 1 = Monday … 7 = Sunday", () => {
    expect(ISO_WEEKDAYS).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(weekdayName(1)).toBe("Monday");
    expect(weekdayName(7)).toBe("Sunday");
  });

  it.each([
    [1, true],
    [7, true],
    [0, false],
    [8, false],
    [1.5, false],
    ["1", false],
    [null, false],
  ])("isIsoWeekday(%s) → %s", (value, expected) => {
    expect(isIsoWeekday(value)).toBe(expected);
  });
});
