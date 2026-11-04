/**
 * The admin board (plan 02 step 4; brief §3): every cohort's numbers, the families in each, the warnings box, and
 * the two numbers 02 shows but doesn't own. Admin data, so it needs a real AdminProof. A failed read is flagged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({ result: { userId: "a0000000-0000-4000-8000-000000000031", error: null as string | null } }));
vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin: async () => gate.result }));
const links = vi.hoisted(() => ({
  calls: null as null | ((admin: unknown, now: Date) => Promise<{ booked: number; notBooked: number } | null>),
  preBooked: null as null | ((admin: unknown, start: string) => Promise<number>),
}));
vi.mock("./links", () => ({ callsThisWeekSource: () => links.calls, preBookedSource: () => links.preBooked }));

import { proveAdmin, type AdminProof } from "@/lib/calls/admin-proof";
import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";
import { loadCohortBoard } from "./board";

const NOW = new Date("2027-02-03T10:00:00Z");
const id = (n: number) => `b0200000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const pid = (n: number) => `c0200000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const place = (n: number, fields: Record<string, unknown>) => ({
  id: pid(n), cohort_start_date: "2027-02-01", parent_user_id: id(n), state: "taken", is_goodwill: false, hold_expires_at: null,
  paid_by: "card", taken_at: "2027-02-02T09:00:00Z", reopened_at: null, reopen_reason: null, ...fields,
});
const PLACES = [
  place(1, {}),
  place(2, { paid_by: "bank_transfer" }),
  place(3, {}),
  place(6, { state: "reopened", reopened_at: "2027-02-03T09:00:00Z", reopen_reason: "moved abroad" }),
  place(4, { cohort_start_date: "2027-02-08", is_goodwill: true, paid_by: "bank_transfer" }),
  place(5, { cohort_start_date: "2027-02-08", state: "held", paid_by: null, taken_at: null, hold_expires_at: "2027-02-03T10:20:00Z" }),
  place(8, { cohort_start_date: "2027-02-08", state: "held", paid_by: null, taken_at: null, hold_expires_at: "2027-02-03T09:00:00Z" }),
  place(7, { cohort_start_date: "2027-01-25" }),
];
const PROFILES = [
  { user_id: id(1), first_name: "Sarah", last_name: "Jones", email: "s@example.test" },
  { user_id: id(2), first_name: "Amira", last_name: "Khan", email: null },
  { user_id: id(3), first_name: null, last_name: null, email: "c@example.test" },
  { user_id: id(9), first_name: "Tom", last_name: "Reid", email: null },
];
const WARNINGS = {
  refunded_but_held: [{ place_id: pid(1), parent_user_id: id(1), cohort_start_date: "2027-02-01" }],
  paid_without_place: [{ parent_user_id: id(9), deposit_paid_at: "2027-02-02T09:00:00Z" }],
};

function db(reads: Record<string, unknown> = {}): FakeAdmin {
  const f = fakeAdmin({
    cohort_schedule: { first_start_date: "2027-01-25", repeat_weeks: 1, default_places: 5, created_at: "2026-11-04T05:00:00Z" },
    cohorts: [{ start_date: "2027-01-25", places: 5 }, { start_date: "2027-02-01", places: 5 }, { start_date: "2027-02-08", places: 5 }],
    cohort_places: PLACES,
    user_profiles: (op: FakeAdmin["ops"][number]) => {
      const ids = op.filters.find(([f, c]) => f === "in" && c === "user_id")?.[2] as string[];
      return PROFILES.filter((p) => ids.includes(p.user_id));
    },
    ...reads,
  });
  f.rpcResults.cohort_warnings = { data: WARNINGS, error: null };
  return f;
}

let proof: AdminProof;
beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  links.calls = null;
  links.preBooked = null;
  proof = (await proveAdmin())!;
});
afterEach(() => vi.unstubAllEnvs());

async function board(f: FakeAdmin = db()) {
  const r = await loadCohortBoard(proof, f.client, NOW);
  if (!r.ok) throw new Error("board failed");
  return r.value;
}

describe("loadCohortBoard — the cohorts", () => {
  it("current: 5 places · 3 taken · 2 left (brief §0.3), one re-opened", async () => {
    const b = await board();
    expect(b.today).toBe("2027-02-03");
    expect(b.suggestedFirst).toBe("2027-02-08");
    expect(b.current?.view).toEqual({ start: "2027-02-01", places: 5, taken: 3, beingPaid: 0, left: 2, overBy: 0 });
    expect(b.current?.reopened).toBe(1);
  });

  it("next: goodwill counted in taken, the live hold being paid, a lapsed hold not shown (brief §0.11, §0.6)", async () => {
    const b = await board();
    expect(b.next?.view).toEqual({ start: "2027-02-08", places: 5, taken: 1, beingPaid: 1, left: 3, overBy: 0 });
    expect(b.next?.goodwillTaken).toBe(1);
    expect(b.next?.families.map((f) => f.state)).toEqual(["taken", "held"]);
    expect(b.upcoming).toHaveLength(8);
    expect(b.upcoming[0]).toBe(b.next);
  });

  it("families: taken, then being paid, then re-opened, by name (email, then a short id, when there's no name)", async () => {
    const b = await board();
    expect(b.current?.families).toEqual([
      expect.objectContaining({ name: "Amira Khan", paidBy: "bank_transfer", state: "taken" }),
      expect.objectContaining({ name: "c@example.test", paidBy: "card" }),
      expect.objectContaining({ name: "Sarah Jones", paidBy: "card", placeId: pid(1), parentUserId: id(1) }),
      expect.objectContaining({ name: "Family b0200000", state: "reopened", reopenReason: "moved abroad", reopenedAt: "2027-02-03T09:00:00Z" }),
    ]);
    expect(b.next?.families.find((f) => f.state === "taken")).toMatchObject({ isGoodwill: true });
  });

  it("past cohorts, read-only, newest first", async () => {
    const b = await board();
    expect(b.past.map((p) => [p.view.start, p.view.taken])).toEqual([["2027-01-25", 1]]);
  });

  it("names are read ≤100 ids a request", async () => {
    const f = db();
    await board(f);
    const reads = f.ops.filter((o) => o.table === "user_profiles");
    expect(reads.length).toBeGreaterThan(0);
    for (const op of reads) expect((op.filters.find(([x, c]) => x === "in" && c === "user_id")?.[2] as string[]).length).toBeLessThanOrEqual(100);
  });
});

describe("loadCohortBoard — the warnings box (brief §3.8)", () => {
  it("refunded but held, paid without a place, by name", async () => {
    const b = await board();
    expect(b.warnings).toEqual({
      kind: "ok",
      truncated: false,
      list: [
        { kind: "refunded_but_held", placeId: pid(1), parentUserId: id(1), name: "Sarah Jones", cohortStartDate: "2027-02-01" },
        { kind: "paid_without_place", parentUserId: id(9), name: "Tom Reid" },
      ],
    });
  });

  it("over capacity on a current or upcoming cohort (brief §0.10)", async () => {
    const f = db({ cohorts: [{ start_date: "2027-02-01", places: 2 }] });
    f.rpcResults.cohort_warnings = { data: { refunded_but_held: [], paid_without_place: [] }, error: null };
    const b = await board(f);
    expect(b.current?.view.overBy).toBe(1);
    expect(b.warnings).toEqual({ kind: "ok", truncated: false, list: [{ kind: "over_capacity", cohortStartDate: "2027-02-01", overBy: 1 }] });
  });

  it("a failed warnings read is flagged, the rest of the board still shows", async () => {
    const f = db();
    f.rpcResults.cohort_warnings = { data: null, error: { message: "x", code: "57014" } };
    expect((await board(f)).warnings).toEqual({ kind: "unavailable" });
    const g = db();
    g.rpcResults.cohort_warnings = { data: { refunded_but_held: "no" }, error: null };
    expect((await board(g)).warnings).toEqual({ kind: "unavailable" });
  });

  it("a full list of 100 says so", async () => {
    const f = db();
    const many = Array.from({ length: 100 }, (_, i) => ({ parent_user_id: id(9), deposit_paid_at: `2027-02-02T09:00:${String(i % 60).padStart(2, "0")}Z` }));
    f.rpcResults.cohort_warnings = { data: { refunded_but_held: [], paid_without_place: many }, error: null };
    expect((await board(f)).warnings).toMatchObject({ kind: "ok", truncated: true });
  });
});

describe("loadCohortBoard — numbers 02 doesn't own (brief §0.11, §0.12)", () => {
  it("not connected while the sources are null", async () => {
    const b = await board();
    expect(b.calls).toEqual({ kind: "not_connected" });
    expect(b.preBooked).toEqual({ kind: "not_connected" });
  });

  it("04's {8, 4} and 03's stubbed 2 for the next cohort", async () => {
    links.calls = async () => ({ booked: 8, notBooked: 4 });
    const asked: string[] = [];
    links.preBooked = async (_admin, start) => { asked.push(start); return 2; };
    const b = await board();
    expect(b.calls).toEqual({ kind: "counts", counts: { booked: 8, notBooked: 4 } });
    expect(b.preBooked).toEqual({ kind: "count", count: 2 });
    expect(asked).toEqual(["2027-02-08"]);
  });

  it("a source that fails or throws is 'unavailable', never 0", async () => {
    links.calls = async () => null;
    links.preBooked = async () => { throw new Error("x"); };
    const b = await board();
    expect(b.calls).toEqual({ kind: "unavailable" });
    expect(b.preBooked).toEqual({ kind: "unavailable" });
  });
});

describe("loadCohortBoard — refusals and failures", () => {
  it("a look-alike proof reads nothing", async () => {
    const f = db();
    expect(await loadCohortBoard({ ...proof } as AdminProof, f.client, NOW)).toEqual({ ok: false });
    expect(f.ops).toHaveLength(0);
    expect(f.rpcCalls).toHaveLength(0);
  });

  it("any failed core read fails the board (never an empty page)", async () => {
    for (const table of ["cohort_schedule", "cohorts", "cohort_places", "user_profiles"]) {
      const f = db();
      f.readErrors[table] = { message: "down", code: "XX000" };
      expect(await loadCohortBoard(proof, f.client, NOW)).toEqual({ ok: false });
    }
    const g = db();
    g.client.from = (() => { throw new Error("boom"); }) as never;
    expect(await loadCohortBoard(proof, g.client, NOW)).toEqual({ ok: false });
  });

  it("nothing set up: no schedule, no cohorts — the empty state", async () => {
    const f = db({ cohort_schedule: null, cohorts: [], cohort_places: [] });
    f.rpcResults.cohort_warnings = { data: { refunded_but_held: [], paid_without_place: [] }, error: null };
    const b = await board(f);
    expect(b.schedule).toBeNull();
    expect(b.current).toBeNull();
    expect(b.upcoming).toEqual([]);
    expect(b.preBooked).toEqual({ kind: "not_connected" });
  });
});
