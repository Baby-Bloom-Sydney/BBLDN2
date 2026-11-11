/**
 * `getDfyStatus` counts what the family's DFY list shows: a nanny's answer is counted once the family can see it
 * (stage 10 on), the same rows `getDfyConnections` lists. BB-wave1-041126, 2026-11-09.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, type FakeAdmin, type Op } from "@/lib/payments/fake-admin.test-util";

let admin: FakeAdmin;
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.client }));
vi.mock("./parent", () => ({ getParentId: async () => "p-1", getPosition: async () => ({ data: null, error: null }) }));
vi.mock("@/lib/matching/dfy-dispatch", async (orig) => ({ ...(await orig<object>()), processDfyWaves: vi.fn(async () => {}) }));

import { getDfyStatus } from "./matching";

const rowsAt = (op: Op) => {
  const stage = op.filters.find(([, col]) => col === "connection_stage");
  return stage && stage[0] === "eq" && stage[2] === 9 ? [{ nanny_id: "n-held" }] : [];
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
  admin = fakeAdmin({
    nanny_positions: { id: "pos-1", dfy_activated_at: "2026-11-08T00:00:00Z", dfy_expires_at: "2026-11-20T00:00:00Z", dfy_wave_sent: [1, 2, 3], dfy_tier: "standard" },
    dfy_match_notifications: [
      { nanny_id: "n-held", status: "interested" },
      { nanny_id: "n-shown", status: "interested" },
      { nanny_id: "n-quiet", status: "notified" },
    ],
    connection_requests: rowsAt,
  });
  admin.counts.connection_requests = 1;
});
afterEach(() => vi.useRealTimers());

describe("getDfyStatus — the counts match the DFY list", () => {
  it("counts an answer once the family can see it; an answer still at stage 9 isn't counted yet", async () => {
    const status = await getDfyStatus();
    expect(status).toMatchObject({ notifiedCount: 3, interestedCount: 1 });
  });

  it("the connected count leaves out stage 9 too", async () => {
    await getDfyStatus();
    const counted = admin.ops.find((op) => op.table === "connection_requests" && op.filters.some(([f, c]) => f === "not" && c === "connection_stage"));
    expect(counted?.filters).toEqual(expect.arrayContaining([["neq", "connection_stage", 9]]));
  });
});
