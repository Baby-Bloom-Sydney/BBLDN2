/**
 * Brief 03 (plan 03 row B3, §6): the dossier reads the family's deposit panel only while DEPOSIT_LINK_ENABLED is on
 * (which needs COHORTS_ENABLED too), with an admin proof, and hands it to the header. Off → no proof asked for, no
 * deposit read, and no deposit prop (the panel exactly as today). BB-wave2-231126/03-build, 2026-11-25.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({
  proofs: 0,
  reads: [] as unknown[][],
  proof: { kind: "admin_proof", userId: "admin-1" } as object | null,
  headerProps: null as Record<string, unknown> | null,
}));
const CODE = "Ab0_-".repeat(8) + "xyz";
/** A full server read: the link's code, the payment intent id and the whole address are all in it. */
const FULL = vi.hoisted(() => ({
  ok: true,
  value: {
    parentUserId: "p1",
    today: "2027-02-03",
    state: "paid_card",
    payment: { pence: null, paidAt: "2027-02-03T09:00:00.000Z", refundedAt: null, method: "card", paymentIntentId: "pi_3Test" },
    card: null,
    bankTransfer: null,
    place: null,
    link: {
      id: "d0300000-0000-4000-8000-000000000001",
      code: "Ab0_-".repeat(8) + "xyz",
      target: "current",
      goodwillStartDate: null,
      createdAt: "2027-02-03T08:59:00.000Z",
      lastEmailedAt: "2027-02-03T09:02:00.000Z",
      lastEmailedTo: "sarah@gmail.com",
    },
    prebooking: null,
    duplicatePayments: 0,
    warnings: [],
    cohorts: { current: null, next: null, canOfferGoodwill: false },
    canTakeDeposit: false,
    canRecordBankRefund: false,
  },
}));
const PANEL = vi.hoisted(() => ({ read: null as unknown }));

function builder(table: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "returns", "not", "in"]) b[m] = () => b;
  b.maybeSingle = async () => ({ data: null, error: null });
  b.single = async () => ({ data: null, error: null });
  b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, table }).then(resolve);
  return b;
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => builder(table) }) }));
vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin: async () => ({ userId: "admin-1", error: null }) }));
vi.mock("@/lib/admin/getAdminUserData", () => ({ getAdminUserData: async () => null }));
vi.mock("@/lib/cohorts/read", () => ({ readCurrentCohortSummary: async () => ({ kind: "not_set_up" }) }));
vi.mock("@/lib/calls/admin-proof", () => ({
  proveAdmin: async () => {
    seen.proofs += 1;
    return seen.proof;
  },
}));
vi.mock("@/lib/deposit/panel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/deposit/panel")>()),
  readDepositPanel: async (...args: unknown[]) => {
    seen.reads.push(args);
    return PANEL.read;
  },
}));
vi.mock("./SubscriptionDetailHeader", () => ({ SubscriptionDetailHeader: () => null }));
vi.mock("./SubscriptionStatsGrid", () => ({ SubscriptionStatsGrid: () => null }));
vi.mock("./SubscriptionTimeline", () => ({ SubscriptionTimeline: () => null }));

beforeEach(() => {
  seen.proofs = 0;
  seen.reads = [];
  seen.proof = { kind: "admin_proof", userId: "admin-1" };
  seen.headerProps = null;
  PANEL.read = FULL;
});
afterEach(() => vi.unstubAllEnvs());

async function renderPage() {
  const { default: Page } = await import("./page");
  const tree = await Page({ params: { userId: "p1" } });
  const children = (tree as { props: { children: Array<{ props?: Record<string, unknown> } | null> } }).props.children;
  seen.headerProps = children.find((c) => c?.props && "parentIsTestUser" in c.props)?.props ?? null;
  return tree;
}

describe("admin subscription dossier — the deposit panel", () => {
  it.each([
    ["both unset", "", ""],
    ["DEPOSIT_LINK_ENABLED unset", "", "true"],
    ["COHORTS_ENABLED unset", "true", ""],
    ["DEPOSIT_LINK_ENABLED not the literal true", "yes", "true"],
  ])("off (%s): no proof, no read, no deposit prop", async (_name, deposit, cohorts) => {
    vi.stubEnv("DEPOSIT_LINK_ENABLED", deposit);
    vi.stubEnv("COHORTS_ENABLED", cohorts);
    expect(await renderPage()).toBeTruthy();
    expect(seen.proofs).toBe(0);
    expect(seen.reads).toEqual([]);
    expect(seen.headerProps?.deposit ?? null).toBeNull();
  });

  it("on: one proof, one read of this family's panel with that proof, handed to the header", async () => {
    vi.stubEnv("DEPOSIT_LINK_ENABLED", "true");
    vi.stubEnv("COHORTS_ENABLED", "true");
    await renderPage();
    expect(seen.proofs).toBe(1);
    expect(seen.reads).toHaveLength(1);
    const [proof, admin, parentUserId, now] = seen.reads[0];
    expect(proof).toBe(seen.proof);
    expect(admin).toEqual(expect.objectContaining({ from: expect.any(Function) }));
    expect(parentUserId).toBe("p1");
    expect(now).toBeInstanceOf(Date);
    expect(seen.headerProps?.deposit).toMatchObject({ ok: true, value: { parentUserId: "p1", state: "paid_card", canTakeDeposit: false } });
  });

  it("on: the header (a client component) gets no link code, no payment intent id and only the masked address (03b review M1)", async () => {
    vi.stubEnv("DEPOSIT_LINK_ENABLED", "true");
    vi.stubEnv("COHORTS_ENABLED", "true");
    await renderPage();
    const props = JSON.stringify(seen.headerProps?.deposit);
    expect(props).not.toContain(CODE);
    expect(props).not.toContain("pi_");
    expect(props).not.toContain("paymentIntentId");
    expect(props).not.toContain("sarah@gmail.com");
    expect(props).toContain("s•••@gmail.com");
  });

  it("on, a failed read: handed on as it is (the block's one line)", async () => {
    vi.stubEnv("DEPOSIT_LINK_ENABLED", "true");
    vi.stubEnv("COHORTS_ENABLED", "true");
    PANEL.read = { ok: false, status: "error" };
    await renderPage();
    expect(seen.headerProps?.deposit).toEqual({ ok: false, status: "error" });
  });

  it("on, but no admin proof: no read, and no deposit prop", async () => {
    vi.stubEnv("DEPOSIT_LINK_ENABLED", "true");
    vi.stubEnv("COHORTS_ENABLED", "true");
    seen.proof = null;
    await renderPage();
    expect(seen.proofs).toBe(1);
    expect(seen.reads).toEqual([]);
    expect(seen.headerProps?.deposit ?? null).toBeNull();
  });
});
