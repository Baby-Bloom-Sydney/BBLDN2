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
  log: vi.fn(async (_e: { eventType: string; eventData?: Record<string, unknown> }) => {}),
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
  logConnectionEvent: h.log,
}));
vi.mock("@/lib/email/resend", () => ({ sendEmail: h.sendEmail }));
vi.mock("@/lib/email/helpers", () => ({ getUserEmailInfo: vi.fn(async () => ({ email: "x@example.test", firstName: "Sophie", lastName: "Taylor" })) }));
vi.mock("./position-funnel", () => ({ checkPostIntroOutcomes: vi.fn(async () => {}), checkPostTrialOutcomes: vi.fn(async () => {}) }));
vi.mock("@/lib/chat/proactive/action-triggered", () => ({ dispatchActionTriggeredInBackground: h.dispatch }));
vi.mock("@/lib/position/logger", () => ({ funnelLog: vi.fn() }));

import {
  acceptConnectionRequest, cancelConnectionRequest, declineConnectionRequest, getParentConnectionRequests, scheduleConnectionTime,
} from "./connection";

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const SLOTS = [`${day(2)}_morning`, `${day(2)}_midday`, `${day(3)}_afternoon`, `${day(4)}_evening`, `${day(4)}_morning`];
const FUTURE = "2099-01-01T00:00:00Z";

function seed(level: number, stage = 0, status = "pending", source = "parent") {
  h.db = createMemoryDb({
    nannies: [{ id: "n1", user_id: "nanny-u", verification_level: level, hourly_rate_min: 20 }],
    parents: [{ id: "p1", user_id: "parent-u" }],
    connection_requests: [
      { id: "c1", parent_id: "p1", nanny_id: "n1", position_id: "pos1", status, connection_stage: stage, source,
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

  it("G6b the accept below level 4 is logged as held; at level 4 it isn't", async () => {
    seed(3);
    await acceptConnectionRequest("c1", SLOTS);
    seed(4);
    await acceptConnectionRequest("c1", SLOTS);
    expect(h.log.mock.calls.map(([e]) => [e.eventType, e.eventData?.held ?? false])).toEqual([["accepted", true], ["accepted", false]]);
  });

  it("G12b removing a row the family never saw is logged as held", async () => {
    seed(3, 9, "accepted", "dfy");
    h.parentId = null;
    await cancelConnectionRequest("c1");
    expect(h.log.mock.calls.map(([e]) => [e.eventType, e.eventData?.held ?? false])).toEqual([["cancelled", true]]);
  });

  it("G7b the stage-9 request reads as the request sent: still pending, no slots, no response yet", async () => {
    seed(3, 9, "accepted");
    h.user = { id: "parent-u" };
    const { data } = await getParentConnectionRequests();
    expect(data[0]).toMatchObject({ connection_stage: 0, status: "pending", proposed_times: [], responded_at: null });
    // the request's own expiry (sent + 72 hours), not the one her answer set
    expect(data[0].expires_at).toBe("2026-10-09T00:00:00.000Z");
  });

  it("G11 her own stage-4 application isn't a request to accept or decline; the family hears nothing", async () => {
    seed(3, 4, "pending", "manual");
    expect((await acceptConnectionRequest("c1", SLOTS)).success).toBe(false);
    expect((await declineConnectionRequest("c1", "busy")).success).toBe(false);
    expect(req()).toMatchObject({ status: "pending", connection_stage: 4 });
    expect(h.createInboxMessage).not.toHaveBeenCalled();
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("G11 a family's request (stage 0) is still declined as before", async () => {
    seed(3);
    expect((await declineConnectionRequest("c1", "busy")).success).toBe(true);
    expect(req()).toMatchObject({ status: "declined", connection_stage: 2 });
  });

  it("G12 removing a row the family never saw (a stage-9 DFY answer) tells the family nothing", async () => {
    seed(3, 9, "accepted", "dfy");
    h.parentId = null;
    expect((await cancelConnectionRequest("c1")).success).toBe(true);
    expect(req().status).toBe("cancelled");
    expect(h.createInboxMessage.mock.calls.map((c) => (c as unknown as [{ userId: string }])[0].userId)).not.toContain("parent-u");
  });

  it("G12 removing a request the family sent still tells the family", async () => {
    seed(3, 9, "accepted", "parent");
    h.parentId = null;
    expect((await cancelConnectionRequest("c1")).success).toBe(true);
    expect(h.createInboxMessage.mock.calls.map((c) => (c as unknown as [{ userId: string }])[0].userId)).toContain("parent-u");
  });

  it("G13 the list's expiry leaves a row that moved on after its read (released to 10), and tells nobody", async () => {
    seed(3, 9, "accepted");
    h.db.tables.connection_requests[0].expires_at = "2020-01-01T00:00:00Z";
    h.user = { id: "parent-u" };
    const client = h.db.client() as { from: (t: string) => unknown };
    const realFrom = client.from.bind(client);
    let reads = 0;
    // the release lands between the expiry's read and its write
    client.from = (t: string) => {
      if (t === "connection_requests" && reads++ === 1) Object.assign(req(), { connection_stage: 10, expires_at: FUTURE });
      return realFrom(t);
    };
    h.db.client = () => client;
    await getParentConnectionRequests();
    expect(req()).toMatchObject({ status: "accepted", connection_stage: 10 });
    expect(h.createInboxMessage).not.toHaveBeenCalled();
  });

  it("G13b the list's expiry of a row the family never saw is logged as held", async () => {
    seed(3, 9, "accepted", "dfy");
    h.db.tables.connection_requests[0].expires_at = "2020-01-01T00:00:00Z";
    h.user = { id: "parent-u" };
    await getParentConnectionRequests();
    expect(h.log.mock.calls.map(([e]) => [e.eventType, e.eventData?.held ?? false])).toEqual([["expired", true]]);
  });

  // scheduling books an accepted connection only (stage 10); a stage-9 row stays as it is until Approve releases it
  it("G10 later stages refuse a held stage-9 row (scheduleConnectionTime)", async () => {
    seed(3, 9, "accepted");
    h.user = { id: "parent-u" };
    const r = await scheduleConnectionTime("c1", day(2), 9, 0);
    expect(r.success).toBe(false);
    expect(req().connection_stage).toBe(9);
  });
});
