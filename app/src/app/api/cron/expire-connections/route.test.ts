/**
 * The expiry cron follows the lazy expiry's rules (`expireStaleRequests`): a held row (stage 4 or 9, any source) has
 * no clock while it is held — it is never expired and nobody is told; every other stale row expires and the family
 * hears about it. BB-wave1-041126, 2026-11-09.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb, type MemoryDb } from "../../../../../tests/fakes/memory-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  inbox: vi.fn(async (_m: { userId: string; body: string }) => {}),
  email: vi.fn(async (_m: { to: string }) => ({ success: true })),
  log: vi.fn(async (_e: { connectionRequestId: string; eventData?: Record<string, unknown> }) => {}),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }));
vi.mock("@/lib/actions/connection-helpers", () => ({ createInboxMessage: h.inbox, logConnectionEvent: h.log }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: h.email }));
vi.mock("@/lib/email/helpers", () => ({
  getUserEmailInfo: vi.fn(async (id: string) => ({ email: `${id}@example.test`, firstName: "Sam", lastName: "Lee" })),
}));

import { GET } from "./route";

const PAST = "2026-11-01T00:00:00Z";
const row = (id: string, status: string, stage: number, source: string, parent: string) =>
  ({ id, parent_id: parent, nanny_id: "n1", status, connection_stage: stage, source, expires_at: PAST });

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "test-secret");
  h.log.mockClear();
  h.inbox.mockClear();
  h.email.mockClear();
  h.db = createMemoryDb({
    nannies: [{ id: "n1", user_id: "nanny-u" }],
    parents: ["a", "b", "c", "d", "e", "f", "g"].map((x) => ({ id: `p-${x}`, user_id: `parent-${x}` })),
    connection_requests: [
      row("c-sent", "pending", 0, "manual", "p-a"),        // a family's request, unanswered
      row("c-accepted", "accepted", 10, "manual", "p-b"),  // accepted, no meet booked
      row("c-held-9", "accepted", 9, "manual", "p-c"),     // a family's request, answered below level 4
      row("c-held-dfy", "accepted", 9, "dfy", "p-d"),      // a DFY answer below level 4
      row("c-held-4", "pending", 4, "manual", "p-e"),      // an application below level 4
      row("c-held-4-dfy", "pending", 4, "dfy", "p-f"),     // the same, from a DFY source
      { ...row("c-no-stage", "pending", 0, "manual", "p-g"), connection_stage: null }, // an old row with no stage
    ],
  });
});
afterEach(() => vi.unstubAllEnvs());

const run = () => GET(new NextRequest("http://localhost/api/cron/expire-connections", { headers: { authorization: "Bearer test-secret" } }));
const stageOf = (id: string) => h.db.tables.connection_requests.find((r) => r.id === id)?.connection_stage;
const toParents = () => h.inbox.mock.calls.map(([m]) => m).filter((m) => m.userId.startsWith("parent-"));

const HELD = ["c-held-9", "c-held-dfy", "c-held-4", "c-held-4-dfy"];

describe("/api/cron/expire-connections — a held row has no clock", () => {
  it("leaves every held row past its time as it is", async () => {
    const before = h.db.tables.connection_requests.filter((r) => HELD.includes(String(r.id))).map((r) => ({ ...r }));
    expect((await run()).status).toBe(200);
    expect(h.db.tables.connection_requests.filter((r) => HELD.includes(String(r.id)))).toEqual(before);
  });

  it("logs, messages and emails nothing about a held row (no INT-005, no INT-006)", async () => {
    await run();
    const ids = (calls: unknown[][]) => calls.map(([m]) => (m as { connectionRequestId?: string; referenceId?: string }).connectionRequestId ?? (m as { referenceId?: string }).referenceId);
    expect(ids(h.log.mock.calls).filter((id) => HELD.includes(String(id)))).toEqual([]);
    expect(ids(h.inbox.mock.calls).filter((id) => HELD.includes(String(id)))).toEqual([]);
    expect(h.email.mock.calls.map(([m]) => m.to).filter((to) => /parent-[cdef]@/.test(to))).toEqual([]);
    expect(h.log.mock.calls.some(([e]) => e.eventData?.held === true)).toBe(false);
  });
});

describe("/api/cron/expire-connections — every other stale row expires and the family hears about it", () => {
  it("expires the request they sent, the accepted one and an old row with no stage, each to the lazy expiry's stage", async () => {
    await run();
    expect([stageOf("c-sent"), stageOf("c-accepted"), stageOf("c-no-stage")]).toEqual([1, 11, 1]);
    expect(h.db.tables.connection_requests.filter((r) => !HELD.includes(String(r.id))).every((r) => r.status === "expired")).toBe(true);
  });

  it("messages and emails those families, and the nanny", async () => {
    await run();
    const byParent = Object.fromEntries(toParents().map((m) => [m.userId, m.body]));
    expect(Object.keys(byParent).sort()).toEqual(["parent-a", "parent-b", "parent-g"]);
    expect(byParent["parent-a"]).toMatch(/did not respond/);
    expect(byParent["parent-b"]).toMatch(/not scheduled/);
    expect(h.email.mock.calls.map(([m]) => m.to).filter((to) => to.startsWith("parent-")).sort())
      .toEqual(["parent-a@example.test", "parent-b@example.test", "parent-g@example.test"]);
    expect(h.inbox.mock.calls.map(([m]) => m.userId).filter((u) => u === "nanny-u")).toHaveLength(3);
  });
});

describe("/api/cron/expire-connections — a row that moved on after the read", () => {
  it("sends no expiry messages for a row booked between the read and the write", async () => {
    h.db = createMemoryDb({
      nannies: [{ id: "n1", user_id: "nanny-u" }],
      parents: [{ id: "p-a", user_id: "parent-a" }],
      connection_requests: [row("c-moved", "accepted", 10, "manual", "p-a")],
    });
    const client = h.db.client() as { from: (t: string) => { update: (p: unknown) => unknown } };
    const realFrom = client.from.bind(client);
    // the family books a time after the cron's read: the row is at 20 when the cron writes
    let reads = 0;
    vi.spyOn(client, "from").mockImplementation((t: string) => {
      if (t === "connection_requests" && reads++ === 1) Object.assign(h.db.tables.connection_requests[0], { connection_stage: 20, status: "confirmed" });
      return realFrom(t) as never;
    });
    h.db.client = () => client;
    await run();
    expect(h.db.tables.connection_requests[0]).toMatchObject({ status: "confirmed", connection_stage: 20 });
    expect(h.inbox).not.toHaveBeenCalled();
    expect(h.email).not.toHaveBeenCalled();
  });
});
