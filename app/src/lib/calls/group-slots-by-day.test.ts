/**
 * Slots grouped by London day for the picker (plan A4; port of LDN1 `group-slots-by-day.ts`, 24-hour words).
 * One group per day with the full date as its legend; every option named "… (London time)" (brief §2, picker
 * semantics). A day with no free slot is simply absent.
 */
import { describe, expect, it } from "vitest";
import { groupSlotsByDay } from "./group-slots-by-day";

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
    expect(days[0].slots[0].name).toBe("Tuesday 9 February, 14:00 (London time)");
    expect(days[1].slots[0]).toEqual({
      startsAt: "2027-02-11T09:30:00.000Z",
      endsAt: "2027-02-11T10:00:00.000Z",
      time: "09:30",
      name: "Thursday 11 February, 09:30 (London time)",
    });
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
