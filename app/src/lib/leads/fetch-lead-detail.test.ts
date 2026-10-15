/**
 * fetchLeadDetail — the nanny's `abn` is not in the payload unless PAYOUTS_ENABLED (4-w5fix, W5-M2; P-23).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const NANNY = "22222222-2222-4222-8222-222222222222";

/** Every query resolves empty except the `nannies` row, which carries a tax ID. */
function recorder(table: string): unknown {
  const result =
    table === "nannies"
      ? { data: { id: "n1", user_id: NANNY, created_at: "2026-10-01T00:00:00Z", abn: "12345678901" }, error: null }
      : { data: null, error: null };
  const target: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(target, {
    get(_t, prop: string) {
      if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve(result);
      return () => proxy;
    },
  });
  return proxy;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => recorder(table),
    auth: { admin: { getUserById: async () => ({ data: { user: null }, error: null }) } },
  }),
}));

import { fetchLeadDetail } from "./fetch-lead-detail";

afterEach(() => vi.unstubAllEnvs());

describe("fetchLeadDetail — abn behind PAYOUTS_ENABLED", () => {
  it("flag off: the payload carries no tax ID", async () => {
    vi.stubEnv("PAYOUTS_ENABLED", "");
    const detail = await fetchLeadDetail(NANNY);
    expect(detail?.nanny).not.toBeNull();
    expect(detail?.nanny?.abn).toBeNull();
    expect(JSON.stringify(detail)).not.toContain("12345678901");
  });

  it("flag on: the payload carries the tax ID as before", async () => {
    vi.stubEnv("PAYOUTS_ENABLED", "true");
    const detail = await fetchLeadDetail(NANNY);
    expect(detail?.nanny?.abn).toBe("12345678901");
  });
});
