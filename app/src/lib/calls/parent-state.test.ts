/**
 * parent-state.ts (plan B6): her call page's loader. The switch first (off → call_booking_disabled, zero reads);
 * a session id that isn't a user id → invalid, zero reads; otherwise her rows only, and the free first-call times.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallsDeps } from "./deps";
import { bookingRow, callsTo, fakeCallsRepo, type FakeCallsState } from "./fake-calls-repo.test-util";
import { loadMyCallView } from "./parent-state";

const HER = "b0400000-0000-4000-8000-000000000001";
const NOW = new Date("2027-02-04T10:00:00.000Z");

function setup(seed: Partial<FakeCallsState> = {}) {
  const fake = fakeCallsRepo(seed);
  const deps: CallsDeps = { repo: fake.repo, now: () => NOW, notify: async () => {}, prebookRequests: async () => new Map() };
  return { fake, deps };
}

beforeEach(() => vi.stubEnv("CALL_BOOKING_ENABLED", "true"));
afterEach(() => vi.unstubAllEnvs());

describe("loadMyCallView", () => {
  it("switch off → call_booking_disabled, zero reads", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    const { fake, deps } = setup();
    expect(await loadMyCallView(HER, deps)).toEqual({ ok: false, error: "call_booking_disabled" });
    expect(fake.calls).toEqual([]);
  });

  it("not a user id → invalid, zero reads", async () => {
    const { fake, deps } = setup();
    expect(await loadMyCallView("not-a-uuid", deps)).toEqual({ ok: false, error: "invalid" });
    expect(fake.calls).toEqual([]);
  });

  it("reads her rows only; not booked → the 7-day picker from now + 2 h", async () => {
    const { fake, deps } = setup();
    const view = await loadMyCallView(HER, deps);
    expect(callsTo(fake, "readBookingsForParents")[0].args).toEqual([[HER]]);
    expect(callsTo(fake, "readLogEntriesForParents")[0].args).toEqual([[HER]]);
    expect(view.ok && view.value.kind).toBe("pick");
    expect(view.ok && view.value.kind === "pick" && view.value.days[0].slots[0].name).toBe("Thursday 4 February, 12:00 (London time)");
  });

  it("booked → her booking", async () => {
    const { deps } = setup({ bookings: [bookingRow({ parentUserId: HER, startsAt: "2027-02-09T14:00:00.000Z" })] });
    const view = await loadMyCallView(HER, deps);
    expect(view.ok && view.value.kind === "booked" && view.value.booking.line).toBe(
      "Your Complimentary matchmaker call is on Tuesday 9 February at 14:00 (London time)",
    );
  });
});
