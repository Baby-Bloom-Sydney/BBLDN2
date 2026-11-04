/**
 * repo.ts — the reads (plan A6; brief §5). The only module that touches the call_* tables. Every read maps rows
 * to domain types, normalises timestamps to "…Z", and returns `error` (logged server-side) instead of throwing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeAdmin } from "@/lib/payments/fake-admin.test-util";
import { createCallsRepo } from "./repo";

const PARENT = "b0400000-0000-4000-8000-000000000001";
const OTHER = "b0400000-0000-4000-8000-000000000002";
const SPAN = { startsAt: "2027-02-04T12:00:00.000Z", endsAt: "2027-02-11T10:30:00.000Z" };

const SETTINGS_ROW = {
  slot_minutes: 30,
  window_days: 7,
  notice_minutes: 120,
  hold_minutes: 5,
  parent_reminder_minutes: 1440,
  admin_reminder_minutes: 15,
  overdue_grace_minutes: 15,
  not_booked_delay_minutes: 30,
  caller_number: null,
  enabled_since: null,
};

const BOOKING_ROW = {
  id: "c0400000-0000-4000-8000-000000000001",
  parent_user_id: PARENT,
  position_id: null,
  starts_at: "2027-02-09T14:00:00+00:00",
  ends_at: "2027-02-09T14:30:00+00:00",
  status: "booked",
  purpose: "first_call",
  booked_by_kind: "parent",
  hold_expires_at: null,
  booked_at: "2027-02-04T10:01:00.123456+00:00",
  moved_at: null,
  moved_from_starts_at: null,
  cancelled_at: null,
  cancel_reason: null,
  closed_at: null,
  created_at: "2027-02-04T10:00:00+00:00",
};

const ENTRY_ROW = {
  id: "e0400000-0000-4000-8000-000000000001",
  parent_user_id: PARENT,
  booking_id: BOOKING_ROW.id,
  occurred_at: "2027-02-09T14:05:00+00:00",
  recorded_by: OTHER,
  method: "phone",
  source: "manual",
  result: "no_answer",
  outcome: null,
  note: null,
  call_back_at: null,
  justcall_call_id: null,
};

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("readSettings", () => {
  it("reads the one row (id = 1) and maps it", async () => {
    const f = fakeAdmin({ call_settings: SETTINGS_ROW });
    const read = await createCallsRepo({ client: f.client }).readSettings();
    expect(read).toEqual({ ok: true, value: expect.objectContaining({ slotMinutes: 30, enabledSince: null }) });
    expect(f.ops[0]).toMatchObject({ table: "call_settings", kind: "select", filters: [["eq", "id", 1]] });
  });

  it("never writes on read — enabled_since is only stamped by Start call booking (R11)", async () => {
    const f = fakeAdmin({ call_settings: SETTINGS_ROW });
    await createCallsRepo({ client: f.client }).readSettings();
    expect(f.ops.filter((o) => o.kind !== "select")).toEqual([]);
  });

  it("missing or malformed row → error, logged", async () => {
    const missing = await createCallsRepo({ client: fakeAdmin({}).client }).readSettings();
    const bad = await createCallsRepo({ client: fakeAdmin({ call_settings: { ...SETTINGS_ROW, slot_minutes: 1 } }).client }).readSettings();
    expect(missing).toEqual({ ok: false, error: "error" });
    expect(bad).toEqual({ ok: false, error: "error" });
    expect(errorLog).toHaveBeenCalled();
  });
});

describe("a database that fails", () => {
  const failing = (message: string): SupabaseClient => {
    const builder: Record<string, unknown> = {};
    for (const f of ["select", "eq", "in", "or", "gte", "lt", "gt", "order", "limit", "range"]) builder[f] = () => builder;
    builder.maybeSingle = async () => ({ data: null, error: { message, code: "57014" } });
    builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message, code: "57014" } }).then(resolve);
    return { from: () => builder } as unknown as SupabaseClient;
  };

  it("a PostgREST error → error, logged with its code", async () => {
    const repo = createCallsRepo({ client: failing("statement timeout") });
    expect(await repo.readSettings()).toEqual({ ok: false, error: "error" });
    expect(await repo.readWeeklyHours()).toEqual({ ok: false, error: "error" });
    expect(await repo.readBookedCalls()).toEqual({ ok: false, error: "error" });
    expect(errorLog.mock.calls[0][1]).toMatchObject({ code: "57014" });
  });

  it("a client that throws → error, never thrown to the caller", async () => {
    const repo = createCallsRepo({
      client: {
        from: () => {
          throw new Error("boom");
        },
      } as unknown as SupabaseClient,
    });
    await expect(repo.readBlocks(SPAN)).resolves.toEqual({ ok: false, error: "error" });
  });

  it("missing credentials (no client given, no env) → error, never thrown", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    try {
      await expect(createCallsRepo().readSettings()).resolves.toEqual({ ok: false, error: "error" });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("readWeeklyHours", () => {
  it("maps and sorts the rows", async () => {
    const f = fakeAdmin({
      call_weekly_hours: [
        { weekday: 6, start_minute: 600, end_minute: 840 },
        { weekday: 1, start_minute: 540, end_minute: 1140 },
      ],
    });
    expect(await createCallsRepo({ client: f.client }).readWeeklyHours()).toEqual({
      ok: true,
      value: [
        { weekday: 1, startMinute: 540, endMinute: 1140 },
        { weekday: 6, startMinute: 600, endMinute: 840 },
      ],
    });
  });

  it("no rows → [] (no hours, no slots)", async () => {
    expect(await createCallsRepo({ client: fakeAdmin({ call_weekly_hours: [] }).client }).readWeeklyHours()).toEqual({ ok: true, value: [] });
  });
});

describe("readBlocks", () => {
  it("reads the blocks overlapping a span", async () => {
    const f = fakeAdmin({
      call_blocks: [{ id: "b1", starts_at: "2027-02-12T09:00:00+00:00", ends_at: "2027-02-12T13:00:00+00:00", reason: "dentist" }],
    });
    const read = await createCallsRepo({ client: f.client }).readBlocks(SPAN);
    expect(read).toEqual({
      ok: true,
      value: [{ id: "b1", startsAt: "2027-02-12T09:00:00.000Z", endsAt: "2027-02-12T13:00:00.000Z", reason: "dentist" }],
    });
    expect(f.ops[0].filters).toEqual(
      expect.arrayContaining([
        ["lt", "starts_at", SPAN.endsAt],
        ["gt", "ends_at", SPAN.startsAt],
      ]),
    );
  });
});

describe("the booking reads", () => {
  it("readOccupyingBookings: held or booked rows overlapping the span, timestamps as …Z", async () => {
    const f = fakeAdmin({ call_bookings: [BOOKING_ROW] });
    const read = await createCallsRepo({ client: f.client }).readOccupyingBookings(SPAN);
    expect(read.ok && read.value[0]).toMatchObject({
      id: BOOKING_ROW.id,
      parentUserId: PARENT,
      startsAt: "2027-02-09T14:00:00.000Z",
      endsAt: "2027-02-09T14:30:00.000Z",
      bookedAt: "2027-02-04T10:01:00.123Z",
      status: "booked",
      purpose: "first_call",
    });
    expect(f.ops[0].filters).toEqual(
      expect.arrayContaining([
        ["in", "status", ["held", "booked"]],
        ["lt", "starts_at", SPAN.endsAt],
        ["gt", "ends_at", SPAN.startsAt],
      ]),
    );
  });

  it("readBookingsStartingIn: statuses, start in [from, to), optional purpose", async () => {
    const f = fakeAdmin({ call_bookings: [BOOKING_ROW] });
    const repo = createCallsRepo({ client: f.client });
    await repo.readBookingsStartingIn(SPAN, { statuses: ["booked", "done"], purpose: "cohort_prebook" });
    expect(f.ops[0].filters).toEqual(
      expect.arrayContaining([
        ["in", "status", ["booked", "done"]],
        ["gte", "starts_at", SPAN.startsAt],
        ["lt", "starts_at", SPAN.endsAt],
        ["eq", "purpose", "cohort_prebook"],
      ]),
    );
    await repo.readBookingsStartingIn(SPAN, { statuses: ["booked"] });
    expect(f.ops[1].filters.some(([, col]) => col === "purpose")).toBe(false);
  });

  it("readBookedCalls: every booked row, by start", async () => {
    const f = fakeAdmin({ call_bookings: [BOOKING_ROW] });
    await createCallsRepo({ client: f.client }).readBookedCalls();
    expect(f.ops[0].filters).toEqual(expect.arrayContaining([["eq", "status", "booked"]]));
  });

  it("readBookingsForParents: by parent ids; no ids → [] with no query", async () => {
    const f = fakeAdmin({ call_bookings: [BOOKING_ROW] });
    const repo = createCallsRepo({ client: f.client });
    expect(await repo.readBookingsForParents([])).toEqual({ ok: true, value: [] });
    expect(f.ops).toHaveLength(0);
    await repo.readBookingsForParents([PARENT, OTHER]);
    expect(f.ops[0].filters).toEqual(expect.arrayContaining([["in", "parent_user_id", [PARENT, OTHER]]]));
  });

  it("a malformed booking row → error", async () => {
    const f = fakeAdmin({ call_bookings: [{ ...BOOKING_ROW, status: "rescheduled" }] });
    expect(await createCallsRepo({ client: f.client }).readBookedCalls()).toEqual({ ok: false, error: "error" });
  });
});

describe("the log reads", () => {
  it("readLogEntriesForParents maps entries; no ids → no query", async () => {
    const f = fakeAdmin({ call_log_entries: [ENTRY_ROW] });
    const repo = createCallsRepo({ client: f.client });
    expect(await repo.readLogEntriesForParents([])).toEqual({ ok: true, value: [] });
    const read = await repo.readLogEntriesForParents([PARENT]);
    expect(read).toEqual({
      ok: true,
      value: [
        {
          id: ENTRY_ROW.id,
          parentUserId: PARENT,
          bookingId: BOOKING_ROW.id,
          occurredAt: "2027-02-09T14:05:00.000Z",
          recordedBy: OTHER,
          method: "phone",
          source: "manual",
          result: "no_answer",
          outcome: null,
          note: null,
          callBackAt: null,
          justcallCallId: null,
        },
      ],
    });
    expect(f.ops[0].filters).toEqual(expect.arrayContaining([["in", "parent_user_id", [PARENT]]]));
  });

  it("readRecentLogEntries: newest first, limited", async () => {
    const f = fakeAdmin({ call_log_entries: [ENTRY_ROW] });
    await createCallsRepo({ client: f.client }).readRecentLogEntries(50);
    expect(f.ops[0].filters).toEqual(
      expect.arrayContaining([
        ["order", "occurred_at", { ascending: false }],
        ["limit", 50, undefined],
      ]),
    );
  });
});

describe("the to-call scope (brief §3 'who appears'; plan D7)", () => {
  it("reads parents not from an invite — NULL source included — created at or after enabled_since", async () => {
    const f = fakeAdmin({
      parents: [
        { user_id: PARENT, signup_source: null, created_at: "2027-02-04T10:00:00+00:00" },
        { user_id: OTHER, signup_source: "standard_match", created_at: "2027-02-04T11:00:00+00:00" },
      ],
    });
    const read = await createCallsRepo({ client: f.client }).readScopeParents("2027-02-01T09:00:00.000Z");
    expect(read).toEqual({
      ok: true,
      value: [
        { userId: PARENT, signupSource: null, signedUpAt: "2027-02-04T10:00:00.000Z" },
        { userId: OTHER, signupSource: "standard_match", signedUpAt: "2027-02-04T11:00:00.000Z" },
      ],
    });
    expect(f.ops[0].table).toBe("parents");
    expect(f.ops[0].filters).toEqual(
      expect.arrayContaining([
        ["or", "signup_source.is.null,signup_source.not.in.(nanny_invite,parent_invite)", undefined],
        ["gte", "created_at", "2027-02-01T09:00:00.000Z"],
      ]),
    );
  });

  it("readContacts: user_profiles incl. is_test_user; no ids → no query", async () => {
    const f = fakeAdmin({
      user_profiles: [
        { user_id: PARENT, first_name: "Jane", last_name: "Smith", email: "jane@example.com", mobile_number: "+447700900123", is_test_user: true },
      ],
    });
    const repo = createCallsRepo({ client: f.client });
    expect(await repo.readContacts([])).toEqual({ ok: true, value: [] });
    expect(await repo.readContacts([PARENT])).toEqual({
      ok: true,
      value: [{ userId: PARENT, firstName: "Jane", lastName: "Smith", email: "jane@example.com", mobile: "+447700900123", isTestUser: true }],
    });
    expect(f.ops[0].table).toBe("user_profiles");
    expect(f.ops[0].filters).toEqual(expect.arrayContaining([["in", "user_id", [PARENT]]]));
  });

  it("readLatestPositionId: the parent's newest position, or null", async () => {
    const f = fakeAdmin({ parents: { id: "p-row" }, nanny_positions: { id: "pos-1" } });
    expect(await createCallsRepo({ client: f.client }).readLatestPositionId(PARENT)).toEqual({ ok: true, value: "pos-1" });
    expect(f.ops[0]).toMatchObject({ table: "parents", filters: [["eq", "user_id", PARENT]] });
    expect(f.ops[1].filters).toEqual(
      expect.arrayContaining([
        ["eq", "parent_id", "p-row"],
        ["order", "created_at", { ascending: false }],
      ]),
    );
    const none = fakeAdmin({ parents: null });
    expect(await createCallsRepo({ client: none.client }).readLatestPositionId(PARENT)).toEqual({ ok: true, value: null });
    expect(none.ops).toHaveLength(1);
  });
});
