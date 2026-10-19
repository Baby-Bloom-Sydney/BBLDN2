/**
 * Unit 5c (BB-LDN-5c-151026) — the babysitting line is hidden while `BABYSITTING_ENABLED` is off (P-23, Stage 5
 * ruling 1, N-1). The two babysitting pages render the "Coming soon." panel (not a 404, so nav links keep working),
 * the public page / OG image / Katie tile fetch / API stub answer 404, the payment page sends the parent back to the
 * panel, and the two hubs never call the babysitting getters (whose lazy expiry + reminder sweeps would run).
 * Everything is gated before any data read. With the flag on, each surface reaches its old data read.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isValidElement, type ReactElement } from "react";

const calls = vi.hoisted(() => ({ read: vi.fn(), hubProps: vi.fn() }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("next/headers", () => ({ cookies: () => ({ getAll: () => [], get: () => undefined }) }));

vi.mock("@/lib/actions/babysitting", () => {
  const read = (name: string) => async () => {
    calls.read(name);
    throw new Error(`DATA_READ:${name}`);
  };
  return {
    getParentBabysittingRequests: read("getParentBabysittingRequests"),
    getNannyBabysittingJobs: read("getNannyBabysittingJobs"),
    getPublicBsrProfile: read("getPublicBsrProfile"),
    getLondonDistricts: read("getLondonDistricts"),
  };
});

/** A Supabase-shaped stub: every call chains, awaiting yields `{ data: null, error: null }`. */
function chain(): unknown {
  const target = function () {};
  const proxy: unknown = new Proxy(target, {
    get(_t, key) {
      if (key === "then") return (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
      return () => proxy;
    },
    apply: () => proxy,
  });
  return proxy;
}
let adminFromThrows = true;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (adminFromThrows) {
        calls.read(table);
        throw new Error(`DATA_READ:${table}`);
      }
      return chain();
    },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
  }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  }),
}));

// Hub page siblings — resolved, read-free stand-ins.
vi.mock("@/lib/actions/parent", () => ({ getPosition: async () => ({ data: null, error: null }) }));
vi.mock("@/lib/actions/position-funnel", () => ({
  getParentPlacement: async () => ({ data: null }),
  getConfirmedConnections: async () => ({ data: [], error: null }),
  getParentUpcomingIntros: async () => ({ data: [] }),
  getNannyPlacements: async () => ({ data: [] }),
  getNannyUpcomingIntros: async () => ({ data: [] }),
}));
vi.mock("@/lib/actions/matching", () => ({
  getDfyStatus: async () => ({ tier: null, expiresAt: null, activated: false }),
  getDfyNotificationsForNanny: async () => ({ data: [] }),
}));
vi.mock("@/lib/actions/verification", () => ({ getVerificationData: async () => ({ data: null }) }));
vi.mock("@/lib/actions/bapp/child-invites", () => ({ getPendingInvitesForUser: async () => ({ data: [] }) }));
vi.mock("./parent/ParentHubClient", () => ({
  ParentHubClient: (props: unknown) => {
    calls.hubProps(props);
    return null;
  },
}));
vi.mock("./nanny/NannyHubClient", () => ({
  NannyHubClient: (props: unknown) => {
    calls.hubProps(props);
    return null;
  },
}));
// The pages' own clients are never rendered by these server-function calls; stub them to avoid browser imports.
vi.mock("./parent/babysitting/ParentBabysittingClient", () => ({ ParentBabysittingClient: () => null }));
vi.mock("./nanny/babysitting/NannyBabysittingClient", () => ({ NannyBabysittingClient: () => null }));
vi.mock("./parent/babysitting/[id]/payment/BsrPaymentClient", () => ({ default: () => null }));
vi.mock("./(public)/babysitting/[id]/BsrJobView", () => ({ BsrJobView: () => null }));
vi.mock("next/og", () => ({ ImageResponse: class {} }));
// Katie on, so the Katie tile fetch's 404 with the flag off is this unit's gate, not Katie's.
vi.mock("@/lib/chat/flags", () => ({ KATIE_ENABLED: true }));

import { BabysittingComingSoon } from "@/components/babysitting/BabysittingComingSoon";

beforeEach(() => {
  calls.read.mockReset();
  calls.hubProps.mockReset();
  adminFromThrows = true;
});
afterEach(() => vi.unstubAllEnvs());

const off = () => vi.stubEnv("BABYSITTING_ENABLED", "");
const on = () => vi.stubEnv("BABYSITTING_ENABLED", "true");
const PARAMS = { params: { id: "11111111-1111-1111-1111-111111111111" } };

/** Walks a server-rendered element tree and reports whether `BabysittingComingSoon` is in it. */
function containsPanel(node: unknown): boolean {
  if (!isValidElement(node)) return false;
  const el = node as ReactElement<{ children?: unknown }>;
  if (el.type === BabysittingComingSoon) return true;
  const kids = el.props.children;
  return (Array.isArray(kids) ? kids : [kids]).some(containsPanel);
}

type ServerPage = (props?: unknown) => Promise<unknown> | unknown;

describe("babysitting pages render the Coming soon panel while off", () => {
  it.each([
    ["/parent/babysitting", () => import("./parent/babysitting/page")],
    ["/nanny/babysitting", () => import("./nanny/babysitting/page")],
  ])("%s → panel, no read", async (_path, load) => {
    off();
    const { default: Page } = (await load()) as { default: ServerPage };
    const out = await Page();
    expect(containsPanel(out)).toBe(true);
    expect(calls.read).not.toHaveBeenCalled();
  });

  it.each([
    ["/parent/babysitting", () => import("./parent/babysitting/page"), "DATA_READ:getParentBabysittingRequests"],
    ["/nanny/babysitting", () => import("./nanny/babysitting/page"), "DATA_READ:getNannyBabysittingJobs"],
  ])("%s reopens with the flag on", async (_path, load, reached) => {
    on();
    const { default: Page } = (await load()) as { default: ServerPage };
    await expect(async () => Page()).rejects.toThrow(reached);
  });
});

describe("public page, OG image, Katie tile fetch, API stub → 404 while off", () => {
  it("/babysitting/[id] page → notFound() before getPublicBsrProfile", async () => {
    off();
    const mod = await import("./(public)/babysitting/[id]/page");
    await expect(async () => mod.default(PARAMS)).rejects.toThrow("NOT_FOUND");
    await expect(async () => mod.generateMetadata(PARAMS)).rejects.toThrow("NOT_FOUND");
    expect(calls.read).not.toHaveBeenCalled();
  });

  it("/babysitting/[id] reopens with the flag on", async () => {
    on();
    const mod = await import("./(public)/babysitting/[id]/page");
    await expect(async () => mod.default(PARAMS)).rejects.toThrow("DATA_READ:getPublicBsrProfile");
  });

  it.each([
    ["/api/og/babysitting/[id]", () => import("./api/og/babysitting/[id]/route")],
    ["/api/chat/bsr/[id]", () => import("./api/chat/bsr/[id]/route")],
    ["/api/babysitting", () => import("./api/babysitting/route")],
  ])("%s → 404 before any read", async (_path, load) => {
    off();
    const { GET } = (await load()) as { GET: (req: Request, ctx: unknown) => Promise<Response> };
    const res = await GET(new Request("http://localhost/x"), PARAMS);
    expect(res.status).toBe(404);
    expect(calls.read).not.toHaveBeenCalled();
  });

  it("/api/og/babysitting/[id] reopens with the flag on", async () => {
    on();
    const { GET } = await import("./api/og/babysitting/[id]/route");
    await expect(async () => GET(new Request("http://localhost/x"), PARAMS)).rejects.toThrow(
      "DATA_READ:getPublicBsrProfile",
    );
  });

  it("/api/chat/bsr/[id] reopens with the flag on (reaches its own auth check)", async () => {
    on();
    const { GET } = await import("./api/chat/bsr/[id]/route");
    const res = await GET(new Request("http://localhost/x"), PARAMS);
    expect(res.status).not.toBe(404);
  });

  it("/api/babysitting reopens with the flag on", async () => {
    on();
    const { GET } = await import("./api/babysitting/route");
    expect((await GET()).status).toBe(200);
  });
});

describe("payment page sends the parent to the panel while off", () => {
  it("redirects to /parent/babysitting before any read", async () => {
    off();
    const { default: Page } = await import("./parent/babysitting/[id]/payment/page");
    await expect(async () => Page(PARAMS)).rejects.toThrow("REDIRECT:/parent/babysitting");
    expect(calls.read).not.toHaveBeenCalled();
  });

  it("reaches its ownership read with the flag on", async () => {
    on();
    const { default: Page } = await import("./parent/babysitting/[id]/payment/page");
    await expect(async () => Page(PARAMS)).rejects.toThrow("DATA_READ:parents");
  });
});

describe("hubs never call the babysitting getters while off", () => {
  it("/parent passes an empty list and does not call getParentBabysittingRequests", async () => {
    off();
    adminFromThrows = false;
    const { default: Page } = await import("./parent/page");
    const out = (await Page({ searchParams: {} })) as ReactElement<{ children: ReactElement }>;
    expect(calls.read).not.toHaveBeenCalled();
    expect((out.props.children.props as { babysittingRequests: unknown }).babysittingRequests).toEqual([]);
  });

  it("/parent calls getParentBabysittingRequests with the flag on", async () => {
    on();
    adminFromThrows = false;
    const { default: Page } = await import("./parent/page");
    await expect(async () => Page({ searchParams: {} })).rejects.toThrow("DATA_READ:getParentBabysittingRequests");
  });

  it("/nanny passes empty jobs, not banned, and does not call getNannyBabysittingJobs", async () => {
    off();
    adminFromThrows = false;
    const { default: Page } = await import("./nanny/page");
    const out = (await Page()) as ReactElement<{ children: ReactElement<Record<string, unknown>> }>;
    const hub = out.props.children.props;
    expect(calls.read).not.toHaveBeenCalled();
    expect(hub.babysittingJobs).toEqual([]);
    expect(hub.bsrBanned).toBe(false);
    expect(hub.bsrBanUntil).toBeNull();
  });

  it("/nanny calls getNannyBabysittingJobs with the flag on", async () => {
    on();
    adminFromThrows = false;
    const { default: Page } = await import("./nanny/page");
    await expect(async () => Page()).rejects.toThrow("DATA_READ:getNannyBabysittingJobs");
  });
});
