/**
 * The two clock helpers every time label in the app now goes through.
 *
 * Every expected string is produced by `Intl` at test time, never typed by
 * hand: a test that hardcodes `"14:30"` pins today's `en-GB` separator rather
 * than the rule (`LEDGER/2-0.md` §8, lesson 3).
 */

import { describe, expect, it } from "vitest";
import { APP_LOCALE } from "@/lib/constants";
import {
  TIME_BRACKETS,
  formatClockHourMinute,
  formatClockTime,
  getBracketTimeOptions,
} from "@/lib/timezone";

/** What the locale itself renders for a wall-clock hour and minute. */
function viaIntl(hour: number, minute: number): string {
  return new Date(Date.UTC(2000, 0, 1, hour, minute)).toLocaleTimeString(
    APP_LOCALE,
    { hour: "2-digit", minute: "2-digit", timeZone: "UTC" },
  );
}

describe("formatClockHourMinute", () => {
  it("renders the hour and minute through the locale", () => {
    for (const [h, m] of [
      [0, 0],
      [6, 30],
      [12, 0],
      [13, 45],
      [19, 47],
      [23, 15],
    ] as const) {
      expect(formatClockHourMinute(h, m)).toBe(viaIntl(h, m));
    }
  });

  it("carries no am/pm marker on a 24-hour locale", () => {
    for (let h = 0; h < 24; h++) {
      expect(formatClockHourMinute(h, 0)).not.toMatch(/[ap]m/i);
    }
  });

  it("does not shift a wall-clock time by the zone offset", () => {
    // `start_time` values are already London wall-clock. Formatting them
    // through `APP_TZ` would add the BST offset a second time and move every
    // summer slot by an hour — the one regression this pair must not have.
    const summerAfternoon = formatClockHourMinute(14, 30);
    const winterAfternoon = formatClockHourMinute(14, 30);
    expect(summerAfternoon).toBe(winterAfternoon);
    expect(summerAfternoon).toBe(viaIntl(14, 30));
  });
});

describe("formatClockTime", () => {
  it('renders an "HH:MM" wall-clock string through the locale', () => {
    expect(formatClockTime("19:47")).toBe(viaIntl(19, 47));
    expect(formatClockTime("06:00")).toBe(viaIntl(6, 0));
    expect(formatClockTime("00:15")).toBe(viaIntl(0, 15));
  });

  it("returns the input unchanged when it is not a time", () => {
    expect(formatClockTime("")).toBe("");
    expect(formatClockTime("not a time")).toBe("not a time");
  });
});

describe("the shared time picker", () => {
  it("labels every bracket option on the locale's clock", () => {
    for (const bracket of ["morning", "midday", "afternoon", "evening"] as const) {
      for (const option of getBracketTimeOptions(bracket)) {
        expect(option.label).toBe(viaIntl(option.hour, option.minute));
      }
    }
  });

  it("reads its bracket headers on the same clock as its options", () => {
    // `ParentConnectionsClient` renders the sublabel directly above the option
    // grid; two clocks in one control is worse than either alone.
    for (const bracket of Object.values(TIME_BRACKETS)) {
      expect(bracket.sublabel).not.toMatch(/[ap]m/i);
      expect(bracket.sublabel).toContain(viaIntl(bracket.startHour, 0));
      expect(bracket.sublabel).toContain(viaIntl(bracket.endHour, 0));
    }
  });
});
