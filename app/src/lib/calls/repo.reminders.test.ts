/**
 * repo.ts — the reminder claims (plan B2; §12 R3). Still the only module that touches the call tables. A reminder is
 * claimed by stamping it first (`… IS NULL`, still booked, same start — a move clears the stamp and changes the
 * start), and released after a failed send only if the stamp is still this run's. The "pick a time" email is claimed
 * by inserting its `call_nudges` row (`ON CONFLICT DO NOTHING RETURNING`), and released by deleting this run's row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, writesTo } from "@/lib/payments/fake-admin.test-util";
import { createReminderRepo } from "./repo";

const PARENT = "b0400000-0000-4000-8000-000000000001";
const BOOKING = "c0400000-0000-4000-8000-000000000001";
const STAMP = "2027-02-08T14:01:00.000Z";
const BOOKING_ROW = {
  id: BOOKING,
  parent_user_id: PARENT,
  position_id: null,
  starts_at: "2027-02-09T14:00:00+00:00",
  ends_at: "2027-02-09T14:30:00+00:00",
  status: "booked",
  purpose: "first_call",
  booked_by_kind: "parent",
  hold_expires_at: null,
  booked_at: "2027-02-04T10:01:00+00:00",
  moved_at: null,
  moved_from_starts_at: null,
  cancelled_at: null,
  cancel_reason: null,
  closed_at: null,
  created_at: "2027-02-04T10:00:00+00:00",
};

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("readUnremindedCalls", () => {
  it.each([
    ["parent", "parent_reminder_sent_at"],
    ["admin", "admin_reminder_sent_at"],
  ] as const)("%s: booked calls starting in (after, until] with no %s stamp", async (kind, column) => {
    const f = fakeAdmin({ call_bookings: [BOOKING_ROW] });
    const read = await createReminderRepo({ client: f.client }).readUnremindedCalls(kind, {
      after: "2027-02-08T14:00:00.000Z",
      until: "2027-02-09T14:00:00.000Z",
    });
    expect(read).toEqual({ ok: true, value: [expect.objectContaining({ id: BOOKING, startsAt: "2027-02-09T14:00:00.000Z" })] });
    expect(f.ops[0].table).toBe("call_bookings");
    expect(f.ops[0].filters).toEqual(
      expect.arrayContaining([
        ["eq", "status", "booked"],
        ["gt", "starts_at", "2027-02-08T14:00:00.000Z"],
        ["lte", "starts_at", "2027-02-09T14:00:00.000Z"],
        ["is", column, null],
        ["range", 0, 499],
      ]),
    );
  });

  it("a read error → error, logged", async () => {
    const f = fakeAdmin({});
    f.readErrors.call_bookings = { message: "boom", code: "XX000" };
    const read = await createReminderRepo({ client: f.client }).readUnremindedCalls("parent", { after: STAMP, until: STAMP });
    expect(read).toEqual({ ok: false, error: "error" });
    expect(errorLog).toHaveBeenCalled();
  });
});

describe("claimReminder / releaseReminder", () => {
  it("claims by stamping first: still booked, same start, not yet stamped; claimed when a row comes back", async () => {
    const f = fakeAdmin({});
    f.writeResults.call_bookings = [{ id: BOOKING }];
    const repo = createReminderRepo({ client: f.client });
    expect(await repo.claimReminder("parent", { id: BOOKING, startsAt: "2027-02-09T14:00:00.000Z" }, STAMP)).toEqual({ ok: true, value: true });
    const [claim] = writesTo(f, "call_bookings");
    expect(claim).toMatchObject({ kind: "update", payload: { parent_reminder_sent_at: STAMP } });
    expect(claim.filters).toEqual([
      ["eq", "id", BOOKING],
      ["eq", "status", "booked"],
      ["eq", "starts_at", "2027-02-09T14:00:00.000Z"],
      ["is", "parent_reminder_sent_at", null],
    ]);
  });

  it("no row back (already stamped, moved or no longer booked) → not claimed", async () => {
    const f = fakeAdmin({});
    f.writeResults.call_bookings = [];
    const repo = createReminderRepo({ client: f.client });
    expect(await repo.claimReminder("admin", { id: BOOKING, startsAt: "2027-02-09T14:00:00.000Z" }, STAMP)).toEqual({ ok: true, value: false });
    expect(writesTo(f, "call_bookings")[0].payload).toEqual({ admin_reminder_sent_at: STAMP });
  });

  it("a write error → error", async () => {
    const f = fakeAdmin({});
    f.writeErrors.call_bookings = { message: "boom" };
    expect(await createReminderRepo({ client: f.client }).claimReminder("parent", { id: BOOKING, startsAt: STAMP }, STAMP)).toEqual({
      ok: false,
      error: "error",
    });
  });

  it("release clears only this run's stamp", async () => {
    const f = fakeAdmin({});
    expect(await createReminderRepo({ client: f.client }).releaseReminder("admin", BOOKING, STAMP)).toEqual({ ok: true, value: true });
    const [release] = writesTo(f, "call_bookings");
    expect(release).toMatchObject({ kind: "update", payload: { admin_reminder_sent_at: null } });
    expect(release.filters).toEqual([
      ["eq", "id", BOOKING],
      ["eq", "admin_reminder_sent_at", STAMP],
    ]);
  });

  it("a failed release → error, logged", async () => {
    const f = fakeAdmin({});
    f.writeErrors.call_bookings = { message: "boom" };
    expect(await createReminderRepo({ client: f.client }).releaseReminder("parent", BOOKING, STAMP)).toEqual({ ok: false, error: "error" });
    expect(errorLog).toHaveBeenCalled();
  });
});

describe("the call_nudges claim (R3)", () => {
  it("readNudgedParents: the ids that already have a claim", async () => {
    const f = fakeAdmin({ call_nudges: [{ parent_user_id: PARENT }] });
    const read = await createReminderRepo({ client: f.client }).readNudgedParents([PARENT, "other"]);
    expect(read.ok && [...read.value]).toEqual([PARENT]);
    expect(f.ops[0].filters).toContainEqual(["in", "parent_user_id", [PARENT, "other"]]);
  });

  it("readNudgedParents of nobody reads nothing", async () => {
    const f = fakeAdmin({});
    const read = await createReminderRepo({ client: f.client }).readNudgedParents([]);
    expect(read.ok && read.value.size).toBe(0);
    expect(f.ops).toEqual([]);
  });

  it("claimNudge inserts ON CONFLICT DO NOTHING and returns the row: claimed only when it comes back", async () => {
    const f = fakeAdmin({});
    f.writeResults.call_nudges = [{ parent_user_id: PARENT }];
    const repo = createReminderRepo({ client: f.client });
    expect(await repo.claimNudge(PARENT, STAMP)).toEqual({ ok: true, value: true });
    expect(writesTo(f, "call_nudges")[0]).toMatchObject({
      kind: "upsert",
      payload: { parent_user_id: PARENT, not_booked_sent_at: STAMP },
      options: { onConflict: "parent_user_id", ignoreDuplicates: true },
    });
    f.writeResults.call_nudges = [];
    expect(await repo.claimNudge(PARENT, STAMP)).toEqual({ ok: true, value: false });
  });

  it("releaseNudge deletes only this run's claim", async () => {
    const f = fakeAdmin({});
    expect(await createReminderRepo({ client: f.client }).releaseNudge(PARENT, STAMP)).toEqual({ ok: true, value: true });
    const [release] = writesTo(f, "call_nudges");
    expect(release.kind).toBe("delete");
    expect(release.filters).toEqual([
      ["eq", "parent_user_id", PARENT],
      ["eq", "not_booked_sent_at", STAMP],
    ]);
  });

  it("errors → error", async () => {
    const f = fakeAdmin({});
    f.writeErrors.call_nudges = { message: "boom" };
    f.readErrors.call_nudges = { message: "boom" };
    const repo = createReminderRepo({ client: f.client });
    expect(await repo.claimNudge(PARENT, STAMP)).toEqual({ ok: false, error: "error" });
    expect(await repo.releaseNudge(PARENT, STAMP)).toEqual({ ok: false, error: "error" });
    expect(await repo.readNudgedParents([PARENT])).toEqual({ ok: false, error: "error" });
  });
});
