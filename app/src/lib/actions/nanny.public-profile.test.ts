/**
 * `getPublicNannyProfile` — the public (guest-reachable) nanny profile returns what its screens render: her first
 * name, the initial of her last name, her age, her area; never her account id, full last name or date of birth.
 *
 * BB-wave1-041126, 2026-11-09.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";

let admin: FakeAdmin;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ai/client", () => ({ openai: {} }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.client }));

import { getPublicNannyProfile } from "./nanny";

const NANNY_ROW = { id: "n-1", user_id: "u-1", verification_level: 4, verification_tier: "tier3", languages: ["English"], photo_1_url: null };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
  admin = fakeAdmin({
    nannies: NANNY_ROW,
    user_profiles: { first_name: "Nina", last_name: "Walker", suburb: "London", postcode: "N1 0AA", profile_picture_url: null, date_of_birth: "1990-01-15" },
    nanny_availability: null,
    nanny_credentials: [],
    nanny_images: [],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getPublicNannyProfile — only what the screens render", () => {
  it("returns her age and last initial, never her account id, full last name or date of birth", async () => {
    const { data } = await getPublicNannyProfile("n-1");
    expect(data).not.toBeNull();
    expect(data).toMatchObject({ nanny_id: "n-1", first_name: "Nina", last_initial: "W", age: 36, suburb: "London" });
    expect(Object.keys(data ?? {})).not.toEqual(expect.arrayContaining(["user_id"]));
    expect(data).not.toHaveProperty("user_id");
    expect(data).not.toHaveProperty("last_name");
    expect(data).not.toHaveProperty("date_of_birth");
    expect(JSON.stringify(data)).not.toMatch(/u-1|Walker|1990-01-15/);
  });

  it("an age it can't work out is null (no date, or one that can't be right)", async () => {
    for (const dob of [null, "2030-01-01", "not a date"]) {
      admin.reads.user_profiles = { first_name: "Nina", last_name: "", suburb: null, postcode: null, profile_picture_url: null, date_of_birth: dob };
      const { data } = await getPublicNannyProfile("n-1");
      expect(data?.age).toBeNull();
      expect(data?.last_initial).toBe("");
    }
  });

  it("not found stays not found", async () => {
    admin.reads.nannies = null;
    expect(await getPublicNannyProfile("n-404")).toEqual({ data: null, error: "Nanny not found" });
  });
});
