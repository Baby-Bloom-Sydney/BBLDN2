/**
 * parent-state.ts (plan B6): her call page's loader. The switch first (off → call_booking_disabled, zero reads);
 * a session id that isn't a user id → invalid, zero reads; otherwise her rows only, and the free first-call times.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallsDeps } from "./deps";
import { bookingRow, callsTo, fakeCallsRepo, type FakeCallsState } from "./fake-calls-repo.test-util";
import { loadHubCall, loadMyCallView } from "./parent-state";
import { CALL_SETTINGS_DEFAULTS } from "./settings";

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
    // 04b rework W4: the whole grid — today's past and inside-the-notice slots are listed, greyed (not free).
    const first = view.ok && view.value.kind === "pick" ? view.value.days[0] : null;
    expect(first?.slots[0]).toMatchObject({ name: "Thursday 4 February, 09:00", free: false });
    expect(first?.slots.find((s) => s.free)?.name).toBe("Thursday 4 February, 12:00");
  });

  it("her mobile from her own profile row, in UK national form (W5); none → null", async () => {
    const contact = { userId: HER, firstName: "Jane", lastName: "Smith", email: "jane@example.com", mobile: "+447700900123", isTestUser: false };
    const { fake, deps } = setup({ contacts: [contact] });
    const view = await loadMyCallView(HER, deps);
    expect(callsTo(fake, "readContacts")[0].args).toEqual([[HER]]);
    expect(view.ok && view.value.kind === "pick" && view.value.mobile).toBe("07700 900123");
    const none = await loadMyCallView(HER, setup().deps);
    expect(none.ok && none.value.kind === "pick" && none.value.mobile).toBeNull();
    const failing = await loadMyCallView(HER, setup({ contacts: [contact], failing: ["readContacts"] }).deps);
    expect(failing.ok && failing.value.kind === "pick" && failing.value.mobile).toBeNull();
  });

  it("W11: no position yet → needsPosition (a picked time can't be held until she has one); a failed read → false", async () => {
    const none = await loadMyCallView(HER, setup({ latestPositionId: null }).deps);
    expect(none.ok && none.value.kind === "pick" && none.value.needsPosition).toBe(true);
    const has = await loadMyCallView(HER, setup({ latestPositionId: "pos-1" }).deps);
    expect(has.ok && has.value.kind === "pick" && has.value.needsPosition).toBe(false);
    const failing = await loadMyCallView(HER, setup({ latestPositionId: null, failing: ["readLatestPositionId"] }).deps);
    expect(failing.ok && failing.value.kind === "pick" && failing.value.needsPosition).toBe(false);
  });

  it("booked → her booking", async () => {
    const { deps } = setup({ bookings: [bookingRow({ parentUserId: HER, startsAt: "2027-02-09T14:00:00.000Z" })] });
    const view = await loadMyCallView(HER, deps);
    expect(view.ok && view.value.kind === "booked" && view.value.booking.line).toBe(
      "Your Complimentary matchmaker call is on Tuesday 9 February at 14:00",
    );
  });
});

describe("loadHubCall (plan B7; TS review: the card and whether the call is offered, one read)", () => {
  const SCOPE = { userId: HER, signupSource: "advanced_match", signedUpAt: "2027-02-03T10:00:00.000Z" };
  const STARTED = { ...CALL_SETTINGS_DEFAULTS, enabledSince: "2027-02-01T09:00:00.000Z" };
  const NONE = { card: null, offered: false, failed: false };
  /** A read failed: not a definite "not offered" (W17), so after-position can tell them apart. */
  const FAILED = { card: null, offered: false, failed: true };

  it("switch off → nothing, with zero reads", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    const { fake, deps } = setup();
    expect(await loadHubCall(HER, deps)).toEqual(NONE);
    expect(fake.calls).toEqual([]);
  });

  it("not a user id → nothing, with zero reads", async () => {
    const { fake, deps } = setup();
    expect(await loadHubCall("x", deps)).toEqual(NONE);
    expect(fake.calls).toEqual([]);
  });

  it("reads her settings, scope row, bookings and attempts → the card, and the call offered", async () => {
    const { fake, deps } = setup({ settings: STARTED, scope: [SCOPE] });
    expect(await loadHubCall(HER, deps)).toEqual({ card: { kind: "not_booked", afterNoAnswer: false }, offered: true, failed: false });
    expect(callsTo(fake, "readScopeParent")[0].args).toEqual([HER]);
    expect(callsTo(fake, "readBookingsForParents")[0].args).toEqual([[HER]]);
  });

  it("out of scope (switch-on not pressed) → no card, not offered", async () => {
    const { deps } = setup({ scope: [SCOPE] });
    expect(await loadHubCall(HER, deps)).toEqual(NONE);
  });

  it("any read failing → no card, and marked failed (logged) — never a wrong card, never a definite 'not offered'", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const failing of ["readSettings", "readScopeParent", "readBookingsForParents", "readLogEntriesForParents"] as const) {
      const { deps } = setup({ settings: STARTED, scope: [SCOPE], failing: [failing] });
      expect(await loadHubCall(HER, deps)).toEqual(FAILED);
    }
    expect(log).toHaveBeenCalledTimes(4);
    log.mockRestore();
  });
});
