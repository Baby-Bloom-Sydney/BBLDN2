/**
 * The Calendar tab's pure parts (plan C5, §13; brief §0.12, §3 admin 5, §9.12):
 *
 * - the 7-day grid from settings, hours, blocks and bookings, on the one London clock: free / booked (with the family's
 *   name) / held / blocked. A free cell is exactly a time a parent may pick now (`free-slots.ts`). A booked call keeps
 *   its own time whatever the slot length; a grid time that would overlap it isn't drawn. A booked call inside a block
 *   is booked and flagged, never cancelled (ADR-077);
 * - native date and time strings ("2027-02-12", "09:00") read as London clock time — on the server, never in the
 *   browser's zone — refusing the hour the clocks skip;
 * - the block form and the weekly-hours form, checked.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bookingRow, EVERY_DAY_9_TO_7 } from "./fake-calls-repo.test-util";
import {
  calendarDays,
  calendarViewOf,
  clockMinutes,
  hoursFromForm,
  londonInstantOf,
  parseBlockForm,
  type CalendarDaysInput,
} from "./calendar";
import { CALL_SETTINGS_DEFAULTS } from "./settings";
import type { CallBlock, WeeklyHoursRange } from "./types";

const NOW = new Date("2027-02-04T10:00:00.000Z"); // Thursday 4 February, 10:00 London (GMT)
const JANE = "b0400000-0000-4000-8000-000000000001";
const NAMES = new Map([[JANE, "Jane Smith"]]);

function input(over: Partial<CalendarDaysInput> = {}): CalendarDaysInput {
  return { settings: CALL_SETTINGS_DEFAULTS, hours: EVERY_DAY_9_TO_7, blocks: [], bookings: [], names: NAMES, now: NOW, ...over };
}

const day = (days: ReturnType<typeof calendarDays>, londonDate: string) => {
  const found = days.find((d) => d.londonDate === londonDate);
  if (!found) throw new Error(`no ${londonDate}`);
  return found;
};
const times = (cells: readonly { time: string }[]) => cells.map((c) => c.time);
const block = (startsAt: string, endsAt: string, reason = "dentist"): CallBlock => ({ id: `blk-${startsAt}`, startsAt, endsAt, reason });

describe("calendarDays — the 7-day grid", () => {
  it("seven London days from today, each headed in words", () => {
    const days = calendarDays(input());
    expect(days.map((d) => d.londonDate)).toEqual(["2027-02-04", "2027-02-05", "2027-02-06", "2027-02-07", "2027-02-08", "2027-02-09", "2027-02-10"]);
    expect(days[0].heading).toBe("Thursday 4 February");
    expect(days[2].heading).toBe("Saturday 6 February");
  });

  it("free cells are the times a parent may pick now: today from now + notice (12:00), on the 30-minute grid", () => {
    const today = day(calendarDays(input()), "2027-02-04");
    expect(today.cells[0]).toMatchObject({ kind: "free", time: "12:00–12:30", startsAt: "2027-02-04T12:00:00.000Z" });
    expect(today.cells.every((c) => c.kind === "free")).toBe(true);
    expect(today.cells).toHaveLength(14); // 12:00 … 18:30
    expect(day(calendarDays(input()), "2027-02-05").cells).toHaveLength(20); // 09:00 … 18:30
  });

  it("a booked call shows at its time with the family's name; no grid time overlapping it is drawn", () => {
    const booked = bookingRow({ parentUserId: JANE, startsAt: "2027-02-09T14:00:00.000Z" });
    const tue = day(calendarDays(input({ bookings: [booked] })), "2027-02-09");
    const cell = tue.cells.find((c) => c.kind === "booked");
    expect(cell).toMatchObject({ time: "14:00–14:30", name: "Jane Smith", blockedOver: false, blockReason: null });
    expect(tue.cells.filter((c) => c.startsAt < booked.endsAt && booked.startsAt < c.endsAt)).toEqual([cell]);
  });

  it("an unknown family's booked call still shows, named as unknown", () => {
    const booked = bookingRow({ parentUserId: "b0400000-0000-4000-8000-000000000099", startsAt: "2027-02-09T14:00:00.000Z" });
    expect(day(calendarDays(input({ bookings: [booked] })), "2027-02-09").cells.find((c) => c.kind === "booked")?.name).toBe("Unknown family");
  });

  it("call length 45 → a 45-minute grid, while an existing 30-minute booking keeps its time (brief §9.12)", () => {
    const booked = bookingRow({ parentUserId: JANE, startsAt: "2027-02-08T10:00:00.000Z" });
    const mon = day(calendarDays(input({ settings: { ...CALL_SETTINGS_DEFAULTS, slotMinutes: 45 }, bookings: [booked] })), "2027-02-08");
    expect(times(mon.cells).slice(0, 4)).toEqual(["09:00–09:45", "10:00–10:30", "10:30–11:15", "11:15–12:00"]);
    expect(mon.cells[1]).toMatchObject({ kind: "booked", name: "Jane Smith" });
  });

  it("a block over a booking flags it and leaves it booked; the grid times under the block are blocked, with the reason", () => {
    const booked = bookingRow({ parentUserId: JANE, startsAt: "2027-02-05T10:00:00.000Z" });
    const fri = day(calendarDays(input({ bookings: [booked], blocks: [block("2027-02-05T09:00:00.000Z", "2027-02-05T11:00:00.000Z")] })), "2027-02-05");
    expect(fri.cells.slice(0, 5).map((c) => [c.time, c.kind])).toEqual([
      ["09:00–09:30", "blocked"],
      ["09:30–10:00", "blocked"],
      ["10:00–10:30", "booked"],
      ["10:30–11:00", "blocked"],
      ["11:00–11:30", "free"],
    ]);
    expect(fri.cells[2]).toMatchObject({ name: "Jane Smith", blockedOver: true, blockReason: "dentist" });
    expect(fri.cells[0]).toMatchObject({ blockReason: "dentist", name: null });
  });

  it("removing the block brings the times back", () => {
    const fri = day(calendarDays(input()), "2027-02-05");
    expect(fri.cells.slice(0, 2).map((c) => c.kind)).toEqual(["free", "free"]);
  });

  it("a live hold shows as held (no name); a hold that has run out doesn't, and its time is free again", () => {
    const live = bookingRow({ parentUserId: JANE, startsAt: "2027-02-06T10:00:00.000Z", status: "held", holdExpiresAt: "2027-02-04T10:04:00.000Z", bookedAt: null });
    const gone = bookingRow({ parentUserId: JANE, startsAt: "2027-02-06T11:00:00.000Z", status: "held", holdExpiresAt: "2027-02-04T09:59:00.000Z", bookedAt: null, purpose: "cohort_prebook" });
    const sat = day(calendarDays(input({ bookings: [live, gone] })), "2027-02-06");
    expect(sat.cells.find((c) => c.time === "10:00–10:30")).toMatchObject({ kind: "held", name: null });
    expect(sat.cells.find((c) => c.time === "11:00–11:30")).toMatchObject({ kind: "free" });
  });

  it("cancelled and closed bookings take no time", () => {
    const cancelled = bookingRow({ parentUserId: JANE, startsAt: "2027-02-06T10:00:00.000Z", status: "cancelled", cancelReason: "parent" });
    const done = bookingRow({ parentUserId: JANE, startsAt: "2027-02-06T10:30:00.000Z", status: "done", closedAt: "2027-02-06T11:00:00.000Z" });
    const sat = day(calendarDays(input({ bookings: [cancelled, done] })), "2027-02-06");
    expect(sat.cells.slice(2, 4).map((c) => [c.time, c.kind])).toEqual([
      ["10:00–10:30", "free"],
      ["10:30–11:00", "free"],
    ]);
  });

  it("Saturday 10:00–14:00 only → Saturday's grid is 10:00 … 13:30, and a day with no hours is empty (brief §9.12)", () => {
    const saturday: readonly WeeklyHoursRange[] = [{ weekday: 6, startMinute: 600, endMinute: 840 }];
    const days = calendarDays(input({ hours: saturday }));
    expect(times(day(days, "2027-02-06").cells)).toEqual(["10:00–10:30", "10:30–11:00", "11:00–11:30", "11:30–12:00", "12:00–12:30", "12:30–13:00", "13:00–13:30", "13:30–14:00"]);
    expect(day(days, "2027-02-05").cells).toEqual([]);
  });

  it("a booked call earlier today (before the notice) still shows; the grid times before the notice don't", () => {
    const earlier = bookingRow({ parentUserId: JANE, startsAt: "2027-02-04T09:00:00.000Z" });
    const today = day(calendarDays(input({ bookings: [earlier] })), "2027-02-04");
    expect(times(today.cells).slice(0, 2)).toEqual(["09:00–09:30", "12:00–12:30"]);
  });

  it("the spring clock change: Sunday 28 March 2027 has no 01:00 or 01:30 (the hour the clocks skip), labels in BST", () => {
    const night: readonly WeeklyHoursRange[] = [{ weekday: 7, startMinute: 0, endMinute: 180 }];
    const sun = day(calendarDays(input({ hours: night, now: new Date("2027-03-27T00:00:00.000Z"), settings: { ...CALL_SETTINGS_DEFAULTS, noticeMinutes: 0 } })), "2027-03-28");
    expect(times(sun.cells)).toEqual(["00:00–00:30", "00:30–02:00", "02:00–02:30", "02:30–03:00"]);
  });
});

describe("londonInstantOf — native date and time strings, read as London on the server", () => {
  it.each([
    ["2027-01-15", "09:00", "2027-01-15T09:00:00.000Z"],
    ["2027-06-30", "23:30", "2027-06-30T22:30:00.000Z"],
    ["2027-02-12", "13:00", "2027-02-12T13:00:00.000Z"],
  ])("%s %s → %s", (date, time, expected) => {
    expect(londonInstantOf(date, time)).toBe(expected);
  });

  it.each([
    ["2027-03-28", "01:30"], // the hour the clocks skip
    ["2027-02-30", "09:00"],
    ["2027-02-10", "9:00"],
    ["2027-02-10", "24:00"],
    ["10/02/2027", "09:00"],
    ["2027-02-10", "09:00:00"],
    ["", ""],
  ])("%j %j → null", (date, time) => {
    expect(londonInstantOf(date, time)).toBeNull();
  });
});

describe("clockMinutes", () => {
  it.each([
    ["00:00", 0],
    ["09:30", 570],
    ["23:59", 1439],
  ])("%s → %s", (clock, minutes) => expect(clockMinutes(clock)).toBe(minutes));

  it.each(["24:00", "9:30", "09:60", "nine", ""])("%j → null", (clock) => expect(clockMinutes(clock)).toBeNull());
});

describe("parseBlockForm — a block from the Calendar tab", () => {
  const FORM = { fromDate: "2027-02-12", fromTime: "09:00", toDate: "2027-02-12", toTime: "13:00", reason: "  dentist " };

  it("London from and to → the instants, the reason trimmed", () => {
    expect(parseBlockForm(FORM, NOW)).toEqual({ ok: true, value: { startsAt: "2027-02-12T09:00:00.000Z", endsAt: "2027-02-12T13:00:00.000Z", reason: "dentist" } });
  });

  it("several days at once (a holiday) is fine", () => {
    expect(parseBlockForm({ ...FORM, toDate: "2027-02-19", toTime: "18:00" }, NOW)).toMatchObject({ ok: true, value: { endsAt: "2027-02-19T18:00:00.000Z" } });
  });

  it("a block already under way is fine (it ends in the future)", () => {
    expect(parseBlockForm({ ...FORM, fromDate: "2027-02-04", fromTime: "08:00", toDate: "2027-02-04", toTime: "12:00" }, NOW).ok).toBe(true);
  });

  it.each([
    ["the end before the start", { toTime: "08:00" }],
    ["the end at the start", { toTime: "09:00" }],
    ["already over", { fromDate: "2027-02-03", toDate: "2027-02-03" }],
    ["no reason", { reason: "   " }],
    ["a reason over 200 characters", { reason: "x".repeat(201) }],
    ["the hour the clocks skip", { fromDate: "2027-03-28", fromTime: "01:30", toDate: "2027-03-28" }],
    ["a bad date", { fromDate: "12/02/2027" }],
    ["a bad time", { toTime: "1pm" }],
  ])("refuses %s", (_label, over) => {
    expect(parseBlockForm({ ...FORM, ...over }, NOW)).toEqual({ ok: false, error: "invalid" });
  });

  it("refuses unknown keys and non-objects", () => {
    expect(parseBlockForm({ ...FORM, startsAt: "2027-02-12T09:00:00Z" }, NOW).ok).toBe(false);
    expect(parseBlockForm(null, NOW).ok).toBe(false);
  });
});

describe("hoursFromForm — the weekly-hours form", () => {
  it("each row's London clock → minutes (several ranges a day)", () => {
    expect(
      hoursFromForm([
        { weekday: 6, start: "10:00", end: "14:00" },
        { weekday: 1, start: "09:00", end: "12:00" },
        { weekday: 1, start: "12:00", end: "17:30" },
      ]),
    ).toEqual({
      ok: true,
      value: [
        { weekday: 6, startMinute: 600, endMinute: 840 },
        { weekday: 1, startMinute: 540, endMinute: 720 },
        { weekday: 1, startMinute: 720, endMinute: 1050 },
      ],
    });
  });

  it("no rows → no hours (BAI can take no calls)", () => {
    expect(hoursFromForm([])).toEqual({ ok: true, value: [] });
  });

  it.each([
    [{ weekday: 0, start: "09:00", end: "10:00" }],
    [{ weekday: 8, start: "09:00", end: "10:00" }],
    [{ weekday: 1, start: "9:00", end: "10:00" }],
    [{ weekday: 1, start: "09:00", end: "" }],
    [{ weekday: 1, start: "09:00", end: "10:00", extra: true }],
  ])("refuses %j", (row) => {
    expect(hoursFromForm([row])).toEqual({ ok: false, error: "invalid" });
  });

  it("refuses more rows than a week could hold", () => {
    expect(hoursFromForm(Array.from({ length: 200 }, () => ({ weekday: 1, start: "09:00", end: "10:00" })))).toEqual({ ok: false, error: "invalid" });
  });
});

describe("calendarViewOf — what the tab draws", () => {
  const BLOCKS: readonly CallBlock[] = [
    block("2027-02-15T09:00:00.000Z", "2027-02-19T18:00:00.000Z", "holiday"),
    block("2027-02-12T09:00:00.000Z", "2027-02-12T13:00:00.000Z", "dentist"),
    block("2027-02-04T07:00:00.000Z", "2027-02-04T08:00:00.000Z", "over already"),
  ];

  it("the blocks still to come, soonest first, in London words; ended ones left out of the list", () => {
    const view = calendarViewOf({ ...input({ blocks: BLOCKS }) });
    expect(view.blocks).toEqual([
      { id: "blk-2027-02-12T09:00:00.000Z", when: "Fri 12 Feb, 09:00 – 13:00 (London time)", reason: "dentist" },
      { id: "blk-2027-02-15T09:00:00.000Z", when: "Mon 15 Feb, 09:00 – Fri 19 Feb, 18:00 (London time)", reason: "holiday" },
    ]);
  });

  it("the hours as the form's rows: weekday, its name, London clock strings", () => {
    const view = calendarViewOf(input({ hours: [{ weekday: 6, startMinute: 600, endMinute: 840 }] }));
    expect(view.hours).toEqual([{ weekday: 6, dayName: "Saturday", start: "10:00", end: "14:00" }]);
  });

  it("not started → no start date; started → the London date in words", () => {
    expect(calendarViewOf(input()).startedOn).toBeNull();
    const started = calendarViewOf(input({ settings: { ...CALL_SETTINGS_DEFAULTS, enabledSince: "2026-11-06T23:30:00.000Z" } }));
    expect(started.startedOn).toBe("6 November 2026");
  });

  it("carries the settings and the seven days", () => {
    const view = calendarViewOf(input());
    expect(view.settings).toBe(CALL_SETTINGS_DEFAULTS);
    expect(view.days).toHaveLength(7);
  });
});

describe("calendar-limits — what the client forms show, with no zod in the browser bundle", () => {
  it("the fixed call lengths and the reason limit are the server's own (re-exported, the same objects)", async () => {
    const limits = await import("./calendar-limits");
    const settings = await import("./settings");
    const calendar = await import("./calendar");
    expect(limits.CALL_LENGTH_CHOICES).toBe(settings.CALL_LENGTH_CHOICES);
    expect(limits.BLOCK_REASON_MAX).toBe(calendar.BLOCK_REASON_MAX);
    expect(limits.BLOCK_REASON_MAX).toBe(200);
  });

  it("imports nothing at run time (the Calendar forms import it in the browser)", () => {
    const source = readFileSync(join(__dirname, "calendar-limits.ts"), "utf8");
    expect(source).not.toMatch(/^import (?!type )/m);
  });

  it("every /admin/calls file the browser loads takes run-time imports only from zod-free call modules (review round 1)", () => {
    const dir = join(__dirname, "../../app/admin/calls");
    const SERVER_ONLY = new Set(["page.tsx", "actions.ts"]);
    const ALLOWED = new Set(["calendar-limits", "copy", "dashboard-row", "outcomes", "weekday"]);
    const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !/\.test\.|test-util/.test(f) && !SERVER_ONLY.has(f));
    expect(files.length).toBeGreaterThan(10);
    const offending = files.flatMap((file) =>
      [...readFileSync(join(dir, file), "utf8").matchAll(/^import (?!type )[^;]*from "@\/lib\/calls\/([^"]+)";/gm)]
        .map((m) => m[1])
        .filter((name) => !ALLOWED.has(name))
        .map((name) => `${file} → ${name}`),
    );
    expect(offending).toEqual([]);
  });

  it("the allowed modules themselves import no zod at run time", () => {
    for (const name of ["calendar-limits", "copy", "dashboard-row", "outcomes", "weekday"]) {
      expect(readFileSync(join(__dirname, `${name}.ts`), "utf8")).not.toMatch(/^import (?!type )[^;]*from "zod";/m);
    }
  });
});

describe("review round 1 (04c-2)", () => {
  it("a range ending at midnight round-trips: the view says 24:00 and the form's 24:00 is 1440 (end only)", () => {
    const view = calendarViewOf(input({ hours: [{ weekday: 7, startMinute: 1080, endMinute: 1440 }] }));
    expect(view.hours[0]).toMatchObject({ start: "18:00", end: "24:00" });
    expect(hoursFromForm([{ weekday: 7, start: view.hours[0].start, end: view.hours[0].end }])).toEqual({ ok: true, value: [{ weekday: 7, startMinute: 1080, endMinute: 1440 }] });
    expect(hoursFromForm([{ weekday: 7, start: "24:00", end: "24:00" }])).toEqual({ ok: false, error: "invalid" });
  });

  it("a block may run at most 366 days, and end at most 730 days ahead (security review LOW-2)", () => {
    const FORM = { fromDate: "2027-02-12", fromTime: "09:00", toDate: "2027-02-12", toTime: "13:00", reason: "holiday" };
    expect(parseBlockForm({ ...FORM, toDate: "2028-02-12" }, NOW).ok).toBe(true);
    expect(parseBlockForm({ ...FORM, toDate: "2028-02-14" }, NOW)).toEqual({ ok: false, error: "invalid" });
    expect(parseBlockForm({ ...FORM, fromDate: "2029-01-01", toDate: "2029-02-05" }, NOW)).toEqual({ ok: false, error: "invalid" });
    expect(parseBlockForm({ ...FORM, fromDate: "0001-01-01", toDate: "2027-02-12" }, NOW)).toEqual({ ok: false, error: "invalid" });
  });

  it("the notice and hold limits the form shows are the server's own (one source, calendar-limits.ts)", async () => {
    const limits = await import("./calendar-limits");
    expect([limits.NOTICE_MINUTES_MIN, limits.NOTICE_MINUTES_MAX, limits.HOLD_MINUTES_MIN, limits.HOLD_MINUTES_MAX]).toEqual([0, 10080, 1, 60]);
  });
});
