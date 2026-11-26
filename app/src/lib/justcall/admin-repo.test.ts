/**
 * admin-repo.ts — the reads 05a-2's admin needs (plan 05 §5 B2): the Unmatched rows (a result set, not dismissed, no
 * parent; a sid that already has an entry left out — carried in from 05a-1 §5), details by sid, and the parent search
 * (`user_roles` parents only). Bounded, failing closed, never throwing; the shared RPC fake (alignment item 4).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, type Op } from "@/lib/payments/fake-admin.test-util";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("no admin client in unit tests");
  },
}));

import { createJustCallAdminRepo } from "./admin-repo";

const P1 = "b0500000-0000-4000-8000-000000000001";
const P2 = "b0500000-0000-4000-8000-000000000002";
const NANNY = "b0500000-0000-4000-8000-000000000040";

const callRow = (sid: string, over: Record<string, unknown> = {}) => ({
  call_sid: sid, direction: "outgoing", justcall_type: "Answered", mapped_result: "answered", duration_seconds: 372,
  started_at: "2027-02-09T14:03:00+00:00", notes: null, disposition: null, contact_number: "447700900599", match_note: "none", ...over,
});

let errors: unknown[][];
beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void errors.push(a));
});
afterEach(() => vi.restoreAllMocks());

describe("readUnmatched", () => {
  it("unmatched, undismissed calls with a result, newest first, capped, with the full count", async () => {
    const f = fakeAdmin({ justcall_calls: [callRow("CA1"), callRow("CA2", { match_note: "several", contact_number: null })], call_log_entries: [] });
    f.counts.justcall_calls = 7;
    const result = await createJustCallAdminRepo({ client: f.client }).readUnmatched(100);
    expect(result).toEqual({
      ok: true,
      value: {
        total: 7,
        calls: [
          { callSid: "CA1", direction: "outgoing", justcallType: "Answered", mappedResult: "answered", durationSeconds: 372, startedAt: "2027-02-09T14:03:00.000Z", notes: null, disposition: null, contactNumber: "447700900599", matchNote: "none" },
          expect.objectContaining({ callSid: "CA2", contactNumber: null, matchNote: "several" }),
        ],
      },
    });
    expect(f.ops[0].filters).toEqual(expect.arrayContaining([
      ["is", "parent_user_id", null], ["is", "dismissed_at", null], ["not", "mapped_result", "is"],
      ["order", "started_at", { ascending: false }], ["range", 0, 99],
    ]));
  });

  it("leaves out a sid that already has an entry (04's writer took the JustCall id), and counts it out", async () => {
    const f = fakeAdmin({ justcall_calls: [callRow("CA1"), callRow("CA2")], call_log_entries: [{ justcall_call_id: "CA2" }] });
    f.counts.justcall_calls = 2;
    const result = await createJustCallAdminRepo({ client: f.client }).readUnmatched(100);
    expect(result.ok && result.value.calls.map((c) => c.callSid)).toEqual(["CA1"]);
    expect(result.ok && result.value.total).toBe(1);
    const entriesRead = f.ops.find((o: Op) => o.table === "call_log_entries");
    expect(entriesRead?.filters).toEqual(expect.arrayContaining([["in", "justcall_call_id", ["CA1", "CA2"]]]));
  });

  it("no calls → no entries read", async () => {
    const f = fakeAdmin({ justcall_calls: [] });
    f.counts.justcall_calls = 0;
    expect(await createJustCallAdminRepo({ client: f.client }).readUnmatched(100)).toEqual({ ok: true, value: { calls: [], total: 0 } });
    expect(f.ops).toHaveLength(1);
  });

  it.each([
    ["the calls read fails", "justcall_calls"],
    ["the entries read fails", "call_log_entries"],
  ])("%s → error, logged", async (_label, table) => {
    const f = fakeAdmin({ justcall_calls: [callRow("CA1")], call_log_entries: [] });
    f.counts.justcall_calls = 1;
    f.readErrors[table] = { message: "boom" };
    expect(await createJustCallAdminRepo({ client: f.client }).readUnmatched(100)).toEqual({ ok: false, error: "error" });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("a row that doesn't fit, or more rows than asked → error", async () => {
    const bad = fakeAdmin({ justcall_calls: [callRow("CA1", { direction: "sideways" })] });
    expect(await createJustCallAdminRepo({ client: bad.client }).readUnmatched(100)).toEqual({ ok: false, error: "error" });
    const many = fakeAdmin({ justcall_calls: [callRow("CA1"), callRow("CA2"), callRow("CA3")], call_log_entries: [] });
    expect(await createJustCallAdminRepo({ client: many.client }).readUnmatched(2)).toEqual({ ok: false, error: "error" });
  });
});

describe("readDetails", () => {
  it("details by sid, in chunks of 100", async () => {
    const sids = Array.from({ length: 150 }, (_, i) => "CA".concat(String(i)));
    const f = fakeAdmin({ justcall_calls: (op: Op) => (op.filters.find(([k]) => k === "in")?.[2] as string[]).slice(0, 2).map((sid) => callRow(sid, { notes: "wants Tuesdays" })) });
    const result = await createJustCallAdminRepo({ client: f.client }).readDetails(sids);
    expect(f.ops).toHaveLength(2);
    expect((f.ops[0].filters.find(([k]) => k === "in")?.[2] as string[]).length).toBe(100);
    expect(result.ok && [...result.value.keys()]).toEqual(["CA0", "CA1", "CA100", "CA101"]);
    expect(result.ok && result.value.get("CA0")).toEqual({
      callSid: "CA0", direction: "outgoing", justcallType: "Answered", mappedResult: "answered", durationSeconds: 372,
      startedAt: "2027-02-09T14:03:00.000Z", notes: "wants Tuesdays", disposition: null,
    });
  });

  it("no sids → no read; a failed read → error", async () => {
    const none = fakeAdmin();
    expect(await createJustCallAdminRepo({ client: none.client }).readDetails([])).toEqual({ ok: true, value: new Map() });
    expect(none.ops).toEqual([]);
    const f = fakeAdmin();
    f.readErrors.justcall_calls = { message: "boom" };
    expect(await createJustCallAdminRepo({ client: f.client }).readDetails(["CA1"])).toEqual({ ok: false, error: "error" });
  });
});

describe("searchParents", () => {
  const profiles = [
    { user_id: P2, first_name: "Zoe", last_name: "Bell", mobile_number: null },
    { user_id: P1, first_name: "Ava", last_name: "Smith", mobile_number: "+447700900517" },
    { user_id: NANNY, first_name: "Ava", last_name: "Nanny", mobile_number: "+447700900540" },
  ];

  it("by mobile: exactly that E.164 number; parents only (user_roles)", async () => {
    const f = fakeAdmin({ user_profiles: profiles, user_roles: [{ user_id: P1 }, { user_id: P2 }] });
    const result = await createJustCallAdminRepo({ client: f.client }).searchParents({ kind: "mobile", e164: "+447700900517" });
    expect(f.ops[0].filters).toEqual(expect.arrayContaining([["eq", "mobile_number", "+447700900517"]]));
    expect(f.ops[1]).toMatchObject({ table: "user_roles" });
    expect(f.ops[1].filters).toEqual(expect.arrayContaining([["in", "user_id", [P2, P1, NANNY]], ["eq", "role", "parent"]]));
    expect(result).toEqual({ ok: true, value: [
      { userId: P1, firstName: "Ava", lastName: "Smith", mobile: "+447700900517" },
      { userId: P2, firstName: "Zoe", lastName: "Bell", mobile: null },
    ] });
  });

  it("by one name: first or last name starting with it", async () => {
    const f = fakeAdmin({ user_profiles: [], user_roles: [] });
    await createJustCallAdminRepo({ client: f.client }).searchParents({ kind: "name", first: "ava", last: null });
    expect(f.ops[0].filters).toEqual(expect.arrayContaining([["or", "first_name.ilike.ava%,last_name.ilike.ava%", undefined], ["range", 0, 49]]));
  });

  it("by two names: first name starts with the first, last name with the last", async () => {
    const f = fakeAdmin({ user_profiles: [], user_roles: [] });
    await createJustCallAdminRepo({ client: f.client }).searchParents({ kind: "name", first: "ava", last: "smi" });
    expect(f.ops[0].filters).toEqual(expect.arrayContaining([["ilike", "first_name", "ava%"], ["ilike", "last_name", "smi%"]]));
  });

  it("no profile → no roles read; a failed read → error", async () => {
    const none = fakeAdmin({ user_profiles: [] });
    expect(await createJustCallAdminRepo({ client: none.client }).searchParents({ kind: "name", first: "ava", last: null })).toEqual({ ok: true, value: [] });
    expect(none.ops).toHaveLength(1);
    const f = fakeAdmin({ user_profiles: profiles });
    f.readErrors.user_roles = { message: "boom" };
    expect(await createJustCallAdminRepo({ client: f.client }).searchParents({ kind: "mobile", e164: "+447700900517" })).toEqual({ ok: false, error: "error" });
  });

  it("logs no number or name", async () => {
    const f = fakeAdmin();
    f.readErrors.user_profiles = { message: "boom" };
    await createJustCallAdminRepo({ client: f.client }).searchParents({ kind: "mobile", e164: "+447700900517" });
    await createJustCallAdminRepo({ client: f.client }).searchParents({ kind: "name", first: "ava", last: null });
    expect(JSON.stringify(errors)).not.toMatch(/7700900517|ava/i);
  });
});

describe("the bounded reads, after the code and TypeScript reviews", () => {
  it("the parent search reads on past a page of non-parents, until it has 10 parents (review M1)", async () => {
    const page = (op: Op) => {
      const from = Number(op.filters.find(([k]) => k === "range")?.[1]);
      return from === 0
        ? Array.from({ length: 50 }, (_, i) => ({ user_id: `nanny-${i}`, first_name: "Ma", last_name: `Nanny ${i}`, mobile_number: null }))
        : [{ user_id: P1, first_name: "Mary", last_name: "Parent", mobile_number: null }];
    };
    const f = fakeAdmin({ user_profiles: page, user_roles: (op: Op) => ((op.filters.find(([k]) => k === "in")?.[2] as string[]).includes(P1) ? [{ user_id: P1 }] : []) });
    const result = await createJustCallAdminRepo({ client: f.client }).searchParents({ kind: "name", first: "ma", last: null });
    expect(result).toEqual({ ok: true, value: [{ userId: P1, firstName: "Mary", lastName: "Parent", mobile: null }] });
    expect(f.ops.filter((o) => o.table === "user_profiles")).toHaveLength(2);
  });

  it("the parent search stops at its page cap and answers what it found", async () => {
    const f = fakeAdmin({ user_profiles: () => Array.from({ length: 50 }, (_, i) => ({ user_id: `n-${i}`, first_name: "Ma", last_name: "X", mobile_number: null })), user_roles: [] });
    expect(await createJustCallAdminRepo({ client: f.client }).searchParents({ kind: "name", first: "ma", last: null })).toEqual({ ok: true, value: [] });
    expect(f.ops.filter((o) => o.table === "user_profiles").length).toBeLessThanOrEqual(10);
  });

  it("Unmatched reads on when a sid with an entry is left out, so the newest calls still fill the page (review M2)", async () => {
    const page = (op: Op) => {
      const from = Number(op.filters.find(([k]) => k === "range")?.[1]);
      return from === 0 ? [callRow("CA1"), callRow("CA2")] : [callRow("CA3")];
    };
    const f = fakeAdmin({ justcall_calls: page, call_log_entries: (op: Op) => ((op.filters.find(([k]) => k === "in")?.[2] as string[]).includes("CA2") ? [{ justcall_call_id: "CA2" }] : []) });
    f.counts.justcall_calls = 3;
    const result = await createJustCallAdminRepo({ client: f.client }).readUnmatched(2);
    expect(result.ok && result.value.calls.map((c) => c.callSid)).toEqual(["CA1", "CA3"]);
    expect(result.ok && result.value.total).toBe(2);
  });

  it("details for more than 500 sids fail closed (security review L6)", async () => {
    const f = fakeAdmin({ justcall_calls: [] });
    expect(await createJustCallAdminRepo({ client: f.client }).readDetails(Array.from({ length: 501 }, (_, i) => "CA".concat(String(i))))).toEqual({ ok: false, error: "error" });
    expect(f.ops).toEqual([]);
  });
});
