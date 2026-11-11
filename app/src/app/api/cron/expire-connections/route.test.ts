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
  email: vi.fn(async (_m: { to: string; html: string }) => ({ success: true })),
  log: vi.fn(async (_e: { connectionRequestId: string; eventData?: Record<string, unknown> }) => {}),
  offer: vi.fn(async (_parentUserId: string, _parentId: string) => false),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }));
vi.mock("@/lib/actions/connection-helpers", () => ({ createInboxMessage: h.inbox, logConnectionEvent: h.log }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: h.email }));
vi.mock("@/lib/email/helpers", () => ({
  getUserEmailInfo: vi.fn(async (id: string) => ({ email: `${id}@example.test`, firstName: "Sam", lastName: "Lee" })),
}));
vi.mock("@/lib/calls/expiry-offer", () => ({ callOfferForExpiredFamily: h.offer }));

import { SITE_URL } from "@/lib/constants";
import { emailFooter } from "@/lib/email/brand";
import { connectionExpiredCallOfferHtml } from "@/lib/email/templates/connection-expired-call-offer";
import { GET } from "./route";

const PAST = "2026-11-01T00:00:00Z";
const row = (id: string, status: string, stage: number, source: string, parent: string) =>
  ({ id, parent_id: parent, nanny_id: "n1", status, connection_stage: stage, source, expires_at: PAST });

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "test-secret");
  h.log.mockClear();
  h.inbox.mockClear();
  h.email.mockClear();
  h.offer.mockReset().mockResolvedValue(false);
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

  it("logs the expiry of a row the family never saw as held", async () => {
    await run();
    const held = h.log.mock.calls.filter(([e]) => e.eventData?.held === true).map(([e]) => e.connectionRequestId).sort();
    expect(held).toEqual(["c-held-4", "c-held-dfy"]);
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

describe("/api/cron/expire-connections — a row that moved on after the read", () => {
  it("sends no expiry messages for a row released or scheduled between the read and the write", async () => {
    h.db = createMemoryDb({
      nannies: [{ id: "n1", user_id: "nanny-u" }],
      parents: [{ id: "p-a", user_id: "parent-a" }],
      connection_requests: [row("c-moved", "accepted", 9, "manual", "p-a")],
    });
    const client = h.db.client() as { from: (t: string) => { update: (p: unknown) => unknown } };
    const realFrom = client.from.bind(client);
    // the release lands after the cron's read: the row is at 10 when the cron writes
    let reads = 0;
    vi.spyOn(client, "from").mockImplementation((t: string) => {
      if (t === "connection_requests" && reads++ === 1) h.db.tables.connection_requests[0].connection_stage = 10;
      return realFrom(t) as never;
    });
    h.db.client = () => client;
    await run();
    expect(h.db.tables.connection_requests[0]).toMatchObject({ status: "accepted", connection_stage: 10 });
    expect(h.inbox).not.toHaveBeenCalled();
    expect(h.email).not.toHaveBeenCalled();
  });
});

describe("/api/cron/expire-connections — a held answer inside its 7 days", () => {
  it("leaves it as it is and tells nobody (day 4: her 7 days run to day 7)", async () => {
    const ahead = new Date(Date.now() + 3 * 86_400_000).toISOString();
    h.db = createMemoryDb({
      nannies: [{ id: "n1", user_id: "nanny-u" }],
      parents: [{ id: "p-a", user_id: "parent-a" }, { id: "p-b", user_id: "parent-b" }],
      connection_requests: [
        { ...row("c-day4", "accepted", 9, "manual", "p-a"), expires_at: ahead },
        { ...row("c-day4-dfy", "accepted", 9, "dfy", "p-b"), expires_at: ahead },
      ],
    });
    const before = h.db.tables.connection_requests.map((r) => ({ ...r }));
    expect((await run()).status).toBe(200);
    expect(h.db.tables.connection_requests).toEqual(before);
    expect(h.inbox).not.toHaveBeenCalled();
    expect(h.email).not.toHaveBeenCalled();
    expect(h.log).not.toHaveBeenCalled();
  });
});

describe("/api/cron/expire-connections — the expired event records what the family saw", () => {
  it("family_saw: booking for an accepted row (10), request for a sent request or an answered one (9); held rows stay { held: true }", async () => {
    await run();
    const byRow = Object.fromEntries(h.log.mock.calls.map(([e]) => [e.connectionRequestId, e.eventData]));
    expect(byRow).toEqual({
      "c-sent": { family_saw: "request" },
      "c-accepted": { family_saw: "booking" },
      "c-held-9": { family_saw: "request" },
      "c-held-dfy": { held: true },
      "c-held-4": { held: true },
    });
  });

  it("a pending application the family saw (stage 5) records no family_saw: its event is as it was", async () => {
    h.db = createMemoryDb({
      nannies: [{ id: "n1", user_id: "nanny-u" }],
      parents: [{ id: "p-a", user_id: "parent-a" }],
      connection_requests: [row("c-applied", "pending", 5, "manual", "p-a")],
    });
    await run();
    expect(h.log).toHaveBeenCalledTimes(1);
    expect(h.log.mock.calls[0][0]).not.toHaveProperty("eventData");
  });
});

/** The family's expiry email (INT-005) exactly as it is sent without the call offer, for "Sam". */
const familyEmailWithoutOffer = () => `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#f8fafc;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;">
  <div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;padding:32px;">
    <div style="margin-bottom:24px;">
      <span style="font-size:20px;font-weight:700;"><span style="color:#0f172a;">Baby</span><span style="color:#8b5cf6;">Bloom</span></span>
    </div>
    <h1 style="font-size:22px;font-weight:700;margin:0 0 16px;">Your connection request has expired</h1>
    <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;">Hi Sam, unfortunately your connection request wasn't responded to in time and has expired.</p>
    <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;">Don't worry — there are plenty of great nannies on Baby Bloom. You can browse available nannies and send a new connection request whenever you're ready.</p>
    <div style="text-align:center;margin-top:24px;">
      <a href="${SITE_URL}/parent/browse" style="display:inline-block;background:#8b5cf6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Browse Nannies</a>
    </div>
    ${emailFooter({ terms: "client" })}
  </div>
</div>
</body></html>`;

describe("/api/cron/expire-connections — the call offer in the family's email", () => {
  const emailTo = (to: string) => h.email.mock.calls.map(([m]) => m).find((m) => m.to === to);
  const browseButton = () => `\n    <div style="text-align:center;margin-top:24px;">\n      <a href="${SITE_URL}/parent/browse"`;

  it("asks only for the families told, with their user id and parents row id", async () => {
    await run();
    expect(h.offer.mock.calls.map(([u, p]) => `${u}:${p}`).sort()).toEqual(["parent-a:p-a", "parent-b:p-b", "parent-c:p-c"]);
  });

  it("without the offer, the family's email is byte-identical to the email without it", async () => {
    await run();
    expect(emailTo("parent-a@example.test")?.html).toBe(familyEmailWithoutOffer());
  });

  it("with the offer, the block sits just above Browse Nannies and the rest is unchanged", async () => {
    h.offer.mockResolvedValue(true);
    await run();
    const html = emailTo("parent-a@example.test")?.html ?? "";
    const block = connectionExpiredCallOfferHtml();
    expect(html).toContain(block);
    expect(html.indexOf(block) + block.length).toBe(html.indexOf(browseButton()));
    expect(html.replace(block, "")).toBe(familyEmailWithoutOffer());
  });

  it("only the family it is true for gets it", async () => {
    h.offer.mockImplementation(async (userId: string) => userId === "parent-b");
    await run();
    expect(emailTo("parent-b@example.test")?.html).toContain("Complimentary matchmaker call");
    expect(emailTo("parent-a@example.test")?.html).toBe(familyEmailWithoutOffer());
  });

  it("the nanny's email (INT-006) never carries it", async () => {
    h.offer.mockResolvedValue(true);
    await run();
    const toNanny = h.email.mock.calls.map(([m]) => m).filter((m) => m.to === "nanny-u@example.test");
    expect(toNanny).toHaveLength(5);
    for (const m of toNanny) expect(m.html).not.toContain("Complimentary");
  });
});
