/**
 * The lazy expiry marks, in the row's `expired` event, what the family saw of a row that ran out of time (the family's
 * lists keep those rows); a held row stays `held`, and a nanny's application gets no mark.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb, type MemoryDb } from "../../../tests/fakes/memory-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  log: vi.fn(async (_e: { eventType: string; eventData?: Record<string, unknown> }) => {}),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "parent-u" } }, error: null }) } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./parent", () => ({ getParentId: vi.fn(async () => "p1") }));
vi.mock("./connection-helpers", () => ({
  getNannyPhone: vi.fn(async () => null),
  getPositionSummary: vi.fn(async () => null),
  createInboxMessage: vi.fn(async () => {}),
  logConnectionEvent: h.log,
}));
vi.mock("@/lib/email/resend", () => ({ sendEmail: vi.fn(async () => ({ success: true })) }));
vi.mock("@/lib/email/helpers", () => ({ getUserEmailInfo: vi.fn(async () => null) }));
vi.mock("./position-funnel", () => ({ checkPostIntroOutcomes: vi.fn(async () => {}), checkPostTrialOutcomes: vi.fn(async () => {}) }));
vi.mock("@/lib/chat/proactive/action-triggered", () => ({ dispatchActionTriggeredInBackground: vi.fn() }));
vi.mock("@/lib/position/logger", () => ({ funnelLog: vi.fn() }));
vi.mock("@/lib/email/dbs-emails", () => ({ sendBarredAdminAlert: vi.fn() }));

import { getParentConnectionRequests } from "./connection";

function seed(stage: number, status: string, source: string | null) {
  h.db = createMemoryDb({
    nannies: [{ id: "n1", user_id: "nanny-u" }],
    parents: [{ id: "p1", user_id: "parent-u" }],
    nanny_positions: [{ id: "pos1", status: "active" }],
    connection_requests: [
      { id: "c1", parent_id: "p1", nanny_id: "n1", position_id: "pos1", status, connection_stage: stage, source,
        proposed_times: [], expires_at: "2020-01-01T00:00:00Z", created_at: "2019-12-25T00:00:00Z" },
    ],
    user_profiles: [],
  });
}

beforeEach(() => h.log.mockClear());

describe("the lazy expiry's mark", () => {
  it.each([
    [0, "pending", "parent", { family_saw: "request" }],
    [9, "accepted", "parent", { family_saw: "request" }],
    [10, "accepted", "parent", { family_saw: "booking" }],
    [10, "accepted", "dfy", { family_saw: "booking" }],
    [9, "accepted", "dfy", { held: true }],
    [5, "pending", null, undefined],
  ] as const)("stage %i (%s, %s) → %o", async (stage, status, source, data) => {
    seed(stage, status, source);
    await getParentConnectionRequests();
    expect(h.db.tables.connection_requests[0].status).toBe("expired");
    expect(h.log.mock.calls.map(([e]) => [e.eventType, e.eventData])).toEqual([["expired", data]]);
  });
});
