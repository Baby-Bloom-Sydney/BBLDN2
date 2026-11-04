/**
 * The 02 ↔ 04 and 02 ↔ 03 seams (plan 02 §8, §12 R1–R2). 04a is merged, so the calls source is wired to 04's own
 * contract: one function, so the cohort sentence and 04's counts line can't disagree. 03 (wave 2) wires the
 * pre-booked source; until then it is null, and the page says "not connected yet" — never a stand-in 0 (§0.12).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ getCallsToMake: vi.fn() }));
vi.mock("@/lib/calls/contracts", async () => {
  const time = await vi.importActual<typeof import("@/lib/timezone")>("@/lib/timezone");
  return { getCallsToMake: calls.getCallsToMake, londonWeekRange: time.londonWeekRange };
});

import { londonWeekRange } from "@/lib/timezone";
import { fakeAdmin } from "@/lib/payments/fake-admin.test-util";
import { callsSentence } from "./copy";
import { callsThisWeekSource, preBookedSource } from "./links";

afterEach(() => {
  vi.unstubAllEnvs();
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

describe("preBookedSource — 03 wires it (plan R2)", () => {
  it("null today", () => {
    expect(preBookedSource()).toBeNull();
  });
});
