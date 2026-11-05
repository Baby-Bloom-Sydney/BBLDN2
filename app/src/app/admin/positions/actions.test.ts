/**
 * /admin/positions server actions — each proves admin before any client is made (F-8). BB-wave1-041126.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Gate = { userId: string; error: string | null };
interface Op { table: string; kind: string; payload?: unknown; filters: Array<[string, ...unknown[]]> }

const h = vi.hoisted(() => ({
  gate: { userId: "admin-1", error: null } as Gate,
  ops: [] as Op[],
  clients: 0,
  revalidated: [] as string[],
}));

function client() {
  h.clients += 1;
  const chain = (table: string, kind: string, payload?: unknown) => {
    const op: Op = { table, kind, payload, filters: [] };
    h.ops.push(op);
    const data = table === "user_profiles"
      ? { user_id: "user-1", first_name: "Ann", last_name: "Lee", email: "ann@example.com", suburb: null, postcode: null,
          profile_picture_url: null, mobile_number: null, date_of_birth: null, created_at: "2026-11-05T00:00:00Z" }
      : null;
    const b: Record<string, unknown> = {};
    for (const f of ["select", "eq"]) b[f] = (...args: unknown[]) => { op.filters.push([f, ...args]); return b; };
    b.maybeSingle = async () => ({ data, error: null });
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok, ko);
    return b;
  };
  return {
    from: (t: string) => ({
      select: (...a: unknown[]) => (chain(t, "select") as { select: (...x: unknown[]) => unknown }).select(...a),
      update: (p: unknown) => chain(t, "update", p),
    }),
  };
}

vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin: async () => h.gate }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => client() }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => { h.revalidated.push(p); } }));

import { closePositionAction, fetchUserData } from "./actions";

const NOT_SIGNED_IN: Gate = { userId: "", error: "Not authenticated" };
const NOT_ADMIN: Gate = { userId: "", error: "Not authorized — admin role required" };

beforeEach(() => {
  h.gate = { userId: "admin-1", error: null };
  h.ops = [];
  h.clients = 0;
  h.revalidated = [];
});

describe("fetchUserData", () => {
  it("returns the user's details to an admin", async () => {
    const user = await fetchUserData("user-1");
    expect(user?.email).toBe("ann@example.com");
    expect(h.clients).toBe(1);
  });

  it.each([["not signed in", NOT_SIGNED_IN], ["not an admin", NOT_ADMIN]])(
    "returns null and reads nothing when the caller is %s",
    async (_label, gate) => {
      h.gate = gate;
      expect(await fetchUserData("user-1")).toBeNull();
      expect(h.clients).toBe(0);
      expect(h.ops).toEqual([]);
    },
  );
});

describe("closePositionAction", () => {
  it("closes the named position for an admin", async () => {
    const result = await closePositionAction("pos-1");
    expect(result).toEqual({ success: true, error: null });
    const update = h.ops.find((o) => o.table === "nanny_positions" && o.kind === "update");
    expect(update?.filters).toContainEqual(["eq", "id", "pos-1"]);
    expect(h.revalidated).toEqual(["/admin/positions"]);
  });

  it.each([["not signed in", NOT_SIGNED_IN], ["not an admin", NOT_ADMIN]])(
    "refuses and writes nothing when the caller is %s",
    async (_label, gate) => {
      h.gate = gate;
      const result = await closePositionAction("pos-1");
      expect(result.success).toBe(false);
      expect(result.error).toBe(gate.error);
      expect(h.clients).toBe(0);
      expect(h.ops).toEqual([]);
      expect(h.revalidated).toEqual([]);
    },
  );
});
