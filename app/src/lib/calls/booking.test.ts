/**
 * booking.ts (plan A7 + §12 R15 names). Each operation: the switch first (off → `call_booking_disabled`, zero repo
 * calls), then zod, then — where a time comes from the client — the server recomputes that it is a current free
 * slot, then the repository, then a notice (logged, never thrown).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin }));

import { proveAdmin, type AdminProof } from "./admin-proof";
import {
  bookSlotForParent,
  cancelBooking,
  confirmHoldForParent,
  getFreeSlots,
  holdSlotForParent,
  recordCallOutcome,
} from "./booking";
import type { CallsDeps } from "./deps";
import { bookingRow, callsTo, fakeCallsRepo, type FakeCallsState } from "./fake-calls-repo.test-util";
import type { CallNotice } from "./notify";
import { CALL_SETTINGS_DEFAULTS } from "./settings";

const PARENT = "b0400000-0000-4000-8000-000000000001";
const OTHER_PARENT = "b0400000-0000-4000-8000-000000000002";
const ADMIN = "a0400000-0000-4000-8000-000000000001";
const HOLD = "c0400000-0000-4000-8000-0000000000aa";
const NOW = new Date("2027-02-04T10:00:00.000Z"); // Thu 4 Feb 2027 10:00 London
const PARENT_ACTOR = { userId: PARENT, kind: "parent" } as const;
let PROOF: AdminProof;
let ADMIN_ACTOR: { readonly kind: "admin"; readonly proof: AdminProof };
const FORGED = { kind: "admin_proof", userId: ADMIN } as unknown as AdminProof;

beforeAll(async () => {
  requireAdmin.mockResolvedValue({ userId: ADMIN, error: null });
  const proof = await proveAdmin();
  if (proof === null) throw new Error("no proof");
  PROOF = proof;
  ADMIN_ACTOR = { kind: "admin", proof };
});
const TUE_14 = "2027-02-09T14:00:00.000Z";

function setup(seed: Partial<FakeCallsState> = {}) {
  const fake = fakeCallsRepo(seed);
  const notices: CallNotice[] = [];
  const deps: CallsDeps = {
    repo: fake.repo,
    now: () => NOW,
    notify: async (notice) => {
      notices.push(notice);
    },
    prebookRequests: async () => new Map(),
  };
  return { fake, deps, notices };
}

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv("CALL_BOOKING_ENABLED", "true");
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("with CALL_BOOKING_ENABLED off", () => {
  it.each(["", "false", "TRUE", "1"])("every operation refuses with call_booking_disabled and touches nothing (%j)", async (value) => {
    vi.stubEnv("CALL_BOOKING_ENABLED", value);
    const { fake, deps, notices } = setup();
    const answers = await Promise.all([
      getFreeSlots({}, deps),
      holdSlotForParent({ parentUserId: PARENT, startsAt: TUE_14, actor: PARENT_ACTOR }, deps),
      confirmHoldForParent({ parentUserId: PARENT, holdId: HOLD, idempotencyKey: "k", actor: PARENT_ACTOR }, deps),
      bookSlotForParent({ parentUserId: PARENT, startsAt: TUE_14, idempotencyKey: "k", actor: ADMIN_ACTOR }, deps),
      cancelBooking({ parentUserId: PARENT, bookingId: HOLD, actor: PARENT_ACTOR }, deps),
      recordCallOutcome(PROOF, { parentUserId: PARENT, result: "answered" }, deps),
    ]);
    expect(answers).toEqual(Array(6).fill({ ok: false, error: "call_booking_disabled" }));
    expect(fake.calls).toEqual([]);
    expect(notices).toEqual([]);
  });
});

describe("getFreeSlots", () => {
  it("the §9.2 window: Thu 12:00 → Thu 11 Feb 10:00, weekends in", async () => {
    const { deps } = setup();
    const free = await getFreeSlots({}, deps);
    expect(free.ok).toBe(true);
    const slots = free.ok ? free.value : [];
    expect(slots[0].startsAt).toBe("2027-02-04T12:00:00.000Z");
    expect(slots.at(-1)?.startsAt).toBe("2027-02-11T10:00:00.000Z");
    expect(slots.some((s) => s.startsAt.startsWith("2027-02-06"))).toBe(true);
  });

  it("loads blocks and bookings only over the candidates' span", async () => {
    const { fake, deps } = setup();
    await getFreeSlots({}, deps);
    const span = { startsAt: "2027-02-04T12:00:00.000Z", endsAt: "2027-02-11T10:30:00.000Z" };
    expect(callsTo(fake, "readBlocks")[0].args).toEqual([span]);
    expect(callsTo(fake, "readOccupyingBookings")[0].args).toEqual([span]);
  });

  it("leaves out a time someone else has booked", async () => {
    const { deps } = setup({ bookings: [bookingRow({ parentUserId: OTHER_PARENT, startsAt: TUE_14 })] });
    const free = await getFreeSlots({}, deps);
    expect(free.ok && free.value.some((s) => s.startsAt === TUE_14)).toBe(false);
  });

  it("no hours → [] (the parent sees the no-times line)", async () => {
    const { fake, deps } = setup({ hours: [] });
    expect(await getFreeSlots({}, deps)).toEqual({ ok: true, value: [] });
    expect(callsTo(fake, "readBlocks")).toEqual([]);
  });

  it("the cohort pre-book: one London date beyond the window (Mon 8 Feb asked on Thu 28 Jan)", async () => {
    const { deps } = setup();
    const asked = { ...deps, now: () => new Date("2027-01-28T10:00:00.000Z") };
    const free = await getFreeSlots({ londonDate: "2027-02-08", purpose: "cohort_prebook" }, asked);
    const slots = free.ok ? free.value : [];
    expect(slots).toHaveLength(20);
    expect(slots.every((s) => s.startsAt.startsWith("2027-02-08"))).toBe(true);
  });

  it("a first-call date beyond the window → []", async () => {
    const { deps } = setup();
    const asked = { ...deps, now: () => new Date("2027-01-28T10:00:00.000Z") };
    expect(await getFreeSlots({ londonDate: "2027-02-08" }, asked)).toEqual({ ok: true, value: [] });
  });

  it.each([{ londonDate: "2027-02-30" }, { purpose: "nanny" }, { extra: 1 }, null])("refuses %j as invalid", async (input) => {
    const { fake, deps } = setup();
    expect(await getFreeSlots(input as never, deps)).toEqual({ ok: false, error: "invalid" });
    expect(fake.calls).toEqual([]);
  });

  it("a repository failure → error", async () => {
    const { deps } = setup({ failing: ["readWeeklyHours"] });
    expect(await getFreeSlots({}, deps)).toEqual({ ok: false, error: "error" });
  });
});

describe("holdSlotForParent — the server recomputes the slot", () => {
  it("holds a current free slot, with the grid's end time and her latest position", async () => {
    const { fake, deps } = setup({ latestPositionId: "pos-1" });
    const held = await holdSlotForParent({ parentUserId: PARENT, startsAt: "2027-02-09T14:00:00+00:00", actor: PARENT_ACTOR }, deps);
    expect(held).toEqual({
      ok: true,
      value: { bookingId: "hold-1", holdExpiresAt: "2027-02-04T10:05:00.000Z", startsAt: TUE_14, endsAt: "2027-02-09T14:30:00.000Z", holdMinutes: 5 },
    });
    expect(callsTo(fake, "holdSlot")[0].args[0]).toEqual({
      parentUserId: PARENT,
      startsAt: TUE_14,
      endsAt: "2027-02-09T14:30:00.000Z",
      purpose: "first_call",
      positionId: "pos-1",
      actor: PARENT_ACTOR,
    });
  });

  it("says how long it is held: call_settings.hold_minutes, read with the free check (W16)", async () => {
    const { deps } = setup({ settings: { ...CALL_SETTINGS_DEFAULTS, holdMinutes: 12 } });
    const held = await holdSlotForParent({ parentUserId: PARENT, startsAt: TUE_14, positionId: null, actor: PARENT_ACTOR }, deps);
    expect(held.ok && held.value.holdMinutes).toBe(12);
  });

  it("keeps an explicit position (or none) without looking one up", async () => {
    const { fake, deps } = setup({ latestPositionId: "pos-1" });
    await holdSlotForParent({ parentUserId: PARENT, startsAt: TUE_14, positionId: null, actor: PARENT_ACTOR }, deps);
    expect(callsTo(fake, "readLatestPositionId")).toEqual([]);
    expect(callsTo(fake, "holdSlot")[0].args[0]).toMatchObject({ positionId: null });
  });

  it.each([
    ["off the grid (14:15)", "2027-02-09T14:15:00.000Z", "invalid"],
    ["outside the hours (20:00)", "2027-02-09T20:00:00.000Z", "invalid"],
    ["inside the notice (Thu 11:00)", "2027-02-04T11:00:00.000Z", "too_soon"],
    ["beyond the window (Fri 12 Feb)", "2027-02-12T10:00:00.000Z", "invalid"],
    ["not a time", "Tuesday at two", "invalid"],
    ["a bare local time", "2027-02-09T14:00:00", "invalid"],
  ])("%s → %s, and no hold is taken", async (_label, startsAt, error) => {
    const { fake, deps } = setup();
    expect(await holdSlotForParent({ parentUserId: PARENT, startsAt, actor: PARENT_ACTOR }, deps)).toEqual({ ok: false, error });
    expect(callsTo(fake, "holdSlot")).toEqual([]);
  });

  it("a time already taken or blocked → taken, and no hold is taken", async () => {
    const booked = setup({ bookings: [bookingRow({ parentUserId: OTHER_PARENT, startsAt: TUE_14 })] });
    expect(await holdSlotForParent({ parentUserId: PARENT, startsAt: TUE_14, actor: PARENT_ACTOR }, booked.deps)).toEqual({
      ok: false,
      error: "taken",
    });
    const blocked = setup({ blocks: [{ id: "b1", startsAt: "2027-02-09T13:00:00.000Z", endsAt: "2027-02-09T15:00:00.000Z", reason: "dentist" }] });
    expect(await holdSlotForParent({ parentUserId: PARENT, startsAt: TUE_14, actor: PARENT_ACTOR }, blocked.deps)).toEqual({
      ok: false,
      error: "taken",
    });
    expect(callsTo(booked.fake, "holdSlot")).toEqual([]);
  });

  it("her own live hold doesn't block her (the database replaces it); someone else's does", async () => {
    const hold = (parentUserId: string) =>
      bookingRow({ parentUserId, startsAt: TUE_14, status: "held", bookedAt: null, holdExpiresAt: "2027-02-04T10:04:00.000Z" });
    const own = setup({ bookings: [hold(PARENT)] });
    expect((await holdSlotForParent({ parentUserId: PARENT, startsAt: TUE_14, positionId: null, actor: PARENT_ACTOR }, own.deps)).ok).toBe(true);
    const ownBook = await bookSlotForParent({ parentUserId: PARENT, startsAt: TUE_14, positionId: null, idempotencyKey: "k", actor: ADMIN_ACTOR }, own.deps);
    expect(ownBook.ok).toBe(true);
    const other = setup({ bookings: [hold(OTHER_PARENT)] });
    expect(await holdSlotForParent({ parentUserId: PARENT, startsAt: TUE_14, positionId: null, actor: PARENT_ACTOR }, other.deps)).toEqual({
      ok: false,
      error: "taken",
    });
  });

  it("her own hold for the other purpose, or her own booked call, still blocks (the database would refuse)", async () => {
    const prebookHold = bookingRow({
      parentUserId: PARENT,
      startsAt: TUE_14,
      status: "held",
      purpose: "cohort_prebook",
      bookedAt: null,
      holdExpiresAt: "2027-02-04T10:04:00.000Z",
    });
    const ownBooked = bookingRow({ parentUserId: PARENT, startsAt: TUE_14 });
    for (const bookings of [[prebookHold], [ownBooked]]) {
      const { deps } = setup({ bookings });
      expect(await holdSlotForParent({ parentUserId: PARENT, startsAt: TUE_14, positionId: null, actor: PARENT_ACTOR }, deps)).toEqual({
        ok: false,
        error: "taken",
      });
    }
  });

  it("a cohort pre-book may hold beyond the window, on that day", async () => {
    const { fake, deps } = setup();
    const held = await holdSlotForParent(
      { parentUserId: PARENT, startsAt: "2027-02-15T10:00:00.000Z", purpose: "cohort_prebook", positionId: null, actor: PARENT_ACTOR },
      deps,
    );
    expect(held.ok).toBe(true);
    expect(callsTo(fake, "holdSlot")[0].args[0]).toMatchObject({ purpose: "cohort_prebook" });
  });

  it("passes the database's refusal through (taken in the race)", async () => {
    const { deps } = setup({ results: { holdSlot: { ok: false, error: "taken" } } });
    expect(await holdSlotForParent({ parentUserId: PARENT, startsAt: TUE_14, positionId: null, actor: PARENT_ACTOR }, deps)).toEqual({
      ok: false,
      error: "taken",
    });
  });

  it.each([
    { parentUserId: "not-a-uuid", startsAt: TUE_14, actor: PARENT_ACTOR },
    { parentUserId: PARENT, startsAt: TUE_14, actor: { userId: PARENT, kind: "nanny" } },
    { parentUserId: PARENT, startsAt: TUE_14, purpose: "first", actor: PARENT_ACTOR },
  ])("refuses a malformed request %#", async (input) => {
    const { fake, deps } = setup();
    expect(await holdSlotForParent(input as never, deps)).toEqual({ ok: false, error: "invalid" });
    expect(fake.calls).toEqual([]);
  });
});

describe("who may act (review H2b, H2c, H2e)", () => {
  const OTHER_ACTOR = { userId: OTHER_PARENT, kind: "parent" } as const;

  it("a parent acting for another parent → invalid on hold, book, confirm and cancel, zero repo calls", async () => {
    const { fake, deps } = setup();
    const answers = await Promise.all([
      holdSlotForParent({ parentUserId: PARENT, startsAt: TUE_14, actor: OTHER_ACTOR }, deps),
      bookSlotForParent({ parentUserId: PARENT, startsAt: TUE_14, idempotencyKey: "k", actor: OTHER_ACTOR }, deps),
      confirmHoldForParent({ parentUserId: PARENT, holdId: HOLD, idempotencyKey: "k", actor: OTHER_ACTOR }, deps),
      cancelBooking({ parentUserId: PARENT, bookingId: HOLD, actor: OTHER_ACTOR }, deps),
    ]);
    expect(answers).toEqual(Array(4).fill({ ok: false, error: "invalid" }));
    expect(fake.calls).toEqual([]);
  });

  it("an admin actor needs a real proof (a look-alike → invalid, zero repo calls)", async () => {
    const { fake, deps } = setup();
    const forged = { kind: "admin", proof: FORGED } as const;
    const answers = await Promise.all([
      holdSlotForParent({ parentUserId: PARENT, startsAt: TUE_14, actor: forged }, deps),
      bookSlotForParent({ parentUserId: PARENT, startsAt: TUE_14, idempotencyKey: "k", actor: forged }, deps),
      cancelBooking({ parentUserId: PARENT, bookingId: HOLD, actor: { userId: ADMIN, kind: "admin" } as never }, deps),
    ]);
    expect(answers).toEqual(Array(3).fill({ ok: false, error: "invalid" }));
    expect(fake.calls).toEqual([]);
  });

  it("a real proof acts as that admin", async () => {
    const { fake, deps } = setup();
    await cancelBooking({ parentUserId: PARENT, bookingId: HOLD, actor: ADMIN_ACTOR }, deps);
    expect(callsTo(fake, "cancelBooking")[0].args[0]).toEqual({ parentUserId: PARENT, bookingId: HOLD, actor: { userId: ADMIN, kind: "admin" } });
  });

  it("a position that isn't hers: the database's invalid passes through", async () => {
    const { deps } = setup({ results: { holdSlot: { ok: false, error: "invalid" } } });
    const held = await holdSlotForParent({ parentUserId: PARENT, startsAt: TUE_14, positionId: OTHER_PARENT, actor: PARENT_ACTOR }, deps);
    expect(held).toEqual({ ok: false, error: "invalid" });
  });
});

describe("holdSlotForParent across the spring clock change (review M3)", () => {
  const ALL_DAY = ([1, 2, 3, 4, 5, 6, 7] as const).map((weekday) => ({ weekday, startMinute: 0, endMinute: 1440 }));
  const at = (iso: string, seed: Partial<FakeCallsState> = {}) => {
    const { deps } = setup(seed);
    return { ...deps, now: () => new Date(iso) };
  };
  const hold = (startsAt: string, deps: CallsDeps) =>
    holdSlotForParent({ parentUserId: PARENT, startsAt, positionId: null, actor: PARENT_ACTOR }, deps);

  it("Thu 25 Mar 10:00: Thu 1 Apr 10:00 BST is the last time; 10:30 BST is past the window", async () => {
    expect((await hold("2027-04-01T09:00:00.000Z", at("2027-03-25T10:00:00.000Z"))).ok).toBe(true);
    expect(await hold("2027-04-01T09:30:00.000Z", at("2027-03-25T10:00:00.000Z"))).toEqual({ ok: false, error: "invalid" });
  });

  it("Sat 27 Mar 23:30: Sun 02:30 BST is the first time; 02:00 BST and 00:30 GMT are too soon", async () => {
    const deps = at("2027-03-27T23:30:00.000Z", { hours: ALL_DAY });
    expect((await hold("2027-03-28T01:30:00.000Z", deps)).ok).toBe(true);
    expect(await hold("2027-03-28T01:00:00.000Z", deps)).toEqual({ ok: false, error: "too_soon" });
    expect(await hold("2027-03-28T00:30:00.000Z", deps)).toEqual({ ok: false, error: "too_soon" });
  });
});

describe("confirmHoldForParent", () => {
  const confirm = (deps: CallsDeps) =>
    confirmHoldForParent({ parentUserId: PARENT, holdId: HOLD, idempotencyKey: "key-1", actor: PARENT_ACTOR }, deps);

  it("booked → a 'booked' notice", async () => {
    const { deps, notices } = setup();
    const done = await confirm(deps);
    expect(done).toEqual({ ok: true, value: { kind: "booked", bookingId: "hold-1", startsAt: TUE_14, replay: false } });
    expect(notices).toEqual([{ kind: "booked", parentUserId: PARENT, bookingId: "hold-1", startsAt: TUE_14, actorKind: "parent" }]);
  });

  it("with a booking already → the same row moves, old time returned, a 'moved' notice", async () => {
    const moved = { kind: "moved", bookingId: "booking-9", startsAt: TUE_14, fromStartsAt: "2027-02-08T10:00:00.000Z" } as const;
    const { deps, notices } = setup({ results: { confirmHold: { ok: true, value: moved } } });
    expect(await confirm(deps)).toEqual({ ok: true, value: moved });
    expect(notices).toEqual([
      { kind: "moved", parentUserId: PARENT, bookingId: "booking-9", startsAt: TUE_14, fromStartsAt: "2027-02-08T10:00:00.000Z", actorKind: "parent" },
    ]);
  });

  it("a replay sends nothing a second time", async () => {
    const replay = { kind: "booked", bookingId: "hold-1", startsAt: TUE_14, replay: true } as const;
    const { deps, notices } = setup({ results: { confirmHold: { ok: true, value: replay } } });
    expect(await confirm(deps)).toEqual({ ok: true, value: replay });
    expect(notices).toEqual([]);
  });

  it.each(["hold_expired", "not_yours", "not_found", "rate_limited"] as const)("%s passes through, nothing sent", async (error) => {
    const { deps, notices } = setup({ results: { confirmHold: { ok: false, error } } });
    expect(await confirm(deps)).toEqual({ ok: false, error });
    expect(notices).toEqual([]);
  });

  it("an email failure leaves the booking standing", async () => {
    const { deps } = setup();
    const failing = {
      ...deps,
      notify: async () => {
        throw new Error("resend down");
      },
    };
    expect((await confirm(failing)).ok).toBe(true);
    expect(errorLog).toHaveBeenCalled();
  });

  it.each([
    { parentUserId: PARENT, holdId: "nope", idempotencyKey: "k", actor: PARENT_ACTOR },
    { parentUserId: PARENT, holdId: HOLD, idempotencyKey: "", actor: PARENT_ACTOR },
    { parentUserId: PARENT, holdId: HOLD, idempotencyKey: "k".repeat(201), actor: PARENT_ACTOR },
  ])("refuses a malformed request %#", async (input) => {
    const { fake, deps } = setup();
    expect(await confirmHoldForParent(input, deps)).toEqual({ ok: false, error: "invalid" });
    expect(fake.calls).toEqual([]);
  });
});

describe("bookSlotForParent — hold and confirm in one (admin on-behalf; 03's pre-book)", () => {
  it("recomputes the slot, books it, and sends a notice naming who acted", async () => {
    const { fake, deps, notices } = setup();
    const done = await bookSlotForParent(
      { parentUserId: PARENT, startsAt: TUE_14, purpose: "first_call", positionId: null, idempotencyKey: "key-2", actor: ADMIN_ACTOR },
      deps,
    );
    expect(done).toEqual({ ok: true, value: { kind: "booked", bookingId: "booking-1", startsAt: TUE_14, replay: false } });
    expect(callsTo(fake, "bookSlot")[0].args[0]).toMatchObject({ endsAt: "2027-02-09T14:30:00.000Z", idempotencyKey: "key-2" });
    expect(notices[0]).toMatchObject({ kind: "booked", actorKind: "admin" });
  });

  it("an off-grid start → invalid, nothing booked", async () => {
    const { fake, deps } = setup();
    const done = await bookSlotForParent({ parentUserId: PARENT, startsAt: "2027-02-09T14:10:00.000Z", idempotencyKey: "k", actor: ADMIN_ACTOR }, deps);
    expect(done).toEqual({ ok: false, error: "invalid" });
    expect(callsTo(fake, "bookSlot")).toEqual([]);
  });

  it("passes taken through", async () => {
    const { deps, notices } = setup({ results: { bookSlot: { ok: false, error: "taken" } } });
    const done = await bookSlotForParent({ parentUserId: PARENT, startsAt: TUE_14, positionId: null, idempotencyKey: "k", actor: ADMIN_ACTOR }, deps);
    expect(done).toEqual({ ok: false, error: "taken" });
    expect(notices).toEqual([]);
  });
});

describe("cancelBooking", () => {
  it("cancels and sends a 'cancelled' notice", async () => {
    const { deps, notices } = setup();
    const done = await cancelBooking({ parentUserId: PARENT, bookingId: HOLD, actor: PARENT_ACTOR }, deps);
    expect(done).toEqual({ ok: true, value: { bookingId: HOLD, startsAt: TUE_14 } });
    expect(notices).toEqual([{ kind: "cancelled", parentUserId: PARENT, bookingId: HOLD, startsAt: TUE_14, actorKind: "parent" }]);
  });

  it("another parent's booking → not_yours, nothing sent", async () => {
    const { deps, notices } = setup({ results: { cancelBooking: { ok: false, error: "not_yours" } } });
    expect(await cancelBooking({ parentUserId: OTHER_PARENT, bookingId: HOLD, actor: { userId: OTHER_PARENT, kind: "parent" } }, deps)).toEqual({
      ok: false,
      error: "not_yours",
    });
    expect(notices).toEqual([]);
  });

  it("a malformed id → invalid", async () => {
    const { fake, deps } = setup();
    expect(await cancelBooking({ parentUserId: PARENT, bookingId: "x", actor: PARENT_ACTOR }, deps)).toEqual({ ok: false, error: "invalid" });
    expect(fake.calls).toEqual([]);
  });
});

describe("recordCallOutcome — admin proof first (review H2e); 05 passes justcallCallId (R22)", () => {
  it("records as the proven admin, with defaults: method phone, source manual, no note", async () => {
    const { fake, deps, notices } = setup();
    const done = await recordCallOutcome(PROOF, { parentUserId: PARENT, bookingId: HOLD, result: "no_answer" }, deps);
    expect(done).toEqual({ ok: true, value: { entryId: "entry-1", replay: false } });
    expect(callsTo(fake, "recordOutcome")[0].args[0]).toEqual({
      parentUserId: PARENT,
      bookingId: HOLD,
      result: "no_answer",
      outcome: null,
      note: null,
      callBackAt: null,
      method: "phone",
      source: "manual",
      actor: { userId: ADMIN },
      justcallCallId: null,
    });
    expect(notices).toEqual([]);
  });

  it("passes a JustCall entry through whole", async () => {
    const { fake, deps } = setup();
    await recordCallOutcome(
      PROOF,
      {
        parentUserId: PARENT,
        result: "answered",
        outcome: "call_back_later",
        note: "after the school run",
        callBackAt: "2027-02-10T16:00:00+00:00",
        method: "justcall",
        source: "justcall",
        justcallCallId: "jc-123",
      },
      deps,
    );
    expect(callsTo(fake, "recordOutcome")[0].args[0]).toMatchObject({
      bookingId: null,
      callBackAt: "2027-02-10T16:00:00.000Z",
      method: "justcall",
      source: "justcall",
      actor: { userId: ADMIN },
      justcallCallId: "jc-123",
    });
  });

  it("a forged proof → invalid, nothing recorded", async () => {
    const { fake, deps } = setup();
    expect(await recordCallOutcome(FORGED, { parentUserId: PARENT, result: "no_answer" }, deps)).toEqual({ ok: false, error: "invalid" });
    expect(fake.calls).toEqual([]);
  });

  it("Stop calling needs no result", async () => {
    const { deps } = setup();
    expect((await recordCallOutcome(PROOF, { parentUserId: PARENT, outcome: "stop_calling" }, deps)).ok).toBe(true);
  });

  it("Stop calling while booked → booked_call_exists passes through", async () => {
    const { deps } = setup({ results: { recordOutcome: { ok: false, error: "booked_call_exists" } } });
    expect(await recordCallOutcome(PROOF, { parentUserId: PARENT, outcome: "stop_calling" }, deps)).toEqual({
      ok: false,
      error: "booked_call_exists",
    });
  });

  it.each([
    ["an outcome without Answered", { result: "no_answer", outcome: "deposit_taken" }],
    ["no result and no Stop calling", { result: null }],
    ["a note over 2,000 characters", { result: "answered", note: "x".repeat(2001) }],
    ["an unknown result", { result: "busy" }],
    ["a call-back time that isn't one", { result: "answered", outcome: "call_back_later", callBackAt: "tomorrow" }],
    ["a caller-supplied actor", { result: "answered", actor: { userId: ADMIN } }],
  ])("%s → invalid, nothing recorded", async (_label, fields) => {
    const { fake, deps } = setup();
    expect(await recordCallOutcome(PROOF, { parentUserId: PARENT, ...fields } as never, deps)).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(fake.calls).toEqual([]);
  });
});
