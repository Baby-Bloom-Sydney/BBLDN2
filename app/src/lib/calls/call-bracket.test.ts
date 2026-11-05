/**
 * Which time-of-day column a call slot sits in (04b rework W4): the meet-and-greet picker's four `TIME_BRACKETS`
 * (Morning 08–11, Midday 11–14, Afternoon 14–17, Evening 17–20), through `getBracketForHour` (`lib/timezone.ts`).
 * Call hours can run outside 08:00–20:00 (BAI sets them), so a slot before 08:00 folds into Morning and one from
 * 20:00 into Evening — never dropped.
 */
import { describe, expect, it } from "vitest";
import { callBracketOf } from "./call-bracket";

describe("callBracketOf", () => {
  it.each([
    [8, "morning"],
    [10, "morning"],
    [11, "midday"],
    [13, "midday"],
    [14, "afternoon"],
    [16, "afternoon"],
    [17, "evening"],
    [19, "evening"],
  ])("%i:xx → %s (inside the brackets)", (hour, bracket) => {
    expect(callBracketOf(hour)).toBe(bracket);
  });

  it.each([
    [0, "morning"],
    [6, "morning"],
    [7, "morning"],
    [20, "evening"],
    [21, "evening"],
    [23, "evening"],
  ])("%i:xx → %s (folded in from outside 08:00–20:00)", (hour, bracket) => {
    expect(callBracketOf(hour)).toBe(bracket);
  });
});
