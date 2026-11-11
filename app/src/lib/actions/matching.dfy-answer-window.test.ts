/**
 * Her answer to a DFY match gives the family a window to book: 72 hours at level 4 (the row goes straight to the
 * family), 7 days below it (the row waits for her approval first). The same windows as her accept of a request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb, type MemoryDb } from "../../../tests/fakes/memory-supabase";

const h = vi.hoisted(() => ({ db: null as unknown as MemoryDb }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "nanny-u" } }, error: null }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }));
vi.mock("./parent", () => ({ getParentId: async () => null, getPosition: async () => ({ data: null, error: null }) }));
vi.mock("./connection-helpers", () => ({ createInboxMessage: vi.fn(async () => {}), logConnectionEvent: vi.fn(async () => {}) }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: vi.fn(async () => ({ success: true })) }));
vi.mock("@/lib/email/helpers", () => ({ getUserEmailInfo: vi.fn(async () => ({ email: "x@example.test", firstName: "Nina", lastName: "W" })) }));
vi.mock("@/lib/position/logger", () => ({ funnelLog: vi.fn() }));
vi.mock("@/lib/chat/proactive/action-triggered", () => ({ dispatchActionTriggeredInBackground: vi.fn() }));

import { respondToDfyMatch } from "./matching";

const NOW = "2026-11-11T09:00:00.000Z";
const DAY = 86_400_000;
const SLOTS = ["2026-11-13_morning", "2026-11-13_midday", "2026-11-14_afternoon", "2026-11-15_evening", "2026-11-15_morning"];

function seed(level: number) {
  h.db = createMemoryDb({
    nannies: [{ id: "n1", user_id: "nanny-u", verification_level: level }],
    dfy_match_notifications: [{ id: "d1", position_id: "pos1", nanny_id: "n1", status: "notified" }],
    nanny_positions: [{ id: "pos1", parent_id: "p1", dfy_expires_at: "2099-01-01T00:00:00Z", suburb: "Islington", stage: 1 }],
    parents: [{ id: "p1", user_id: "parent-u" }],
    connection_requests: [],
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

describe("respondToDfyMatch — the family's window", () => {
  it.each([
    [3, 9, 7 * DAY],
    [4, 10, 3 * DAY],
  ] as const)("at level %i the row is at stage %i with %i ms to book", async (level, stage, window) => {
    seed(level);
    const result = await respondToDfyMatch("d1", SLOTS);
    expect(result.success).toBe(true);
    expect(h.db.tables.connection_requests[0]).toMatchObject({
      connection_stage: stage,
      source: "dfy",
      expires_at: new Date(Date.parse(NOW) + window).toISOString(),
    });
  });
});
