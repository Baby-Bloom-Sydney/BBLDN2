/**
 * `declineDfyConnection` passes on a DFY nanny the family's list offers (stage 10, before a meet is booked): the read
 * and the update both carry that stage, and a row that has moved on is left as it is. BB-wave1-041126, 2026-11-09.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";

let admin: FakeAdmin;
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.client }));
vi.mock("./parent", () => ({ getParentId: async () => "p-1", getPosition: async () => ({ data: null, error: null }) }));
vi.mock("./connection-helpers", async (orig) => ({ ...(await orig<object>()), logConnectionEvent: vi.fn(async () => {}) }));

import { declineDfyConnection } from "./matching";

const row = (stage: number) => ({ id: "c-1", parent_id: "p-1", nanny_id: "n-1", position_id: "pos-1", source: "dfy", connection_stage: stage });
const updates = () => admin.ops.filter((op) => op.table === "connection_requests" && op.kind === "update");

beforeEach(() => {
  admin = fakeAdmin({ connection_requests: row(10) });
  admin.writeResults.connection_requests = [{ id: "c-1" }];
});

describe("declineDfyConnection — the DFY card's Decline (stage 10)", () => {
  it("passes on an offered nanny: the update's WHERE carries stage 10", async () => {
    expect(await declineDfyConnection("c-1")).toEqual({ success: true, error: null });
    expect(updates()[0]?.filters).toEqual(expect.arrayContaining([["eq", "connection_stage", 10]]));
  });

  it.each([[9], [20], [34], [40]])("leaves a row at stage %i alone", async (stage) => {
    admin.reads.connection_requests = row(stage);
    expect((await declineDfyConnection("c-1")).success).toBe(false);
    expect(updates()).toHaveLength(0);
  });

  it("changes nothing more when the row moved on before the write (no row back)", async () => {
    admin.writeResults.connection_requests = [];
    expect((await declineDfyConnection("c-1")).success).toBe(false);
    expect(admin.ops.filter((op) => op.table === "dfy_match_notifications" && op.kind === "update")).toHaveLength(0);
  });
});
