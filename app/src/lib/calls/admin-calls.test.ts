/**
 * The admin-only operations (04a security review H2e): each needs a real admin proof as its first parameter, and
 * acts as that admin. The switch is checked first; a missing or forged proof is `invalid` with zero repo calls.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin }));

import {
  addCallBlock,
  adminRefusalOf,
  bookSlotOnBehalf,
  calendarRefusalOf,
  calendarWeek,
  cancelBookingOnBehalf,
  confirmHoldOnBehalf,
  familySlotGrid,
  holdSlotOnBehalf,
  removeCallBlock,
  replaceWeeklyHours,
  startCallBooking,
  updateCallSettings,
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

/** PARENT has a parents row (she is in the scope the fake reads `readScopeParent` from). */
const PARENT_ROW = { userId: "b0400000-0000-4000-8000-000000000001", signupSource: "advanced_match", signedUpAt: "2027-02-01T09:00:00.000Z" };

function setup(seed: Partial<FakeCallsState> = {}) {
  const fake = fakeCallsRepo({ scope: [PARENT_ROW], ...seed });
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
  updateCallSettings(proof, { slotMinutes: 45 }, deps),
  addCallBlock(proof, { fromDate: "2027-02-12", fromTime: "09:00", toDate: "2027-02-12", toTime: "13:00", reason: "dentist" }, deps),
  removeCallBlock(proof, BOOKING, deps),
  calendarWeek(proof, deps),
];

describe("the gates", () => {
  it("switch off → call_booking_disabled, zero repo calls", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    const { fake, deps } = setup();
    expect(await Promise.all(ALL(PROOF, deps))).toEqual(Array(11).fill({ ok: false, error: "call_booking_disabled" }));
    expect(fake.calls).toEqual([]);
  });

  it("a forged proof → invalid, zero repo calls", async () => {
    const { fake, deps } = setup();
    expect(await Promise.all(ALL(FORGED, deps))).toEqual(Array(11).fill({ ok: false, error: "invalid" }));
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

describe("on-behalf writes need a parents row (review round 2 L11)", () => {
  it.each([
    ["holdSlotOnBehalf", (deps: CallsDeps) => holdSlotOnBehalf(PROOF, { parentUserId: PARENT, startsAt: TUE_14 }, deps)],
    ["confirmHoldOnBehalf", (deps: CallsDeps) => confirmHoldOnBehalf(PROOF, { parentUserId: PARENT, holdId: BOOKING, idempotencyKey: "k" }, deps)],
    ["bookSlotOnBehalf", (deps: CallsDeps) => bookSlotOnBehalf(PROOF, { parentUserId: PARENT, startsAt: TUE_14, idempotencyKey: "k" }, deps)],
    ["cancelBookingOnBehalf", (deps: CallsDeps) => cancelBookingOnBehalf(PROOF, { parentUserId: PARENT, bookingId: BOOKING }, deps)],
  ] as const)("%s: no parents row → not_found, before any write or email", async (_n, act) => {
    const { fake, deps, notices } = setup({ scope: [] });
    expect(await act(deps)).toEqual({ ok: false, error: "not_found" });
    for (const write of ["holdSlot", "confirmHold", "bookSlot", "cancelBooking"] as const) expect(callsTo(fake, write)).toEqual([]);
    expect(notices).toEqual([]);
  });

  it("the parents read failing → error, before any write", async () => {
    const { fake, deps } = setup({ failing: ["readScopeParent"] });
    expect(await holdSlotOnBehalf(PROOF, { parentUserId: PARENT, startsAt: TUE_14 }, deps)).toEqual({ ok: false, error: "error" });
    expect(callsTo(fake, "holdSlot")).toEqual([]);
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

describe("the Calendar tab (04c-2, plan C5; BB-wave1-041126/04c2-build)", () => {
  const BLOCK_FORM = { fromDate: "2027-02-12", fromTime: "09:00", toDate: "2027-02-12", toTime: "13:00", reason: " dentist " };
  const JANE = { userId: PARENT, firstName: "Jane", lastName: "Smith", email: "jane@example.com", mobile: null, isTestUser: false };

  it("updateCallSettings: call length 45, notice, hold, caller number → the repository, as the admin", async () => {
    const { fake, deps } = setup();
    const update = { slotMinutes: 45, noticeMinutes: 60, holdMinutes: 10, callerNumber: "+44 20 7946 0000" };
    const saved = await updateCallSettings(PROOF, update, deps);
    expect(saved).toMatchObject({ ok: true, value: { slotMinutes: 45, noticeMinutes: 60, holdMinutes: 10, callerNumber: "+442079460000" } });
    expect(callsTo(fake, "updateSettings")[0].args).toEqual([
      { slotMinutes: 45, noticeMinutes: 60, holdMinutes: 10, callerNumber: "+442079460000" },
      { userId: ADMIN, kind: "admin" },
    ]);
  });

  it.each([
    ["a length off the fixed list (25)", { slotMinutes: 25 }],
    ["the database's own bounds but not the list (5)", { slotMinutes: 5 }],
    ["enabledSince (Start call booking's alone)", { enabledSince: "2027-02-01T09:00:00Z" }],
    ["a notice past a week", { noticeMinutes: 10081 }],
    ["a caller number not in the +44 form", { callerNumber: "020 7946 0000" }],
  ])("updateCallSettings refuses %s, with no write", async (_label, update) => {
    const { fake, deps } = setup();
    expect(await updateCallSettings(PROOF, update, deps)).toEqual({ ok: false, error: "invalid" });
    expect(callsTo(fake, "updateSettings")).toEqual([]);
  });

  it("addCallBlock reads the form as London time on the server, then adds it as the admin", async () => {
    const { fake, deps } = setup();
    const added = await addCallBlock(PROOF, { ...BLOCK_FORM, fromDate: "2027-06-30", fromTime: "23:00", toDate: "2027-07-01", toTime: "08:00" }, deps);
    expect(added.ok).toBe(true);
    expect(callsTo(fake, "insertBlock")[0].args).toEqual([
      { startsAt: "2027-06-30T22:00:00.000Z", endsAt: "2027-07-01T07:00:00.000Z", reason: "dentist" },
      { userId: ADMIN, kind: "admin" },
    ]);
  });

  it("addCallBlock refuses a block already over (by the server's clock), with no write", async () => {
    const { fake, deps } = setup();
    expect(await addCallBlock(PROOF, { ...BLOCK_FORM, fromDate: "2027-02-03", toDate: "2027-02-03" }, deps)).toEqual({ ok: false, error: "invalid" });
    expect(callsTo(fake, "insertBlock")).toEqual([]);
  });

  it("removeCallBlock removes that block as the admin; already gone → not_found; not an id → invalid before any call", async () => {
    const blocks = [{ id: BOOKING, startsAt: "2027-02-12T09:00:00.000Z", endsAt: "2027-02-12T13:00:00.000Z", reason: "dentist" }];
    const { fake, deps } = setup({ blocks });
    expect(await removeCallBlock(PROOF, BOOKING, deps)).toEqual({ ok: true, value: blocks[0] });
    expect(callsTo(fake, "deleteBlock")[0].args).toEqual([BOOKING, { userId: ADMIN, kind: "admin" }]);
    expect(await removeCallBlock(PROOF, "c0400000-0000-4000-8000-000000000099", deps)).toEqual({ ok: false, error: "not_found" });
    const before = fake.calls.length;
    expect(await removeCallBlock(PROOF, "../blocks", deps)).toEqual({ ok: false, error: "invalid" });
    expect(fake.calls.length).toBe(before);
  });

  it("calendarWeek: the grid over today's London date and six more, blocks from its start on, booked names", async () => {
    const { bookingRow } = await import("./fake-calls-repo.test-util");
    const booked = bookingRow({ parentUserId: PARENT, startsAt: TUE_14 });
    const { fake, deps } = setup({ bookings: [booked], contacts: [JANE] });
    const week = await calendarWeek(PROOF, deps);
    expect(week.ok).toBe(true);
    if (!week.ok) return;
    expect(week.value.days.map((d) => d.londonDate)[0]).toBe("2027-02-04");
    expect(week.value.days.flatMap((d) => d.cells).find((c) => c.kind === "booked")).toMatchObject({ name: "Jane Smith", time: "14:00–14:30" });
    expect(callsTo(fake, "readOccupyingBookings")[0].args).toEqual([{ startsAt: "2027-02-04T00:00:00.000Z", endsAt: "2027-02-11T00:00:00.000Z" }]);
    expect(callsTo(fake, "readBlocks")[0].args[0]).toMatchObject({ startsAt: "2027-02-04T00:00:00.000Z" });
    expect(callsTo(fake, "readContacts")[0].args).toEqual([[PARENT]]);
  });

  it("calendarWeek reads no contacts when nobody is booked (a live hold carries no name)", async () => {
    const { bookingRow } = await import("./fake-calls-repo.test-util");
    const held = bookingRow({ parentUserId: PARENT, startsAt: TUE_14, status: "held", holdExpiresAt: "2027-02-04T10:05:00.000Z", bookedAt: null });
    const { fake, deps } = setup({ bookings: [held] });
    expect((await calendarWeek(PROOF, deps)).ok).toBe(true);
    expect(callsTo(fake, "readContacts")).toEqual([]);
  });

  it.each(["readSettings", "readWeeklyHours", "readBlocks", "readOccupyingBookings", "readContacts"] as const)(
    "calendarWeek fails closed when %s fails",
    async (method) => {
      const { bookingRow } = await import("./fake-calls-repo.test-util");
      const { deps } = setup({ bookings: [bookingRow({ parentUserId: PARENT, startsAt: TUE_14 })], failing: [method] });
      expect(await calendarWeek(PROOF, deps)).toEqual({ ok: false, error: "error" });
    },
  );

  it("calendarRefusalOf: overlapping hours stay 'overlap' (their own words); the rest as adminRefusalOf", () => {
    expect(calendarRefusalOf("overlap")).toBe("overlap");
    expect(calendarRefusalOf("invalid")).toBe("invalid");
    expect(calendarRefusalOf("not_found")).toBe("not_found");
    expect(calendarRefusalOf("taken")).toBe("taken");
  });
});
