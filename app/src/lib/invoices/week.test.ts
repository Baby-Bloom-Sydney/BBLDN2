/**
 * Invoice weeks and dates (plan 06 step 3; R22: built on the one London clock in `src/lib/timezone.ts`, no copy).
 * Every block runs with the host in three zones, as `timezone.london.test.ts` does: CI runs UTC, a laptop may not.
 *
 * BB-wave1-041126/06a-build, 2026-11-04.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { londonDateOf, londonMondayOf } from "@/lib/timezone";
import {
  isFutureLondonDate,
  isLondonDate,
  isLondonMonday,
  issueDateLabel,
  londonDayRange,
  londonWeekStart,
  shiftDateLabel,
  weekEndOf,
  weekOfLabel,
  weekRangeLabel,
} from "./week";

const HOST_ZONES = ["UTC", "Etc/GMT-11", "America/New_York"] as const;

describe.each(HOST_ZONES)("invoice weeks with the host in %s", (zone) => {
  let previous: string | undefined;
  beforeAll(() => {
    previous = process.env.TZ;
    process.env.TZ = zone;
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  });

  it("londonWeekStart is the one clock's Monday (R21: a re-export, not a copy)", () => {
    expect(londonWeekStart).toBe(londonMondayOf);
    expect(londonWeekStart("2027-02-14")).toBe("2027-02-08");
    expect(londonWeekStart("2027-02-08")).toBe("2027-02-08");
  });

  it.each([
    ["Sunday 23:30 BST, the night the clocks went forward", "2027-03-28T22:30:00Z", "2027-03-22"],
    ["Monday 00:30 BST", "2027-03-28T23:30:00Z", "2027-03-29"],
    ["Sunday 23:30 GMT, the night the clocks went back", "2027-10-31T23:30:00Z", "2027-10-25"],
    ["Monday 00:30 GMT", "2027-11-01T00:30:00Z", "2027-11-01"],
  ])("an instant on %s falls in the week of %s", (_label, instant, monday) => {
    expect(londonWeekStart(londonDateOf(new Date(instant)))).toBe(monday);
  });

  it("isLondonDate accepts only real calendar dates", () => {
    expect(isLondonDate("2027-02-08")).toBe(true);
    expect(isLondonDate("2028-02-29")).toBe(true);
    for (const bad of ["2027-02-30", "2027-13-01", "2027-2-8", "08/02/2027", "", "2027-02-08T00:00:00Z"]) {
      expect(isLondonDate(bad)).toBe(false);
    }
  });

  it("isLondonMonday is a real date that is its own week's Monday", () => {
    expect(isLondonMonday("2027-02-08")).toBe(true);
    expect(isLondonMonday("2027-02-09")).toBe(false);
    expect(isLondonMonday("2027-02-31")).toBe(false);
  });

  it("a date is future only after London's today (this week can be invoiced; brief §3 nanny 4)", () => {
    const sundayLateBst = new Date("2027-06-13T22:30:00Z"); // 23:30 Sunday 13 June in London
    expect(isFutureLondonDate("2027-06-13", sundayLateBst)).toBe(false);
    expect(isFutureLondonDate("2027-06-14", sundayLateBst)).toBe(true);
    expect(isFutureLondonDate("2027-06-07", sundayLateBst)).toBe(false);
  });

  it("weekEndOf is the Sunday", () => {
    expect(weekEndOf("2027-02-08")).toBe("2027-02-14");
    expect(weekEndOf("2027-03-29")).toBe("2027-04-04");
  });

  it("londonDayRange is London's midnight to midnight, as a half-open UTC range (the daily cap)", () => {
    expect(londonDayRange(new Date("2027-06-15T12:00:00Z"))).toEqual({
      fromUtc: "2027-06-14T23:00:00.000Z",
      toUtc: "2027-06-15T23:00:00.000Z",
    });
    expect(londonDayRange(new Date("2027-01-15T12:00:00Z"))).toEqual({
      fromUtc: "2027-01-15T00:00:00.000Z",
      toUtc: "2027-01-16T00:00:00.000Z",
    });
    // the day the clocks go forward is 23 hours long
    expect(londonDayRange(new Date("2027-03-28T12:00:00Z"))).toEqual({
      fromUtc: "2027-03-28T00:00:00.000Z",
      toUtc: "2027-03-28T23:00:00.000Z",
    });
  });

  it("labels the week, the week's Monday and a Trial Shift date (plan §3a)", () => {
    expect(weekRangeLabel("2027-02-08")).toBe("8–14 Feb 2027");
    expect(weekRangeLabel("2027-03-29")).toBe("29 Mar – 4 Apr 2027");
    expect(weekRangeLabel("2026-12-28")).toBe("28 Dec 2026 – 3 Jan 2027");
    expect(weekOfLabel("2027-02-08")).toBe("8 Feb 2027");
    expect(shiftDateLabel("2027-02-03")).toBe("Wed 3 Feb 2027");
  });

  it("labels the issue date in London (an instant just after midnight BST is the next day)", () => {
    expect(issueDateLabel(new Date("2027-02-15T09:00:00Z"))).toBe("15 Feb 2027");
    expect(issueDateLabel(new Date("2027-06-14T23:30:00Z"))).toBe("15 Jun 2027");
    expect(issueDateLabel("2027-06-14T23:30:00Z")).toBe("15 Jun 2027");
  });

  it("refuses to label what isn't a date (never prints Invalid Date)", () => {
    expect(() => weekRangeLabel("2027-02-31")).toThrow(RangeError);
    expect(() => shiftDateLabel("tomorrow")).toThrow(RangeError);
    expect(() => issueDateLabel("not a time")).toThrow(RangeError);
  });
});

