/**
 * Brief 02 (plan 02 step 10): the dossier reads the current cohort only while COHORTS_ENABLED is "true", and hands it
 * to the header. Off → no cohort read at all, and the header gets nothing (the page is exactly as today).
 * BB-wave1-041126/02-build.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({ tables: [] as string[], summaries: 0, headerProps: null as Record<string, unknown> | null }));

function builder(table: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "returns", "not", "in"]) b[m] = () => b;
  b.maybeSingle = async () => ({ data: null, error: null });
  b.single = async () => ({ data: null, error: null });
  b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, table }).then(resolve);
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
vi.mock("@/lib/cohorts/read", () => ({
  readCurrentCohortSummary: async () => {
    seen.summaries += 1;
    return { kind: "current", view: { start: "2027-02-01", places: 5, taken: 3, beingPaid: 0, left: 2, overBy: 0 } };
  },
}));
vi.mock("./SubscriptionDetailHeader", () => ({ SubscriptionDetailHeader: () => null }));
vi.mock("./SubscriptionStatsGrid", () => ({ SubscriptionStatsGrid: () => null }));
vi.mock("./SubscriptionTimeline", () => ({ SubscriptionTimeline: () => null }));

beforeEach(() => {
  seen.tables = [];
  seen.summaries = 0;
  seen.headerProps = null;
});
afterEach(() => vi.unstubAllEnvs());

async function renderPage() {
  const { default: Page } = await import("./page");
  const tree = await Page({ params: { userId: "p1" } });
  // The header element is one of the page's children: read the props the page gave it.
  const children = (tree as { props: { children: Array<{ props?: Record<string, unknown> } | null> } }).props.children;
  seen.headerProps = children.find((c) => c?.props && "parentIsTestUser" in c.props)?.props ?? null;
  return tree;
}

describe("admin subscription dossier — the cohort line", () => {
  it("off: no cohort read, and no cohort prop for the header", async () => {
    vi.stubEnv("COHORTS_ENABLED", "");
    expect(await renderPage()).toBeTruthy();
    expect(seen.summaries).toBe(0);
    expect(seen.tables.some((t) => t.startsWith("cohort"))).toBe(false);
    expect(seen.headerProps?.cohort ?? null).toBeNull();
  });

  it("on: one read, handed to the header", async () => {
    vi.stubEnv("COHORTS_ENABLED", "true");
    await renderPage();
    expect(seen.summaries).toBe(1);
    expect(seen.headerProps?.cohort).toEqual({ kind: "current", view: { start: "2027-02-01", places: 5, taken: 3, beingPaid: 0, left: 2, overBy: 0 } });
  });
});
