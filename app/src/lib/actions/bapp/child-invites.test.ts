/**
 * Trimmed unit suite for the child-invite linking redesign.
 *
 * Scope discipline: 4 highest-failure-probability paths. The schema +
 * RLS + SECURITY DEFINER paths are covered by the Supabase
 * post-migration verification SQL (03b-post-migration-verify.sql) and
 * not re-tested here.
 *
 * 1. createChild rejects without guardian_permission_confirmed (AGR-14).
 * 2. connectChildInvite happy path translates RPC success to envelope.
 * 3. connectChildInvite maps SQLSTATE P0005 to "role_mismatch".
 * 4. removeNannyFromChild keeps the placement active when the
 *    (parent, nanny) pair still shares another child (06 §2 — the
 *    multi-children-per-placement edge case).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock state ────────────────────────────────────────────────────────

const state = vi.hoisted(() => ({
  authUser: { id: "user-nanny-1", email: "nanny@example.com" } as {
    id: string;
    email: string;
  } | null,
  // Per-table fixtures.
  userRoles: [] as Array<{ user_id: string; role: string }>,
  childById: null as Record<string, unknown> | null,
  userProfilesById: new Map<string, { first_name: string | null }>(),
  // Counters / capture for behaviour assertions.
  childInsertCalled: 0,
  inviteInsertCalled: 0,
  consentCalls: 0,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  rpcResponse: { data: null as unknown, error: null as unknown },
  // Captures for the parent.connected_to_child dispatch (T8).
  parentConnectedDispatches: [] as Array<Record<string, unknown>>,
  // Multi-children placement-end fixture state.
  childUpdates: [] as Array<{ id: string; nanny_user_id: null | string }>,
  childCountForPair: 0,
  placementUpdates: [] as Array<Record<string, unknown>>,
  activeForNannyCount: 0,
  activeForParentCount: 0,
  nannyRow: null as { id: string } | null,
  parentRow: null as { id: string } | null,
  activityLogs: [] as Array<Record<string, unknown>>,
  // 4c trial guard (ADR-093): what isDfyFamily answers.
  isDfy: false,
}));

vi.mock("@/lib/payments/dfy-access", () => ({
  isDfyFamily: async () => state.isDfy,
}));

beforeEach(() => {
  state.authUser = { id: "user-nanny-1", email: "nanny@example.com" };
  state.userRoles = [];
  state.childById = null;
  state.childInsertCalled = 0;
  state.inviteInsertCalled = 0;
  state.consentCalls = 0;
  state.rpcCalls = [];
  state.rpcResponse = { data: null, error: null };
  state.childUpdates = [];
  state.childCountForPair = 0;
  state.placementUpdates = [];
  state.activeForNannyCount = 0;
  state.activeForParentCount = 0;
  state.nannyRow = null;
  state.parentRow = null;
  state.activityLogs = [];
  state.userProfilesById = new Map();
  state.parentConnectedDispatches = [];
  state.isDfy = false;
  delete process.env.INVITE_LINKS_ENABLED;
});

// ── Module mocks ──────────────────────────────────────────────────────

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/legal/record-consent", () => ({
  recordConsent: vi.fn(async () => {
    state.consentCalls += 1;
    return { success: true };
  }),
}));

// Mock the proactive dispatch helpers — we want to assert the call
// shape for parent.connected_to_child without firing real triggers.
vi.mock("./child-onboarding-dispatch", () => ({
  recordCelebrationTile: vi.fn(async () => ({ ok: true })),
  dispatchChildCreated: vi.fn(),
  dispatchParentConnectedToChild: (input: Record<string, unknown>) => {
    state.parentConnectedDispatches.push(input);
  },
  isUserSubsequentChild: vi.fn(async () => false),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.authUser },
        error: state.authUser ? null : { message: "no user" },
      }),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      switch (table) {
        case "user_roles":
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data:
                    state.userRoles.find(
                      (r) => r.user_id === state.authUser?.id,
                    ) ?? null,
                  error: null,
                }),
              }),
            }),
          };
        case "child_client":
          return {
            insert: (_row: Record<string, unknown>) => {
              state.childInsertCalled += 1;
              return {
                select: () => ({
                  single: async () => ({
                    data: { id: "child-new" },
                    error: null,
                  }),
                }),
              };
            },
            select: (
              _cols?: string,
              opts?: { count?: string; head?: boolean },
            ) => {
              if (opts?.count === "exact") {
                // count-only chain used by endPlacementIfNoSharedChildren
                // and the per-side active-placement counts.
                let counter = state.childCountForPair;
                const chain: Record<string, unknown> = {
                  eq(field: string, _value: unknown) {
                    if (
                      field === "nanny_user_id" &&
                      state.activeForNannyCount > 0
                    ) {
                      counter = state.activeForNannyCount;
                    }
                    return chain;
                  },
                  then: (fn: (r: { count: number; error: null }) => unknown) =>
                    Promise.resolve(fn({ count: counter, error: null })),
                };
                return chain;
              }
              return {
                eq: () => ({
                  maybeSingle: async () => ({
                    data: state.childById,
                    error: null,
                  }),
                }),
              };
            },
            update: (patch: Record<string, unknown>) => ({
              eq: async (_col: string, id: string) => {
                state.childUpdates.push({
                  id,
                  nanny_user_id: patch.nanny_user_id as null,
                });
                return { error: null };
              },
            }),
          };
        case "child_client_events":
          return {
            insert: async () => ({ error: null }),
          };
        case "user_profiles":
          return {
            select: () => ({
              eq: (_col: string, value: string) => ({
                maybeSingle: async () => ({
                  data: state.userProfilesById.get(value) ?? null,
                  error: null,
                }),
              }),
            }),
          };
        case "child_invites":
          return {
            insert: async (_row: Record<string, unknown>) => {
              state.inviteInsertCalled += 1;
              return { error: null };
            },
          };
        case "activity_logs":
          return {
            insert: async (row: Record<string, unknown>) => {
              state.activityLogs.push(row);
              return { error: null };
            },
          };
        case "nannies":
          return {
            select: (_cols: string, opts?: { count?: string }) => {
              if (opts?.count === "exact") {
                const chain: Record<string, unknown> = {
                  eq() {
                    return chain;
                  },
                  then: (fn: (r: { count: number; error: null }) => unknown) =>
                    Promise.resolve(
                      fn({ count: state.activeForNannyCount, error: null }),
                    ),
                };
                return chain;
              }
              return {
                eq: () => ({
                  maybeSingle: async () => ({
                    data: state.nannyRow,
                    error: null,
                  }),
                }),
              };
            },
            update: () => ({
              eq: async () => ({ error: null }),
            }),
          };
        case "parents":
          return {
            select: (_cols: string, opts?: { count?: string }) => {
              if (opts?.count === "exact") {
                const chain: Record<string, unknown> = {
                  eq() {
                    return chain;
                  },
                  then: (fn: (r: { count: number; error: null }) => unknown) =>
                    Promise.resolve(
                      fn({ count: state.activeForParentCount, error: null }),
                    ),
                };
                return chain;
              }
              return {
                eq: () => ({
                  maybeSingle: async () => ({
                    data: state.parentRow,
                    error: null,
                  }),
                }),
              };
            },
            update: () => ({
              eq: async () => ({ error: null }),
            }),
          };
        case "nanny_placements":
          return {
            select: (_cols: string, opts?: { count?: string }) => {
              if (opts?.count === "exact") {
                // Disambiguate by reading the eq field path: nanny_id vs parent_id.
                let resolvedCount = 0;
                const chain: Record<string, unknown> = {
                  eq(field: string) {
                    if (field === "nanny_id") {
                      resolvedCount = state.activeForNannyCount;
                    } else if (field === "parent_id") {
                      resolvedCount = state.activeForParentCount;
                    }
                    return chain;
                  },
                  then: (fn: (r: { count: number; error: null }) => unknown) =>
                    Promise.resolve(fn({ count: resolvedCount, error: null })),
                };
                return chain;
              }
              return { eq: () => ({}) };
            },
            update: (patch: Record<string, unknown>) => ({
              eq: () => ({
                eq: () => ({
                  eq: async () => {
                    state.placementUpdates.push(patch);
                    return { error: null };
                  },
                }),
              }),
            }),
          };
        default:
          throw new Error(`unmocked table: ${table}`);
      }
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      return state.rpcResponse;
    },
  }),
}));

// ── Tests ─────────────────────────────────────────────────────────────

describe("createChild", () => {
  it("rejects when guardian_permission_confirmed is false (AGR-14)", async () => {
    state.userRoles = [{ user_id: "user-nanny-1", role: "nanny" }];
    const { createChild } = await import("./child-clients");
    const result = await createChild({
      first_name: "Test",
      date_of_birth: "2024-01-01",
      gender: null,
      guardian_permission_confirmed: false,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/guardian permission/i);
    expect(state.childInsertCalled).toBe(0);
    expect(state.inviteInsertCalled).toBe(0);
    expect(state.consentCalls).toBe(0);
  });
});

describe("connectChildInvite", () => {
  it("happy path: returns childId from RPC and revalidates", async () => {
    state.rpcResponse = {
      data: [{ child_id: "child-claimed-1" }],
      error: null,
    };
    const { connectChildInvite } = await import("./child-invites");
    const token = "ABCD-2345";
    const result = await connectChildInvite(token);
    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(result.data).toEqual({ childId: "child-claimed-1" });
    expect(state.rpcCalls).toEqual([
      {
        name: "connect_child_invite",
        args: { p_token: token, p_caller_user: "user-nanny-1" },
      },
    ]);
  });

  it("translates SQLSTATE P0005 to role_mismatch envelope", async () => {
    state.rpcResponse = {
      data: null,
      error: { code: "P0005", message: "role mismatch" },
    };
    const { connectChildInvite } = await import("./child-invites");
    const result = await connectChildInvite("ABCD-2345");
    expect(result.success).toBe(false);
    expect(result.error).toBe("role_mismatch");
    expect(result.data).toBeNull();
  });

  it("dispatches parent.connected_to_child with the parent as recipient (resolved from child row, not caller)", async () => {
    // Caller is the nanny in this test (state.authUser default), but
    // the dispatched recipient must be the PARENT — sourced from the
    // committed child_client.parent_user_id, not from user.id.
    state.rpcResponse = {
      data: [{ child_id: "child-claimed-1" }],
      error: null,
    };
    state.childById = {
      first_name: "Oliver",
      parent_user_id: "parent-99",
      nanny_user_id: "nanny-99",
    };
    state.userProfilesById.set("parent-99", { first_name: "Sarah" });
    state.userProfilesById.set("nanny-99", { first_name: "Emma" });
    const { connectChildInvite } = await import("./child-invites");
    const result = await connectChildInvite("ABCD-2345");
    expect(result.success).toBe(true);
    expect(state.parentConnectedDispatches).toHaveLength(1);
    expect(state.parentConnectedDispatches[0]).toMatchObject({
      recipientUserId: "parent-99",
      childId: "child-claimed-1",
      childFirstName: "Oliver",
      parentFirstName: "Sarah",
      nannyFirstName: "Emma",
    });
  });

  it("does NOT propagate failure to the caller when post-RPC name lookup fails (linkage already committed)", async () => {
    // RPC succeeds — but the post-claim child row has null pointers
    // (theoretically impossible). Action must still return success
    // because the linkage itself committed.
    state.rpcResponse = {
      data: [{ child_id: "child-claimed-2" }],
      error: null,
    };
    state.childById = {
      first_name: "Casey",
      parent_user_id: null,
      nanny_user_id: null,
    };
    const { connectChildInvite } = await import("./child-invites");
    const result = await connectChildInvite("ABCD-2345");
    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(state.parentConnectedDispatches).toHaveLength(0);
  });
});

describe("connectChildInvite — trial guard (4c, ADR-093)", () => {
  const linked = () => {
    state.rpcResponse = { data: [{ child_id: "child-claimed-1" }], error: null };
    state.childById = { first_name: "Oliver", parent_user_id: "parent-99", nanny_user_id: "nanny-99" };
  };

  it("a self-serve family gets the trial RPC", async () => {
    linked();
    const { connectChildInvite } = await import("./child-invites");
    expect((await connectChildInvite("ABCD-2345")).success).toBe(true);
    expect(state.rpcCalls.map((c) => c.name)).toContain("start_family_trial_if_first");
  });

  it("a done-for-you family gets no trial and no error", async () => {
    linked();
    state.isDfy = true;
    const { connectChildInvite } = await import("./child-invites");
    const result = await connectChildInvite("ABCD-2345");
    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(state.rpcCalls.map((c) => c.name)).not.toContain("start_family_trial_if_first");
  });
});

describe("removeNannyFromChild — RPC envelope", () => {
  // Post-M1: the multi-children logic, child UPDATE, placement-end, and
  // activity log all live inside the SECURITY DEFINER PG function
  // `remove_nanny_from_child`. The action is now a thin wrapper around
  // an RPC call; correctness of the multi-children behaviour is covered
  // by the migration's `04-unlink-functions.sql` body + the live
  // `04b-post-migration-verify.sql` checks. Here we only assert the
  // envelope mapping.
  it("returns success when the RPC succeeds", async () => {
    state.authUser = { id: "user-parent-1", email: "parent@example.com" };
    state.rpcResponse = { data: null, error: null };

    const { removeNannyFromChild } = await import("./child-clients");
    const result = await removeNannyFromChild("child-1");

    expect(result).toEqual({ success: true, error: null });
    expect(state.rpcCalls).toEqual([
      {
        name: "remove_nanny_from_child",
        args: { p_child_id: "child-1", p_caller_user: "user-parent-1" },
      },
    ]);
  });

  it("translates SQLSTATE P0008 to not_parent envelope", async () => {
    state.authUser = { id: "user-parent-1", email: "parent@example.com" };
    state.rpcResponse = {
      data: null,
      error: { code: "P0008", message: "not_parent" },
    };

    const { removeNannyFromChild } = await import("./child-clients");
    const result = await removeNannyFromChild("child-1");

    expect(result).toEqual({ success: false, error: "not_parent" });
  });
});

describe("nannyLeaveChild — RPC envelope", () => {
  it("translates SQLSTATE P0009 to not_nanny envelope", async () => {
    state.authUser = { id: "user-nanny-1", email: "nanny@example.com" };
    state.rpcResponse = {
      data: null,
      error: { code: "P0009", message: "not_nanny" },
    };

    const { nannyLeaveChild } = await import("./child-clients");
    const result = await nannyLeaveChild("child-1");

    expect(result).toEqual({ success: false, error: "not_nanny" });
    expect(state.rpcCalls).toEqual([
      {
        name: "nanny_leave_child",
        args: { p_child_id: "child-1", p_caller_user: "user-nanny-1" },
      },
    ]);
  });
});
