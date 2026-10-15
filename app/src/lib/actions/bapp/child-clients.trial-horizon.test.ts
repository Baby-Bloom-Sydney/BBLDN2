/**
 * `createChildAsParent` — the trial and the access horizon after a parent links a child (LDN2 unit 4b).
 *
 * - The trial RPC runs only when `NEW_TRIALS_ENABLED` is on (card 8a, M-9) and the family is not
 *   done-for-you (ADR-093, 4c's guard — kept).
 * - After the link, the parent's upfront horizon is recomputed (ADR-084); a failure is logged and
 *   never fails the child creation.
 *
 * This action had no harness before (4c ledger §5). BB-LDN-4b-151026.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const PARENT_ID = "11111111-1111-4000-8000-111111111111";

const state = vi.hoisted(() => ({
  rpcCalls: [] as string[],
  isDfy: false,
  horizonCalls: [] as string[],
  horizonThrows: false,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/invite/flags", () => ({ invitesDisabled: () => false }));
vi.mock("@/lib/invite/mint", () => ({
  mintChildInvite: async () => ({ token: "ABCD-2345", url: "https://example.test/i/ABCD-2345" }),
}));
vi.mock("@/lib/legal/record-consent", () => ({ recordConsent: vi.fn(async () => ({ success: true })) }));
vi.mock("./child-onboarding-dispatch", () => ({
  recordCelebrationTile: vi.fn(async () => ({ ok: true })),
  dispatchChildCreated: vi.fn(),
  isUserSubsequentChild: vi.fn(async () => false),
}));
vi.mock("@/lib/payments/dfy-access", () => ({ isDfyFamily: async () => state.isDfy }));
vi.mock("@/app/api/webhooks/stripe/handlers", () => ({
  recomputeUpfrontHorizon: async (_admin: unknown, parentUserId: string) => {
    state.horizonCalls.push(parentUserId);
    if (state.horizonThrows) throw new Error("horizon boom");
    return "updated";
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: PARENT_ID, email: "p@example.test" } }, error: null }),
    },
  }),
}));

function chain(result: { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "insert"]) b[m] = () => b;
  b.maybeSingle = async () => result;
  b.single = async () => result;
  b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return b;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table === "user_roles") return chain({ data: { role: "parent" }, error: null });
      if (table === "child_client") return chain({ data: { id: "child-1" }, error: null });
      return chain({ data: null, error: null });
    },
    rpc: async (name: string) => {
      state.rpcCalls.push(name);
      return { data: true, error: null };
    },
  }),
}));

const input = {
  first_name: "Mila",
  date_of_birth: "2025-08-20",
  gender: null,
  parent_app_consent_given: true,
};

beforeEach(() => {
  state.rpcCalls = [];
  state.isDfy = false;
  state.horizonCalls = [];
  state.horizonThrows = false;
  delete process.env.NEW_TRIALS_ENABLED;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createChildAsParent — trial rules (card 8a, ADR-093)", () => {
  it("a self-serve family gets the trial RPC by default", async () => {
    const { createChildAsParent } = await import("./child-clients");
    expect((await createChildAsParent(input)).success).toBe(true);
    expect(state.rpcCalls).toEqual(["start_family_trial_if_first"]);
  });

  it("NEW_TRIALS_ENABLED=false skips the trial RPC; the child is still created", async () => {
    process.env.NEW_TRIALS_ENABLED = "false";
    const { createChildAsParent } = await import("./child-clients");
    const result = await createChildAsParent(input);
    expect(result.success).toBe(true);
    expect(state.rpcCalls).toEqual([]);
  });

  it("a done-for-you family gets no trial and no error", async () => {
    state.isDfy = true;
    const { createChildAsParent } = await import("./child-clients");
    const result = await createChildAsParent(input);
    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(state.rpcCalls).toEqual([]);
  });
});

describe("createChildAsParent — horizon recompute on link (ADR-084)", () => {
  it("recomputes the parent's upfront horizon after the child is created", async () => {
    const { createChildAsParent } = await import("./child-clients");
    expect((await createChildAsParent(input)).success).toBe(true);
    expect(state.horizonCalls).toEqual([PARENT_ID]);
  });

  it("a failed recompute is logged and never fails the child creation", async () => {
    state.horizonThrows = true;
    const { createChildAsParent } = await import("./child-clients");
    const result = await createChildAsParent(input);
    expect(result.success).toBe(true);
    expect(result.data?.id).toBe("child-1");
  });
});
