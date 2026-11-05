/**
 * The parent's own entry points (04a security review H2a/H2c/H2d), for 04b's "use server" actions. They take only
 * the session's user id: she is the parent and the actor, the purpose is always her first call, and her position
 * is found server-side — a caller can never name another parent, an actor or a position.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallsDeps } from "./deps";
import { callsTo, fakeCallsRepo, type FakeCallsState } from "./fake-calls-repo.test-util";
import { parentCancelBooking, parentConfirmHold, parentHoldSlot } from "./parent-booking";

const SESSION = "b0400000-0000-4000-8000-000000000001";
const HOLD = "c0400000-0000-4000-8000-0000000000aa";
const NOW = new Date("2027-02-04T10:00:00.000Z");
const TUE_14 = "2027-02-09T14:00:00.000Z";
const HER = { userId: SESSION, kind: "parent" };

function setup(seed: Partial<FakeCallsState> = {}) {
  const fake = fakeCallsRepo({ latestPositionId: "pos-1", ...seed });
  const deps: CallsDeps = { repo: fake.repo, now: () => NOW, notify: async () => {}, prebookRequests: async () => new Map() };
  return { fake, deps };
}

beforeEach(() => vi.stubEnv("CALL_BOOKING_ENABLED", "true"));
afterEach(() => vi.unstubAllEnvs());

describe("parentHoldSlot", () => {
  it("holds for her, as her, for her first call, with her latest position", async () => {
    const { fake, deps } = setup();
    expect((await parentHoldSlot(SESSION, TUE_14, deps)).ok).toBe(true);
    expect(callsTo(fake, "holdSlot")[0].args[0]).toEqual({
      parentUserId: SESSION,
      startsAt: TUE_14,
      endsAt: "2027-02-09T14:30:00.000Z",
      purpose: "first_call",
      positionId: "pos-1",
      actor: HER,
    });
    expect(callsTo(fake, "readLatestPositionId")[0].args).toEqual([SESSION]);
  });

  it("still recomputes the time on the server", async () => {
    const { fake, deps } = setup();
    expect(await parentHoldSlot(SESSION, "2027-02-09T14:10:00.000Z", deps)).toEqual({ ok: false, error: "invalid" });
    expect(callsTo(fake, "holdSlot")).toEqual([]);
  });
});

describe("parentConfirmHold / parentCancelBooking", () => {
  it("confirm acts as her", async () => {
    const { fake, deps } = setup();
    expect((await parentConfirmHold(SESSION, HOLD, "key-1", deps)).ok).toBe(true);
    expect(callsTo(fake, "confirmHold")[0].args[0]).toEqual({ parentUserId: SESSION, holdId: HOLD, idempotencyKey: "key-1", actor: HER });
  });

  it("cancel acts as her; another parent's booking comes back not_yours", async () => {
    const { fake, deps } = setup({ results: { cancelBooking: { ok: false, error: "not_yours" } } });
    expect(await parentCancelBooking(SESSION, HOLD, deps)).toEqual({ ok: false, error: "not_yours" });
    expect(callsTo(fake, "cancelBooking")[0].args[0]).toEqual({ parentUserId: SESSION, bookingId: HOLD, actor: HER });
  });
});

describe("the gates", () => {
  it("switch off → call_booking_disabled for all three, zero repo calls", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    const { fake, deps } = setup();
    const answers = await Promise.all([
      parentHoldSlot(SESSION, TUE_14, deps),
      parentConfirmHold(SESSION, HOLD, "k", deps),
      parentCancelBooking(SESSION, HOLD, deps),
    ]);
    expect(answers).toEqual(Array(3).fill({ ok: false, error: "call_booking_disabled" }));
    expect(fake.calls).toEqual([]);
  });

  it.each(["", "not-a-uuid", "'; drop table parents; --"])("a session id that isn't one (%j) → invalid, zero repo calls", async (id) => {
    const { fake, deps } = setup();
    const answers = await Promise.all([
      parentHoldSlot(id, TUE_14, deps),
      parentConfirmHold(id, HOLD, "k", deps),
      parentCancelBooking(id, HOLD, deps),
    ]);
    expect(answers).toEqual(Array(3).fill({ ok: false, error: "invalid" }));
    expect(fake.calls).toEqual([]);
  });
});
