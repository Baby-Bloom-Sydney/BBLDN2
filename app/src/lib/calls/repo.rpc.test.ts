/**
 * repo.ts — the six writer functions and Start call booking (plan A6; amendment 19). Every jsonb `status` maps to
 * the closed `CallError` union; anything else (a PostgREST error, a non-object, an unknown status) is `error`,
 * logged server-side and never thrown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin } from "@/lib/payments/fake-admin.test-util";
import { createCallsRepo } from "./repo";

const PARENT = "b0400000-0000-4000-8000-000000000001";
const ADMIN = "a0400000-0000-4000-8000-000000000001";
const HOLD = "c0400000-0000-4000-8000-000000000001";
const BOOKING = "c0400000-0000-4000-8000-000000000002";
const PARENT_ACTOR = { userId: PARENT, kind: "parent" } as const;
const ADMIN_ACTOR = { userId: ADMIN, kind: "admin" } as const;
const STARTS = "2027-02-09T14:00:00.000Z";
const ENDS = "2027-02-09T14:30:00.000Z";

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function repoReturning(fn: string, data: unknown, error: { message: string; code?: string } | null = null) {
  const f = fakeAdmin();
  f.rpcResults[fn] = { data, error };
  return { f, repo: createCallsRepo({ client: f.client }) };
}

const hold = (repo: ReturnType<typeof createCallsRepo>) =>
  repo.holdSlot({ parentUserId: PARENT, startsAt: STARTS, endsAt: ENDS, purpose: "first_call", positionId: null, actor: PARENT_ACTOR });

describe("holdSlot → call_hold_slot", () => {
  it("passes the named arguments", async () => {
    const { f, repo } = repoReturning("call_hold_slot", { status: "held", booking_id: HOLD, hold_expires_at: "2027-02-04T10:05:00.5+00:00" });
    await hold(repo);
    expect(f.rpcCalls).toEqual([
      {
        fn: "call_hold_slot",
        args: {
          p_parent: PARENT,
          p_starts: STARTS,
          p_ends: ENDS,
          p_purpose: "first_call",
          p_position: null,
          p_actor: PARENT,
          p_actor_kind: "parent",
        },
      },
    ]);
  });

  it("held → the hold id and its expiry as …Z", async () => {
    const { repo } = repoReturning("call_hold_slot", { status: "held", booking_id: HOLD, hold_expires_at: "2027-02-04T10:05:00.5+00:00" });
    expect(await hold(repo)).toEqual({ ok: true, value: { bookingId: HOLD, holdExpiresAt: "2027-02-04T10:05:00.500Z" } });
  });

  it.each(["taken", "too_soon", "rate_limited", "invalid"] as const)("%s → the refusal, not logged as a failure", async (status) => {
    const { repo } = repoReturning("call_hold_slot", { status });
    expect(await hold(repo)).toEqual({ ok: false, error: status });
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("held without an id → error", async () => {
    const { repo } = repoReturning("call_hold_slot", { status: "held" });
    expect(await hold(repo)).toEqual({ ok: false, error: "error" });
  });
});

describe("confirmHold → call_confirm_hold", () => {
  const confirm = (repo: ReturnType<typeof createCallsRepo>) =>
    repo.confirmHold({ parentUserId: PARENT, holdId: HOLD, idempotencyKey: "key-1", actor: PARENT_ACTOR });

  it("passes the named arguments", async () => {
    const { f, repo } = repoReturning("call_confirm_hold", { status: "booked", booking_id: HOLD, starts_at: STARTS });
    await confirm(repo);
    expect(f.rpcCalls[0]).toEqual({
      fn: "call_confirm_hold",
      args: { p_parent: PARENT, p_hold_id: HOLD, p_idempotency_key: "key-1", p_actor: PARENT, p_actor_kind: "parent" },
    });
  });

  it("booked → a new booking", async () => {
    const { repo } = repoReturning("call_confirm_hold", { status: "booked", booking_id: HOLD, starts_at: "2027-02-09T14:00:00+00:00" });
    expect(await confirm(repo)).toEqual({ ok: true, value: { kind: "booked", bookingId: HOLD, startsAt: STARTS, replay: false } });
  });

  it("booked + replay → the first result, marked a replay", async () => {
    const { repo } = repoReturning("call_confirm_hold", { status: "booked", booking_id: HOLD, starts_at: STARTS, replay: true });
    expect(await confirm(repo)).toEqual({ ok: true, value: { kind: "booked", bookingId: HOLD, startsAt: STARTS, replay: true } });
  });

  it("moved → the same booking row, with the old time", async () => {
    const { repo } = repoReturning("call_confirm_hold", {
      status: "moved",
      booking_id: BOOKING,
      starts_at: STARTS,
      from: "2027-02-08T10:00:00+00:00",
    });
    expect(await confirm(repo)).toEqual({
      ok: true,
      value: { kind: "moved", bookingId: BOOKING, startsAt: STARTS, fromStartsAt: "2027-02-08T10:00:00.000Z" },
    });
  });

  it.each(["not_yours", "not_found", "hold_expired", "rate_limited", "invalid"] as const)("%s → the refusal", async (status) => {
    const { repo } = repoReturning("call_confirm_hold", { status });
    expect(await confirm(repo)).toEqual({ ok: false, error: status });
  });

  it("an ok status from another function (cancelled) → error", async () => {
    const { repo } = repoReturning("call_confirm_hold", { status: "cancelled", booking_id: HOLD, starts_at: STARTS });
    expect(await confirm(repo)).toEqual({ ok: false, error: "error" });
    expect(errorLog).toHaveBeenCalled();
  });
});

describe("bookSlot → call_book_slot", () => {
  const book = (repo: ReturnType<typeof createCallsRepo>) =>
    repo.bookSlot({
      parentUserId: PARENT,
      startsAt: STARTS,
      endsAt: ENDS,
      purpose: "cohort_prebook",
      positionId: "pos-1",
      idempotencyKey: "key-2",
      actor: ADMIN_ACTOR,
    });

  it("passes the named arguments", async () => {
    const { f, repo } = repoReturning("call_book_slot", { status: "booked", booking_id: BOOKING, starts_at: STARTS });
    await book(repo);
    expect(f.rpcCalls[0]).toEqual({
      fn: "call_book_slot",
      args: {
        p_parent: PARENT,
        p_starts: STARTS,
        p_ends: ENDS,
        p_purpose: "cohort_prebook",
        p_position: "pos-1",
        p_idempotency_key: "key-2",
        p_actor: ADMIN,
        p_actor_kind: "admin",
      },
    });
  });

  it.each(["taken", "too_soon", "not_yours", "rate_limited", "invalid"] as const)("%s → the refusal", async (status) => {
    const { repo } = repoReturning("call_book_slot", { status });
    expect(await book(repo)).toEqual({ ok: false, error: status });
  });

  it("booked → the booking", async () => {
    const { repo } = repoReturning("call_book_slot", { status: "booked", booking_id: BOOKING, starts_at: STARTS });
    expect(await book(repo)).toEqual({ ok: true, value: { kind: "booked", bookingId: BOOKING, startsAt: STARTS, replay: false } });
  });
});

describe("cancelBooking → call_cancel_booking", () => {
  it("passes the named arguments and maps cancelled", async () => {
    const { f, repo } = repoReturning("call_cancel_booking", { status: "cancelled", booking_id: BOOKING, starts_at: STARTS });
    const done = await repo.cancelBooking({ parentUserId: PARENT, bookingId: BOOKING, actor: ADMIN_ACTOR });
    expect(done).toEqual({ ok: true, value: { bookingId: BOOKING, startsAt: STARTS } });
    expect(f.rpcCalls[0].args).toEqual({ p_parent: PARENT, p_booking_id: BOOKING, p_actor: ADMIN, p_actor_kind: "admin" });
  });

  it.each(["not_found", "not_yours", "invalid", "rate_limited"] as const)("%s → the refusal", async (status) => {
    const { repo } = repoReturning("call_cancel_booking", { status });
    expect(await repo.cancelBooking({ parentUserId: PARENT, bookingId: BOOKING, actor: PARENT_ACTOR })).toEqual({ ok: false, error: status });
  });
});

describe("recordOutcome → call_record_outcome", () => {
  const record = (repo: ReturnType<typeof createCallsRepo>, justcallCallId: string | null = null) =>
    repo.recordOutcome({
      parentUserId: PARENT,
      bookingId: BOOKING,
      result: "answered",
      outcome: "call_back_later",
      note: "after school run",
      callBackAt: "2027-02-10T16:00:00.000Z",
      method: "phone",
      source: "manual",
      actor: { userId: ADMIN },
      justcallCallId,
    });

  it("passes the named arguments, including the JustCall id (R22)", async () => {
    const { f, repo } = repoReturning("call_record_outcome", { status: "recorded", entry_id: "e1" });
    await record(repo, "jc-123");
    expect(f.rpcCalls[0].args).toEqual({
      p_parent: PARENT,
      p_booking_id: BOOKING,
      p_result: "answered",
      p_outcome: "call_back_later",
      p_note: "after school run",
      p_call_back_at: "2027-02-10T16:00:00.000Z",
      p_method: "phone",
      p_source: "manual",
      p_actor: ADMIN,
      p_justcall_call_id: "jc-123",
    });
  });

  it("recorded → the entry; replay → marked", async () => {
    expect(await record(repoReturning("call_record_outcome", { status: "recorded", entry_id: "e1" }).repo)).toEqual({
      ok: true,
      value: { entryId: "e1", replay: false },
    });
    expect(await record(repoReturning("call_record_outcome", { status: "recorded", entry_id: "e1", replay: true }).repo)).toEqual({
      ok: true,
      value: { entryId: "e1", replay: true },
    });
  });

  it.each(["booked_call_exists", "not_found", "not_yours", "invalid"] as const)("%s → the refusal", async (status) => {
    expect(await record(repoReturning("call_record_outcome", { status }).repo)).toEqual({ ok: false, error: status });
  });
});

describe("replaceWeeklyHours → call_replace_weekly_hours", () => {
  it("sends the week as snake_case jsonb and maps replaced", async () => {
    const { f, repo } = repoReturning("call_replace_weekly_hours", { status: "replaced" });
    const done = await repo.replaceWeeklyHours([{ weekday: 6, startMinute: 600, endMinute: 840 }], ADMIN_ACTOR);
    expect(done).toEqual({ ok: true, value: true });
    expect(f.rpcCalls[0].args).toEqual({ p_hours: [{ weekday: 6, start_minute: 600, end_minute: 840 }], p_actor: ADMIN });
  });

  it.each(["overlap", "invalid"] as const)("%s → the refusal", async (status) => {
    const { repo } = repoReturning("call_replace_weekly_hours", { status });
    expect(await repo.replaceWeeklyHours([], ADMIN_ACTOR)).toEqual({ ok: false, error: status });
  });
});

describe("anything unexpected from a writer → error, logged, never thrown", () => {
  it.each([
    ["a PostgREST error", null, { message: "permission denied for function call_hold_slot", code: "42501" }],
    ["null data", null, null],
    ["a string", "held", null],
    ["an unknown status", { status: "maybe" }, null],
    ["no status", { booking_id: HOLD }, null],
  ])("%s", async (_label, data, error) => {
    const { repo } = repoReturning("call_hold_slot", data, error);
    expect(await hold(repo)).toEqual({ ok: false, error: "error" });
    expect(errorLog).toHaveBeenCalled();
  });

  it("a client whose rpc throws", async () => {
    const f = fakeAdmin();
    (f.client as unknown as { rpc: () => never }).rpc = () => {
      throw new Error("socket hang up");
    };
    expect(await hold(createCallsRepo({ client: f.client }))).toEqual({ ok: false, error: "error" });
  });
});

describe("startCallBooking (plan §12 R11) — sets enabled_since once, never on a read", () => {
  const ROW = {
    slot_minutes: 30,
    window_days: 7,
    notice_minutes: 120,
    hold_minutes: 5,
    parent_reminder_minutes: 1440,
    admin_reminder_minutes: 15,
    overdue_grace_minutes: 15,
    not_booked_delay_minutes: 30,
    caller_number: null,
  };
  const NOW = new Date("2027-02-01T09:00:00.000Z");

  it("not started → stamps it WHERE enabled_since IS NULL, logs it, and returns the stored time", async () => {
    const f = fakeAdmin();
    Object.defineProperty(f.reads, "call_settings", {
      get: () => ({ ...ROW, enabled_since: f.ops.some((o) => o.kind === "update") ? "2027-02-01T09:00:00+00:00" : null }),
    });
    const started = await createCallsRepo({ client: f.client, now: () => NOW }).startCallBooking(ADMIN_ACTOR);
    expect(started).toEqual({ ok: true, value: { enabledSince: "2027-02-01T09:00:00.000Z", startedNow: true } });
    const update = f.ops.find((o) => o.kind === "update");
    expect(update).toMatchObject({
      table: "call_settings",
      payload: { enabled_since: "2027-02-01T09:00:00.000Z", updated_by: ADMIN },
      filters: [
        ["eq", "id", 1],
        ["is", "enabled_since", null],
      ],
    });
    expect(f.ops.find((o) => o.table === "activity_logs")?.payload).toEqual({
      user_id: ADMIN,
      action_type: "call.settings_updated",
      action_details: { enabled_since: "2027-02-01T09:00:00.000Z", started_call_booking: true },
    });
  });

  it("already started → no write, the first time kept", async () => {
    const f = fakeAdmin({ call_settings: { ...ROW, enabled_since: "2027-01-20T08:00:00+00:00" } });
    const started = await createCallsRepo({ client: f.client, now: () => NOW }).startCallBooking(ADMIN_ACTOR);
    expect(started).toEqual({ ok: true, value: { enabledSince: "2027-01-20T08:00:00.000Z", startedNow: false } });
    expect(f.ops.filter((o) => o.kind !== "select")).toEqual([]);
  });

  it("someone else started it a moment earlier → their time, no log row", async () => {
    const f = fakeAdmin();
    Object.defineProperty(f.reads, "call_settings", {
      get: () => ({ ...ROW, enabled_since: f.ops.some((o) => o.kind === "update") ? "2027-02-01T08:59:59+00:00" : null }),
    });
    const started = await createCallsRepo({ client: f.client, now: () => NOW }).startCallBooking(ADMIN_ACTOR);
    expect(started).toEqual({ ok: true, value: { enabledSince: "2027-02-01T08:59:59.000Z", startedNow: false } });
    expect(f.ops.some((o) => o.table === "activity_logs")).toBe(false);
  });

  it("the update fails → error", async () => {
    const f = fakeAdmin({ call_settings: { ...ROW, enabled_since: null } });
    f.writeErrors.call_settings = { message: "deadlock detected" };
    expect(await createCallsRepo({ client: f.client, now: () => NOW }).startCallBooking(ADMIN_ACTOR)).toEqual({ ok: false, error: "error" });
  });

  it("the stamp didn't stick → error", async () => {
    const f = fakeAdmin({ call_settings: { ...ROW, enabled_since: null } });
    expect(await createCallsRepo({ client: f.client, now: () => NOW }).startCallBooking(ADMIN_ACTOR)).toEqual({ ok: false, error: "error" });
  });
});
