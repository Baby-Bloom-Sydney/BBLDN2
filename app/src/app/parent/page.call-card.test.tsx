/**
 * /parent with the call card (plan B7; brief §0.5, §6 row 4, §9.1, §9.5). Flag off: the card's loader is never called
 * and the markup is exactly today's. Flag on: her card, loaded for her session id, above ParentHubClient (which is
 * not edited); no card → today's markup.
 */
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ card: vi.fn() }));
const empty = { data: [], error: null };
vi.mock("@/lib/actions/parent", () => ({ getPosition: vi.fn(async () => ({ data: null, error: null })) }));
vi.mock("@/lib/actions/position-funnel", () => ({
  getParentPlacement: vi.fn(async () => ({ data: null })),
  getConfirmedConnections: vi.fn(async () => empty),
  getParentUpcomingIntros: vi.fn(async () => empty),
}));
vi.mock("@/lib/actions/matching", () => ({ getDfyStatus: vi.fn(async () => ({ tier: null, expiresAt: null, activated: false })) }));
vi.mock("@/lib/actions/babysitting", () => ({ getParentBabysittingRequests: vi.fn(async () => empty) }));
vi.mock("@/lib/actions/bapp/child-invites", () => ({ getPendingInvitesForUser: vi.fn(async () => empty) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "u-1" } } }) } }) }));
vi.mock("@/lib/supabase/admin", () => {
  const chain: Record<string, unknown> = {};
  for (const f of ["select", "eq"]) chain[f] = () => chain;
  chain.order = async () => empty;
  return { createAdminClient: () => ({ from: () => chain }) };
});
vi.mock("./ParentHubClient", () => ({ ParentHubClient: () => <div data-testid="hub" /> }));
vi.mock("@/lib/calls/parent-state", () => ({ loadHubCallCard: h.card }));

import ParentHubPage from "./page";

const TODAY = '<div class="mx-auto max-w-2xl space-y-3"><div data-testid="hub"></div></div>';

async function markup(): Promise<string> {
  const { container } = render(await ParentHubPage({ searchParams: {} }));
  return container.innerHTML;
}

beforeEach(() => {
  h.card.mockReset();
  h.card.mockResolvedValue({ kind: "not_booked", line: "Pick a time for your Complimentary matchmaker call" });
});
afterEach(() => vi.unstubAllEnvs());

describe("/parent and the call card", () => {
  it("flag off → the loader is never called and the markup is today's", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    expect(await markup()).toBe(TODAY);
    expect(h.card).not.toHaveBeenCalled();
  });

  it("flag off → the element tree is today's too: ParentHubClient is the wrapper's only child", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    const out = (await ParentHubPage({ searchParams: {} })) as ReactElement<{ children: ReactElement<{ babysittingRequests: unknown }> }>;
    expect(out.props.children.props.babysittingRequests).toEqual([]);
  });

  it("flag on → her card, for her session id, above ParentHubClient", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    const html = await markup();
    expect(h.card).toHaveBeenCalledWith("u-1");
    expect(html).toContain("Pick a time for your Complimentary matchmaker call");
    expect(html.indexOf("Pick a time")).toBeLessThan(html.indexOf('data-testid="hub"'));
  });

  it("flag on, no card → today's markup", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    h.card.mockResolvedValueOnce(null);
    expect(await markup()).toBe(TODAY);
  });
});
