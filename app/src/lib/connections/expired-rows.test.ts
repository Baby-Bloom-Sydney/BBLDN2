import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../../tests/fakes/memory-supabase";
import { familySawAtExpiry, readFamilyExpiredConnections } from "./expired-rows";

describe("familySawAtExpiry — what the family saw of a row that runs out of time", () => {
  it.each([
    [0, "parent", "request"],
    [0, null, "request"],
    [9, "parent", "request"],
    [10, "parent", "booking"],
    [10, "dfy", "booking"],
  ] as const)("stage %s (%s) → %s", (stage, source, saw) => {
    expect(familySawAtExpiry({ connection_stage: stage, source })).toBe(saw);
  });

  it.each([
    [9, "dfy"],
    [4, null],
    [5, null],
    [null, "parent"],
    [20, "parent"],
  ] as const)("stage %s (%s) → nothing", (stage, source) => {
    expect(familySawAtExpiry({ connection_stage: stage, source })).toBeNull();
  });
});

const row = (id: string, nanny: string, stage: number, status: string, source: string | null, created: string, parent = "p1") => ({
  id, parent_id: parent, nanny_id: nanny, connection_stage: stage, status, source, created_at: created, updated_at: created,
});
const expiredLog = (id: string, data: Record<string, unknown>) => ({ connection_request_id: id, event_type: "expired", event_data: data });

function db(rows: Record<string, unknown>[], logs: Record<string, unknown>[]) {
  return createMemoryDb({
    connection_requests: rows,
    connections_log: logs,
    nannies: [
      { id: "nA", user_id: "uA" }, { id: "nB", user_id: "uB" }, { id: "nC", user_id: "uC" }, { id: "nD", user_id: "uD" }, { id: "nE", user_id: "uE" },
    ],
    user_profiles: [
      { user_id: "uA", first_name: "Sarah", last_name: "Jones", suburb: "Islington", profile_picture_url: null },
      { user_id: "uB", first_name: "Amira", last_name: "Khan", suburb: "Camden", profile_picture_url: "https://x.test/b.png" },
      { user_id: "uC", first_name: "Cleo", last_name: "Hart", suburb: "Hackney", profile_picture_url: null },
      { user_id: "uD", first_name: "Dora", last_name: "Lee", suburb: "Bow", profile_picture_url: null },
      { user_id: "uE", first_name: "Eve", last_name: "Moss", suburb: "Kew", profile_picture_url: null },
    ],
  });
}

describe("readFamilyExpiredConnections — the expired rows the family's lists keep", () => {
  it("keeps the rows the family saw run out, with the reason, newest first", async () => {
    const d = db(
      [
        row("r1", "nA", 1, "expired", "parent", "2026-11-01T10:00:00Z"),
        row("r2", "nB", 11, "expired", "parent", "2026-11-02T10:00:00Z"),
        row("r3", "nC", 11, "expired", "dfy", "2026-11-03T10:00:00Z"),
      ],
      [expiredLog("r1", { family_saw: "request" }), expiredLog("r2", { family_saw: "booking" }), expiredLog("r3", { family_saw: "booking" })],
    );
    const rows = await readFamilyExpiredConnections(d.client() as never, "p1");
    expect(rows.map((r) => [r.connectionId, r.nannyFirstName, r.expiredBecause, r.source])).toEqual([
      ["r3", "Cleo", "not_booked", "dfy"],
      ["r2", "Amira", "not_booked", "parent"],
      ["r1", "Sarah", "no_reply", "parent"],
    ]);
    expect(rows[1]).toMatchObject({ nannyId: "nB", nannyName: "Amira Khan", nannySuburb: "Camden", nannyPhoto: "https://x.test/b.png" });
  });

  it("leaves out a row with no mark: held, barred, an application, or another family's", async () => {
    const d = db(
      [
        row("held", "nA", 11, "expired", "dfy", "2026-11-01T10:00:00Z"),
        row("barred", "nB", 1, "expired", "parent", "2026-11-01T10:00:00Z"),
        row("app", "nC", 1, "expired", null, "2026-11-01T10:00:00Z"),
        row("other", "nD", 1, "expired", "parent", "2026-11-01T10:00:00Z", "p2"),
      ],
      [expiredLog("held", { held: true }), expiredLog("app", {}), expiredLog("other", { family_saw: "request" })],
    );
    expect(await readFamilyExpiredConnections(d.client() as never, "p1")).toEqual([]);
  });

  it("leaves out an expired row once a newer row with the same nanny exists, and keeps only the newest expiry", async () => {
    const d = db(
      [
        row("old", "nA", 1, "expired", "parent", "2026-11-01T10:00:00Z"),
        row("new", "nA", 0, "pending", "parent", "2026-11-05T10:00:00Z"),
        row("e1", "nE", 1, "expired", "parent", "2026-11-01T10:00:00Z"),
        row("e2", "nE", 11, "expired", "parent", "2026-11-04T10:00:00Z"),
      ],
      [expiredLog("old", { family_saw: "request" }), expiredLog("e1", { family_saw: "request" }), expiredLog("e2", { family_saw: "booking" })],
    );
    const rows = await readFamilyExpiredConnections(d.client() as never, "p1");
    expect(rows.map((r) => r.connectionId)).toEqual(["e2"]);
  });

  it("leaves out a nanny who is no longer on the platform (suspended, deactivated or inactive)", async () => {
    const d = db(
      [
        row("s", "nA", 1, "expired", "parent", "2026-11-01T10:00:00Z"),
        row("d", "nB", 11, "expired", "parent", "2026-11-01T10:00:00Z"),
        row("i", "nC", 1, "expired", "parent", "2026-11-01T10:00:00Z"),
        row("ok", "nD", 1, "expired", "parent", "2026-11-01T10:00:00Z"),
      ],
      ["s", "d", "i", "ok"].map((id) => expiredLog(id, { family_saw: "request" })),
    );
    const statuses: Record<string, string> = { nA: "suspended", nB: "deactivated", nC: "inactive", nD: "active" };
    for (const n of d.tables.nannies) n.status = statuses[n.id as string] ?? "active";
    const rows = await readFamilyExpiredConnections(d.client() as never, "p1");
    expect(rows.map((r) => r.connectionId)).toEqual(["ok"]);
  });

  it("reads nothing more when the family has no expired row", async () => {
    const d = db([row("live", "nA", 0, "pending", "parent", "2026-11-01T10:00:00Z")], []);
    expect(await readFamilyExpiredConnections(d.client() as never, "p1")).toEqual([]);
  });
});
