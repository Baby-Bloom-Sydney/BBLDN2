/**
 * /nanny/settings (server) — the Business slot (plan 06 §14.6 b3.4; acceptance A1). The page passes
 * `<BusinessSettingsLeaf />` into the client shell only when the switch is on **and** `?s=business`; otherwise the slot
 * is null, so no invoice read happens — not the session check, not a client call, not a read of her details. The
 * page's other reads are unchanged.
 * 06b-3 rework (ledger B06 §9.1 R1, R2): the profile read adds her street line and the row's version; the Business
 * leaf gets her address and that version from it (one record).
 *
 * BB-wave1-041126/06b3-build, 2026-11-07; BB-wave1-041126/06b3-rework, 2026-11-09.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";

const h = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
  getUser: vi.fn(),
  tables: [] as string[],
  selects: [] as string[],
  profileRow: null as Record<string, unknown> | null,
  homeRow: null as Record<string, unknown> | null,
  homeError: null as { message: string } | null,
  sessionTables: [] as string[],
  getNannyId: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: h.getUser },
    // her own session: only her home address row is read with it (RLS: hers only — security H1)
    from: (table: string) => {
      h.sessionTables.push(table);
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.maybeSingle = async () => (h.homeError ? { data: null, error: h.homeError } : { data: h.homeRow, error: null });
      return c;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => {
  const chain = (table: string): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    for (const f of ["eq", "order"]) c[f] = () => c;
    c.select = (columns: string) => (table === "user_profiles" && h.selects.push(columns), c);
    c.single = async () => ({ data: table === "user_profiles" ? h.profileRow : null, error: null });
    c.maybeSingle = async () => ({ data: null, error: null });
    c.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
    return c;
  };
  return { createAdminClient: () => ({ from: (t: string) => (h.tables.push(t), chain(t)), rpc: h.rpc }) };
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
  h.homeRow = null;
  h.homeError = null;
  h.sessionTables = [];
  h.props = null;
  h.tables = [];
  h.selects = [];
  h.profileRow = null;
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

  it("her address is her own home row, read with her session (never the profile's street line); Profile and the leaf get it and its version", async () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
    h.profileRow = {
      first_name: "Sophie", last_name: "Taylor", email: "s@example.test", mobile_number: "+447700900123", date_of_birth: "1995-03-12",
      suburb: "London", postcode: "N1 0AA", address_line1: "9 Left Behind", updated_at: "2027-02-15T10:00:00.111111+00:00",
    };
    h.homeRow = { line1: "1 Upper Street", town: "London", postcode: "N1 0AA", updated_at: "2027-02-15T10:00:00.333333+00:00" };
    const props = await propsFor({ s: "business" });
    expect(h.selects[0]).not.toContain("address_line");
    expect(h.sessionTables).toEqual(["nanny_home_addresses"]);
    expect(h.tables).toEqual(PAGE_TABLES);
    expect(props.profile).toMatchObject({
      address_line1: "1 Upper Street", address_line2: "", suburb: "London", postcode: "N1 0AA",
      updated_at: "2027-02-15T10:00:00.111111+00:00", address_updated_at: "2027-02-15T10:00:00.333333+00:00",
    });
    expect((props.businessSection as ReactElement<Record<string, unknown>>).props).toEqual({
      home: { line1: "1 Upper Street", line2: "", town: "London", postcode: "N1 0AA" }, homeUpdatedAt: "2027-02-15T10:00:00.333333+00:00",
    });
  });

  it("no home row: her area from her profile, as she saw it before, and no address version", async () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
    h.profileRow = { first_name: "Kateřina", last_name: "Dvořák", suburb: "London", postcode: "SW4 7AA", updated_at: "2027-02-15T10:00:00.111111+00:00" };
    const props = await propsFor({ s: "business" });
    expect(props.profile).toMatchObject({ address_line1: "", suburb: "London", postcode: "SW4 7AA", address_updated_at: null });
    expect((props.businessSection as ReactElement<Record<string, unknown>>).props).toEqual({
      home: { line1: "", line2: "", town: "London", postcode: "SW4 7AA" }, homeUpdatedAt: null,
    });
  });

  it("her home row unreadable: shown as none (her area), with no version, so a save of it is refused as stale, never overwrites", async () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
    h.profileRow = { first_name: "Sophie", last_name: "Taylor", suburb: "London", postcode: "N1 0AA", updated_at: null };
    h.homeError = { message: "boom" };
    const props = await propsFor({ s: "business" });
    expect(props.profile).toMatchObject({ address_line1: "", address_updated_at: null });
    expect((props.businessSection as ReactElement<Record<string, unknown>>).props).toMatchObject({ homeUpdatedAt: null });
  });

  it("no part of an address on file → the leaf gets none", async () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
    const props = await propsFor({ s: "business" });
    expect((props.businessSection as ReactElement<Record<string, unknown>>).props).toEqual({ home: null, homeUpdatedAt: null });
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
