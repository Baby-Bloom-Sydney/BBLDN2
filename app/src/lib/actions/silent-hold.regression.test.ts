/**
 * Unit 3d (BB-LDN-3d-061026) — silent-hold regressions the admin Approve relies on (04-test-plan §6: G6, G7, G8, G10),
 * written green before 3d's first edit. 00-RULINGS #10: at level 3 her accept is held at stage 9, the parent sees
 * "Request Sent" and is not notified; only Approve (level 4) releases it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMemoryDb, type MemoryDb } from "../../../tests/fakes/memory-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  user: { id: "nanny-u" } as { id: string } | null,
  parentId: "p1" as string | null,
  createInboxMessage: vi.fn(async () => {}),
  sendEmail: vi.fn(async () => ({ success: true })),
  dispatch: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: h.user }, error: h.user ? null : { message: "no" } }) } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./parent", () => ({ getParentId: vi.fn(async () => h.parentId) }));
vi.mock("./connection-helpers", () => ({
  getNannyPhone: vi.fn(async () => "+447700900123"),
  getPositionSummary: vi.fn(async () => null),
  createInboxMessage: h.createInboxMessage,
  logConnectionEvent: vi.fn(async () => {}),
}));
vi.mock("@/lib/email/resend", () => ({ sendEmail: h.sendEmail }));
vi.mock("@/lib/email/helpers", () => ({ getUserEmailInfo: vi.fn(async () => ({ email: "x@example.test", firstName: "Sophie", lastName: "Taylor" })) }));
vi.mock("./position-funnel", () => ({ checkPostIntroOutcomes: vi.fn(async () => {}), checkPostTrialOutcomes: vi.fn(async () => {}) }));
vi.mock("@/lib/chat/proactive/action-triggered", () => ({ dispatchActionTriggeredInBackground: h.dispatch }));
vi.mock("@/lib/position/logger", () => ({ funnelLog: vi.fn() }));

import { acceptConnectionRequest, getParentConnectionRequests, scheduleConnectionTime } from "./connection";

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const SLOTS = [`${day(2)}_morning`, `${day(2)}_midday`, `${day(3)}_afternoon`, `${day(4)}_evening`, `${day(4)}_morning`];
const FUTURE = "2099-01-01T00:00:00Z";

function seed(level: number, stage = 0, status = "pending") {
  h.db = createMemoryDb({
    nannies: [{ id: "n1", user_id: "nanny-u", verification_level: level, hourly_rate_min: 20 }],
    parents: [{ id: "p1", user_id: "parent-u" }],
    connection_requests: [
      { id: "c1", parent_id: "p1", nanny_id: "n1", position_id: "pos1", status, connection_stage: stage, source: "parent",
        proposed_times: SLOTS, expires_at: FUTURE, created_at: "2026-10-06T00:00:00Z" },
    ],
    user_profiles: [],
  });
}
const req = () => h.db.tables.connection_requests[0];

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { id: "nanny-u" };
  h.parentId = "p1";
});

describe("silent hold (#10)", () => {
  it("G6 a level-3 accept is held at stage 9", async () => {
    seed(3);
    expect((await acceptConnectionRequest("c1", SLOTS)).success).toBe(true);
    expect(req()).toMatchObject({ status: "accepted", connection_stage: 9 });
  });

  it("G8 no parent notification below level 4 (inbox, email, Katie)", async () => {
    seed(3);
    await acceptConnectionRequest("c1", SLOTS);
    expect(h.createInboxMessage.mock.calls.map((c) => (c as unknown as [{ userId: string }])[0].userId)).toEqual(["nanny-u"]);
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("G6 a level-4 accept goes straight to stage 10 and the parent is told", async () => {
    seed(4);
    await acceptConnectionRequest("c1", SLOTS);
    expect(req().connection_stage).toBe(10);
    expect(h.createInboxMessage).toHaveBeenCalledWith(expect.objectContaining({ userId: "parent-u", type: "connection_accepted" }));
  });

  it("G7 the parent sees a stage-9 request as Request Sent (stage 0)", async () => {
    seed(3, 9, "accepted");
    h.user = { id: "parent-u" };
    const { data } = await getParentConnectionRequests();
    expect(data).toHaveLength(1);
    expect(data[0].connection_stage).toBe(0);
  });

  // Pinned as found on main @ 9e1d67a: scheduleConnectionTime checks `status === 'accepted'` only, and a held
  // stage-9 row is already `accepted`, so a parent who calls the action directly can schedule against a held accept.
  // The parent UI never offers it (G7 remaps the row to Request Sent). Owner: hardening — listed in LEDGER/3d.md.
  it.fails("G10 later stages refuse a held stage-9 row (scheduleConnectionTime)", async () => {
    seed(3, 9, "accepted");
    h.user = { id: "parent-u" };
    const r = await scheduleConnectionTime("c1", day(2), 9, 0);
    expect(r.success).toBe(false);
    expect(req().connection_stage).toBe(9);
  });
});
