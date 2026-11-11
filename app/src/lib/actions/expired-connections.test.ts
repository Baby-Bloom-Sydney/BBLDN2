import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb, type MemoryDb } from "../../../tests/fakes/memory-supabase";

const h = vi.hoisted(() => ({ db: null as unknown as MemoryDb, parentId: "p1" as string | null, counting: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.counting ?? h.db.client() }));
vi.mock("./parent", () => ({ getParentId: vi.fn(async () => h.parentId) }));

import { getParentExpiredConnections, getParentOpenRequestCount } from "./expired-connections";

beforeEach(() => {
  h.parentId = "p1";
  h.counting = null;
  h.db = createMemoryDb({
    connection_requests: [
      { id: "r1", parent_id: "p1", nanny_id: "nA", status: "expired", connection_stage: 1, source: "parent", created_at: "2026-11-01T00:00:00Z" },
      { id: "r2", parent_id: "p1", nanny_id: "nB", status: "pending", connection_stage: 0, source: "parent", created_at: "2026-11-02T00:00:00Z" },
      { id: "r3", parent_id: "p1", nanny_id: "nC", status: "pending", connection_stage: 5, source: null, created_at: "2026-11-02T00:00:00Z" },
      { id: "r4", parent_id: "p2", nanny_id: "nA", status: "pending", connection_stage: 0, source: "parent", created_at: "2026-11-02T00:00:00Z" },
    ],
    connections_log: [{ connection_request_id: "r1", event_type: "expired", event_data: { family_saw: "request" } }],
    nannies: [{ id: "nA", user_id: "uA" }],
    user_profiles: [{ user_id: "uA", first_name: "Sarah", last_name: "Jones", suburb: "Islington", profile_picture_url: null }],
  });
});

describe("the family's expired connections and open requests", () => {
  it("reads her own expired rows", async () => {
    const { data, error } = await getParentExpiredConnections();
    expect(error).toBeNull();
    expect(data.map((r) => [r.connectionId, r.nannyFirstName, r.expiredBecause])).toEqual([["r1", "Sarah", "no_reply"]]);
  });

  it("counts her pending rows, as the request limit does", async () => {
    // the in-memory database has no head count: a fake that counts the rows the filters keep
    const filters: [string, unknown][] = [];
    const rows = h.db.tables.connection_requests;
    const query = {
      select: (_c: string, opts: { count: string; head: boolean }) => (expect(opts).toEqual({ count: "exact", head: true }), query),
      eq: (c: string, v: unknown) => (filters.push([c, v]), query),
      then: (done: (r: { count: number }) => void) => done({ count: rows.filter((r) => filters.every(([c, v]) => r[c] === v)).length }),
    };
    h.counting = { from: (t: string) => (expect(t).toBe("connection_requests"), query) };
    expect(await getParentOpenRequestCount()).toBe(2);
    expect(filters).toEqual([["parent_id", "p1"], ["status", "pending"]]);
  });

  it("gives nothing to someone who isn't a family", async () => {
    h.parentId = null;
    expect(await getParentExpiredConnections()).toEqual({ data: [], error: "Not authenticated as parent" });
    expect(await getParentOpenRequestCount()).toBe(0);
  });
});
