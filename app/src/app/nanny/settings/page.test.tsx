/**
 * /nanny/settings (server) — the Business slot (plan 06 §14.6 b3.4; acceptance A1). The page passes
 * `<BusinessSettingsLeaf />` into the client shell only when the switch is on **and** `?s=business`; otherwise the slot
 * is null, so no invoice read happens — not the session check, not a client call, not a read of her details. The
 * page's other reads are unchanged.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";

const h = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
  getUser: vi.fn(),
  tables: [] as string[],
  getNannyId: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({ auth: { getUser: h.getUser } }) }));
vi.mock("@/lib/supabase/admin", () => {
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    for (const f of ["select", "eq", "order"]) c[f] = () => c;
    c.single = async () => ({ data: null, error: null });
    c.maybeSingle = async () => ({ data: null, error: null });
    c.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
    return c;
  };
  return { createAdminClient: () => ({ from: (t: string) => (h.tables.push(t), chain()), rpc: h.rpc }) };
});
vi.mock("@/lib/actions/connection", () => ({ getNannyId: h.getNannyId }));
vi.mock("@/lib/payments/queryPayoutsDashboard", () => ({ fetchPayoutsDashboardData: vi.fn() }));
vi.mock("@/lib/payments/queryPayoutHistory", () => ({ fetchPayoutHistory: vi.fn() }));
vi.mock("@/lib/payments/queryNannyPayoutOnboarding", () => ({ fetchPayoutOnboardingViewData: vi.fn() }));
vi.mock("./NannySettingsClient", () => ({
  NannySettingsClient: (props: Record<string, unknown>) => {
    h.props = props;
    return null;
  },
}));

import { BusinessSettingsLeaf } from "@/app/nanny/invoices/business/BusinessSettingsLeaf";
import NannySettingsPage from "./page";

const PAGE_TABLES = ["user_profiles", "nannies", "verifications", "child_client"];

/** Render the page's element tree as far as the client shell (mocked), returning the props it was given. */
async function propsFor(searchParams?: Record<string, string | string[] | undefined>): Promise<Record<string, unknown>> {
  const tree = (await NannySettingsPage({ searchParams })) as ReactElement<Record<string, unknown>>;
  const shell = tree.type as (p: Record<string, unknown>) => unknown;
  shell(tree.props);
  return h.props ?? {};
}

beforeEach(() => {
  h.props = null;
  h.tables = [];
  h.getUser.mockReset().mockResolvedValue({ data: { user: { id: "b0600000-0000-4000-8000-000000000001", email: "n@example.test" } }, error: null });
  h.getNannyId.mockReset();
  h.rpc.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("/nanny/settings — the Business slot", () => {
  it.each([
    ["", { s: "business" }],
    ["false", { s: "business" }],
    ["TRUE", { s: "business" }],
    ["1", { s: "business" }],
  ])("switch %j: no slot, even for ?s=business; no invoice read", async (flag, search) => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", flag);
    const props = await propsFor(search);
    expect(props.businessSection).toBeNull();
    expect(h.tables).toEqual(PAGE_TABLES);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.getNannyId).not.toHaveBeenCalled();
  });

  it.each([undefined, {}, { s: "profile" }, { s: ["business", "x"] }, { s: "Business" }])(
    "switch on, ?s not exactly 'business' (%j): no slot, no invoice read",
    async (search) => {
      vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
      const props = await propsFor(search);
      expect(props.businessSection).toBeNull();
      expect(h.tables).toEqual(PAGE_TABLES);
      expect(h.rpc).not.toHaveBeenCalled();
      expect(h.getNannyId).not.toHaveBeenCalled();
    },
  );

  it("switch on, ?s=business: the slot is the server leaf, not yet rendered (no read by the page itself)", async () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
    const props = await propsFor({ s: "business" });
    const slot = props.businessSection;
    expect(isValidElement(slot)).toBe(true);
    expect((slot as ReactElement).type).toBe(BusinessSettingsLeaf);
    expect(h.tables).toEqual(PAGE_TABLES);
    expect(h.getNannyId).not.toHaveBeenCalled();
  });

  it("the page's other props are unchanged", async () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
    const props = await propsFor({ s: "business" });
    expect(Object.keys(props).sort()).toEqual([
      "businessSection", "dbs", "managedChildren", "payoutHistory", "payoutOnboarding", "payoutsDashboard", "profile", "verificationLevel",
    ]);
  });

  it("no session → /login, as before", async () => {
    h.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(NannySettingsPage({ searchParams: { s: "business" } })).rejects.toThrow("REDIRECT /login");
  });
});
