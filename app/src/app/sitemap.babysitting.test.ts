/**
 * Unit 5c (BB-LDN-5c-151026) — the sitemap skips the babysitting block while `BABYSITTING_ENABLED` is off: no
 * `babysitting_requests` query and no `/babysitting/` URL. With the flag on the old block returns.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const tables = vi.hoisted(() => [] as string[]);

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      tables.push(table);
      const rows =
        table === "babysitting_requests"
          ? [{ id: "bsr-1", updated_at: null }]
          : table === "nannies"
            ? [{ id: "nanny-1", updated_at: null }]
            : [];
      const result = Promise.resolve({ data: rows, error: null });
      const q = { select: () => q, eq: () => result };
      return q;
    },
  }),
}));

import sitemap from "./sitemap";

afterEach(() => {
  vi.unstubAllEnvs();
  tables.length = 0;
});

describe("sitemap — babysitting block", () => {
  it("off: no babysitting query, no /babysitting/ URL, the rest intact", async () => {
    vi.stubEnv("BABYSITTING_ENABLED", "");
    const urls = (await sitemap()).map((e) => e.url);
    expect(tables).not.toContain("babysitting_requests");
    expect(urls.some((u) => u.includes("/babysitting/"))).toBe(false);
    expect(urls.some((u) => u.endsWith("/nannies/nanny-1"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/pricing"))).toBe(true);
  });

  it("on: the babysitting block returns", async () => {
    vi.stubEnv("BABYSITTING_ENABLED", "true");
    const urls = (await sitemap()).map((e) => e.url);
    expect(tables).toContain("babysitting_requests");
    expect(urls.some((u) => u.endsWith("/babysitting/bsr-1"))).toBe(true);
  });
});
