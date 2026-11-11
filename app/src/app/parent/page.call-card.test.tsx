/**
 * /parent with the call card (plan B7; brief §0.5, §6 row 4, §9.1, §9.5). Flag off: the card's loader is never called
 * and the markup is exactly today's. Flag on: her card, loaded for her session id, above ParentHubClient (which is
 * not edited); no card → today's markup.
 */
import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ card: vi.fn(), placement: vi.fn(), connections: vi.fn() }));
const empty = { data: [], error: null };
vi.mock("@/lib/actions/parent", () => ({ getPosition: vi.fn(async () => ({ data: { id: "pos-1" }, error: null })) }));
vi.mock("@/lib/actions/position-funnel", () => ({
  getParentPlacement: h.placement,
  getConfirmedConnections: h.connections,
  getParentUpcomingIntros: vi.fn(async () => empty),
}));
vi.mock("@/lib/actions/matching", () => ({ getDfyStatus: vi.fn(async () => ({ tier: null, expiresAt: null, activated: false })) }));
vi.mock("@/lib/actions/babysitting", () => ({ getParentBabysittingRequests: vi.fn(async () => empty) }));
vi.mock("@/lib/actions/expired-connections", () => ({
  getParentExpiredConnections: vi.fn(async () => empty),
  getParentOpenRequestCount: vi.fn(async () => 0),
}));
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
vi.mock("@/lib/calls/parent-state", () => ({ loadHubCall: h.card }));
vi.mock("@/components/calls/ChildcareCall", () => ({
  ChildcareCall: ({ card, openWith }: { card: { kind: string } | null; openWith: string | null }) => (
    <section data-card={card?.kind ?? "none"} data-open={openWith ?? "none"}>
      {card ? "Book a time" : null}
    </section>
  ),
}));

import ParentHubPage from "./page";

const TODAY = '<div class="mx-auto max-w-2xl space-y-3"><div data-testid="hub"></div></div>';

async function markup(): Promise<string> {
  const { container } = render(await ParentHubPage({ searchParams: {} }));
  return container.innerHTML;
}

beforeEach(() => {
  h.card.mockReset();
  h.card.mockResolvedValue({ card: { kind: "not_booked", afterNoAnswer: false }, offered: true });
  h.placement.mockReset();
  h.placement.mockResolvedValue({ data: null });
  h.connections.mockReset();
  h.connections.mockResolvedValue(empty);
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
    h.card.mockResolvedValueOnce({ card: null, offered: false });
    const out = (await ParentHubPage({ searchParams: {} })) as ReactElement<{ children: ReactElement<Record<string, unknown>> }>;
    expect("callCard" in out.props.children.props).toBe(false);
  });

  it("flag on → her card, for her session id, handed to ParentHubClient's call-card slot (review F4; W9: on the Childcare tab)", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    const html = await markup();
    expect(h.card).toHaveBeenCalledWith("u-1");
    expect(html).toContain('<div data-testid="hub"><section');
    expect(html).toContain("Book a time");
    const out = (await ParentHubPage({ searchParams: {} })) as ReactElement<{ children: ReactElement<Record<string, unknown>> }>;
    expect(out.props.children.props.callCard).toBeDefined();
  });

  it("flag on, no card → today's markup", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    h.card.mockResolvedValueOnce({ card: null, offered: false });
    expect(await markup()).toBe(TODAY);
  });
});

// ── 04b rework W9 (brief §0a.4): the card shows only while no nanny is hired or connected. ──
describe("/parent and the call card — only with no hired or connected nanny (W9)", () => {
  beforeEach(() => vi.stubEnv("CALL_BOOKING_ENABLED", "true"));

  const props = async () =>
    ((await ParentHubPage({ searchParams: {} })) as ReactElement<{ children: ReactElement<Record<string, unknown>> }>).props.children.props;

  it("a hired nanny (a placement) → no callCard prop", async () => {
    h.placement.mockResolvedValue({ data: { id: "pl-1", nannyName: "Amy" } });
    expect("callCard" in (await props())).toBe(false);
  });

  it("a confirmed connection → no callCard prop", async () => {
    h.connections.mockResolvedValue({ data: [{ connectionId: "c-1" }], error: null });
    expect("callCard" in (await props())).toBe(false);
  });

  it("neither → the card", async () => {
    expect((await props()).callCard).toBeDefined();
  });
});

// ── 04b rework W12 (BAI 2026-11-05): in the app the call is a popup over the Childcare tab. The hub reads `call`
//    (open | booked | gone; anything else ignored) and `at` (the time that went, for the notice). Flag off: ignored. ──
describe("/parent and the call popup's param (W12)", () => {
  const props = async (searchParams: Record<string, string>) =>
    ((await ParentHubPage({ searchParams })) as ReactElement<{ children: ReactElement<Record<string, unknown>> }>).props.children.props;
  const slot = async (searchParams: Record<string, string>) => {
    const p = await props(searchParams);
    return p.callCard as ReactElement<{ openWith: string | null; goneWhen: string | null }> | undefined;
  };

  it.each([["open"], ["booked"], ["gone"]])("call=%s opens the popup", async (mode) => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    expect((await slot({ t: "childcare", call: mode }))?.props.openWith).toBe(mode);
  });

  it("call=gone&at=<the slot> names the time for the notice, in London words", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    expect((await slot({ t: "childcare", call: "gone", at: "2027-02-09T14:00:00.000Z" }))?.props.goneWhen).toBe("Tuesday 9 February at 14:00");
    expect((await slot({ t: "childcare", call: "gone", at: "nope" }))?.props.goneWhen).toBeNull();
  });

  it("call=open&failed=1 opens the picker with 04b's failure line (TS review: only taken says 'gone')", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    const callCard = (await props({ t: "childcare", call: "open", failed: "1" })).callCard as ReactElement<{ failed: boolean }>;
    expect(callCard.props.failed).toBe(true);
    expect(((await props({ t: "childcare", call: "booked", failed: "1" })).callCard as ReactElement<{ failed: boolean }>).props.failed).toBe(false);
  });

  it("the param opens nothing for a parent the call isn't offered to (out of scope, answered, Stop calling)", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    h.card.mockResolvedValue({ card: null, offered: false });
    expect("callCard" in (await props({ t: "childcare", call: "open" }))).toBe(false);
    h.card.mockResolvedValue({ card: { kind: "booked", line: "Tue 9 Feb, 14:00", changeable: true }, offered: false });
    expect(((await props({ t: "childcare", call: "open" })).callCard as ReactElement<{ openWith: string | null }>).props.openWith).toBeNull();
  });

  it("repeated params (?call=open&call=booked) are ignored", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    const searchParams = { t: "childcare", call: ["open", "booked"] } as unknown as Record<string, string>;
    expect(((await props(searchParams)).callCard as ReactElement<{ openWith: string | null }>).props.openWith).toBeNull();
  });

  it("anything else is ignored", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    expect((await slot({ t: "childcare", call: "please" }))?.props.openWith).toBeNull();
  });

  it("the popup opens from the param even with no card to show, while the call is offered", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    h.card.mockResolvedValue({ card: null, offered: true });
    expect((await slot({ t: "childcare", call: "open" }))?.props.openWith).toBe("open");
    expect("callCard" in (await props({ t: "childcare" }))).toBe(false);
  });

  it("a hired or connected nanny → no card and no popup, whatever the param", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    h.placement.mockResolvedValue({ data: { id: "pl-1" } });
    expect("callCard" in (await props({ t: "childcare", call: "open" }))).toBe(false);
  });

  it("flag off → the param is ignored and nothing renders (today's props and markup)", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    expect("callCard" in (await props({ t: "childcare", call: "open" }))).toBe(false);
    expect(h.card).not.toHaveBeenCalled();
  });
});
