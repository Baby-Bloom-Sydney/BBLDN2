/**
 * Unit 4a-i (BB-LDN-4a-i-151026) — the subscription dossier's timeline reads `nanny_payouts` and the linked nanny's
 * payout activity logs. The webhook's kept commission call sites write those rows, so while `PAYOUTS_ENABLED` is off
 * neither query runs (ledger §3). Flag on → both run as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const seen = vi.hoisted(() => ({ tables: [] as string[], inFilters: [] as unknown[][] }));

function builder(table: string) {
  const result = { data: table === "child_client" ? [{ id: "c1", nanny_user_id: "n1", status: "active", created_at: "2026-10-01" }] : [], error: null };
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "returns", "not"]) b[m] = () => b;
  b.in = (col: string, values: unknown[]) => {
    seen.inFilters.push([col, values]);
    return b;
  };
  b.maybeSingle = async () => ({ data: null, error: null });
  b.single = async () => ({ data: null, error: null });
  b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return b;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      seen.tables.push(table);
      return builder(table);
    },
  }),
}));
vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin: async () => undefined }));
vi.mock("@/lib/admin/getAdminUserData", () => ({ getAdminUserData: async () => null }));
vi.mock("./SubscriptionDetailHeader", () => ({ SubscriptionDetailHeader: () => null }));
vi.mock("./SubscriptionStatsGrid", () => ({ SubscriptionStatsGrid: () => null }));
vi.mock("./SubscriptionTimeline", () => ({ SubscriptionTimeline: () => null }));

beforeEach(() => {
  seen.tables = [];
  seen.inFilters = [];
});
afterEach(() => vi.unstubAllEnvs());

const payoutLogQuery = () =>
  seen.inFilters.some(([col, values]) => col === "action_type" && (values as string[]).includes("payout_paid"));

async function renderPage() {
  const { default: Page } = await import("./page");
  return Page({ params: { userId: "p1" } });
}

describe("admin subscription dossier — payout reads", () => {
  it("skips nanny_payouts and the nanny payout-log query when off; the rest still loads", async () => {
    vi.stubEnv("PAYOUTS_ENABLED", "");
    expect(await renderPage()).toBeTruthy();
    expect(seen.tables).not.toContain("nanny_payouts");
    expect(payoutLogQuery()).toBe(false);
    expect(seen.tables).toEqual(expect.arrayContaining(["parent_subscriptions", "child_client", "refund_requests"]));
  });

  it("reads both when on", async () => {
    vi.stubEnv("PAYOUTS_ENABLED", "true");
    expect(await renderPage()).toBeTruthy();
    expect(seen.tables).toContain("nanny_payouts");
    expect(payoutLogQuery()).toBe(true);
  });
});
