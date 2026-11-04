/** Weekly call hours (plan A5; brief §3 admin 5): several ranges a day, overlap refused, touching allowed. */
import { describe, expect, it } from "vitest";
import { validateWeeklyHours, weeklyHoursFromRows } from "./hours";

const r = (weekday: number, startMinute: number, endMinute: number) => ({ weekday, startMinute, endMinute });

describe("validateWeeklyHours", () => {
  it("accepts several ranges a day and returns them sorted", () => {
    expect(validateWeeklyHours([r(6, 600, 840), r(1, 840, 1140), r(1, 540, 720)])).toEqual({
      ok: true,
      value: [r(1, 540, 720), r(1, 840, 1140), r(6, 600, 840)],
    });
  });

  it("allows ranges that touch", () => {
    expect(validateWeeklyHours([r(2, 540, 720), r(2, 720, 840)]).ok).toBe(true);
  });

  it("allows the same times on different days", () => {
    expect(validateWeeklyHours([r(2, 540, 1140), r(3, 540, 1140)]).ok).toBe(true);
  });

  it("refuses overlapping ranges on one day", () => {
    expect(validateWeeklyHours([r(2, 540, 720), r(2, 700, 840)])).toEqual({ ok: false, error: "overlap" });
    expect(validateWeeklyHours([r(2, 540, 1140), r(2, 600, 660)])).toEqual({ ok: false, error: "overlap" });
  });

  it("accepts no hours at all (then no slots are offered)", () => {
    expect(validateWeeklyHours([])).toEqual({ ok: true, value: [] });
  });

  it("accepts a range ending at midnight (1440)", () => {
    expect(validateWeeklyHours([r(7, 1380, 1440), r(1, 0, 60)]).ok).toBe(true);
  });

  it.each([
    ["weekday 0", [r(0, 540, 600)]],
    ["weekday 8", [r(8, 540, 600)]],
    ["start after end", [r(1, 700, 600)]],
    ["start equal to end", [r(1, 600, 600)]],
    ["end past midnight", [r(1, 600, 1441)]],
    ["negative start", [r(1, -1, 600)]],
    ["a fraction", [r(1, 540.5, 600)]],
    ["a string", [{ weekday: "1", startMinute: 540, endMinute: 600 }]],
    ["not an array", { weekday: 1 }],
  ])("refuses %s", (_label, input) => {
    expect(validateWeeklyHours(input)).toEqual({ ok: false, error: "invalid" });
  });
});

describe("weeklyHoursFromRows — the database rows", () => {
  it("maps snake_case rows and sorts them", () => {
    expect(
      weeklyHoursFromRows([
        { weekday: 2, start_minute: 540, end_minute: 1140 },
        { weekday: 1, start_minute: 540, end_minute: 1140 },
      ]),
    ).toEqual([r(1, 540, 1140), r(2, 540, 1140)]);
  });

  it("returns null for rows that aren't hours", () => {
    expect(weeklyHoursFromRows(null)).toBeNull();
    expect(weeklyHoursFromRows([{ weekday: 9, start_minute: 0, end_minute: 60 }])).toBeNull();
  });
});
