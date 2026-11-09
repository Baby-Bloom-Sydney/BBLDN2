import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";

let admin: FakeAdmin;
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.client }));

import { viewerIsNanny } from "./nanny-owner";

beforeEach(() => {
  admin = fakeAdmin({ nannies: { id: "n-1" } });
});

describe("viewerIsNanny", () => {
  it("is true when the viewer's own nannies row is the profile's", async () => {
    expect(await viewerIsNanny("u-1", "n-1")).toBe(true);
    expect(admin.ops[0]?.filters).toEqual([["eq", "user_id", "u-1"]]);
  });

  it("is false for anyone else, a viewer with no nannies row, or a read error", async () => {
    expect(await viewerIsNanny("u-2", "n-9")).toBe(false);
    admin.reads.nannies = null;
    expect(await viewerIsNanny("u-3", "n-1")).toBe(false);
    admin.readErrors.nannies = { message: "timeout" };
    expect(await viewerIsNanny("u-1", "n-1")).toBe(false);
  });
});
