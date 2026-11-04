/**
 * Slot labels (plan A3 → R24: call-specific wrappers only; R20's short form). London, 24-hour, assembled from
 * `formatToParts` so an ICU change to en-GB's comma can't move them (plan R6). Same words in every host zone.
 */
import { describe, expect, it } from "vitest";
import { dayWords, slotHour, slotWords } from "./slot-words";

const HOST_ZONES = ["UTC", "Etc/GMT-11", "America/New_York"] as const;

describe.each(HOST_ZONES)("slotWords with the host in %s", (zone) => {
  const inZone = <T>(fn: () => T): T => {
    const previous = process.env.TZ;
    process.env.TZ = zone;
    try {
      return fn();
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  };

  it("names a winter (GMT) slot", () => {
    const words = inZone(() => slotWords("2027-02-09T14:00:00.000Z"));
    expect(words).toEqual({
      londonDate: "2027-02-09",
      weekday: "Tuesday",
      date: "9 February",
      day: "Tuesday 9 February",
      time: "14:00",
      short: "Tue 9 Feb, 14:00",
      full: "Tuesday 9 February, 14:00 (London time)",
    });
  });

  it("names a summer (BST) slot by its London clock", () => {
    const words = inZone(() => slotWords("2027-07-13T13:00:00.000Z"));
    expect(words.time).toBe("14:00");
    expect(words.day).toBe("Tuesday 13 July");
  });

  it("puts 23:30Z in July on the next London day, at 00:30", () => {
    const words = inZone(() => slotWords("2027-07-13T23:30:00.000Z"));
    expect(words.londonDate).toBe("2027-07-14");
    expect(words.day).toBe("Wednesday 14 July");
    expect(words.time).toBe("00:30");
  });

  it("reads midnight as 00:00, never 24:00", () => {
    expect(inZone(() => slotWords("2027-02-09T00:00:00.000Z")).time).toBe("00:00");
  });
});

// ── 04b rework W4: the picker's row label, as the meet-and-greet grid draws it ("Tue" over "9 Feb"). ──
describe.each(HOST_ZONES)("dayWords with the host in %s", (zone) => {
  const inZone = <T>(fn: () => T): T => {
    const previous = process.env.TZ;
    process.env.TZ = zone;
    try {
      return fn();
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  };

  it("names a London date for the grid's row and its full legend", () => {
    expect(inZone(() => dayWords("2027-02-09"))).toEqual({ weekday: "Tue", date: "9 Feb", legend: "Tuesday 9 February" });
    expect(inZone(() => dayWords("2027-07-13"))).toEqual({ weekday: "Tue", date: "13 Jul", legend: "Tuesday 13 July" });
  });

  it("an hour's London 24-hour clock", () => {
    expect(inZone(() => slotHour("2027-07-13T23:30:00.000Z"))).toBe(0);
    expect(inZone(() => slotHour("2027-02-09T07:30:00.000Z"))).toBe(7);
  });
});
