/**
 * Slot labels (plan A3 → R24: call-specific wrappers only; R20's short form). London, 24-hour, assembled from
 * `formatToParts` so an ICU change to en-GB's comma can't move them (plan R6). Same words in every host zone.
 */
import { describe, expect, it } from "vitest";
import { slotWords } from "./slot-words";

const HOST_ZONES = ["UTC", "Etc/GMT-11", "America/New_York"] as const;

describe.each(HOST_ZONES)("slotWords with the host in %s", (zone) => {
  const inZone = <T>(fn: () => T): T => {
    const previous = process.env.TZ;
    process.env.TZ = zone;
    try {
      return fn();
    } finally {
      process.env.TZ = previous;
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
