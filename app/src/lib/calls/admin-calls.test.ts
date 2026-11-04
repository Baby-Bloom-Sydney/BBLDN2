/**
 * The admin-only operations (04a security review H2e): each needs a real admin proof as its first parameter, and
 * acts as that admin. The switch is checked first; a missing or forged proof is `invalid` with zero repo calls.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin }));

import { bookSlotOnBehalf, cancelBookingOnBehalf, replaceWeeklyHours, startCallBooking } from "./admin-calls";
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
];

describe("the gates", () => {
  it("switch off → call_booking_disabled, zero repo calls", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    const { fake, deps } = setup();
    expect(await Promise.all(ALL(PROOF, deps))).toEqual(Array(4).fill({ ok: false, error: "call_booking_disabled" }));
    expect(fake.calls).toEqual([]);
  });

  it("a forged proof → invalid, zero repo calls", async () => {
    const { fake, deps } = setup();
    expect(await Promise.all(ALL(FORGED, deps))).toEqual(Array(4).fill({ ok: false, error: "invalid" }));
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
