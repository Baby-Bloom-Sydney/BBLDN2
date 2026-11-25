/**
 * The 02 ↔ 04 and 02 ↔ 03 seams (plan 02 §8, §12 R1–R2; plan 03 §8, row A8). 04a is merged, so the calls source is
 * wired to 04's own contract: one function, so the cohort sentence and 04's counts line can't disagree. 03 wires the
 * pre-booked source to its open pre-bookings while the deposit switch is on; off, it is null and the page says "not
 * connected yet". A failed read is null too ("could not be read") — never a stand-in 0 (§0.12).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ getCallsToMake: vi.fn() }));
vi.mock("@/lib/calls/contracts", async () => {
  const time = await vi.importActual<typeof import("@/lib/timezone")>("@/lib/timezone");
  return { getCallsToMake: calls.getCallsToMake, londonWeekRange: time.londonWeekRange };
});

import { londonWeekRange } from "@/lib/timezone";
import { fakeAdmin } from "@/lib/payments/fake-admin.test-util";
import { callsSentence, preBookedLine } from "./copy";
import { callsThisWeekSource, preBookedSource } from "./links";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  calls.getCallsToMake.mockReset();
});

const NOW = new Date("2027-02-03T10:00:00Z");

describe("callsThisWeekSource — 04's getCallsToMake(londonWeekRange(now))", () => {
  it("null while 04's switch is off (→ 'Calls: not connected yet')", () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    expect(callsThisWeekSource()).toBeNull();
    expect(callsSentence(2, { kind: "not_connected" })).toBe("Calls: not connected yet");
  });

  it("on: asks 04 for this London week, and its {8, 4} makes the §0.3 sentence", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    calls.getCallsToMake.mockResolvedValue({ booked: 8, notBooked: 4 });
    const source = callsThisWeekSource();
    expect(source).not.toBeNull();
    const counts = await source!(fakeAdmin().client, NOW);
    expect(calls.getCallsToMake).toHaveBeenCalledWith(londonWeekRange(NOW));
    expect(counts).toEqual({ booked: 8, notBooked: 4 });
    expect(callsSentence(2, { kind: "counts", counts: counts! })).toBe("2 places left and 12 more families to call this week (8 booked · 4 not booked).");
  });

  it("on but 04 can't read its numbers: null comes through (the board shows 'could not be read')", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    calls.getCallsToMake.mockResolvedValue(null);
    expect(await callsThisWeekSource()!(fakeAdmin().client, NOW)).toBeNull();
  });
});

describe("preBookedSource — 03's open pre-bookings for one cohort (plan 02 R2; plan 03 §8, A8)", () => {
  const on = () => {
    vi.stubEnv("DEPOSIT_LINK_ENABLED", "true");
    vi.stubEnv("COHORTS_ENABLED", "true");
  };

  it("null while the deposit switch is off (→ 'Pre-booked calls: not connected yet')", () => {
    vi.stubEnv("DEPOSIT_LINK_ENABLED", "");
    vi.stubEnv("COHORTS_ENABLED", "true");
    expect(preBookedSource()).toBeNull();
    expect(preBookedLine({ kind: "not_connected" })).toBe("Pre-booked calls: not connected yet");
  });

  it("null with the deposit switch set but cohorts off (the deposit switch needs both)", () => {
    vi.stubEnv("DEPOSIT_LINK_ENABLED", "true");
    vi.stubEnv("COHORTS_ENABLED", "");
    expect(preBookedSource()).toBeNull();
  });

  it("on: the count of that cohort's open pre-bookings, from 03's records", async () => {
    on();
    const fake = fakeAdmin();
    fake.counts.deposit_prebookings = 3;
    const source = preBookedSource();
    expect(source).not.toBeNull();
    const count = await source!(fake.client, "2027-02-08");
    expect(count).toBe(3);
    expect(fake.ops).toEqual([
      expect.objectContaining({ table: "deposit_prebookings", kind: "select", filters: [["eq", "cohort_start_date", "2027-02-08"], ["eq", "state", "open"]] }),
    ]);
    expect(preBookedLine({ kind: "count", count: count! })).toBe("3 pre-booked calls");
  });

  it("on but the read fails: null comes through (the board shows 'could not be read'), never a stand-in 0", async () => {
    on();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = fakeAdmin();
    fake.readErrors.deposit_prebookings = { message: "boom", code: "XX000" };
    expect(await preBookedSource()!(fake.client, "2027-02-08")).toBeNull();
  });
});
