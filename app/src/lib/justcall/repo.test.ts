/**
 * repo.ts — 05's service-role repository (plan 05 §5 A7; amendment 20; D9: nothing is added to 04's repo). The ledger,
 * parents by mobile, and the four writer functions. Every result is closed; nothing is thrown; logs carry a code and a
 * message, never a number. Built on the shared RPC fake (BUILD/README alignment item 4).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, type Op } from "@/lib/payments/fake-admin.test-util";

const admin = vi.hoisted(() => ({ created: 0 }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    admin.created += 1;
    throw new Error("no admin client in unit tests");
  },
}));

import { createJustCallRepo } from "./repo";

const PARENT = "b0500000-0000-4000-8000-000000000017";
const OTHER = "b0500000-0000-4000-8000-000000000018";
const NANNY = "b0500000-0000-4000-8000-000000000040";
const ADMIN = "b0500000-0000-4000-8000-000000000060";
const ENTRY = "c0500000-0000-4000-8000-000000000001";
const EVENT_ID = "e0500000-0000-4000-8000-000000000001";
const SID = "CAtest0001";

let errors: unknown[][];
beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void errors.push(a));
});
afterEach(() => vi.restoreAllMocks());

const storedRow = (over: Record<string, unknown> = {}) => ({
  id: EVENT_ID, event_type: "call.completed", call_sid: SID, justcall_id: "1786000001", request_id: "01HTEST",
  request_timestamp: "2027-02-09 14:03:00", outcome: "unresolved", ...over,
});

describe("createJustCallRepo", () => {
  it("creates no client until it is used", async () => {
    const before = admin.created;
    const repo = createJustCallRepo();
    expect(admin.created).toBe(before);
    expect(await repo.readEvent(EVENT_ID)).toEqual({ ok: false, error: "error" });
    expect(admin.created).toBe(before + 1);
  });
});

describe("the ledger", () => {
  const row = { requestId: "01HTEST", eventType: "call.completed", callSid: SID, justcallId: "1786000001", requestTimestamp: "2027-02-09 14:03:00", rawBody: { type: "call.completed" } };

  it("inserts a delivery and returns its id", async () => {
    const f = fakeAdmin();
    f.writeResults.justcall_webhook_events = { id: EVENT_ID };
    expect(await createJustCallRepo({ client: f.client }).insertEvent(row)).toEqual({ ok: true, value: { id: EVENT_ID } });
    expect(f.ops[0]).toMatchObject({
      table: "justcall_webhook_events", kind: "insert",
      payload: { request_id: "01HTEST", event_type: "call.completed", call_sid: SID, justcall_id: "1786000001", request_timestamp: "2027-02-09 14:03:00", raw_body: { type: "call.completed" } },
    });
  });

  it("a redelivery (unique violation) → duplicate", async () => {
    const f = fakeAdmin();
    f.writeErrors.justcall_webhook_events = { message: "duplicate key value violates unique constraint", code: "23505" };
    expect(await createJustCallRepo({ client: f.client }).insertEvent(row)).toEqual({ ok: false, error: "duplicate" });
  });

  it.each([
    ["another error", { message: "boom", code: "XX000" }, undefined],
    ["no row back", undefined, null],
  ])("%s → error, logged", async (_label, writeError, written) => {
    const f = fakeAdmin();
    if (writeError) f.writeErrors.justcall_webhook_events = writeError;
    f.writeResults.justcall_webhook_events = written;
    expect(await createJustCallRepo({ client: f.client }).insertEvent(row)).toEqual({ ok: false, error: "error" });
    expect(errors.length).toBeGreaterThan(0);
  });

  it.each([
    ["applied", null, true],
    ["ignored", "api_not_found", true],
    ["unresolved", "api_500", false],
  ] as const)("finishes a row %s (processed_at only when finished)", async (outcome, code, processed) => {
    const f = fakeAdmin();
    expect(await createJustCallRepo({ client: f.client }).finishEvent(EVENT_ID, outcome, code)).toEqual({ ok: true, value: true });
    const op = f.ops[0] as Op;
    expect(op).toMatchObject({ table: "justcall_webhook_events", kind: "update", filters: [["eq", "id", EVENT_ID]] });
    expect(op.payload).toMatchObject({ outcome, processing_error: code });
    expect(typeof (op.payload as { processed_at: unknown }).processed_at === "string").toBe(processed);
  });

  it("clips a long error code to 300 characters", async () => {
    const f = fakeAdmin();
    await createJustCallRepo({ client: f.client }).finishEvent(EVENT_ID, "ignored", "x".repeat(400));
    expect((f.ops[0].payload as { processing_error: string }).processing_error).toHaveLength(300);
  });

  it("a failed finish → error", async () => {
    const f = fakeAdmin();
    f.writeErrors.justcall_webhook_events = { message: "boom" };
    expect(await createJustCallRepo({ client: f.client }).finishEvent(EVENT_ID, "applied", null)).toEqual({ ok: false, error: "error" });
  });

  it("reads one stored delivery", async () => {
    const f = fakeAdmin({ justcall_webhook_events: storedRow() });
    expect(await createJustCallRepo({ client: f.client }).readEvent(EVENT_ID)).toEqual({
      ok: true,
      value: { id: EVENT_ID, eventType: "call.completed", callSid: SID, justcallId: "1786000001", requestId: "01HTEST", requestTimestamp: "2027-02-09 14:03:00", outcome: "unresolved" },
    });
    expect(f.ops[0].filters).toEqual([["eq", "id", EVENT_ID]]);
  });

  it("an unknown id → null; a row that doesn't fit → error", async () => {
    expect(await createJustCallRepo({ client: fakeAdmin().client }).readEvent(EVENT_ID)).toEqual({ ok: true, value: null });
    const f = fakeAdmin({ justcall_webhook_events: storedRow({ outcome: "maybe" }) });
    expect(await createJustCallRepo({ client: f.client }).readEvent(EVENT_ID)).toEqual({ ok: false, error: "error" });
  });

  it("reads every unresolved row, page by page, oldest first", async () => {
    const pages = (op: Op) => {
      const range = op.filters.find(([kind]) => kind === "range");
      const from = Number(range?.[1]);
      return from === 0 ? Array.from({ length: 500 }, (_, i) => storedRow({ id: `id-${i}` })) : [storedRow({ id: "id-500" })];
    };
    const f = fakeAdmin({ justcall_webhook_events: pages });
    const result = await createJustCallRepo({ client: f.client }).readUnresolvedEvents();
    expect(result.ok && result.value.length).toBe(501);
    expect(f.ops[0].filters).toEqual(expect.arrayContaining([["eq", "outcome", "unresolved"], ["order", "received_at", { ascending: true }], ["range", 0, 499]]));
  });

  it("fails closed on a page longer than asked, or past the cap", async () => {
    const tooLong = fakeAdmin({ justcall_webhook_events: Array.from({ length: 1000 }, () => storedRow()) });
    expect(await createJustCallRepo({ client: tooLong.client }).readUnresolvedEvents()).toEqual({ ok: false, error: "error" });
    const endless = fakeAdmin({ justcall_webhook_events: () => Array.from({ length: 500 }, () => storedRow()) });
    expect(await createJustCallRepo({ client: endless.client }).readUnresolvedEvents()).toEqual({ ok: false, error: "error" });
    expect(endless.ops.length).toBe(40);
  });
});

describe("parentsByMobile", () => {
  it("reads profiles with exactly that mobile, then keeps parents only (user_roles)", async () => {
    const f = fakeAdmin({
      user_profiles: [{ user_id: PARENT }, { user_id: NANNY }],
      user_roles: [{ user_id: PARENT }],
    });
    expect(await createJustCallRepo({ client: f.client }).parentsByMobile("+447700900517")).toEqual({ ok: true, value: [PARENT] });
    expect(f.ops[0]).toMatchObject({ table: "user_profiles", kind: "select" });
    expect(f.ops[0].filters).toEqual(expect.arrayContaining([["eq", "mobile_number", "+447700900517"]]));
    expect(f.ops[1]).toMatchObject({ table: "user_roles", kind: "select" });
    expect(f.ops[1].filters).toEqual(expect.arrayContaining([["in", "user_id", [PARENT, NANNY]], ["eq", "role", "parent"]]));
  });

  it("no profile → no parents, one read", async () => {
    const f = fakeAdmin({ user_profiles: [] });
    expect(await createJustCallRepo({ client: f.client }).parentsByMobile("+447700900517")).toEqual({ ok: true, value: [] });
    expect(f.ops).toHaveLength(1);
  });

  it.each(["user_profiles", "user_roles"])("a failed %s read → error", async (table) => {
    const f = fakeAdmin({ user_profiles: [{ user_id: PARENT }], user_roles: [{ user_id: PARENT }] });
    f.readErrors[table] = { message: "boom" };
    expect(await createJustCallRepo({ client: f.client }).parentsByMobile("+447700900517")).toEqual({ ok: false });
  });

  it("logs no number", async () => {
    const f = fakeAdmin();
    f.readErrors.user_profiles = { message: "boom" };
    await createJustCallRepo({ client: f.client }).parentsByMobile("+447700900517");
    expect(JSON.stringify(errors)).not.toContain("7700900517");
  });
});

const CALL = {
  callSid: SID, justcallId: "1786000001", direction: "outgoing" as const, type: "Answered", mappedResult: "answered" as const,
  durationSeconds: 372, startedAt: "2027-02-09T14:03:00.000Z", contactNumber: "447700900517", justcallNumber: "447700900990",
  agentEmail: "admin+b05-agent@babybloomnannies.co.uk", disposition: null, notes: "wants Tuesdays",
};

function repoReturning(fn: string, data: unknown, error: { message: string; code?: string } | null = null) {
  const f = fakeAdmin();
  f.rpcResults[fn] = { data, error };
  return { f, repo: createJustCallRepo({ client: f.client }) };
}

describe("recordCall → justcall_record_call", () => {
  it("passes the named arguments and reads the reply", async () => {
    const { f, repo } = repoReturning("justcall_record_call", { status: "applied", entry_id: ENTRY, entry_created: true, matched: true });
    expect(await repo.recordCall({ ...CALL, parentUserId: PARENT, matchNote: null })).toEqual({ ok: true, value: { entryId: ENTRY, entryCreated: true, matched: true } });
    expect(f.rpcCalls).toEqual([{
      fn: "justcall_record_call",
      args: {
        p_sid: SID, p_justcall_id: "1786000001", p_parent: PARENT, p_match_note: null, p_direction: "outgoing", p_type: "Answered",
        p_mapped_result: "answered", p_duration: 372, p_started_at: "2027-02-09T14:03:00.000Z", p_contact: "447700900517",
        p_our_number: "447700900990", p_agent: "admin+b05-agent@babybloomnannies.co.uk", p_disposition: null, p_notes: "wants Tuesdays",
      },
    }]);
  });

  it("an unmatched call: no entry", async () => {
    const { repo } = repoReturning("justcall_record_call", { status: "applied", entry_id: null, entry_created: false, matched: false });
    expect(await repo.recordCall({ ...CALL, parentUserId: null, matchNote: "several" })).toEqual({ ok: true, value: { entryId: null, entryCreated: false, matched: false } });
  });

  it.each([
    ["invalid", { status: "invalid" }, "invalid"],
    ["an unknown status", { status: "weird" }, "error"],
    ["a reply that doesn't fit", { status: "applied", entry_id: 7 }, "error"],
    ["not an object", "applied", "error"],
  ])("%s → %s", async (_label, data, error) => {
    const { repo } = repoReturning("justcall_record_call", data);
    expect(await repo.recordCall({ ...CALL, parentUserId: PARENT, matchNote: null })).toEqual({ ok: false, error });
  });

  it("a PostgREST error → error, logged with its code and never the call's numbers", async () => {
    const { repo } = repoReturning("justcall_record_call", null, { message: "canceling statement due to lock timeout", code: "55P03" });
    expect(await repo.recordCall({ ...CALL, parentUserId: PARENT, matchNote: null })).toEqual({ ok: false, error: "error" });
    expect(JSON.stringify(errors)).toContain("55P03");
    expect(JSON.stringify(errors)).not.toContain("7700900");
  });

  it("a thrown client → error", async () => {
    const f = fakeAdmin();
    (f.client as unknown as { rpc: () => never }).rpc = () => { throw new Error("socket"); };
    expect(await createJustCallRepo({ client: f.client }).recordCall({ ...CALL, parentUserId: PARENT, matchNote: null })).toEqual({ ok: false, error: "error" });
  });
});

describe("the writers 05a-2 uses", () => {
  const save = { parentUserId: PARENT, bookingId: null, callSid: SID, result: "answered" as const, outcome: "link_sent" as const, note: "Sent", callBackAt: null, actorUserId: ADMIN };

  it("saveOutcome → justcall_save_outcome", async () => {
    const { f, repo } = repoReturning("justcall_save_outcome", { status: "recorded", entry_id: ENTRY, completed: true });
    expect(await repo.saveOutcome(save)).toEqual({ ok: true, value: { entryId: ENTRY, completed: true } });
    expect(f.rpcCalls[0]).toEqual({
      fn: "justcall_save_outcome",
      args: { p_parent: PARENT, p_booking_id: null, p_sid: SID, p_result: "answered", p_outcome: "link_sent", p_note: "Sent", p_call_back_at: null, p_actor: ADMIN },
    });
  });

  it.each(["invalid", "not_yours", "not_found", "booked_call_exists"])("saveOutcome refusal %s", async (status) => {
    const { repo } = repoReturning("justcall_save_outcome", { status });
    expect(await repo.saveOutcome(save)).toEqual({ ok: false, error: status });
  });

  it("attachCall → justcall_attach_call", async () => {
    const { f, repo } = repoReturning("justcall_attach_call", { status: "attached", entry_id: ENTRY, entry_created: true });
    expect(await repo.attachCall(SID, OTHER, ADMIN)).toEqual({ ok: true, value: { entryId: ENTRY, entryCreated: true } });
    expect(f.rpcCalls[0]).toEqual({ fn: "justcall_attach_call", args: { p_sid: SID, p_parent: OTHER, p_actor: ADMIN } });
  });

  it.each(["invalid", "not_found", "not_unmatched", "not_a_parent"])("attachCall refusal %s", async (status) => {
    const { repo } = repoReturning("justcall_attach_call", { status });
    expect(await repo.attachCall(SID, OTHER, ADMIN)).toEqual({ ok: false, error: status });
  });

  it("dismissCall → justcall_dismiss_call, replay included", async () => {
    const { f, repo } = repoReturning("justcall_dismiss_call", { status: "dismissed", replay: true });
    expect(await repo.dismissCall(SID, ADMIN)).toEqual({ ok: true, value: { replay: true } });
    expect(f.rpcCalls[0]).toEqual({ fn: "justcall_dismiss_call", args: { p_sid: SID, p_actor: ADMIN } });
    const first = repoReturning("justcall_dismiss_call", { status: "dismissed" });
    expect(await first.repo.dismissCall(SID, ADMIN)).toEqual({ ok: true, value: { replay: false } });
  });

  it.each(["invalid", "not_found", "not_unmatched"])("dismissCall refusal %s", async (status) => {
    const { repo } = repoReturning("justcall_dismiss_call", { status });
    expect(await repo.dismissCall(SID, ADMIN)).toEqual({ ok: false, error: status });
  });
});
