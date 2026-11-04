/**
 * Cohort dates on the one London clock (plan 02 step 3, R8, R17). Every block runs under three host zones — CI
 * runs UTC and a developer's machine may not — so no answer can depend on the host's zone. The zone names are
 * IANA spellings the sweep allows (`Etc/GMT-11` is eleven hours east; no place name in `src/`).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { londonToday } from "@/lib/timezone";
import { daysBetween, formatCohortDate, formatCohortShort, formatDayMonth, isLondonDate, nextMonday } from "./dates";

const HOST_ZONES = ["UTC", "Etc/GMT-11", "America/New_York"] as const;

describe.each(HOST_ZONES)("cohort dates with the host in %s", (zone) => {
  let previous: string | undefined;
  beforeAll(() => {
    previous = process.env.TZ;
    process.env.TZ = zone;
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  });

  describe("today in London", () => {
    it.each([
      ["the morning the clocks go forward", "2027-03-28T00:30:00Z", "2027-03-28"],
      ["30 June 23:30 UTC is already 1 July in London (BST)", "2027-06-30T23:30:00Z", "2027-07-01"],
      ["Sunday 31 January 23:30 UTC is still 31 January (GMT)", "2027-01-31T23:30:00Z", "2027-01-31"],
      ["a summer Sunday 23:30 UTC is Monday in London", "2027-06-27T23:30:00Z", "2027-06-28"],
    ])("%s", (_label, instant, expected) => {
      expect(londonToday(new Date(instant))).toBe(expected);
    });
  });

  describe("formatCohortDate — 'Mon 1 Feb 2027', never the host's zone", () => {
    it.each([
      ["2027-02-01", "Mon 1 Feb 2027", "Mon 1 Feb"],
      ["2027-03-29", "Mon 29 Mar 2027", "Mon 29 Mar"],
      ["2027-11-01", "Mon 1 Nov 2027", "Mon 1 Nov"],
      ["2026-12-31", "Thu 31 Dec 2026", "Thu 31 Dec"],
    ])("%s", (date, long, short) => {
      expect(formatCohortDate(date)).toBe(long);
      expect(formatCohortShort(date)).toBe(short);
    });

    it("returns anything that isn't a London date unchanged", () => {
      expect(formatCohortDate("soon")).toBe("soon");
      expect(formatCohortShort("2027-02-30")).toBe("2027-02-30");
    });
  });

  describe("formatDayMonth — an instant as its London day and month", () => {
    it.each([
      ["2027-02-03T10:00:00Z", "3 Feb"],
      ["2027-06-30T23:30:00Z", "1 Jul"],
      ["2027-01-31T23:30:00Z", "31 Jan"],
    ])("%s → %s", (instant, expected) => {
      expect(formatDayMonth(instant)).toBe(expected);
    });

    it("an unreadable instant is a dash", () => {
      expect(formatDayMonth("not a time")).toBe("—");
    });
  });

  describe("nextMonday — the form's suggested first start", () => {
    it.each([
      ["a Wednesday", "2026-11-04", "2026-11-09"],
      ["a Sunday", "2027-01-31", "2027-02-01"],
      ["a Monday suggests the Monday after", "2027-02-01", "2027-02-08"],
      ["across the clocks going forward", "2027-03-27", "2027-03-29"],
    ])("%s", (_label, today, expected) => {
      expect(nextMonday(today)).toBe(expected);
    });
  });

  describe("daysBetween — calendar days, so clock changes never matter", () => {
    it.each([
      ["2027-03-22", "2027-03-29", 7],
      ["2027-10-25", "2027-11-01", 7],
      ["2027-02-01", "2027-01-25", -7],
      ["2027-02-01", "2027-02-01", 0],
    ])("%s → %s = %d", (from, to, days) => {
      expect(daysBetween(from, to)).toBe(days);
    });
  });
});

describe("isLondonDate", () => {
  it.each(["2027-02-01", "2028-02-29"])("accepts %s", (date) => {
    expect(isLondonDate(date)).toBe(true);
  });
  it.each(["2027-02-29", "2027-13-01", "2027-2-1", "", "2027-02-01T00:00", 20270201, null, undefined])("refuses %s", (value) => {
    expect(isLondonDate(value)).toBe(false);
  });
});
