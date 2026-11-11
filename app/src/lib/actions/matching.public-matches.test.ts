/**
 * `getMatchesForPosition` (called from the parent's pages and from the browser) returns matches as the cards show
 * them — nothing only the server may hold. BB-wave1-041126, 2026-11-09.
 */
import { describe, expect, it, vi } from "vitest";
import { FULL_MATCH, PRIVATE } from "@/lib/matching/match-fixture.test-util";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("./parent", () => ({
  getParentId: async () => "p-1",
  getPosition: async () => ({ data: { id: "pos-1" }, error: null }),
}));
vi.mock("@/lib/matching/engine", () => ({ runMatchmaking: async () => ({ matches: [FULL_MATCH], totalEligible: 1 }) }));

import { getMatchesForPosition } from "./matching";

describe("getMatchesForPosition", () => {
  it("returns the match for its card, and nothing only the server may hold", async () => {
    const { data } = await getMatchesForPosition();
    expect(data?.matches[0]?.profile).toMatchObject({ first_name: "nina", last_name: "W" });
    expect(JSON.stringify(data)).not.toMatch(PRIVATE);
  });
});
