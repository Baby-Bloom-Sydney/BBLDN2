/**
 * /parent with the call card (plan B7; brief §0.5, §6 row 4, §9.1, §9.5). Flag off: the card's loader is never called
 * and the markup is exactly today's. Flag on: her card, loaded for her session id, above ParentHubClient (which is
 * not edited); no card → today's markup.
 */
import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
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
vi.mock("./ParentHubClient", () => ({
  ParentHubClient: ({ callCard }: { callCard?: ReactNode }) => <div data-testid="hub">{callCard}</div>,
}));
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

  it("flag off → the element tree is today's too: ParentHubClient is the wrapper's only child, with no callCard prop", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    const out = (await ParentHubPage({ searchParams: {} })) as ReactElement<{ children: ReactElement<Record<string, unknown>> }>;
    expect(out.props.children.props.babysittingRequests).toEqual([]);
    expect("callCard" in out.props.children.props).toBe(false);
  });

  it("flag on, the card loader throwing → the hub still renders today's markup; logged by error name only (review F5)", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.card.mockRejectedValueOnce(new TypeError("fetch failed for jane@example.com"));
    expect(await markup()).toBe(TODAY);
    expect(log).toHaveBeenCalledWith("[parent/page] the call card could not be loaded", { name: "TypeError" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("jane@example.com");
    log.mockRestore();
  });

  it("flag on, no card → no callCard prop either", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    h.card.mockResolvedValueOnce(null);
    const out = (await ParentHubPage({ searchParams: {} })) as ReactElement<{ children: ReactElement<Record<string, unknown>> }>;
    expect("callCard" in out.props.children.props).toBe(false);
  });

  it("flag on → her card, for her session id, handed to ParentHubClient's call-card slot (review F4)", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    const html = await markup();
    expect(h.card).toHaveBeenCalledWith("u-1");
    expect(html).toContain('<div data-testid="hub"><div');
    expect(html).toContain("Pick a time for your Complimentary matchmaker call");
    const out = (await ParentHubPage({ searchParams: {} })) as ReactElement<{ children: ReactElement<Record<string, unknown>> }>;
    expect(out.props.children.props.callCard).toBeDefined();
  });

  it("flag on, no card → today's markup", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    h.card.mockResolvedValueOnce(null);
    expect(await markup()).toBe(TODAY);
  });
});
