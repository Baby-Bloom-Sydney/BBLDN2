/**
 * FIXES F-1 / F-2 (BUILD-ORDER.md, BAI 2026-11-04): closing a parent account
 * - F-1 ends her active nanny placements — matched on `parent_id` (the parents row), the column the table has;
 * - F-2 writes an audit row the activity_logs CHECK accepts: `action_type` / `action_details`, `profile_deactivated`.
 *
 * BB-wave1-041126, 2026-11-04.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, writesTo, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";

const CALLER_ID = "11111111-1111-4111-8111-111111111111";
const PARENT_ROW_ID = "22222222-2222-4222-8222-222222222222";

let admin: FakeAdmin;
const signOutMock = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./connection-helpers", () => ({ createInboxMessage: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: CALLER_ID } }, error: null }),
      signOut: () => signOutMock(),
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.client }));

beforeEach(() => {
  vi.resetModules();
  signOutMock.mockReset();
  admin = fakeAdmin({ parents: { id: PARENT_ROW_ID }, parent_subscriptions: null });
});

async function closeAccount() {
  const { deactivateParentAccount } = await import("./parent");
  return deactivateParentAccount();
}

describe("deactivateParentAccount — F-1: her placements end", () => {
  it("ends active placements by parent_id, the parents row id", async () => {
    await closeAccount();
    const [end] = writesTo(admin, "nanny_placements");
    expect(end?.kind).toBe("update");
    expect(end?.payload).toMatchObject({ status: "ended" });
    expect(end?.filters).toContainEqual(["eq", "parent_id", PARENT_ROW_ID]);
    expect(end?.filters).toContainEqual(["eq", "status", "active"]);
    expect(end?.filters.some(([, col]) => col === "parent_user_id")).toBe(false);
  });

  it("skips the placements step when she has no parents row", async () => {
    admin.reads.parents = null;
    await closeAccount();
    expect(writesTo(admin, "nanny_placements")).toEqual([]);
  });
});

describe("deactivateParentAccount — F-2: the closure is audited", () => {
  it("writes action_type profile_deactivated with action_details, as the CHECK allows", async () => {
    const result = await closeAccount();
    expect(result).toEqual({ success: true, error: null });
    const [log] = writesTo(admin, "activity_logs");
    expect(log?.payload).toEqual({
      user_id: CALLER_ID,
      action_type: "profile_deactivated",
      action_details: { deactivated_by: "user", role: "parent" },
    });
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });
});
