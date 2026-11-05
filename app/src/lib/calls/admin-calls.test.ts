/**
 * The admin-only operations (04a security review H2e): each needs a real admin proof as its first parameter, and
 * acts as that admin. The switch is checked first; a missing or forged proof is `invalid` with zero repo calls.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin }));

import {
  adminRefusalOf,
  bookSlotOnBehalf,
  cancelBookingOnBehalf,
  confirmHoldOnBehalf,
  familySlotGrid,
  holdSlotOnBehalf,
  replaceWeeklyHours,
  startCallBooking,
} from "./admin-calls";
import { proveAdmin, type AdminProof } from "./admin-proof";
import type { CallsDeps } from "./deps";
import { callsTo, fakeCallsRepo, type FakeCallsState } from "./fake-calls-repo.test-util";
import type { CallNotice } from "./notify";

const ADMIN = "a0400000-0000-4000-8000-000000000001";
const PARENT = "b0400000-0000-4000-8000-000000000001";
const BOOKING = "c0400000-0000-4000-8000-000000000001";
const NOW = new Date("2027-02-04T10:00:00.000Z");
const TUE_14 = "2027-02-09T14:00:00.000Z";
const FORGED = { kind: "admin_proof", userId: ADMIN } as unknown as AdminProof;
let PROOF: AdminProof;

function setup(seed: Partial<FakeCallsState> = {}) {
  const fake = fakeCallsRepo(seed);
  const notices: CallNotice[] = [];
  const deps: CallsDeps = {
    repo: fake.repo,
    now: () => NOW,
    notify: async (n) => {
      notices.push(n);
    },
    prebookRequests: async () => new Map(),
  };
  return { fake, deps, notices };
}

beforeAll(async () => {
  requireAdmin.mockResolvedValue({ userId: ADMIN, error: null });
  const proof = await proveAdmin();
  if (proof === null) throw new Error("no proof");
  PROOF = proof;
});
beforeEach(() => vi.stubEnv("CALL_BOOKING_ENABLED", "true"));
afterEach(() => vi.unstubAllEnvs());

const ALL = (proof: AdminProof, deps: CallsDeps) => [
  startCallBooking(proof, deps),
  replaceWeeklyHours(proof, [{ weekday: 6, startMinute: 600, endMinute: 840 }], deps),
  bookSlotOnBehalf(proof, { parentUserId: PARENT, startsAt: TUE_14, idempotencyKey: "k" }, deps),
  cancelBookingOnBehalf(proof, { parentUserId: PARENT, bookingId: BOOKING }, deps),
  holdSlotOnBehalf(proof, { parentUserId: PARENT, startsAt: TUE_14 }, deps),
  confirmHoldOnBehalf(proof, { parentUserId: PARENT, holdId: BOOKING, idempotencyKey: "k" }, deps),
  familySlotGrid(proof, PARENT, deps),
];

describe("the gates", () => {
  it("switch off → call_booking_disabled, zero repo calls", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    const { fake, deps } = setup();
    expect(await Promise.all(ALL(PROOF, deps))).toEqual(Array(7).fill({ ok: false, error: "call_booking_disabled" }));
    expect(fake.calls).toEqual([]);
  });

  it("a forged proof → invalid, zero repo calls", async () => {
    const { fake, deps } = setup();
    expect(await Promise.all(ALL(FORGED, deps))).toEqual(Array(7).fill({ ok: false, error: "invalid" }));
    expect(fake.calls).toEqual([]);
  });
});

describe("acting as the proven admin", () => {
  it("startCallBooking → the repository, as her", async () => {
    const { fake, deps } = setup();
    expect(await startCallBooking(PROOF, deps)).toEqual({ ok: true, value: { enabledSince: "2027-02-01T09:00:00.000Z", startedNow: true } });
    expect(callsTo(fake, "startCallBooking")[0].args).toEqual([{ userId: ADMIN, kind: "admin" }]);
  });

  it("replaceWeeklyHours checks the week first (invalid / overlap without a write), then replaces it sorted", async () => {
    const { fake, deps } = setup();
    expect(await replaceWeeklyHours(PROOF, [{ weekday: 0, startMinute: 0, endMinute: 60 }], deps)).toEqual({ ok: false, error: "invalid" });
    expect(
      await replaceWeeklyHours(PROOF, [{ weekday: 1, startMinute: 540, endMinute: 720 }, { weekday: 1, startMinute: 700, endMinute: 800 }], deps),
    ).toEqual({ ok: false, error: "overlap" });
    expect(callsTo(fake, "replaceWeeklyHours")).toEqual([]);
    const week = [
      { weekday: 6, startMinute: 600, endMinute: 840 },
      { weekday: 1, startMinute: 540, endMinute: 1140 },
    ];
    expect(await replaceWeeklyHours(PROOF, week, deps)).toEqual({ ok: true, value: true });
    expect(callsTo(fake, "replaceWeeklyHours")[0].args).toEqual([[week[1], week[0]], { userId: ADMIN, kind: "admin" }]);
  });

  it("replaceWeeklyHours passes the database's overlap through", async () => {
    const { deps } = setup({ results: { replaceWeeklyHours: { ok: false, error: "overlap" } } });
    expect(await replaceWeeklyHours(PROOF, [], deps)).toEqual({ ok: false, error: "overlap" });
  });

  it("bookSlotOnBehalf books as the admin and the notice says so", async () => {
    const { fake, deps, notices } = setup();
    const done = await bookSlotOnBehalf(PROOF, { parentUserId: PARENT, startsAt: TUE_14, positionId: null, idempotencyKey: "k" }, deps);
    expect(done.ok).toBe(true);
    expect(callsTo(fake, "bookSlot")[0].args[0]).toMatchObject({ parentUserId: PARENT, actor: { userId: ADMIN, kind: "admin" } });
    expect(notices[0]).toMatchObject({ kind: "booked", actorKind: "admin" });
  });

  it("cancelBookingOnBehalf cancels as the admin", async () => {
    const { fake, deps, notices } = setup();
    expect((await cancelBookingOnBehalf(PROOF, { parentUserId: PARENT, bookingId: BOOKING }, deps)).ok).toBe(true);
    expect(callsTo(fake, "cancelBooking")[0].args[0]).toEqual({ parentUserId: PARENT, bookingId: BOOKING, actor: { userId: ADMIN, kind: "admin" } });
    expect(notices[0]).toMatchObject({ kind: "cancelled", actorKind: "admin" });
  });
});

describe("the on-behalf picker: tap to hold, then confirm (04c-1 C4; BB-wave1-041126/04c1-build)", () => {
  it("holdSlotOnBehalf holds her first call as the admin; her latest position is found server-side", async () => {
    const { fake, deps } = setup({ latestPositionId: "d0400000-0000-4000-8000-000000000001" });
    const held = await holdSlotOnBehalf(PROOF, { parentUserId: PARENT, startsAt: TUE_14 }, deps);
    expect(held).toEqual({
      ok: true,
      value: { bookingId: "hold-1", holdExpiresAt: "2027-02-04T10:05:00.000Z", startsAt: TUE_14, endsAt: "2027-02-09T14:30:00.000Z", holdMinutes: 5 },
    });
    expect(callsTo(fake, "holdSlot")[0].args[0]).toMatchObject({
      parentUserId: PARENT,
      purpose: "first_call",
      positionId: "d0400000-0000-4000-8000-000000000001",
      actor: { userId: ADMIN, kind: "admin" },
    });
  });

  it("holdSlotOnBehalf refuses a time off the grid (the server recomputes it), with no write", async () => {
    const { fake, deps } = setup();
    expect(await holdSlotOnBehalf(PROOF, { parentUserId: PARENT, startsAt: "2027-02-09T14:10:00.000Z" }, deps)).toEqual({ ok: false, error: "invalid" });
    expect(callsTo(fake, "holdSlot")).toEqual([]);
  });

  it("holdSlotOnBehalf refuses a parent id that isn't a user id, before any read", async () => {
    const { fake, deps } = setup();
    expect(await holdSlotOnBehalf(PROOF, { parentUserId: "nope", startsAt: TUE_14 }, deps)).toEqual({ ok: false, error: "invalid" });
    expect(fake.calls).toEqual([]);
  });

  it("confirmHoldOnBehalf confirms as the admin; a move is a move, and she is emailed either way", async () => {
    const moved = { ok: true as const, value: { kind: "moved" as const, bookingId: BOOKING, startsAt: TUE_14, fromStartsAt: "2027-02-08T10:00:00.000Z" } };
    const { fake, deps, notices } = setup({ results: { confirmHold: moved } });
    expect(await confirmHoldOnBehalf(PROOF, { parentUserId: PARENT, holdId: BOOKING, idempotencyKey: "k" }, deps)).toEqual(moved);
    expect(callsTo(fake, "confirmHold")[0].args[0]).toEqual({ parentUserId: PARENT, holdId: BOOKING, idempotencyKey: "k", actor: { userId: ADMIN, kind: "admin" } });
    expect(notices[0]).toMatchObject({ kind: "moved", actorKind: "admin", parentUserId: PARENT });
  });

  it("confirmHoldOnBehalf passes a refusal through (her hold ran out)", async () => {
    const { deps, notices } = setup({ results: { confirmHold: { ok: false, error: "hold_expired" } } });
    expect(await confirmHoldOnBehalf(PROOF, { parentUserId: PARENT, holdId: BOOKING, idempotencyKey: "k" }, deps)).toEqual({ ok: false, error: "hold_expired" });
    expect(notices).toEqual([]);
  });

  it("familySlotGrid is her picker's whole grid; her own live hold doesn't look taken to her", async () => {
    const hers = { id: "h", parentUserId: PARENT, startsAt: TUE_14, status: "held" as const, holdExpiresAt: "2027-02-04T10:05:00.000Z" };
    const { bookingRow } = await import("./fake-calls-repo.test-util");
    const { deps } = setup({ bookings: [bookingRow({ ...hers, bookedAt: null })] });
    const grid = await familySlotGrid(PROOF, PARENT, deps);
    expect(grid.ok).toBe(true);
    if (!grid.ok) return;
    expect(grid.value.slots.find((s) => s.startsAt === TUE_14)?.free).toBe(true);
    expect(grid.value.dates[0]).toBe("2027-02-04");
  });

  it("familySlotGrid refuses a parent id that isn't a user id", async () => {
    const { fake, deps } = setup();
    expect(await familySlotGrid(PROOF, "nope", deps)).toEqual({ ok: false, error: "invalid" });
    expect(fake.calls).toEqual([]);
  });
});

describe("adminRefusalOf: every call error as a code staff may see (04c-1)", () => {
  it("passes the closed codes through; an overlap reads as taken", () => {
    expect(adminRefusalOf("taken")).toBe("taken");
    expect(adminRefusalOf("overlap")).toBe("taken");
    expect(adminRefusalOf("booked_call_exists")).toBe("booked_call_exists");
    expect(adminRefusalOf("hold_expired")).toBe("hold_expired");
    expect(adminRefusalOf("call_booking_disabled")).toBe("call_booking_disabled");
    expect(adminRefusalOf("error")).toBe("error");
  });
});
