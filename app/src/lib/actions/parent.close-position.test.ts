/**
 * Closing a position cancels its connections only when the position closed is the signed-in parent's.
 *
 * BB-wave1-041126, 2026-11-09.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, writesTo, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";

const PARENT_ROW_ID = "p-1";
const POSITION_ID = "pos-1";

let admin: FakeAdmin;
let session: FakeAdmin;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./connection-helpers", () => ({ createInboxMessage: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    from: session.client.from,
    auth: { getUser: async () => ({ data: { user: { id: "u-parent" } }, error: null }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.client }));

import { closePosition } from "./parent";

beforeEach(() => {
  admin = fakeAdmin();
  session = fakeAdmin({ parents: { id: PARENT_ROW_ID } });
});

describe("closePosition", () => {
  it("closes her own position and cancels its connections", async () => {
    session.writeResults.nanny_positions = [{ id: POSITION_ID }];
    expect(await closePosition(POSITION_ID)).toEqual({ success: true, error: null });
    const [close] = writesTo(session, "nanny_positions");
    expect(close?.filters).toEqual(expect.arrayContaining([["eq", "id", POSITION_ID], ["eq", "parent_id", PARENT_ROW_ID]]));
    expect(writesTo(admin, "connection_requests")).toHaveLength(1);
  });

  it("changes nothing else when no position of hers was closed", async () => {
    session.writeResults.nanny_positions = [];
    expect(await closePosition("pos-not-hers")).toEqual({ success: false, error: "Failed to close position" });
    expect(admin.ops).toEqual([]);
  });
});
