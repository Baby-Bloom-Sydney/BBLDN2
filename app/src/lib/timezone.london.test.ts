/**
 * The one London clock (BUILD/README § Wave 1 alignment, item 2; brief 04 §6, §9.14).
 *
 * Every helper here must give the same answer whatever zone the host runs in — CI runs UTC, BAI's machine runs
 * east of UTC — so each block runs under three host zones. The zone names are IANA spellings the sweep allows
 * (`Etc/GMT-11` is eleven hours east; no place name is written in `src/`, LEDGER/B04 D9).
 *
 * BB-wave1-041126, 2026-11-04.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addLondonDays,
  localToUTC,
  londonDateOf,
  londonMondayOf,
  londonToday,
  londonWeekRange,
  wallClockExists,
} from "@/lib/timezone";

const HOST_ZONES = ["UTC", "Etc/GMT-11", "America/New_York"] as const;

describe.each(HOST_ZONES)("London clock with the host in %s", (zone) => {
  let previous: string | undefined;
  beforeAll(() => {
    previous = process.env.TZ;
    process.env.TZ = zone;
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  });

  describe("localToUTC — a London wall clock as the instant it names", () => {
    it.each([
      ["winter (GMT)", "2027-01-15", 14, 0, "2027-01-15T14:00:00.000Z"],
      ["summer (BST)", "2027-06-15", 14, 0, "2027-06-15T13:00:00.000Z"],
      ["30 June 23:30 BST — the instant is still 30 June", "2027-06-30", 23, 30, "2027-06-30T22:30:00.000Z"],
      ["31 March 23:30 BST — a month boundary", "2027-03-31", 23, 30, "2027-03-31T22:30:00.000Z"],
      ["the morning the clocks go forward, before the gap", "2027-03-28", 0, 30, "2027-03-28T00:30:00.000Z"],
      ["the morning the clocks go forward, after the gap", "2027-03-28", 2, 0, "2027-03-28T01:00:00.000Z"],
      ["the night the clocks go back, after the repeat", "2027-10-31", 2, 0, "2027-10-31T02:00:00.000Z"],
      ["the night the clocks go back, before the repeat", "2027-10-31", 0, 30, "2027-10-30T23:30:00.000Z"],
    ])("%s", (_label, date, hour, minute, expected) => {
      expect(localToUTC(date, hour, minute)).toBe(expected);
    });

    it("gives one instant for the repeated hour when the clocks go back", () => {
      expect(localToUTC("2027-10-31", 1, 30)).toBe("2027-10-31T01:30:00.000Z");
    });
  });

  describe("wallClockExists — the hour the clocks skip", () => {
    it("01:00–01:59 on 28 March 2027 does not exist in London", () => {
      expect(wallClockExists("2027-03-28", 1, 0)).toBe(false);
      expect(wallClockExists("2027-03-28", 1, 59)).toBe(false);
    });

    it("the times either side of the gap, and the repeated hour, exist", () => {
      expect(wallClockExists("2027-03-28", 0, 59)).toBe(true);
      expect(wallClockExists("2027-03-28", 2, 0)).toBe(true);
      expect(wallClockExists("2027-10-31", 1, 30)).toBe(true);
    });
  });

  describe("londonDateOf / londonToday", () => {
    it("23:30Z on a July evening is already the next London day", () => {
      expect(londonDateOf("2027-07-14T23:30:00.000Z")).toBe("2027-07-15");
    });

    it("23:30Z on a January evening is still the same London day", () => {
      expect(londonDateOf(new Date("2027-01-14T23:30:00.000Z"))).toBe("2027-01-14");
    });

    it("londonToday reads the given clock", () => {
      expect(londonToday(new Date("2027-06-30T23:30:00.000Z"))).toBe("2027-07-01");
    });
  });

  describe("addLondonDays / londonMondayOf", () => {
    it("adds calendar days across a month and a clock change", () => {
      expect(addLondonDays("2027-03-27", 2)).toBe("2027-03-29");
      expect(addLondonDays("2027-02-01", -1)).toBe("2027-01-31");
    });

    it("finds the Monday of any date's week, Monday itself included", () => {
      expect(londonMondayOf("2027-02-01")).toBe("2027-02-01");
      expect(londonMondayOf("2027-02-07")).toBe("2027-02-01");
      expect(londonMondayOf("2027-02-08")).toBe("2027-02-08");
    });
  });

  describe("londonWeekRange — Monday 00:00 to the next Monday 00:00, London, half-open", () => {
    it("a winter week is seven 24-hour days", () => {
      expect(londonWeekRange(new Date("2027-02-03T12:00:00.000Z"))).toEqual({
        fromUtc: "2027-02-01T00:00:00.000Z",
        toUtc: "2027-02-08T00:00:00.000Z",
      });
    });

    it("the week the clocks go forward is an hour short", () => {
      expect(londonWeekRange(new Date("2027-03-24T12:00:00.000Z"))).toEqual({
        fromUtc: "2027-03-22T00:00:00.000Z",
        toUtc: "2027-03-28T23:00:00.000Z",
      });
    });

    it("the week the clocks go back is an hour long", () => {
      expect(londonWeekRange(new Date("2027-10-27T12:00:00.000Z"))).toEqual({
        fromUtc: "2027-10-24T23:00:00.000Z",
        toUtc: "2027-11-01T00:00:00.000Z",
      });
    });

    it("Sunday 23:30 London in summer is still the week before", () => {
      expect(londonWeekRange(new Date("2027-07-18T22:30:00.000Z")).fromUtc).toBe("2027-07-11T23:00:00.000Z");
    });
  });
});
