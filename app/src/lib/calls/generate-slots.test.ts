/**
 * Weekly hours → slot grid (plan A4; port of LDN1 `scheduling/lib/generate-slots.ts` on the one London clock).
 * The grid is anchored at each range's start; wall times the clocks skip are left out; the repeated autumn hour
 * gives one slot per clock time (brief §3 parent 7, §9.14).
 */
import { describe, expect, it } from "vitest";
import { generateSlots } from "./generate-slots";
import type { WeeklyHoursRange } from "./types";
import type { IsoWeekday } from "./weekday";

const range = (weekday: IsoWeekday, start: string, end: string): WeeklyHoursRange => {
  const minutes = (clock: string) => {
    const [h, m] = clock.split(":").map(Number);
    return h * 60 + m;
  };
  return { weekday, startMinute: minutes(start), endMinute: minutes(end) };
};

const everyDay = (start: string, end: string): WeeklyHoursRange[] =>
  ([1, 2, 3, 4, 5, 6, 7] as const).map((d) => range(d, start, end));

describe("generateSlots", () => {
  it("puts 09:00–19:00 on a 30-minute grid, last slot ending at 19:00 (GMT)", () => {
    const slots = generateSlots({ hours: everyDay("09:00", "19:00"), fromDate: "2027-02-04", toDate: "2027-02-04", slotMinutes: 30 });
    expect(slots).toHaveLength(20);
    expect(slots[0]).toEqual({ startsAt: "2027-02-04T09:00:00.000Z", endsAt: "2027-02-04T09:30:00.000Z" });
    expect(slots.at(-1)).toEqual({ startsAt: "2027-02-04T18:30:00.000Z", endsAt: "2027-02-04T19:00:00.000Z" });
  });

  it("reads the London clock in BST (09:00 London = 08:00Z)", () => {
    const slots = generateSlots({ hours: everyDay("09:00", "10:00"), fromDate: "2027-07-13", toDate: "2027-07-13", slotMinutes: 30 });
    expect(slots.map((s) => s.startsAt)).toEqual(["2027-07-13T08:00:00.000Z", "2027-07-13T08:30:00.000Z"]);
  });

  it("only uses the ranges on each date's ISO weekday, weekends included", () => {
    const slots = generateSlots({
      hours: [range(6, "10:00", "11:00"), range(1, "09:00", "09:30")],
      fromDate: "2027-02-04", // Thursday
      toDate: "2027-02-08", // Monday
      slotMinutes: 30,
    });
    expect(slots.map((s) => s.startsAt)).toEqual([
      "2027-02-06T10:00:00.000Z",
      "2027-02-06T10:30:00.000Z",
      "2027-02-08T09:00:00.000Z",
    ]);
  });

  it("anchors a 45-minute grid at the range start and never runs past its end", () => {
    const slots = generateSlots({ hours: [range(4, "09:00", "11:00")], fromDate: "2027-02-04", toDate: "2027-02-04", slotMinutes: 45 });
    expect(slots.map((s) => s.startsAt)).toEqual(["2027-02-04T09:00:00.000Z", "2027-02-04T09:45:00.000Z"]);
    expect(slots.at(-1)?.endsAt).toBe("2027-02-04T10:30:00.000Z");
  });

  it("gives several ranges on one day their own grids", () => {
    const slots = generateSlots({
      hours: [range(4, "14:00", "15:00"), range(4, "09:00", "09:30")],
      fromDate: "2027-02-04",
      toDate: "2027-02-04",
      slotMinutes: 30,
    });
    expect(slots.map((s) => s.startsAt)).toEqual([
      "2027-02-04T09:00:00.000Z",
      "2027-02-04T14:00:00.000Z",
      "2027-02-04T14:30:00.000Z",
    ]);
  });

  it("returns [] with no hours", () => {
    expect(generateSlots({ hours: [], fromDate: "2027-02-04", toDate: "2027-02-11", slotMinutes: 30 })).toEqual([]);
  });

  it("returns [] when the dates are the wrong way round", () => {
    expect(generateSlots({ hours: everyDay("09:00", "19:00"), fromDate: "2027-02-05", toDate: "2027-02-04", slotMinutes: 30 })).toEqual([]);
  });

  it("skips the hour the clocks skip on Sun 28 Mar 2027 (no 01:00–01:59 slot)", () => {
    const slots = generateSlots({ hours: [range(7, "00:00", "03:00")], fromDate: "2027-03-28", toDate: "2027-03-28", slotMinutes: 30 });
    expect(slots.map((s) => s.startsAt)).toEqual([
      "2027-03-28T00:00:00.000Z", // 00:00 GMT
      "2027-03-28T00:30:00.000Z", // 00:30 GMT
      "2027-03-28T01:00:00.000Z", // 02:00 BST
      "2027-03-28T01:30:00.000Z", // 02:30 BST
    ]);
  });

  it("never offers two overlapping slots across the spring gap (45-minute grid)", () => {
    const slots = generateSlots({ hours: [range(7, "00:00", "04:00")], fromDate: "2027-03-28", toDate: "2027-03-28", slotMinutes: 45 });
    for (let i = 1; i < slots.length; i += 1) {
      expect(slots[i].startsAt >= slots[i - 1].endsAt).toBe(true);
    }
  });

  it("gives one slot per clock time in the repeated hour on Sun 31 Oct 2027", () => {
    const slots = generateSlots({ hours: [range(7, "00:00", "03:00")], fromDate: "2027-10-31", toDate: "2027-10-31", slotMinutes: 30 });
    const starts = slots.map((s) => s.startsAt);
    expect(starts).toEqual([
      "2027-10-30T23:00:00.000Z", // 00:00 BST
      "2027-10-30T23:30:00.000Z", // 00:30 BST
      "2027-10-31T01:00:00.000Z", // 01:00 GMT (one, not two)
      "2027-10-31T01:30:00.000Z",
      "2027-10-31T02:00:00.000Z",
      "2027-10-31T02:30:00.000Z",
    ]);
    expect(new Set(starts).size).toBe(starts.length);
  });

  it("gives the same slots in every host zone", () => {
    const previous = process.env.TZ;
    const run = () => generateSlots({ hours: everyDay("09:00", "19:00"), fromDate: "2027-06-30", toDate: "2027-07-01", slotMinutes: 30 });
    try {
      process.env.TZ = "UTC";
      const utc = run();
      process.env.TZ = "Etc/GMT-11";
      expect(run()).toEqual(utc);
      process.env.TZ = "America/New_York";
      expect(run()).toEqual(utc);
    } finally {
      process.env.TZ = previous;
    }
  });
});
