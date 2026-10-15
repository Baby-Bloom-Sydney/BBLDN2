/**
 * /admin/guarantees server actions (4e brief step 2; ADR-088, offer §4, SOP 14). BB-LDN-4e-151026.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { G4 } from "@/config/offer";

interface Op { table: string; kind: string; payload?: unknown; filters: Array<[string, ...unknown[]]> }
type Res = { data?: unknown; error?: { message: string; code?: string } | null; count?: number | null };

const h = vi.hoisted(() => ({
  admin: { userId: "admin-1", error: null as string | null },
  ops: [] as Op[],
  res: {} as Record<string, Res | ((op: Op) => Res)>,
}));

function client() {
  const chain = (table: string, kind: string, payload?: unknown) => {
    const op: Op = { table, kind, payload, filters: [] };
    h.ops.push(op);
    const out = () => {
      const r = h.res[`${table}:${kind}`];
      const v = typeof r === "function" ? r(op) : r;
      return { data: v?.data ?? null, error: v?.error ?? null, count: v?.count ?? null };
    };
    const b: Record<string, unknown> = {};
    for (const f of ["eq", "ilike", "limit", "in", "order"]) {
      b[f] = (...args: unknown[]) => { op.filters.push([f, ...args]); return b; };
    }
    b.select = (...args: unknown[]) => { op.filters.push(["select", ...args]); return b; };
    b.returns = () => b;
    b.maybeSingle = async () => out();
    b.single = async () => out();
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(out()).then(ok, ko);
    return b;
  };
  return {
    from: (t: string) => ({
      select: (...a: unknown[]) => (chain(t, "select") as { select: (...x: unknown[]) => unknown }).select(...a),
      insert: (p: unknown) => chain(t, "insert", p),
    }),
  };
}

vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin: async () => h.admin }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => client() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { findGuaranteeFamily, recordGuarantee } from "./actions";

const PARENT = "11111111-1111-4111-8111-111111111111";
const INPUT = { parentUserId: PARENT, promise: "G1", conditionMet: true, outcome: "new nanny found", paidOutPounds: "0", notes: "" };
const writes = (table: string) => h.ops.filter((o) => o.table === table && o.kind === "insert");

beforeEach(() => {
  h.admin = { userId: "admin-1", error: null };
  h.ops = [];
  h.res = {
    "user_profiles:select": { data: [{ user_id: PARENT, first_name: "Ann", last_name: "Lee", email: "ann@example.com" }] },
    "parents:select": { data: { id: "par-1" } },
    "parent_subscriptions:select": {
      data: { placement_id: "pl-1", placed_at: "2026-10-15T02:51:23Z", satisfaction_window_ends_at: "2099-01-01T00:00:00Z" },
    },
    "guarantee_events:select": { data: [{ promise: "G5" }] },
    "guarantee_events:insert": { data: { id: "ge-1" } },
    "nanny_placements:select": { count: 1 },
    "activity_logs:insert": {},
  };
});

describe("recordGuarantee", () => {
  it("refuses a non-admin before any read or write", async () => {
    h.admin = { userId: "", error: "Not authorized — admin role required" };
    expect(await recordGuarantee(INPUT)).toEqual({ ok: false, error: "not_authorized" });
    expect(h.ops).toHaveLength(0);
  });

  it("refuses bad input with the validator's code, writing nothing", async () => {
    expect(await recordGuarantee({ ...INPUT, paidOutPounds: "-1" })).toEqual({ ok: false, error: "invalid_amount" });
    expect(writes("guarantee_events")).toHaveLength(0);
  });

  it("refuses an unknown family", async () => {
    h.res["parents:select"] = { data: null };
    expect(await recordGuarantee(INPUT)).toEqual({ ok: false, error: "not_a_family" });
    expect(writes("guarantee_events")).toHaveLength(0);
  });

  it("writes the row (placement from the family's subscription, admin as recorder) then guarantee.recorded", async () => {
    expect(await recordGuarantee({ ...INPUT, paidOutPounds: "300.50", notes: " on the call " })).toEqual({ ok: true, id: "ge-1" });
    expect(writes("guarantee_events")[0].payload).toEqual({
      parent_user_id: PARENT,
      placement_id: "pl-1",
      promise: "G1",
      condition_met: true,
      outcome: "new nanny found",
      paid_out_pence: 30050,
      notes: "on the call",
      recorded_by: "admin-1",
    });
    expect(writes("activity_logs")[0].payload).toEqual({
      user_id: PARENT,
      action_type: "guarantee.recorded",
      action_details: { guarantee_event_id: "ge-1", promise: "G1", condition_met: true, paid_out_pence: 30050, recorded_by: "admin-1" },
    });
  });

  it("ignores a client-supplied recorder or placement", async () => {
    await recordGuarantee({ ...INPUT, recordedBy: "evil", placementId: "x" });
    const p = writes("guarantee_events")[0].payload as Record<string, unknown>;
    expect(p.recorded_by).toBe("admin-1");
    expect(p.placement_id).toBe("pl-1");
  });

  it("a second G1 for the family hits the unique index → friendly already_recorded, no audit row", async () => {
    h.res["guarantee_events:insert"] = { error: { message: "duplicate key value violates unique constraint", code: "23505" } };
    expect(await recordGuarantee(INPUT)).toEqual({ ok: false, error: "already_recorded" });
    expect(writes("activity_logs")).toHaveLength(0);
  });

  it("any other insert error → save_failed", async () => {
    h.res["guarantee_events:insert"] = { error: { message: "boom", code: "XX000" } };
    expect(await recordGuarantee(INPUT)).toEqual({ ok: false, error: "save_failed" });
  });

  it("G4 is refused below G4.enabledAfterPlacements and allowed at it", async () => {
    h.res["nanny_placements:select"] = { count: G4.enabledAfterPlacements - 1 };
    expect(await recordGuarantee({ ...INPUT, promise: "G4" })).toEqual({ ok: false, error: "g4_not_enabled" });
    expect(writes("guarantee_events")).toHaveLength(0);
    h.res["nanny_placements:select"] = { count: G4.enabledAfterPlacements };
    expect(await recordGuarantee({ ...INPUT, promise: "G4" })).toEqual({ ok: true, id: "ge-1" });
  });

  it("a failed family or subscription read never writes a ledger row without its placement", async () => {
    h.res["parents:select"] = { error: { message: "timeout" } };
    expect(await recordGuarantee(INPUT)).toEqual({ ok: false, error: "save_failed" });
    h.res["parents:select"] = { data: { id: "par-1" } };
    h.res["parent_subscriptions:select"] = { error: { message: "timeout" } };
    expect(await recordGuarantee(INPUT)).toEqual({ ok: false, error: "save_failed" });
    expect(writes("guarantee_events")).toHaveLength(0);
  });

  it("a failed audit row does not undo the recorded guarantee", async () => {
    h.res["activity_logs:insert"] = { error: { message: "check violation" } };
    expect(await recordGuarantee(INPUT)).toEqual({ ok: true, id: "ge-1" });
  });
});

describe("findGuaranteeFamily", () => {
  it("refuses a non-admin", async () => {
    h.admin = { userId: "", error: "Not authenticated" };
    expect(await findGuaranteeFamily("ann@example.com")).toEqual({ ok: false, error: "not_authorized" });
    expect(h.ops).toHaveLength(0);
  });

  it("refuses a malformed email without a query", async () => {
    expect(await findGuaranteeFamily("not an email")).toEqual({ ok: false, error: "invalid_email" });
    expect(h.ops).toHaveLength(0);
  });

  it("looks up case-insensitively with LIKE wildcards escaped", async () => {
    await findGuaranteeFamily("  Ann_X%@Example.com ");
    const f = h.ops.find((o) => o.table === "user_profiles")!.filters.find((x) => x[0] === "ilike")!;
    expect(f).toEqual(["ilike", "email", "ann\\_x\\%@example.com"]);
  });

  it("returns the family, the G2 window state and the promises already recorded", async () => {
    const r = await findGuaranteeFamily("ann@example.com");
    expect(r).toEqual({
      ok: true,
      family: {
        parentUserId: PARENT,
        name: "Ann Lee",
        email: "ann@example.com",
        placedAt: "2026-10-15T02:51:23Z",
        satisfactionWindowEndsAt: "2099-01-01T00:00:00Z",
        g2Window: "open",
        recorded: ["G5"],
      },
    });
  });

  it("not found, ambiguous, and not a family", async () => {
    h.res["user_profiles:select"] = { data: [] };
    expect(await findGuaranteeFamily("x@example.com")).toEqual({ ok: false, error: "not_found" });
    h.res["user_profiles:select"] = { data: [{ user_id: "a" }, { user_id: "b" }] };
    expect(await findGuaranteeFamily("x@example.com")).toEqual({ ok: false, error: "ambiguous" });
    h.res["user_profiles:select"] = { data: [{ user_id: PARENT, first_name: null, last_name: null, email: "x@example.com" }] };
    h.res["parents:select"] = { data: null };
    expect(await findGuaranteeFamily("x@example.com")).toEqual({ ok: false, error: "not_a_family" });
  });

  it("a failed read is lookup_failed, not a wrong answer", async () => {
    h.res["parents:select"] = { error: { message: "timeout" } };
    expect(await findGuaranteeFamily("ann@example.com")).toEqual({ ok: false, error: "lookup_failed" });
  });

  it("a family with no subscription row still resolves, window unknown", async () => {
    h.res["parent_subscriptions:select"] = { data: null };
    const r = await findGuaranteeFamily("ann@example.com");
    expect(r.ok && r.family.g2Window).toBe("unknown");
    expect(r.ok && r.family.placedAt).toBeNull();
  });
});
