/**
 * 5-w3fix (W3-M4, P-23) — the admin pipeline's share and babysitting funnel cards render only while their flag is on:
 * "Nanny Profile Shares" + "Position Shares" behind `SHARE_LOOP_ENABLED`; "BSR Shares", "Babysitting Requests" +
 * "BSR Notifications" behind `BABYSITTING_ENABLED`. The queries feeding them are untouched (hide, never delete).
 * The page is rendered against an admin client whose every query returns an empty page.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";

/** Any builder chain; awaiting it yields an empty page. */
function emptyQuery(): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "then") {
          const empty = Promise.resolve({ data: [], count: 0, error: null });
          return empty.then.bind(empty);
        }
        return () => proxy;
      },
    },
  );
  return proxy;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => emptyQuery(), rpc: () => emptyQuery() }),
}));
vi.mock("@/components/analytics/PipelineTable", () => ({
  PipelineTable: ({ title }: { title: string }) => <h2>{title}</h2>,
}));
vi.mock("@/components/analytics/PipelineTabs", () => ({
  PipelineTabs: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/analytics/DateRangePicker", () => ({ DateRangePicker: () => null }));
vi.mock("@/components/analytics/FilterBar", () => ({ FilterBar: () => null }));

import AdminPipelinePage from "./page";

afterEach(() => vi.unstubAllEnvs());

const SHARE_CARDS = ["Nanny Profile Shares", "Position Shares"];
const BSR_CARDS = ["BSR Shares", "Babysitting Requests", "BSR Notifications"];

async function titles(share: boolean, babysitting: boolean): Promise<string[]> {
  vi.stubEnv("SHARE_LOOP_ENABLED", share ? "true" : "");
  vi.stubEnv("BABYSITTING_ENABLED", babysitting ? "true" : "");
  const ui = await AdminPipelinePage({ searchParams: {} });
  const { container, unmount } = render(ui);
  const out = Array.from(container.querySelectorAll("h2")).map((h) => h.textContent ?? "");
  unmount();
  return out;
}

describe("admin pipeline — hidden funnel cards", () => {
  it("both flags off (the default): none of the five cards; the other funnels still render", async () => {
    const t = await titles(false, false);
    for (const card of [...SHARE_CARDS, ...BSR_CARDS]) expect(t).not.toContain(card);
    expect(t).toContain("Nanny Connections");
    expect(t).toContain("Nanny Verification Levels");
  });

  it("share on only: the two share cards, no babysitting cards", async () => {
    const t = await titles(true, false);
    for (const card of SHARE_CARDS) expect(t).toContain(card);
    for (const card of BSR_CARDS) expect(t).not.toContain(card);
  });

  it("babysitting on only: the three babysitting cards, no share cards", async () => {
    const t = await titles(false, true);
    for (const card of BSR_CARDS) expect(t).toContain(card);
    for (const card of SHARE_CARDS) expect(t).not.toContain(card);
  });

  it("both on: all five as before", async () => {
    const t = await titles(true, true);
    for (const card of [...SHARE_CARDS, ...BSR_CARDS]) expect(t).toContain(card);
  });
});
