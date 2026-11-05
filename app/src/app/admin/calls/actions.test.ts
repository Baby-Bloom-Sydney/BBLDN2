/**
 * /admin/calls server actions (plan C4; brief §3 admin 3–4, §0.10, §0.11, §9.15; BB-wave1-041126/04c1-build).
 *
 * Contract, for each: the switch first (off → call_booking_disabled), then the admin (not one → not_authorized),
 * then zod on the whole input (invalid) — each before anything is read or written — then one call operation acting
 * as the proven admin, then /admin/calls is revalidated after a write. Refusals are closed codes, never detail.
 *
 * The real `booking.ts` / `admin-calls.ts` rules run here against the in-memory call repository (`defaultCallsDeps`
 * is swapped for it); the database's own checks are amendment 19's harness, and the end-to-end walk proves the
 * booking closing and the family moving back to Not booked on the local stack.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallsDeps } from "@/lib/calls/deps";
import type { FakeCallsRepo } from "@/lib/calls/fake-calls-repo.test-util";
import type { CallNotice } from "@/lib/calls/notify";

const h = vi.hoisted(() => ({
  gate: { userId: "a0400000-0000-4000-8000-000000000001", error: null as string | null },
  gateCalls: 0,
  deps: null as CallsDeps | null,
  revalidated: [] as string[],
}));
vi.mock("@/lib/admin/require-admin", () => ({
  requireAdmin: async () => {
    h.gateCalls += 1;
    return h.gate;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => h.revalidated.push(p) }));
vi.mock("@/lib/calls/deps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/calls/deps")>()),
  defaultCallsDeps: () => h.deps!,
}));

import { callsTo, fakeCallsRepo } from "@/lib/calls/fake-calls-repo.test-util";
import { CALL_SETTINGS_DEFAULTS } from "@/lib/calls/settings";
import { cancelCallForFamily, confirmCallForFamily, holdCallForFamily, recordCallOutcomeAction, reloadFamilySlots } from "./actions";

const ADMIN = "a0400000-0000-4000-8000-000000000001";
const JANE = "b0400000-0000-4000-8000-000000000001";
const BOOKING = "c0400000-0000-4000-8000-000000000001";
const NOW = new Date("2027-02-04T10:00:00.000Z");
const TUE_14 = "2027-02-09T14:00:00.000Z";

let fake: FakeCallsRepo;
let notices: CallNotice[];

beforeEach(() => {
  vi.stubEnv("CALL_BOOKING_ENABLED", "true");
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.gate = { userId: ADMIN, error: null };
  h.gateCalls = 0;
  h.revalidated = [];
  notices = [];
  fake = fakeCallsRepo({ settings: { ...CALL_SETTINGS_DEFAULTS, enabledSince: "2027-02-01T09:00:00.000Z" } });
  h.deps = {
    repo: fake.repo,
    now: () => NOW,
    notify: async (n) => {
      notices.push(n);
    },
    prebookRequests: async () => new Map(),
  };
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const OUTCOME = { parentUserId: JANE, bookingId: BOOKING, result: "no_answer", outcome: null, note: "Rang twice" };

const EVERY = [
  ["recordCallOutcomeAction", () => recordCallOutcomeAction(OUTCOME)],
  ["holdCallForFamily", () => holdCallForFamily({ parentUserId: JANE, startsAt: TUE_14 })],
  ["confirmCallForFamily", () => confirmCallForFamily({ parentUserId: JANE, holdId: BOOKING, idempotencyKey: BOOKING })],
  ["cancelCallForFamily", () => cancelCallForFamily({ parentUserId: JANE, bookingId: BOOKING })],
  ["reloadFamilySlots", () => reloadFamilySlots({ parentUserId: JANE })],
] as const;

describe("every action: the switch, the admin, the input — before anything is read", () => {
  it.each(EVERY)("%s: off → call_booking_disabled, no admin check, zero repo calls", async (_n, act) => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    expect(await act()).toEqual({ ok: false, error: "call_booking_disabled" });
    expect(h.gateCalls).toBe(0);
    expect(fake.calls).toEqual([]);
  });

  it.each(EVERY)("%s: not an admin → not_authorized, zero repo calls", async (_n, act) => {
    h.gate = { userId: "", error: "Not authorized — admin role required" };
    expect(await act()).toEqual({ ok: false, error: "not_authorized" });
    expect(fake.calls).toEqual([]);
    expect(h.revalidated).toEqual([]);
  });

  it.each([
    ["recordCallOutcomeAction", () => recordCallOutcomeAction({ ...OUTCOME, parentUserId: "x" })],
    ["recordCallOutcomeAction (extra field)", () => recordCallOutcomeAction({ ...OUTCOME, actor: ADMIN })],
    ["holdCallForFamily", () => holdCallForFamily({ parentUserId: JANE, startsAt: "Tuesday" })],
    ["confirmCallForFamily", () => confirmCallForFamily({ parentUserId: JANE, holdId: "h", idempotencyKey: "" })],
    ["cancelCallForFamily", () => cancelCallForFamily({ parentUserId: JANE })],
    ["reloadFamilySlots", () => reloadFamilySlots(null)],
  ])("%s: bad input → invalid, zero repo calls", async (_n, act) => {
    expect(await act()).toEqual({ ok: false, error: "invalid" });
    expect(fake.calls).toEqual([]);
  });
});

describe("recordCallOutcomeAction (brief §3 admin 3, §0.10)", () => {
  it("No answer against her booked call: recorded as the admin, by phone, manual; the page is revalidated", async () => {
    expect(await recordCallOutcomeAction(OUTCOME)).toEqual({ ok: true, value: { entryId: "entry-1" } });
    expect(callsTo(fake, "recordOutcome")[0].args[0]).toEqual({
      parentUserId: JANE,
      bookingId: BOOKING,
      result: "no_answer",
      outcome: null,
      note: "Rang twice",
      callBackAt: null,
      method: "phone",
      source: "manual",
      actor: { userId: ADMIN },
      justcallCallId: null,
    });
    expect(h.revalidated).toEqual(["/admin/calls"]);
  });

  it("an outcome only with Answered; Stop calling on its own; a blank note is no note", async () => {
    expect(await recordCallOutcomeAction({ ...OUTCOME, result: "no_answer", outcome: "deposit_taken" })).toEqual({ ok: false, error: "invalid" });
    expect(await recordCallOutcomeAction({ ...OUTCOME, bookingId: null, result: null, outcome: "stop_calling", note: "   " })).toEqual({ ok: true, value: { entryId: "entry-1" } });
    expect(callsTo(fake, "recordOutcome")[0].args[0]).toMatchObject({ result: null, outcome: "stop_calling", note: null, bookingId: null });
  });

  it("Stop calling while booked → booked_call_exists (the form says 'Cancel the booked time first'); nothing revalidated", async () => {
    fake.state.results.recordOutcome = { ok: false, error: "booked_call_exists" };
    expect(await recordCallOutcomeAction({ ...OUTCOME, result: null, outcome: "stop_calling" })).toEqual({ ok: false, error: "booked_call_exists" });
    expect(h.revalidated).toEqual([]);
  });

  it("the call-back time is read as London clock time on the server (BST and GMT)", async () => {
    await recordCallOutcomeAction({ ...OUTCOME, result: "answered", outcome: "call_back_later", callBackDate: "2027-07-01", callBackTime: "17:30" });
    await recordCallOutcomeAction({ ...OUTCOME, result: "answered", outcome: "call_back_later", callBackDate: "2027-02-05", callBackTime: "17:30" });
    expect(callsTo(fake, "recordOutcome").map((c) => (c.args[0] as { callBackAt: string }).callBackAt)).toEqual([
      "2027-07-01T16:30:00.000Z",
      "2027-02-05T17:30:00.000Z",
    ]);
  });

  it("a call-back date without a time, or a London time that doesn't exist (the spring gap) → invalid", async () => {
    expect(await recordCallOutcomeAction({ ...OUTCOME, result: "answered", outcome: "call_back_later", callBackDate: "2027-02-05" })).toEqual({ ok: false, error: "invalid" });
    expect(
      await recordCallOutcomeAction({ ...OUTCOME, result: "answered", outcome: "call_back_later", callBackDate: "2027-03-28", callBackTime: "01:30" }),
    ).toEqual({ ok: false, error: "invalid" });
    expect(callsTo(fake, "recordOutcome")).toEqual([]);
  });

  it("a call-back time only with Call back later, and only in the future (security review L2)", async () => {
    expect(await recordCallOutcomeAction({ ...OUTCOME, result: "no_answer", callBackDate: "2027-02-05", callBackTime: "17:30" })).toEqual({ ok: false, error: "invalid" });
    expect(
      await recordCallOutcomeAction({ ...OUTCOME, result: "answered", outcome: "call_back_later", callBackDate: "2020-01-01", callBackTime: "09:00" }),
    ).toEqual({ ok: false, error: "invalid" });
    expect(callsTo(fake, "recordOutcome")).toEqual([]);
  });

  it("a write that failed → error (logged in the repository), never detail", async () => {
    fake.state.failing = ["recordOutcome"];
    expect(await recordCallOutcomeAction(OUTCOME)).toEqual({ ok: false, error: "error" });
  });
});

describe("on behalf (brief §3 admin 4, §0.11)", () => {
  it("hold: a tap holds the time for her, as the admin, with the admin's held line", async () => {
    expect(await holdCallForFamily({ parentUserId: JANE, startsAt: TUE_14 })).toEqual({
      ok: true,
      value: { holdId: "hold-1", startsAt: TUE_14, line: "Held for 5 minutes" },
    });
    expect(callsTo(fake, "holdSlot")[0].args[0]).toMatchObject({ parentUserId: JANE, actor: { userId: ADMIN, kind: "admin" }, purpose: "first_call" });
  });

  it("hold: a time taken meanwhile → taken (the picker shows the taken notice)", async () => {
    fake.state.results.holdSlot = { ok: false, error: "taken" };
    expect(await holdCallForFamily({ parentUserId: JANE, startsAt: TUE_14 })).toEqual({ ok: false, error: "taken" });
  });

  it("confirm (book): booked as the admin; the family is emailed (a booked notice); the page revalidated", async () => {
    const done = await confirmCallForFamily({ parentUserId: JANE, holdId: BOOKING, idempotencyKey: BOOKING });
    expect(done).toEqual({ ok: true, value: { bookingId: "hold-1", moved: false } });
    expect(notices).toEqual([expect.objectContaining({ kind: "booked", parentUserId: JANE, actorKind: "admin" })]);
    expect(h.revalidated).toEqual(["/admin/calls"]);
  });

  it("confirm (move): the same booking moved; the family gets the change email", async () => {
    fake.state.results.confirmHold = { ok: true, value: { kind: "moved", bookingId: BOOKING, startsAt: TUE_14, fromStartsAt: "2027-02-08T10:00:00.000Z" } };
    expect(await confirmCallForFamily({ parentUserId: JANE, holdId: BOOKING, idempotencyKey: BOOKING })).toEqual({ ok: true, value: { bookingId: BOOKING, moved: true } });
    expect(notices).toEqual([expect.objectContaining({ kind: "moved", actorKind: "admin" })]);
  });

  it("confirm: her hold ran out → hold_expired, no email", async () => {
    fake.state.results.confirmHold = { ok: false, error: "hold_expired" };
    expect(await confirmCallForFamily({ parentUserId: JANE, holdId: BOOKING, idempotencyKey: BOOKING })).toEqual({ ok: false, error: "hold_expired" });
    expect(notices).toEqual([]);
  });

  it("cancel: cancelled as the admin; the family gets the cancellation email", async () => {
    expect(await cancelCallForFamily({ parentUserId: JANE, bookingId: BOOKING })).toEqual({ ok: true, value: { bookingId: BOOKING } });
    expect(callsTo(fake, "cancelBooking")[0].args[0]).toEqual({ parentUserId: JANE, bookingId: BOOKING, actor: { userId: ADMIN, kind: "admin" } });
    expect(notices).toEqual([expect.objectContaining({ kind: "cancelled", actorKind: "admin" })]);
    expect(h.revalidated).toEqual(["/admin/calls"]);
  });

  it("cancel: not hers or gone → not_yours / not_found as codes", async () => {
    fake.state.results.cancelBooking = { ok: false, error: "not_yours" };
    expect(await cancelCallForFamily({ parentUserId: JANE, bookingId: BOOKING })).toEqual({ ok: false, error: "not_yours" });
  });

  it("reload: her picker's days again", async () => {
    const days = await reloadFamilySlots({ parentUserId: JANE });
    expect(days.ok).toBe(true);
    expect(days.ok && days.value[0].londonDate).toBe("2027-02-04");
  });

  it("reload: the grid can't be read → error", async () => {
    fake.state.failing = ["readWeeklyHours"];
    expect(await reloadFamilySlots({ parentUserId: JANE })).toEqual({ ok: false, error: "error" });
  });
});
