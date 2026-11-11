import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";

let admin: FakeAdmin;
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.client }));

import { isChildMember } from "./child-member";

const CHILD = { id: "c-1", parent_user_id: "u-parent", nanny_user_id: "u-nanny" };

beforeEach(() => {
  admin = fakeAdmin({ child_client: CHILD });
});

describe("isChildMember", () => {
  it("is true for the child's parent or nanny, read by the child's id", async () => {
    expect(await isChildMember("c-1", "u-parent")).toBe(true);
    expect(await isChildMember("c-1", "u-nanny")).toBe(true);
    expect(admin.ops[0]?.filters).toEqual([["eq", "id", "c-1"]]);
  });

  it("checks the given role only", async () => {
    expect(await isChildMember("c-1", "u-parent", "parent")).toBe(true);
    expect(await isChildMember("c-1", "u-nanny", "parent")).toBe(false);
    expect(await isChildMember("c-1", "u-nanny", "nanny")).toBe(true);
    expect(await isChildMember("c-1", "u-parent", "nanny")).toBe(false);
  });

  it("is false for anyone else, an unknown child or a read error", async () => {
    expect(await isChildMember("c-1", "u-other")).toBe(false);
    admin.reads.child_client = { id: "c-1", parent_user_id: null, nanny_user_id: null };
    expect(await isChildMember("c-1", "u-other")).toBe(false);
    admin.reads.child_client = null;
    expect(await isChildMember("c-1", "u-parent")).toBe(false);
    admin.reads.child_client = CHILD;
    admin.readErrors.child_client = { message: "timeout" };
    expect(await isChildMember("c-1", "u-parent")).toBe(false);
  });

  it("is false without a child id or a user id, before any read", async () => {
    expect(await isChildMember("", "u-parent")).toBe(false);
    expect(await isChildMember("c-1", "")).toBe(false);
    expect(admin.ops).toEqual([]);
  });
});
