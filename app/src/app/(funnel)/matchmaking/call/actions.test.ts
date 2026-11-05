/**
 * /parent/call server actions (plan B6, §12 R9, R23; brief §9.15). For each: the switch first (off →
 * `call_booking_disabled`, nothing read), zod on every input (`invalid`, nothing read), then the parent from the
 * session — never from the client — and only then `parent-booking.ts`, which takes nothing but her session id. A
 * non-parent is refused before any booking call. `confirmMyCallHold` returns the booking id (brief 10's hook).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  session: vi.fn(),
  hold: vi.fn(),
  confirm: vi.fn(),
  cancel: vi.fn(),
  load: vi.fn(),
  revalidate: vi.fn(),
  allowed: vi.fn(),
}));
vi.mock("@/lib/calls/call-allowed", () => ({ mayBookNow: h.allowed }));
vi.mock("@/lib/calls/parent-session", () => ({ sessionParentId: h.session }));
vi.mock("@/lib/calls/parent-booking", () => ({ parentHoldSlot: h.hold, parentConfirmHold: h.confirm, parentCancelBooking: h.cancel }));
vi.mock("@/lib/calls/parent-state", () => ({ loadMyCallView: h.load }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidate }));

import { cancelMyCall, confirmMyCallHold, holdMyCallSlot, reloadMyCallSlots } from "./actions";

const HER = "b0400000-0000-4000-8000-000000000001";
const OTHER = "b0400000-0000-4000-8000-000000000002";
const HOLD = "c0400000-0000-4000-8000-0000000000aa";
const TUE_14 = "2027-02-09T14:00:00.000Z";
const VIEW = { kind: "pick", afterNoAnswer: false, days: [] };
const INJECTION = "' OR 1=1; --";

const bookingCalls = () => [h.hold, h.confirm, h.cancel, h.load].flatMap((fn) => fn.mock.calls);
const all = () =>
  Promise.all([holdMyCallSlot(TUE_14), confirmMyCallHold(HOLD, "key-1"), cancelMyCall(HOLD), reloadMyCallSlots()]);

beforeEach(() => {
  vi.stubEnv("CALL_BOOKING_ENABLED", "true");
  for (const fn of Object.values(h)) fn.mockReset();
  h.session.mockResolvedValue(HER);
  h.hold.mockResolvedValue({ ok: true, value: { bookingId: HOLD, startsAt: TUE_14, endsAt: "2027-02-09T14:30:00.000Z", holdExpiresAt: "2027-02-04T10:05:00.000Z", holdMinutes: 5 } });
  h.confirm.mockResolvedValue({ ok: true, value: { kind: "booked", bookingId: HOLD, startsAt: TUE_14, replay: false } });
  h.cancel.mockResolvedValue({ ok: true, value: { bookingId: HOLD, startsAt: TUE_14 } });
  h.load.mockResolvedValue({ ok: true, value: VIEW });
  h.allowed.mockResolvedValue("yes");
});
afterEach(() => vi.unstubAllEnvs());

describe("the call must be offered to hold or confirm (W17, final review item 12)", () => {
  it("not offered (stop_calling, answered, out of scope, a nanny) → not_offered; nothing held or confirmed", async () => {
    h.allowed.mockResolvedValue("no");
    expect(await holdMyCallSlot(TUE_14)).toEqual({ ok: false, error: "not_offered" });
    expect(await confirmMyCallHold(HOLD, "key-1")).toEqual({ ok: false, error: "not_offered" });
    expect(h.hold).not.toHaveBeenCalled();
    expect(h.confirm).not.toHaveBeenCalled();
    expect(h.allowed).toHaveBeenCalledWith(HER);
  });

  it("the check couldn't be read → the generic error; nothing held or confirmed", async () => {
    h.allowed.mockResolvedValue("unknown");
    expect(await holdMyCallSlot(TUE_14)).toEqual({ ok: false, error: "error" });
    expect(await confirmMyCallHold(HOLD, "key-1")).toEqual({ ok: false, error: "error" });
    expect(bookingCalls()).toEqual([]);
  });

  it("only after the switch, the input and the session: a bad input or no parent never runs the check", async () => {
    expect(await holdMyCallSlot("2027-02-09 14:00")).toEqual({ ok: false, error: "invalid" });
    h.session.mockResolvedValue(null);
    expect(await holdMyCallSlot(TUE_14)).toEqual({ ok: false, error: "not_a_parent" });
    expect(h.allowed).not.toHaveBeenCalled();
  });

  it("cancelling and reloading her view don't need it (she can always cancel, and see her call)", async () => {
    h.allowed.mockResolvedValue("no");
    expect((await cancelMyCall(HOLD)).ok).toBe(true);
    expect((await reloadMyCallSlots()).ok).toBe(true);
    expect(h.allowed).not.toHaveBeenCalled();
  });
});

describe("the gates", () => {
  it("flag off → call_booking_disabled for all four; no session read, no booking call", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    expect(await all()).toEqual(Array(4).fill({ ok: false, error: "call_booking_disabled" }));
    expect(h.session).not.toHaveBeenCalled();
    expect(bookingCalls()).toEqual([]);
  });

  it("not a parent (signed out, a nanny, an admin) → not_a_parent; no booking call", async () => {
    h.session.mockResolvedValue(null);
    expect(await all()).toEqual(Array(4).fill({ ok: false, error: "not_a_parent" }));
    expect(bookingCalls()).toEqual([]);
  });

  it.each([
    ["holdMyCallSlot", () => holdMyCallSlot("2027-02-09 14:00")],
    ["holdMyCallSlot (not a string)", () => holdMyCallSlot({ startsAt: TUE_14 })],
    ["confirmMyCallHold (hold id)", () => confirmMyCallHold("not-a-uuid", "key")],
    ["confirmMyCallHold (key)", () => confirmMyCallHold(HOLD, "")],
    ["confirmMyCallHold (long key)", () => confirmMyCallHold(HOLD, "k".repeat(201))],
    ["cancelMyCall", () => cancelMyCall(INJECTION)],
  ])("zod: %s with a bad input → invalid; nothing read", async (_name, call) => {
    expect(await call()).toEqual({ ok: false, error: "invalid" });
    expect(h.session).not.toHaveBeenCalled();
    expect(bookingCalls()).toEqual([]);
  });
});

describe("the parent comes from the session only", () => {
  it("a client-supplied parent id is never used", async () => {
    const holdWithExtra = holdMyCallSlot as unknown as (...args: unknown[]) => Promise<unknown>;
    await holdWithExtra(TUE_14, OTHER);
    expect(h.hold).toHaveBeenCalledWith(HER, TUE_14);
    const cancelWithExtra = cancelMyCall as unknown as (...args: unknown[]) => Promise<unknown>;
    await cancelWithExtra(HOLD, OTHER);
    expect(h.cancel).toHaveBeenCalledWith(HER, HOLD);
  });

  it("another parent's hold or booking → not_yours", async () => {
    h.confirm.mockResolvedValueOnce({ ok: false, error: "not_yours" });
    h.cancel.mockResolvedValueOnce({ ok: false, error: "not_found" });
    expect(await confirmMyCallHold(HOLD, "key-1")).toEqual({ ok: false, error: "not_yours" });
    expect(await cancelMyCall(HOLD)).toEqual({ ok: false, error: "not_yours" });
    expect(h.revalidate).not.toHaveBeenCalled();
  });

  it("refusals map to the parent's codes (overlap → taken; anything internal → error)", async () => {
    h.hold.mockResolvedValueOnce({ ok: false, error: "overlap" });
    h.hold.mockResolvedValueOnce({ ok: false, error: "booked_call_exists" });
    expect(await holdMyCallSlot(TUE_14)).toEqual({ ok: false, error: "taken" });
    expect(await holdMyCallSlot(TUE_14)).toEqual({ ok: false, error: "error" });
  });
});

describe("each action", () => {
  it("holdMyCallSlot → the held time, and how long it is reserved for (W16: the settings' minutes)", async () => {
    expect(await holdMyCallSlot(TUE_14)).toEqual({
      ok: true,
      value: { holdId: HOLD, startsAt: TUE_14, line: "Your time is being reserved for 5 minutes" },
    });
    h.hold.mockResolvedValueOnce({ ok: true, value: { bookingId: HOLD, startsAt: TUE_14, endsAt: "2027-02-09T14:30:00.000Z", holdExpiresAt: "2027-02-04T10:01:00.000Z", holdMinutes: 1 } });
    expect(await holdMyCallSlot(TUE_14)).toMatchObject({ ok: true, value: { line: "Your time is being reserved for 1 minute" } });
  });

  it("confirmMyCallHold → the booking id (brief 10's hook), moved/replay, the booked view; revalidates /parent", async () => {
    const confirmed = await confirmMyCallHold(HOLD, "key-1");
    expect(h.confirm).toHaveBeenCalledWith(HER, HOLD, "key-1");
    expect(confirmed).toEqual({
      ok: true,
      value: {
        bookingId: HOLD,
        moved: false,
        replay: false,
        booking: {
          bookingId: HOLD,
          startsAt: TUE_14,
          line: "Your Complimentary matchmaker call is on Tuesday 9 February at 14:00",
          when: "Tuesday 9 February, 14:00",
          yourCall: "Your call: Tuesday 9 February at 14:00",
          changeable: true,
        },
      },
    });
    expect(h.revalidate).toHaveBeenCalledWith("/parent");
  });

  it("a move is flagged moved, a replay replay", async () => {
    h.confirm.mockResolvedValueOnce({ ok: true, value: { kind: "moved", bookingId: "b-1", startsAt: TUE_14, fromStartsAt: "2027-02-08T10:00:00.000Z" } });
    h.confirm.mockResolvedValueOnce({ ok: true, value: { kind: "booked", bookingId: "b-1", startsAt: TUE_14, replay: true } });
    const moved = await confirmMyCallHold(HOLD, "key-1");
    const replay = await confirmMyCallHold(HOLD, "key-1");
    expect(moved.ok && [moved.value.moved, moved.value.replay]).toEqual([true, false]);
    expect(replay.ok && [replay.value.moved, replay.value.replay]).toEqual([false, true]);
  });

  it("cancelMyCall → cancels hers, revalidates, returns her fresh view; a failed reload → load_failed", async () => {
    expect(await cancelMyCall(HOLD)).toEqual({ ok: true, value: VIEW });
    expect(h.load).toHaveBeenCalledWith(HER);
    expect(h.revalidate).toHaveBeenCalledWith("/parent");
    h.load.mockResolvedValueOnce({ ok: false, error: "error" });
    expect(await cancelMyCall(HOLD)).toEqual({ ok: true, value: { kind: "load_failed" } });
  });

  it("reloadMyCallSlots → her view; refused → the code", async () => {
    expect(await reloadMyCallSlots()).toEqual({ ok: true, value: VIEW });
    expect(h.load).toHaveBeenCalledWith(HER);
    h.load.mockResolvedValueOnce({ ok: false, error: "rate_limited" });
    expect(await reloadMyCallSlots()).toEqual({ ok: false, error: "rate_limited" });
  });
});
