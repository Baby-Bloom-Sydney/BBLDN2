/**
 * Approve releases a nanny's held rows (`promotePendingConnections`): a stage-9 accept becomes 10 with a fresh
 * 72-hour scheduling window, a stage-4 application becomes 5 with a fresh application window, and the family is
 * told — only for a row still held when the release writes it. BB-wave1-041126, 2026-11-09.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb, type MemoryDb } from "../../../tests/fakes/memory-supabase";

const h = vi.hoisted(() => ({ db: null as unknown as MemoryDb, inbox: vi.fn(async (_m: { userId: string; type: string }) => {}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }));
vi.mock("@/lib/actions/connection-helpers", () => ({ createInboxMessage: h.inbox }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: vi.fn(async () => ({ success: true })) }));
vi.mock("@/lib/email/helpers", () => ({ getUserEmailInfo: vi.fn(async () => ({ email: "x@example.test", firstName: "Nina", lastName: "W" })) }));
vi.mock("@/lib/email/dbs-emails", () => ({ sendBarredAdminAlert: vi.fn() }));

import { promotePendingConnections } from "./silent-hold";

const NOW = "2026-11-09T12:00:00.000Z";
const row = (id: string, stage: number, status: string, source = "manual") =>
  ({ id, parent_id: "p1", nanny_id: "n1", position_id: "pos1", connection_stage: stage, status, source, expires_at: "2026-11-09T13:00:00.000Z" });
const get = (id: string) => h.db.tables.connection_requests.find((r) => r.id === id);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  h.inbox.mockClear();
});
afterEach(() => vi.useRealTimers());

function seed(rows: Record<string, unknown>[]) {
  h.db = createMemoryDb({
    parents: [{ id: "p1", user_id: "parent-u" }],
    nanny_positions: [{ id: "pos1", status: "active" }],
    connection_requests: rows,
  });
}
const run = () => promotePendingConnections(h.db.client() as never, "n1", "nanny-u");

describe("promotePendingConnections — the release", () => {
  it("releases a held accept to stage 10 with a fresh 72-hour window, and tells the family", async () => {
    seed([row("c9", 9, "accepted")]);
    await run();
    expect(get("c9")).toMatchObject({ connection_stage: 10, status: "accepted", expires_at: "2026-11-12T12:00:00.000Z" });
    expect(h.inbox.mock.calls.map(([m]) => [m.userId, m.type])).toEqual([["parent-u", "connection_accepted"]]);
  });

  it("releases a held application to stage 5 and tells the family", async () => {
    seed([row("c4", 4, "pending")]);
    await run();
    expect(get("c4")).toMatchObject({ connection_stage: 5, status: "pending" });
    expect(h.inbox.mock.calls.map(([m]) => [m.userId, m.type])).toEqual([["parent-u", "new_application"]]);
  });

  // a row held longer than the family's 72 hours is released with a fresh window
  it("releases an accept held for more than 72 hours with a fresh 72-hour window", async () => {
    seed([{ ...row("c9", 9, "accepted"), expires_at: "2026-11-05T12:00:00.000Z" }]);
    await run();
    expect(get("c9")).toMatchObject({ connection_stage: 10, status: "accepted", expires_at: "2026-11-12T12:00:00.000Z" });
  });

  it("releases an application held past its 7 days with a fresh application window (as one written at level 4)", async () => {
    seed([{ ...row("c4", 4, "pending"), expires_at: "2026-11-01T12:00:00.000Z" }]);
    await run();
    expect(get("c4")).toMatchObject({ connection_stage: 5, status: "pending", expires_at: "2026-11-16T12:00:00.000Z" });
  });

  it("leaves a row that moved on between the release's read and its write, and tells nobody", async () => {
    seed([row("c9", 9, "accepted"), row("c4", 4, "pending")]);
    const client = h.db.client() as { from: (t: string) => unknown };
    const realFrom = client.from.bind(client);
    let calls = 0;
    // both reads come first; before the writes, the rows move on (an expiry, a cancel)
    client.from = (t: string) => {
      if (t === "connection_requests" && ++calls === 3) {
        Object.assign(get("c9")!, { connection_stage: 11, status: "expired" });
        Object.assign(get("c4")!, { connection_stage: 51, status: "cancelled" });
      }
      return realFrom(t);
    };
    await promotePendingConnections(client as never, "n1", "nanny-u");
    expect(get("c9")).toMatchObject({ connection_stage: 11, status: "expired" });
    expect(get("c4")).toMatchObject({ connection_stage: 51, status: "cancelled" });
    expect(h.inbox).not.toHaveBeenCalled();
  });
});
