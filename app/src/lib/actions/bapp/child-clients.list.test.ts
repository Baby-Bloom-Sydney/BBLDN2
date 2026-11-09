/**
 * `getChildrenForUser` returns each child row without the old invite-email column (never shown on a screen).
 * BB-wave1-041126, 2026-11-09.
 */
import { describe, expect, it, vi } from "vitest";
import { fakeAdmin } from "@/lib/payments/fake-admin.test-util";

const admin = fakeAdmin({ child_client: [{ id: "c-1", first_name: "Ada", parent_user_id: "u-parent", nanny_user_id: "u-nanny", parent_lead_email: "family.private@example.test" }] });
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "u-nanny" } }, error: null }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.client }));

import { getChildrenForUser } from "./child-clients";

describe("getChildrenForUser", () => {
  it("returns her children without the invite-email column", async () => {
    const { data } = await getChildrenForUser();
    expect(data[0]).toMatchObject({ id: "c-1", first_name: "Ada" });
    expect(data[0]).not.toHaveProperty("parent_lead_email");
  });
});
