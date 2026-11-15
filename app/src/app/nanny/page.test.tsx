/**
 * `/nanny`, the hub's server page — the arrival parameters only (06b-4 rework addition, BAI 2026-11-12; ledger B06
 * "What to build" 2–3): it reads `?tab=` and `?add=` and passes `initialTab` (only "children" is honoured) and
 * `openAddChild` (true only for `add=child`) to `NannyHubClient`. Anything else, and no parameters, pass neither. The
 * reads are stubbed: this checks the two props, and that the rest of the props are as without parameters.
 *
 * BB-wave1-041126/06b4-ui, 2026-11-12.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";

const calls = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: calls.redirect }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "b0600000-0000-4000-8000-000000000001" } }, error: null }) } }),
}));
vi.mock("@/lib/supabase/admin", () => {
  /** Every query answers "no rows": a chain whose every call returns itself, and which awaits to `{ data: null }`. */
  const query: object = new Proxy({}, {
    get: (_target, key) => (key === "then" ? (resolve: (v: unknown) => void) => resolve({ data: null, error: null }) : () => query),
  });
  return { createAdminClient: () => query };
});
vi.mock("@/lib/actions/position-funnel", () => ({
  getNannyPlacements: async () => ({ data: [] }),
  getNannyUpcomingIntros: async () => ({ data: [] }),
}));
vi.mock("@/lib/actions/babysitting", () => ({ getNannyBabysittingJobs: async () => ({ data: [], banned: false, banUntil: null }) }));
vi.mock("@/lib/actions/matching", () => ({ getDfyNotificationsForNanny: async () => ({ data: [] }) }));
vi.mock("@/lib/actions/verification", () => ({ getVerificationData: async () => ({ data: null }) }));
vi.mock("@/lib/actions/bapp/child-invites", () => ({ getPendingInvitesForUser: async () => ({ data: [] }) }));
vi.mock("./NannyHubClient", () => ({ NannyHubClient: () => null }));

import NannyHubPage from "./page";

type Params = Record<string, string | string[] | undefined>;

async function hubProps(searchParams?: Params): Promise<Record<string, unknown>> {
  const page = (await NannyHubPage({ searchParams })) as ReactElement<{ children: ReactElement<Record<string, unknown>> }>;
  const client = page.props.children;
  expect(isValidElement(client)).toBe(true);
  return client.props;
}

beforeEach(() => calls.redirect.mockReset());

describe("/nanny — the arrival parameters", () => {
  it("?tab=children&add=child → initialTab children, openAddChild", async () => {
    const props = await hubProps({ tab: "children", add: "child" });
    expect(props.initialTab).toBe("children");
    expect(props.openAddChild).toBe(true);
  });

  it("only those values: another tab, another add, or a repeated parameter → neither", async () => {
    for (const params of [{ tab: "nannying", add: "children" }, { tab: "Children", add: "CHILD" }, { tab: ["children", "children"], add: ["child"] }]) {
      const props = await hubProps(params);
      expect(props.initialTab).toBeUndefined();
      expect(props.openAddChild).toBe(false);
    }
  });

  it("no parameters → neither; every other prop as with the arrival parameters", async () => {
    const plain = await hubProps();
    expect(plain.initialTab).toBeUndefined();
    expect(plain.openAddChild).toBe(false);
    const { initialTab: _tab, openAddChild: _add, ...rest } = await hubProps({ tab: "children", add: "child" });
    const { initialTab: _t, openAddChild: _a, ...plainRest } = plain;
    expect(rest).toEqual(plainRest);
    expect(calls.redirect).not.toHaveBeenCalled();
  });
});
