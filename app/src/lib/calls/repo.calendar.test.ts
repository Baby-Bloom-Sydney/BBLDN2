/**
 * repo.ts — the Calendar tab's three plain service-role writers (plan C5, §13; brief §5 "every audit-worthy write goes
 * to activity_logs"): the settings update, a block added, a block removed. Each writes its `activity_logs` row after
 * the write (`call.settings_updated`, `call.block_added`, `call.block_removed`, already in amendment 19's CHECK; the
 * `actions/admin/dfy.ts` pattern: the write stands, a lost audit row is logged, never swallowed). Nothing is thrown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, writesTo } from "@/lib/payments/fake-admin.test-util";
import { createCallsRepo } from "./repo";

const ADMIN = "a0400000-0000-4000-8000-000000000001";
const BLOCK = "d0400000-0000-4000-8000-000000000001";
const ADMIN_ACTOR = { userId: ADMIN, kind: "admin" } as const;
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
  enabled_since: null,
};
const BLOCK_ROW = { id: BLOCK, starts_at: "2027-02-12T09:00:00+00:00", ends_at: "2027-02-12T13:00:00+00:00", reason: "dentist" };

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const audit = (f: ReturnType<typeof fakeAdmin>) => f.ops.filter((o) => o.table === "activity_logs").map((o) => o.payload);

describe("updateSettings — one update of the one row, then call.settings_updated", () => {
  it("writes the changed columns and who, answers the row as stored, and logs before → after", async () => {
    const f = fakeAdmin({ call_settings: ROW });
    f.writeResults.call_settings = { ...ROW, slot_minutes: 45, notice_minutes: 60, caller_number: "+442079460000" };
    const repo = createCallsRepo({ client: f.client });
    const saved = await repo.updateSettings({ slotMinutes: 45, noticeMinutes: 60, callerNumber: "+442079460000" }, ADMIN_ACTOR);
    expect(saved).toEqual({ ok: true, value: expect.objectContaining({ slotMinutes: 45, noticeMinutes: 60, callerNumber: "+442079460000" }) });
    expect(writesTo(f, "call_settings")).toEqual([
      expect.objectContaining({
        kind: "update",
        payload: { slot_minutes: 45, notice_minutes: 60, caller_number: "+442079460000", updated_by: ADMIN },
        filters: [["eq", "id", 1]],
      }),
    ]);
    expect(audit(f)).toEqual([
      {
        user_id: ADMIN,
        action_type: "call.settings_updated",
        action_details: {
          before: { slot_minutes: 30, notice_minutes: 120, caller_number: null },
          after: { slot_minutes: 45, notice_minutes: 60, caller_number: "+442079460000" },
        },
      },
    ]);
  });

  it("never writes enabled_since (only Start call booking does)", async () => {
    const f = fakeAdmin({ call_settings: ROW });
    f.writeResults.call_settings = ROW;
    await createCallsRepo({ client: f.client }).updateSettings({ holdMinutes: 5 }, ADMIN_ACTOR);
    expect(writesTo(f, "call_settings")[0].payload).not.toHaveProperty("enabled_since");
  });

  it("the read before fails → error, no write", async () => {
    const f = fakeAdmin();
    f.readErrors.call_settings = { message: "statement timeout" };
    expect(await createCallsRepo({ client: f.client }).updateSettings({ slotMinutes: 45 }, ADMIN_ACTOR)).toEqual({ ok: false, error: "error" });
    expect(writesTo(f, "call_settings")).toEqual([]);
    expect(audit(f)).toEqual([]);
  });

  it("the update fails → error, no audit row; logged with its code, never thrown", async () => {
    const f = fakeAdmin({ call_settings: ROW });
    f.writeErrors.call_settings = { message: "new row violates check constraint" };
    expect(await createCallsRepo({ client: f.client }).updateSettings({ slotMinutes: 45 }, ADMIN_ACTOR)).toEqual({ ok: false, error: "error" });
    expect(audit(f)).toEqual([]);
    expect(errorLog).toHaveBeenCalled();
  });

  it("no row came back (the row is missing) → error, no audit row", async () => {
    const f = fakeAdmin({ call_settings: ROW });
    expect(await createCallsRepo({ client: f.client }).updateSettings({ slotMinutes: 45 }, ADMIN_ACTOR)).toEqual({ ok: false, error: "error" });
    expect(audit(f)).toEqual([]);
  });

  it("the audit row fails → the change stands (ok), and the lost row is logged", async () => {
    const f = fakeAdmin({ call_settings: ROW });
    f.writeResults.call_settings = { ...ROW, slot_minutes: 45 };
    f.writeErrors.activity_logs = { message: "check constraint" };
    const saved = await createCallsRepo({ client: f.client }).updateSettings({ slotMinutes: 45 }, ADMIN_ACTOR);
    expect(saved.ok).toBe(true);
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("activity_logs"), expect.anything());
  });
});

describe("insertBlock — a new block, then call.block_added", () => {
  const NEW = { startsAt: "2027-02-12T09:00:00.000Z", endsAt: "2027-02-12T13:00:00.000Z", reason: "dentist" };

  it("inserts start, end, reason and who; answers the stored block; logs it", async () => {
    const f = fakeAdmin();
    f.writeResults.call_blocks = BLOCK_ROW;
    const added = await createCallsRepo({ client: f.client }).insertBlock(NEW, ADMIN_ACTOR);
    expect(added).toEqual({ ok: true, value: { id: BLOCK, startsAt: NEW.startsAt, endsAt: NEW.endsAt, reason: "dentist" } });
    expect(writesTo(f, "call_blocks")).toEqual([
      expect.objectContaining({ kind: "insert", payload: { starts_at: NEW.startsAt, ends_at: NEW.endsAt, reason: "dentist", created_by: ADMIN } }),
    ]);
    expect(audit(f)).toEqual([
      { user_id: ADMIN, action_type: "call.block_added", action_details: { block_id: BLOCK, starts_at: NEW.startsAt, ends_at: NEW.endsAt, reason: "dentist" } },
    ]);
  });

  it("the insert fails → error, no audit row", async () => {
    const f = fakeAdmin();
    f.writeErrors.call_blocks = { message: "violates check constraint call_blocks_times_check" };
    expect(await createCallsRepo({ client: f.client }).insertBlock(NEW, ADMIN_ACTOR)).toEqual({ ok: false, error: "error" });
    expect(audit(f)).toEqual([]);
  });

  it("a row that isn't a block → error, no audit row", async () => {
    const f = fakeAdmin();
    f.writeResults.call_blocks = { id: "not-a-block" };
    expect(await createCallsRepo({ client: f.client }).insertBlock(NEW, ADMIN_ACTOR)).toEqual({ ok: false, error: "error" });
    expect(audit(f)).toEqual([]);
  });

  it("the audit row fails → the block stands (ok), logged", async () => {
    const f = fakeAdmin();
    f.writeResults.call_blocks = BLOCK_ROW;
    f.writeErrors.activity_logs = { message: "down" };
    expect((await createCallsRepo({ client: f.client }).insertBlock(NEW, ADMIN_ACTOR)).ok).toBe(true);
    expect(errorLog).toHaveBeenCalled();
  });
});

describe("deleteBlock — remove one block by id, then call.block_removed", () => {
  it("deletes that id only, answers the removed block, logs what it was", async () => {
    const f = fakeAdmin();
    f.writeResults.call_blocks = [BLOCK_ROW];
    const removed = await createCallsRepo({ client: f.client }).deleteBlock(BLOCK, ADMIN_ACTOR);
    expect(removed).toEqual({ ok: true, value: { id: BLOCK, startsAt: "2027-02-12T09:00:00.000Z", endsAt: "2027-02-12T13:00:00.000Z", reason: "dentist" } });
    expect(writesTo(f, "call_blocks")).toEqual([expect.objectContaining({ kind: "delete", filters: [["eq", "id", BLOCK]] })]);
    expect(audit(f)).toEqual([
      {
        user_id: ADMIN,
        action_type: "call.block_removed",
        action_details: { block_id: BLOCK, starts_at: "2027-02-12T09:00:00.000Z", ends_at: "2027-02-12T13:00:00.000Z", reason: "dentist" },
      },
    ]);
  });

  it("no block with that id (already removed) → not_found, no audit row", async () => {
    const f = fakeAdmin();
    f.writeResults.call_blocks = [];
    expect(await createCallsRepo({ client: f.client }).deleteBlock(BLOCK, ADMIN_ACTOR)).toEqual({ ok: false, error: "not_found" });
    expect(audit(f)).toEqual([]);
  });

  it("the delete fails → error, no audit row", async () => {
    const f = fakeAdmin();
    f.writeErrors.call_blocks = { message: "deadlock detected" };
    expect(await createCallsRepo({ client: f.client }).deleteBlock(BLOCK, ADMIN_ACTOR)).toEqual({ ok: false, error: "error" });
    expect(audit(f)).toEqual([]);
  });
});

describe("review round 1 (04c-2, security LOW-1): a thrown audit insert never makes a landed write look failed", () => {
  function throwingAudit(f: ReturnType<typeof fakeAdmin>) {
    const from = f.client.from.bind(f.client);
    (f.client as unknown as { from: (t: string) => unknown }).from = (table: string) =>
      table === "activity_logs"
        ? {
            insert: () => {
              throw new Error("fetch failed");
            },
          }
        : from(table);
  }

  it("updateSettings, insertBlock, deleteBlock and Start call booking stay ok; the lost row is logged", async () => {
    const f = fakeAdmin({ call_settings: { ...ROW, enabled_since: null } });
    f.writeResults.call_settings = { ...ROW, slot_minutes: 45 };
    f.writeResults.call_blocks = BLOCK_ROW;
    throwingAudit(f);
    const repo = createCallsRepo({ client: f.client });
    expect((await repo.updateSettings({ slotMinutes: 45 }, ADMIN_ACTOR)).ok).toBe(true);
    expect((await repo.insertBlock({ startsAt: "2027-02-12T09:00:00.000Z", endsAt: "2027-02-12T13:00:00.000Z", reason: "dentist" }, ADMIN_ACTOR)).ok).toBe(true);
    f.writeResults.call_blocks = [BLOCK_ROW];
    expect((await repo.deleteBlock(BLOCK, ADMIN_ACTOR)).ok).toBe(true);
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("activity_logs"), expect.anything());
  });

  it("Start call booking: the stamp landed, the audit insert threw → ok (startedNow), not error", async () => {
    const f = fakeAdmin();
    Object.defineProperty(f.reads, "call_settings", {
      get: () => ({ ...ROW, enabled_since: f.ops.some((o) => o.kind === "update") ? "2027-02-01T09:00:00+00:00" : null }),
    });
    throwingAudit(f);
    const started = await createCallsRepo({ client: f.client, now: () => new Date("2027-02-01T09:00:00.000Z") }).startCallBooking(ADMIN_ACTOR);
    expect(started).toEqual({ ok: true, value: { enabledSince: "2027-02-01T09:00:00.000Z", startedNow: true } });
  });
});
