/**
 * Slots grouped by London day for the picker (plan A4; port of LDN1 `group-slots-by-day.ts`, 24-hour words).
 * One group per day with the full date as its legend; every option named "…" (brief §2, picker
 * semantics). A day with no free slot is simply absent.
 */
import { describe, expect, it } from "vitest";
import { groupSlotGridByDay, groupSlotsByDay } from "./group-slots-by-day";

const slot = (startsAt: string) => ({
  startsAt,
  endsAt: new Date(Date.parse(startsAt) + 30 * 60 * 1000).toISOString(),
});

describe("groupSlotsByDay", () => {
  it("groups in order, skips empty days, and names every option in full", () => {
    const days = groupSlotsByDay([
      slot("2027-02-11T09:30:00.000Z"),
      slot("2027-02-09T14:00:00.000Z"),
      slot("2027-02-09T14:30:00.000Z"),
    ]);
    expect(days.map((d) => d.londonDate)).toEqual(["2027-02-09", "2027-02-11"]);
    expect(days[0].legend).toBe("Tuesday 9 February");
    expect(days[0].slots.map((s) => s.time)).toEqual(["14:00", "14:30"]);
    expect(days[0].slots[0].name).toBe("Tuesday 9 February, 14:00");
    expect(days[1].slots[0]).toEqual({
      startsAt: "2027-02-11T09:30:00.000Z",
      endsAt: "2027-02-11T10:00:00.000Z",
      time: "09:30",
      name: "Thursday 11 February, 09:30",
      when: "Thursday 11 February at 09:30",
      bracket: "morning",
      free: true,
    });
    expect(days[1]).toMatchObject({ rowWeekday: "Thu", rowDate: "11 Feb" });
  });

  it("puts a 23:30Z slot in July on the next London day", () => {
    const days = groupSlotsByDay([slot("2027-07-13T23:30:00.000Z")]);
    expect(days[0].londonDate).toBe("2027-07-14");
    expect(days[0].slots[0].time).toBe("00:30");
  });

  it("returns [] for no slots, and does not change its input", () => {
    const input = Object.freeze([slot("2027-02-09T14:30:00.000Z"), slot("2027-02-09T14:00:00.000Z")]);
    expect(groupSlotsByDay([])).toEqual([]);
    groupSlotsByDay(input);
    expect(input[0].startsAt).toBe("2027-02-09T14:30:00.000Z");
  });
});

// ── 04b rework W4 (BAI 2026-11-05: "the unavailable times and dates are greyed out and unable to be selected"):
//    every date in the window is a row — a date with no free slot too — and every grid slot is listed, free or not. ──
describe("groupSlotGridByDay", () => {
  const grid = {
    dates: ["2027-02-09", "2027-02-10", "2027-02-11"],
    slots: [
      { ...slot("2027-02-09T14:00:00.000Z"), free: false },
      { ...slot("2027-02-09T14:30:00.000Z"), free: true },
      { ...slot("2027-02-10T07:30:00.000Z"), free: false },
      { ...slot("2027-02-10T20:00:00.000Z"), free: false },
    ],
  };

  it("one row per date, in order — a date with no free slot, and one with no slots at all, included", () => {
    const days = groupSlotGridByDay(grid);
    expect(days.map((d) => [d.londonDate, d.legend, d.rowWeekday, d.rowDate])).toEqual([
      ["2027-02-09", "Tuesday 9 February", "Tue", "9 Feb"],
      ["2027-02-10", "Wednesday 10 February", "Wed", "10 Feb"],
      ["2027-02-11", "Thursday 11 February", "Thu", "11 Feb"],
    ]);
    expect(days[2].slots).toEqual([]);
  });

  it("every slot keeps its free flag; outside 08:00–20:00 folds into the first and last bracket", () => {
    const days = groupSlotGridByDay(grid);
    expect(days[0].slots.map((s) => [s.time, s.free, s.bracket])).toEqual([
      ["14:00", false, "afternoon"],
      ["14:30", true, "afternoon"],
    ]);
    expect(days[1].slots.map((s) => [s.time, s.bracket])).toEqual([
      ["07:30", "morning"],
      ["20:00", "evening"],
    ]);
  });

  it("a slot on a date outside the list is dropped (the list is the window)", () => {
    const days = groupSlotGridByDay({ dates: ["2027-02-09"], slots: grid.slots });
    expect(days).toHaveLength(1);
    expect(days[0].slots).toHaveLength(2);
  });
});
