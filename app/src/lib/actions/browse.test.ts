/**
 * `fetchBrowseNannies` — the parent's browse list: a signed-in parent (or an admin) gets cards with what the screens
 * show (first name, last initial, age); anyone else gets none. The page size is capped.
 *
 * BB-wave1-041126, 2026-11-09.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";

let admin: FakeAdmin;
const h = vi.hoisted(() => ({ userId: "u-parent" as string | null }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: h.userId ? { id: h.userId } : null }, error: null }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.client }));

import { fetchBrowseNannies } from "./browse";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
  h.userId = "u-parent";
  admin = fakeAdmin({
    user_roles: (op: { filters: Array<[string, string, unknown]> }) =>
      ({ role: op.filters.some(([, , v]) => v === "u-nanny") ? "nanny" : op.filters.some(([, , v]) => v === "u-admin") ? "admin" : "parent" }),
    nannies: [{ id: "n-1", user_id: "u-1", hourly_rate_min: 18, verification_tier: "tier3", verification_level: 4, ai_content: null }],
    user_profiles: [{ user_id: "u-1", first_name: "Nina", last_name: "Walker", suburb: "Islington", profile_picture_url: null, date_of_birth: "1993-03-03" }],
    nanny_credentials: [],
  });
  admin.counts.nannies = 1;
});
afterEach(() => vi.useRealTimers());

describe("fetchBrowseNannies", () => {
  it("gives a parent cards with her first name, last initial and age — no account id, full last name or date of birth", async () => {
    const { nannies, error } = await fetchBrowseNannies(1, 10);
    expect(error).toBeNull();
    expect(nannies[0]).toMatchObject({ id: "n-1", first_name: "Nina", last_name: "W", age: 33 });
    expect(JSON.stringify(nannies)).not.toMatch(/u-1|Walker|1993-03-03/);
  });

  it("gives an admin the same cards", async () => {
    h.userId = "u-admin";
    expect((await fetchBrowseNannies(1, 10)).nannies).toHaveLength(1);
  });

  it("gives no one else anything, before reading a nanny", async () => {
    for (const who of [null, "u-nanny"]) {
      h.userId = who;
      expect(await fetchBrowseNannies(1, 10)).toEqual({ nannies: [], total: 0, error: "Not authorised" });
    }
    expect(admin.ops.some((o) => o.table === "nannies")).toBe(false);
  });

  it("caps a page at 1000", async () => {
    await fetchBrowseNannies(1, 50_000);
    const page = admin.ops.find((o) => o.table === "nannies" && o.filters.some(([f]) => f === "range"));
    expect(page?.filters).toContainEqual(["range", 0, 999]);
  });
});
