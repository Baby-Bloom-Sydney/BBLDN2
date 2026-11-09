/**
 * The expiry cron follows the lazy expiry's rules (`expireStaleRequests`): the family hears about a row only when
 * their own screens showed it, and a request they sent still reads as sent when it expires.
 * BB-wave1-041126, 2026-11-09.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb, type MemoryDb } from "../../../../../tests/fakes/memory-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  inbox: vi.fn(async (_m: { userId: string; body: string }) => {}),
  email: vi.fn(async (_m: { to: string }) => ({ success: true })),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }));
vi.mock("@/lib/actions/connection-helpers", () => ({ createInboxMessage: h.inbox, logConnectionEvent: vi.fn(async () => {}) }));
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
  h.inbox.mockClear();
  h.email.mockClear();
  h.db = createMemoryDb({
    nannies: [{ id: "n1", user_id: "nanny-u" }],
    parents: ["a", "b", "c", "d", "e"].map((x) => ({ id: `p-${x}`, user_id: `parent-${x}` })),
    connection_requests: [
      row("c-sent", "pending", 0, "manual", "p-a"),        // a family's request, unanswered
      row("c-accepted", "accepted", 10, "manual", "p-b"),  // accepted, no meet booked
      row("c-held-9", "accepted", 9, "manual", "p-c"),     // a family's request, answered below level 4
      row("c-held-dfy", "accepted", 9, "dfy", "p-d"),      // a DFY answer below level 4
      row("c-held-4", "pending", 4, "manual", "p-e"),      // an application below level 4
    ],
  });
});
afterEach(() => vi.unstubAllEnvs());

const run = () => GET(new NextRequest("http://localhost/api/cron/expire-connections", { headers: { authorization: "Bearer test-secret" } }));
const stageOf = (id: string) => h.db.tables.connection_requests.find((r) => r.id === id)?.connection_stage;
const toParents = () => h.inbox.mock.calls.map(([m]) => m).filter((m) => m.userId.startsWith("parent-"));

describe("/api/cron/expire-connections — the family hears only about rows their screens showed", () => {
  it("expires every stale row, each to the lazy expiry's stage", async () => {
    expect((await run()).status).toBe(200);
    expect(h.db.tables.connection_requests.every((r) => r.status === "expired")).toBe(true);
    expect([stageOf("c-sent"), stageOf("c-accepted"), stageOf("c-held-9"), stageOf("c-held-dfy"), stageOf("c-held-4")]).toEqual([1, 11, 1, 11, 1]);
  });

  it("messages and emails the family for the request they sent, the accepted one and the answered request (as sent)", async () => {
    await run();
    const byParent = Object.fromEntries(toParents().map((m) => [m.userId, m.body]));
    expect(Object.keys(byParent).sort()).toEqual(["parent-a", "parent-b", "parent-c"]);
    expect(byParent["parent-c"]).toMatch(/did not respond/);
    expect(byParent["parent-b"]).toMatch(/not scheduled/);
    expect(h.email.mock.calls.map(([m]) => m.to).filter((to) => to.startsWith("parent-")).sort())
      .toEqual(["parent-a@example.test", "parent-b@example.test", "parent-c@example.test"]);
  });
});
