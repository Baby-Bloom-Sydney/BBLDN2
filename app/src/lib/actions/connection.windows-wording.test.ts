/**
 * Every connection window is 7 days, and the lines that state it say so: the request (her email), her accept and its
 * release (the family's email says the days left to book, from her offered times), and Katie's lines.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb, type MemoryDb } from "../../../tests/fakes/memory-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  user: { id: "parent-u" } as { id: string } | null,
  sendEmail: vi.fn(async (_m: { to: string; subject: string; html: string }) => ({ success: true })),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Object.assign(h.db.client() as object, { auth: { getUser: async () => ({ data: { user: h.user }, error: null }) } }),
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

import { acceptConnectionRequest, createConnectionRequest } from "./connection";
import { promotePendingConnections } from "@/lib/connections/silent-hold";
import { connectionsTriggers } from "@/lib/chat/modules/connections-triggers";

const NOW = "2026-11-11T09:00:00.000Z";
const DAY = 86_400_000;
const SLOTS = ["2026-11-13_morning", "2026-11-13_midday", "2026-11-14_afternoon", "2026-11-15_evening", "2026-11-15_morning"];
const htmlTo = () => h.sendEmail.mock.calls.map(([m]) => m.html).join("\n");

function seed(stage: number, status: string, level = 4, source = "parent") {
  h.db = createMemoryDb({
    nannies: [{ id: "n1", user_id: "nanny-u", verification_level: level }],
    parents: [{ id: "p1", user_id: "parent-u" }],
    nanny_positions: [{ id: "pos1", parent_id: "p1", status: "active", stage: 10 }],
    connection_requests: stage < 0 ? [] : [
      { id: "c1", parent_id: "p1", nanny_id: "n1", position_id: "pos1", status, connection_stage: stage, source,
        proposed_times: stage === 0 ? [] : SLOTS, expires_at: "2099-01-01T00:00:00Z", created_at: NOW },
    ],
    user_profiles: [{ user_id: "parent-u", first_name: "Pia", last_name: "Flow", suburb: "Islington" }],
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  h.sendEmail.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("the request: 7 days for her reply", () => {
  it("writes 7 days and tells her she has 7 days", async () => {
    seed(-1, "pending");
    h.user = { id: "parent-u" };
    const res = await createConnectionRequest("n1");
    expect(res.success).toBe(true);
    expect(h.db.tables.connection_requests[0].expires_at).toBe(new Date(Date.parse(NOW) + 7 * DAY).toISOString());
    expect(htmlTo()).toContain("respond within 7 days");
    expect(htmlTo()).not.toContain("3 days");
  });
});

describe("her accept and its release: the family's days to book", () => {
  it("her accept at level 4 tells the family the days left to book, from her offered times", async () => {
    seed(0, "pending");
    h.user = { id: "nanny-u" };
    expect((await acceptConnectionRequest("c1", SLOTS)).success).toBe(true);
    // her last time, 15 Nov 19:45 London, less 12 hours: 3 days 22h45m away
    expect(htmlTo()).toContain("4 days left to book your meet and greet with Sophie");
    expect(htmlTo()).not.toContain("3 days");
  });

  it("the release of her held accept tells the family the same", async () => {
    seed(9, "accepted", 3);
    h.db.tables.nannies[0].verification_level = 4;
    await promotePendingConnections(h.db.client() as never, "n1", "nanny-u");
    expect(h.db.tables.connection_requests[0]).toMatchObject({ connection_stage: 10, expires_at: new Date(Date.parse(NOW) + 7 * DAY).toISOString() });
    expect(htmlTo()).toContain("4 days left to book your meet and greet with Sophie");
    expect(htmlTo()).not.toContain("3 days");
  });

  it("escapes her name in the line", async () => {
    const helpers = await import("@/lib/email/helpers");
    vi.mocked(helpers.getUserEmailInfo).mockResolvedValue({ email: "x@example.test", firstName: "<b>Sophie</b>", lastName: "T" } as never);
    seed(0, "pending");
    h.user = { id: "nanny-u" };
    await acceptConnectionRequest("c1", SLOTS);
    expect(htmlTo()).toContain("4 days left to book your meet and greet with &lt;b&gt;Sophie&lt;/b&gt;");
    vi.mocked(helpers.getUserEmailInfo).mockResolvedValue({ email: "x@example.test", firstName: "Sophie", lastName: "Taylor" } as never);
  });

  it("leaves the line out once her times have passed", async () => {
    seed(9, "accepted", 3);
    h.db.tables.connection_requests[0].proposed_times = ["2026-11-11_morning"];
    await promotePendingConnections(h.db.client() as never, "n1", "nanny-u");
    expect(htmlTo()).not.toContain("left to book");
    expect(htmlTo()).not.toContain("3 days");
  });
});

describe("Katie's lines", () => {
  it("tell her she has 7 days, and tell the family she accepted without a countdown", () => {
    const text = JSON.stringify(connectionsTriggers);
    expect(text).toContain("You've got 7 days to respond");
    expect(text).toContain("{nanny_name} accepted! They've shared their availability — pick a time for your meet and greet.");
    expect(text).not.toContain("3 days");
  });
});
