/**
 * The picker's whole grid (04b rework W4; BAI 2026-11-05 "the unavailable times and dates are greyed out and unable
 * to be selected"): every London date in the booking window, and every call slot the weekly hours and slot length
 * make on it, each marked free or not. "Not free" = taken, blocked, past, inside the notice, past the window, or
 * held by anyone (her own hold elsewhere included). Free is exactly `computeFreeSlots` — the server still rechecks
 * every hold, and the database still refuses an overlap.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallsDeps } from "./deps";
import { bookingRow, callsTo, EVERY_DAY_9_TO_7, fakeCallsRepo, type FakeCallsState } from "./fake-calls-repo.test-util";
import { computeFreeSlots } from "./free-slots";
import { parentSlotGrid } from "./parent-booking";
import { CALL_SETTINGS_DEFAULTS } from "./settings";
import { loadSlotGrid, slotGridOf } from "./slot-grid";

const NOW = new Date("2027-02-04T10:00:00.000Z"); // Thursday, GMT
const SESSION = "b0400000-0000-4000-8000-000000000001";
const OTHER = "b0400000-0000-4000-8000-000000000002";
const base = { hours: EVERY_DAY_9_TO_7, settings: CALL_SETTINGS_DEFAULTS, blocks: [], bookings: [], now: NOW };
const freeAt = (grid: ReturnType<typeof slotGridOf>, startsAt: string) => grid.slots.find((s) => s.startsAt === startsAt)?.free;

beforeEach(() => vi.stubEnv("CALL_BOOKING_ENABLED", "true"));
afterEach(() => vi.unstubAllEnvs());

describe("slotGridOf", () => {
  it("every date in the window, every grid slot on it, free exactly where computeFreeSlots says", () => {
    const grid = slotGridOf(base);
    expect(grid.dates).toEqual(["2027-02-04", "2027-02-05", "2027-02-06", "2027-02-07", "2027-02-08", "2027-02-09", "2027-02-10", "2027-02-11"]);
    expect(grid.slots).toHaveLength(8 * 20);
    const free = new Set(computeFreeSlots(base).map((s) => s.startsAt));
    for (const slot of grid.slots) expect(slot.free).toBe(free.has(slot.startsAt));
  });

  it("past and inside the notice → not free; from now + 2 h → free; past the window → not free", () => {
    const grid = slotGridOf(base);
    expect(freeAt(grid, "2027-02-04T09:00:00.000Z")).toBe(false);
    expect(freeAt(grid, "2027-02-04T11:30:00.000Z")).toBe(false);
    expect(freeAt(grid, "2027-02-04T12:00:00.000Z")).toBe(true);
    expect(freeAt(grid, "2027-02-11T10:00:00.000Z")).toBe(true);
    expect(freeAt(grid, "2027-02-11T10:30:00.000Z")).toBe(false);
  });

  it("booked, held (anyone's) or blocked → not free; a run-out hold frees it", () => {
    const grid = slotGridOf({
      ...base,
      blocks: [{ startsAt: "2027-02-05T09:00:00.000Z", endsAt: "2027-02-05T10:00:00.000Z" }],
      bookings: [
        bookingRow({ parentUserId: OTHER, startsAt: "2027-02-06T14:00:00.000Z" }),
        bookingRow({ parentUserId: SESSION, startsAt: "2027-02-06T15:00:00.000Z", status: "held", holdExpiresAt: "2027-02-04T10:04:00.000Z" }),
        bookingRow({ parentUserId: OTHER, startsAt: "2027-02-06T16:00:00.000Z", status: "held", holdExpiresAt: "2027-02-04T09:59:00.000Z" }),
      ],
    });
    expect(freeAt(grid, "2027-02-05T09:00:00.000Z")).toBe(false);
    expect(freeAt(grid, "2027-02-05T09:30:00.000Z")).toBe(false);
    expect(freeAt(grid, "2027-02-05T10:00:00.000Z")).toBe(true);
    expect(freeAt(grid, "2027-02-06T14:00:00.000Z")).toBe(false);
    expect(freeAt(grid, "2027-02-06T15:00:00.000Z")).toBe(false);
    expect(freeAt(grid, "2027-02-06T16:00:00.000Z")).toBe(true);
  });

  it("a date with no hours at all is still a date in the grid, with no slots", () => {
    const noSaturday = EVERY_DAY_9_TO_7.filter((h) => h.weekday !== 6);
    const grid = slotGridOf({ ...base, hours: noSaturday });
    expect(grid.dates).toContain("2027-02-06");
    expect(grid.slots.some((s) => s.startsAt.startsWith("2027-02-06"))).toBe(false);
  });

  it("one London date (the pre-book): only that date", () => {
    const grid = slotGridOf({ ...base, londonDate: "2027-02-20", ignoreWindow: true });
    expect(grid.dates).toEqual(["2027-02-20"]);
    expect(grid.slots.every((s) => s.free)).toBe(true);
  });
});

function setup(seed: Partial<FakeCallsState> = {}) {
  const fake = fakeCallsRepo(seed);
  const deps: CallsDeps = { repo: fake.repo, now: () => NOW, notify: async () => {}, prebookRequests: async () => new Map() };
  return { fake, deps };
}

describe("loadSlotGrid / parentSlotGrid", () => {
  it("reads the settings and hours, then blocks and bookings over the whole grid", async () => {
    const { fake, deps } = setup();
    const grid = await loadSlotGrid({ purpose: "first_call" }, deps);
    expect(grid.ok && grid.value.dates).toHaveLength(8);
    expect(callsTo(fake, "readBlocks")[0].args[0]).toEqual({ startsAt: "2027-02-04T09:00:00.000Z", endsAt: "2027-02-11T19:00:00.000Z" });
    expect(callsTo(fake, "readOccupyingBookings")[0].args[0]).toEqual({ startsAt: "2027-02-04T09:00:00.000Z", endsAt: "2027-02-11T19:00:00.000Z" });
  });

  it("no hours at all → the dates, no slots, and no block or booking read", async () => {
    const { fake, deps } = setup({ hours: [] });
    expect(await loadSlotGrid({ purpose: "first_call" }, deps)).toEqual({ ok: true, value: expect.objectContaining({ slots: [] }) });
    expect(callsTo(fake, "readBlocks")).toEqual([]);
  });

  it.each(["readSettings", "readWeeklyHours", "readBlocks", "readOccupyingBookings"] as const)("%s failing → error", async (method) => {
    const { deps } = setup({ failing: [method] });
    expect(await loadSlotGrid({ purpose: "first_call" }, deps)).toEqual({ ok: false, error: "error" });
  });

  it("parentSlotGrid: her first-call grid; an id that isn't one → invalid; the switch off → disabled before any read", async () => {
    const { fake, deps } = setup();
    expect((await parentSlotGrid(SESSION, deps)).ok).toBe(true);
    expect(await parentSlotGrid("not-a-uuid", deps)).toEqual({ ok: false, error: "invalid" });
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    const before = fake.calls.length;
    expect(await parentSlotGrid(SESSION, deps)).toEqual({ ok: false, error: "call_booking_disabled" });
    expect(fake.calls.length).toBe(before);
  });
});

// ── React re-review HIGH 1 (a): her own live hold is hers to confirm — her view shows it free; anyone else's isn't. ──
describe("parentSlotGrid — her own live hold", () => {
  it("her live first-call hold is free for her; another parent's live hold is not", async () => {
    const { deps } = setup({
      bookings: [
        bookingRow({ parentUserId: SESSION, startsAt: "2027-02-06T14:00:00.000Z", status: "held", holdExpiresAt: "2027-02-04T10:04:00.000Z" }),
        bookingRow({ parentUserId: OTHER, startsAt: "2027-02-06T15:00:00.000Z", status: "held", holdExpiresAt: "2027-02-04T10:04:00.000Z" }),
      ],
    });
    const grid = await parentSlotGrid(SESSION, deps);
    const free = (startsAt: string) => grid.ok && grid.value.slots.find((s) => s.startsAt === startsAt)?.free;
    expect(free("2027-02-06T14:00:00.000Z")).toBe(true);
    expect(free("2027-02-06T15:00:00.000Z")).toBe(false);
  });

  it("her booked call still occupies its slot (only a live hold is hers to take)", async () => {
    const { deps } = setup({ bookings: [bookingRow({ parentUserId: SESSION, startsAt: "2027-02-06T14:00:00.000Z" })] });
    const grid = await parentSlotGrid(SESSION, deps);
    expect(grid.ok && grid.value.slots.find((s) => s.startsAt === "2027-02-06T14:00:00.000Z")?.free).toBe(false);
  });
});
