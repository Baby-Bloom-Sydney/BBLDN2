/**
 * Free slots, pure (plan A4): slots − blocks − overlap with live holds and booked calls − before now + notice
 * − after now + window. The pre-book mode (one London date) keeps the notice and drops the window.
 * The §9.2 fixture: hours 09:00–19:00 every day, clock Thu 4 Feb 2027 10:00 London.
 */
import { describe, expect, it } from "vitest";
import { candidateSlots, computeFreeSlots, spanOf, withoutTaken } from "./free-slots";
import { CALL_SETTINGS_DEFAULTS } from "./settings";
import type { CallSettings, WeeklyHoursRange } from "./types";

const EVERY_DAY_9_TO_7: WeeklyHoursRange[] = ([1, 2, 3, 4, 5, 6, 7] as const).map((weekday) => ({
  weekday,
  startMinute: 540,
  endMinute: 1140,
}));
const NOW = new Date("2027-02-04T10:00:00.000Z"); // Thu 4 Feb 2027 10:00 London (GMT)
const SETTINGS: CallSettings = CALL_SETTINGS_DEFAULTS;

const base = {
  hours: EVERY_DAY_9_TO_7,
  settings: SETTINGS,
  blocks: [],
  bookings: [],
  now: NOW,
};

describe("computeFreeSlots — the 7-day window (§9.2)", () => {
  const slots = computeFreeSlots(base);

  it("starts at now + 2 hours (Thu 12:00) and ends at Thu 11 Feb 10:00, inclusive", () => {
    expect(slots[0].startsAt).toBe("2027-02-04T12:00:00.000Z");
    expect(slots.at(-1)?.startsAt).toBe("2027-02-11T10:00:00.000Z");
  });

  it("is 30 minutes apart within a day", () => {
    const thursday = slots.filter((s) => s.startsAt.startsWith("2027-02-04"));
    expect(thursday.map((s) => s.startsAt.slice(11, 16))).toEqual([
      "12:00", "12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30",
      "16:00", "16:30", "17:00", "17:30", "18:00", "18:30",
    ]);
  });

  it("includes Saturday and Sunday", () => {
    expect(slots.some((s) => s.startsAt.startsWith("2027-02-06"))).toBe(true);
    expect(slots.some((s) => s.startsAt.startsWith("2027-02-07"))).toBe(true);
  });

  it("counts every slot: 14 on Thu, 20 a day Fri–Wed, 3 on the last Thursday", () => {
    expect(slots).toHaveLength(14 + 6 * 20 + 3);
  });
});

describe("computeFreeSlots — what takes a slot away", () => {
  it("never offers a 45-minute slot overlapping a 30-minute booking", () => {
    const slots = computeFreeSlots({
      ...base,
      settings: { ...SETTINGS, slotMinutes: 45 },
      bookings: [{ startsAt: "2027-02-05T10:00:00.000Z", endsAt: "2027-02-05T10:30:00.000Z", status: "booked", holdExpiresAt: null }],
    });
    const friday = slots.filter((s) => s.startsAt.startsWith("2027-02-05")).map((s) => s.startsAt.slice(11, 16));
    // 45-minute grid from 09:00: 09:00, 09:45 (overlaps 10:00–10:30), 10:30, …
    expect(friday.slice(0, 3)).toEqual(["09:00", "10:30", "11:15"]);
  });

  it("removes slots under a block, and removing the block restores them", () => {
    const block = { startsAt: "2027-02-05T09:00:00.000Z", endsAt: "2027-02-05T13:00:00.000Z" };
    const blocked = computeFreeSlots({ ...base, blocks: [block] });
    const friday = (list: typeof blocked) => list.filter((s) => s.startsAt.startsWith("2027-02-05"));
    expect(friday(blocked)[0].startsAt).toBe("2027-02-05T13:00:00.000Z");
    expect(friday(blocked)).toHaveLength(12);
    expect(friday(computeFreeSlots(base))).toHaveLength(20);
  });

  it("does not offer a slot someone else holds, until the hold has run out", () => {
    const held = { startsAt: "2027-02-05T10:00:00.000Z", endsAt: "2027-02-05T10:30:00.000Z", status: "held" as const };
    const live = computeFreeSlots({ ...base, bookings: [{ ...held, holdExpiresAt: "2027-02-04T10:05:00.000Z" }] });
    const expired = computeFreeSlots({ ...base, bookings: [{ ...held, holdExpiresAt: "2027-02-04T09:59:00.000Z" }] });
    expect(live.some((s) => s.startsAt === held.startsAt)).toBe(false);
    expect(expired.some((s) => s.startsAt === held.startsAt)).toBe(true);
  });

  it("ignores cancelled, done and no-answer rows", () => {
    const at = { startsAt: "2027-02-05T10:00:00.000Z", endsAt: "2027-02-05T10:30:00.000Z", holdExpiresAt: null };
    const slots = computeFreeSlots({
      ...base,
      bookings: (["cancelled", "done", "no_answer"] as const).map((status) => ({ ...at, status })),
    });
    expect(slots.some((s) => s.startsAt === at.startsAt)).toBe(true);
  });

  it("offers nothing with no hours", () => {
    expect(computeFreeSlots({ ...base, hours: [] })).toEqual([]);
  });

  it("honours a zero-minute notice", () => {
    const slots = computeFreeSlots({ ...base, settings: { ...SETTINGS, noticeMinutes: 0 } });
    expect(slots[0].startsAt).toBe("2027-02-04T10:00:00.000Z");
  });
});

describe("computeFreeSlots — one London date (the cohort pre-book, brief §0.14, §11 Q9)", () => {
  const ASKED_ON = new Date("2027-01-28T10:00:00.000Z"); // Thu 28 Jan 2027

  it("returns that day only, even beyond the 7-day window", () => {
    const slots = computeFreeSlots({ ...base, now: ASKED_ON, londonDate: "2027-02-08", ignoreWindow: true });
    expect(slots).toHaveLength(20);
    expect(slots.every((s) => s.startsAt.startsWith("2027-02-08"))).toBe(true);
  });

  it("keeps the window when not asked to drop it", () => {
    expect(computeFreeSlots({ ...base, now: ASKED_ON, londonDate: "2027-02-08" })).toEqual([]);
  });

  it("keeps the notice on that date", () => {
    const slots = computeFreeSlots({ ...base, londonDate: "2027-02-04", ignoreWindow: true });
    expect(slots[0].startsAt).toBe("2027-02-04T12:00:00.000Z");
  });

  it("returns [] for a date in the past", () => {
    expect(computeFreeSlots({ ...base, londonDate: "2027-02-03", ignoreWindow: true })).toEqual([]);
  });
});

describe("candidateSlots / withoutTaken / spanOf — the two-step read booking.ts uses", () => {
  it("gives the same answer as computeFreeSlots", () => {
    const block = { startsAt: "2027-02-05T09:00:00.000Z", endsAt: "2027-02-05T13:00:00.000Z" };
    const candidates = candidateSlots(base);
    expect(withoutTaken(candidates, { blocks: [block], bookings: [], now: NOW })).toEqual(
      computeFreeSlots({ ...base, blocks: [block] }),
    );
  });

  it("spans the first start to the last end, or null for none", () => {
    const candidates = candidateSlots(base);
    expect(spanOf(candidates)).toEqual({ startsAt: "2027-02-04T12:00:00.000Z", endsAt: "2027-02-11T10:30:00.000Z" });
    expect(spanOf([])).toBeNull();
  });
});
