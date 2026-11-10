/**
 * Unit 3d (BB-LDN-3d-061026) — silent-hold regressions the admin Approve relies on (04-test-plan §6: G6, G7, G8, G10),
 * written green before 3d's first edit. 00-RULINGS #10: at level 3 her accept is held at stage 9, the parent sees
 * "Request Sent" and is not notified; only Approve (level 4) releases it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
vi.mock("@/lib/email/dbs-emails", () => ({ sendBarredAdminAlert: vi.fn() }));

import {
  acceptConnectionRequest, cancelConnectionRequest, declineConnectionRequest, getNannyConnectionRequests, getParentConnectionRequests,
  scheduleConnectionTime,
} from "./connection";
import { promotePendingConnections } from "@/lib/connections/silent-hold";

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const SLOTS = [`${day(2)}_morning`, `${day(2)}_midday`, `${day(3)}_afternoon`, `${day(4)}_evening`, `${day(4)}_morning`];
const FUTURE = "2099-01-01T00:00:00Z";

function seed(level: number, stage = 0, status = "pending", source = "parent") {
  h.db = createMemoryDb({
    nannies: [{ id: "n1", user_id: "nanny-u", verification_level: level, hourly_rate_min: 20 }],
    parents: [{ id: "p1", user_id: "parent-u" }],
    nanny_positions: [{ id: "pos1", status: "active" }],
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
    const sent = new Date(Date.now() - 86_400_000).toISOString();
    req().created_at = sent;
    h.user = { id: "parent-u" };
    const { data } = await getParentConnectionRequests();
    expect(data[0]).toMatchObject({ connection_stage: 0, status: "pending", proposed_times: [], responded_at: null });
    // the request's own expiry (sent + 72 hours), not the one her answer set
    expect(data[0].expires_at).toBe(new Date(Date.parse(sent) + 72 * 3_600_000).toISOString());
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
    expect(req()).toMatchObject({ status: "declined", connection_stage: 2, decline_reason: "busy" });
  });

  it("G11b the decline's log event carries no reason (the row keeps it)", async () => {
    seed(3);
    await declineConnectionRequest("c1", "Not free at weekends");
    const declined = h.log.mock.calls.map(([e]) => e).filter((e) => e.eventType === "declined");
    expect(declined).toHaveLength(1);
    expect(JSON.stringify(declined[0].eventData ?? {})).not.toMatch(/Not free at weekends|reason/);
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

  it("G13 the list's expiry leaves a row that moved on after its read (booked to 20), and tells nobody", async () => {
    seed(4, 10, "accepted");
    h.db.tables.connection_requests[0].expires_at = "2020-01-01T00:00:00Z";
    h.user = { id: "parent-u" };
    const client = h.db.client() as { from: (t: string) => unknown };
    const realFrom = client.from.bind(client);
    let reads = 0;
    // the family books a time between the expiry's read and its write
    client.from = (t: string) => {
      if (t === "connection_requests" && reads++ === 1) Object.assign(req(), { connection_stage: 20, status: "confirmed" });
      return realFrom(t);
    };
    h.db.client = () => client;
    await getParentConnectionRequests();
    expect(req()).toMatchObject({ status: "confirmed", connection_stage: 20 });
    expect(h.createInboxMessage).not.toHaveBeenCalled();
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

// A held row (stage 4: her application; stage 9: her answer, below level 4) has a 7-day window: inside it the expiry
// leaves the row and the family sees it as waiting; past it, it expires as any other row does.
describe("a held row has 7 days", () => {
  const PAST = "2020-01-01T00:00:00Z";
  const DAY = 86_400_000;
  const toParent = () => h.createInboxMessage.mock.calls.map((c) => (c as unknown as [{ userId: string; body?: string }])[0]).filter((m) => m.userId === "parent-u");
  afterEach(() => vi.useRealTimers());

  it.each([
    [3, 9, 7 * DAY],
    [4, 10, 3 * DAY],
  ] as const)("G18 her accept at level %i (stage %i) gives the family's window: %i ms", async (level, stage, window) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T09:00:00.000Z"));
    seed(level);
    await acceptConnectionRequest("c1", SLOTS);
    expect(req()).toMatchObject({ connection_stage: stage, expires_at: new Date(Date.parse("2026-11-11T09:00:00.000Z") + window).toISOString() });
  });

  it.each(["parent", "dfy"] as const)("G14 her held answer (%s) at day 4, inside its 7 days: both lists leave it, nobody is told", async (source) => {
    seed(3, 9, "accepted", source);
    Object.assign(req(), { created_at: new Date(Date.now() - 4 * DAY).toISOString(), expires_at: new Date(Date.now() + 3 * DAY).toISOString() });
    const before = { ...req() };
    h.user = { id: "parent-u" };
    await getParentConnectionRequests();
    h.user = { id: "nanny-u" };
    await getNannyConnectionRequests();
    expect(req()).toEqual(before);
    expect(h.createInboxMessage).not.toHaveBeenCalled();
    expect(h.log).not.toHaveBeenCalled();
  });

  it("G14c past its 7 days, the family's request she answered expires as the request they sent; the family and she are told", async () => {
    seed(3, 9, "accepted", "parent");
    req().expires_at = PAST;
    h.user = { id: "parent-u" };
    await getParentConnectionRequests();
    expect(req()).toMatchObject({ status: "expired", connection_stage: 1 });
    expect(toParent().map((m) => m.body)).toEqual([expect.stringMatching(/did not respond/)]);
    expect(h.createInboxMessage.mock.calls.map((c) => (c as unknown as [{ userId: string }])[0].userId)).toContain("nanny-u");
    expect(h.log.mock.calls.map(([e]) => [e.eventType, e.eventData?.held ?? false])).toEqual([["expired", false]]);
  });

  it("G14d past its 7 days, a DFY answer the family never saw expires quietly for the family (logged as held)", async () => {
    seed(3, 9, "accepted", "dfy");
    req().expires_at = PAST;
    h.user = { id: "parent-u" };
    await getParentConnectionRequests();
    expect(req()).toMatchObject({ status: "expired", connection_stage: 11 });
    expect(toParent()).toEqual([]);
    expect(h.log.mock.calls.map(([e]) => [e.eventType, e.eventData?.held ?? false])).toEqual([["expired", true]]);
  });

  it("G14e her application to a position since closed expires at its 7 days; the family never hears", async () => {
    seed(3, 4, "pending", "manual");
    h.db.tables.nanny_positions[0].status = "closed";
    req().expires_at = PAST;
    h.user = { id: "nanny-u" };
    await getNannyConnectionRequests();
    expect(req()).toMatchObject({ status: "expired", connection_stage: 1 });
    expect(toParent()).toEqual([]);
    expect(h.createInboxMessage.mock.calls.map((c) => (c as unknown as [{ userId: string }])[0].userId)).toEqual(["nanny-u"]);
    expect(h.log.mock.calls.map(([e]) => [e.eventType, e.eventData?.held ?? false])).toEqual([["expired", true]]);
  });

  it.each([
    [0, "pending", 1],
    [10, "accepted", 11],
    [null, "pending", 1],
  ] as const)("G14b a row the family saw (stage %s, %s) still expires on its time, to %i, and the family is told", async (stage, status, to) => {
    seed(4, 0, status);
    Object.assign(req(), { connection_stage: stage, expires_at: PAST });
    h.user = { id: "parent-u" };
    await getParentConnectionRequests();
    expect(req()).toMatchObject({ status: "expired", connection_stage: to });
    expect(toParent()).toHaveLength(1);
  });

  it("G15 at day 4 the family's held request reads as sent and waiting: past its own 72 hours, no time shown, never expired", async () => {
    seed(3, 9, "accepted");
    Object.assign(req(), { created_at: new Date(Date.now() - 4 * DAY).toISOString(), expires_at: new Date(Date.now() + 3 * DAY).toISOString() });
    h.user = { id: "parent-u" };
    const { data } = await getParentConnectionRequests();
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ connection_stage: 0, status: "pending", proposed_times: [], responded_at: null, expires_at: null });
    expect(req()).toMatchObject({ status: "accepted", connection_stage: 9 });
  });

  it.each([
    [9, "accepted"],
    [4, "pending"],
  ] as const)("G16 her own held row (stage %i) inside its 7 days shows its time as stored", async (stage, status) => {
    seed(3, stage, status, "manual");
    const stored = new Date(Date.now() + 3 * DAY).toISOString();
    req().expires_at = stored;
    h.user = { id: "nanny-u" };
    const { data } = await getNannyConnectionRequests();
    expect(data[0]).toMatchObject({ connection_stage: stage, status, expires_at: stored });
  });

  it("G17 at day 4 the expiry leaves it, the approve releases it with a fresh 72 hours, and the family books", async () => {
    seed(3, 9, "accepted");
    Object.assign(req(), { created_at: new Date(Date.now() - 4 * DAY).toISOString(), expires_at: new Date(Date.now() + 3 * DAY).toISOString() });
    h.user = { id: "parent-u" };
    await getParentConnectionRequests();
    expect(req()).toMatchObject({ status: "accepted", connection_stage: 9 });
    const released = Date.now();
    await promotePendingConnections(h.db.client() as never, "n1", "nanny-u");
    expect(req().connection_stage).toBe(10);
    expect(Date.parse(String(req().expires_at)) - released).toBeGreaterThanOrEqual(72 * 3_600_000 - 5_000);
    expect(Date.parse(String(req().expires_at)) - released).toBeLessThan(72 * 3_600_000 + 5_000);
    const booked = await scheduleConnectionTime("c1", day(2), 9, 0);
    expect(booked.success).toBe(true);
    expect(req().connection_stage).toBe(20);
  });

  it("G19 she is turned down without a bar (level 3 → 2): her held answer expires at its 7 days, as the request the family sent", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T09:00:00.000Z"));
    seed(3);
    await acceptConnectionRequest("c1", SLOTS);
    h.db.tables.nannies[0].verification_level = 2;
    vi.clearAllMocks();
    vi.setSystemTime(new Date("2026-11-17T09:00:00.000Z"));          // day 6: still waiting
    h.user = { id: "parent-u" };
    await getParentConnectionRequests();
    expect(req()).toMatchObject({ status: "accepted", connection_stage: 9 });
    vi.setSystemTime(new Date("2026-11-18T10:00:00.000Z"));          // past its 7 days
    await getParentConnectionRequests();
    expect(req()).toMatchObject({ status: "expired", connection_stage: 1 });
    expect(toParent().map((m) => m.body)).toEqual([expect.stringMatching(/did not respond/)]);
  });
});
