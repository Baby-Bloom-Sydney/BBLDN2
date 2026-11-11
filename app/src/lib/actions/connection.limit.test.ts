/**
 * At 5 open requests the family's request is refused with the limit code (the modal and the assistant show the limit
 * message); below it, the request is sent. The count is the family's pending rows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb, type MemoryDb } from "../../../tests/fakes/memory-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  user: { id: "parent-u" } as { id: string } | null,
  sendEmail: vi.fn(async (_m: { to: string; subject: string; html: string }) => ({ success: true })),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Object.assign(countingClient(), { auth: { getUser: async () => ({ data: { user: h.user }, error: null }) } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./parent", () => ({ getParentId: vi.fn(async () => "p1") }));
vi.mock("./connection-helpers", () => ({
  getNannyPhone: vi.fn(async () => null),
  getPositionSummary: vi.fn(async () => null),
  createInboxMessage: vi.fn(async () => {}),
  logConnectionEvent: vi.fn(async () => {}),
}));
vi.mock("@/lib/email/resend", () => ({ sendEmail: h.sendEmail }));
vi.mock("@/lib/email/helpers", () => ({ getUserEmailInfo: vi.fn(async () => ({ email: "x@example.test", firstName: "Sophie", lastName: "Taylor" })) }));
vi.mock("./position-funnel", () => ({ checkPostIntroOutcomes: vi.fn(async () => {}), checkPostTrialOutcomes: vi.fn(async () => {}) }));
vi.mock("@/lib/chat/proactive/action-triggered", () => ({ dispatchActionTriggeredInBackground: vi.fn() }));
vi.mock("@/lib/position/logger", () => ({ funnelLog: vi.fn() }));
vi.mock("@/lib/email/dbs-emails", () => ({ sendBarredAdminAlert: vi.fn() }));

import { createConnectionRequest } from "./connection";
import { CONNECTION_ERRORS } from "./connection-errors";

/** The in-memory client, plus the head count `createConnectionRequest` reads (the fake has none): eq filters only. */
function countingClient() {
  const base = h.db.client() as { from: (t: string) => Record<string, unknown> };
  return {
    from: (table: string) => {
      const builder = base.from(table) as Record<string, (...a: unknown[]) => unknown>;
      return {
        ...builder,
        select: (cols: string, opts?: { count?: string; head?: boolean }) => {
          if (!opts?.head) return builder.select(cols);
          const filters: [string, unknown][] = [];
          const q = {
            eq: (c: string, v: unknown) => (filters.push([c, v]), q),
            then: (done: (r: { count: number; data: null; error: null }) => void) =>
              done({ count: h.db.tables[table].filter((r) => filters.every(([c, v]) => r[c] === v)).length, data: null, error: null }),
          };
          return q;
        },
      };
    },
  };
}

const pendingRow = (i: number) => ({ id: `p${i}`, parent_id: "p1", nanny_id: `x${i}`, position_id: "pos1", status: "pending", connection_stage: 0, source: "parent", proposed_times: [], expires_at: "2099-01-01T00:00:00Z", created_at: "2026-11-01T00:00:00Z" });

function seed(open: number) {
  h.db = createMemoryDb({
    nannies: [{ id: "n1", user_id: "nanny-u", verification_level: 4 }],
    parents: [{ id: "p1", user_id: "parent-u" }],
    nanny_positions: [{ id: "pos1", parent_id: "p1", status: "active", stage: 10 }],
    connection_requests: Array.from({ length: open }, (_, i) => pendingRow(i)),
    user_profiles: [],
  });
}

beforeEach(() => h.sendEmail.mockClear());

describe("the request limit", () => {
  it("refuses at 5 open requests with the limit code, and sends nothing", async () => {
    seed(5);
    const res = await createConnectionRequest("n1");
    expect(res).toEqual({ success: false, error: CONNECTION_ERRORS.AT_LIMIT });
    expect(h.db.tables.connection_requests).toHaveLength(5);
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("sends a request at 4", async () => {
    seed(4);
    expect((await createConnectionRequest("n1")).success).toBe(true);
    expect(h.db.tables.connection_requests).toHaveLength(5);
  });
});
