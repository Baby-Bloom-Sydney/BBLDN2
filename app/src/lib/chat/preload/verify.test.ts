import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChildSummary } from "@/lib/chat/context";
import { verifyPreload, MAX_PRELOAD_AGE_SECONDS } from "./verify";
import type { PreloadedContext } from "./types";

/**
 * Per-entry verification rules per `04-data-contracts.md §5`.
 *
 * Children-array slots: bad entries dropped individually (slot
 * survives with the good ones).
 * Memory slot: all-or-nothing.
 * Other slots: whole-slot accept/drop.
 *
 * Top-level `as_of` older than MAX_PRELOAD_AGE_SECONDS → drop the
 * entire payload.
 */

const now = () => new Date().toISOString();
const past = (sec: number) => new Date(Date.now() - sec * 1000).toISOString();

const oliver: ChildSummary = {
  id: "child-oliver",
  firstName: "Oliver",
  ageMonths: 18,
  ageBracket: "12-18m",
  gender: "male",
};
const lily: ChildSummary = {
  id: "child-lily",
  firstName: "Lily",
  ageMonths: 8,
  ageBracket: "6-12m",
  gender: "female",
};

interface PlacementRow {
  id: string;
  parent_id: string;
  nanny_id: string;
  status: string;
}

/** A `connection_requests` row as the ownership check embeds it (5e): the
 *  table has `nanny_id`/`parent_id` (profile ids), so the auth user ids
 *  arrive through the `nannies` / `parents` embeds. */
interface ConnectionRow {
  id: string;
  nannies: { user_id: string };
  parents: { user_id: string };
}

const state = {
  // What the supabase mock will return for placement / connection ownership checks.
  placementByUserId: new Map<string, PlacementRow>(),
  connectionsByUserId: new Map<string, ConnectionRow[]>(),
  // What the connection ownership check asked for (5e: table + columns).
  connectionSelects: [] as string[],
  connectionError: null as Error | null,
};

beforeEach(() => {
  state.placementByUserId.clear();
  state.connectionsByUserId.clear();
  state.connectionSelects.length = 0;
  state.connectionError = null;
});

function makeSupabase(): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === "nanny_placements") {
        return {
          select: () => ({
            // .or() chain for nanny OR parent — return placement if user is on either side.
            or: (clause: string) => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: async () => {
                    // Pick whichever placement matches the user_id in the clause.
                    const m = clause.match(
                      /(?:nanny_id|parent_id)\.eq\.([^,]+)/,
                    );
                    const userId = m?.[1];
                    const p = userId
                      ? state.placementByUserId.get(userId)
                      : null;
                    return { data: p ?? null, error: null };
                  },
                }),
              }),
            }),
            eq: () => ({
              maybeSingle: async () => {
                // For look-up by id used by the placement verifier.
                return { data: null, error: null };
              },
            }),
          }),
        };
      }
      // 5e: only the real table answers — `interview_requests` does not
      // exist in the London schema, so any other name throws "unmocked".
      if (table === "connection_requests") {
        return {
          select: (columns: string) => {
            state.connectionSelects.push(columns);
            return {
            eq: (_col: string, value: string) => ({
              maybeSingle: async () => {
                if (state.connectionError) throw state.connectionError;
                // Walk every user's connections looking for a match by id.
                for (const conns of state.connectionsByUserId.values()) {
                  const hit = conns.find((c) => c.id === value);
                  if (hit) return { data: hit, error: null };
                }
                return { data: null, error: null };
              },
            }),
            };
          },
        };
      }
      throw new Error(`unmocked table: ${table}`);
    },
  } as unknown as SupabaseClient;
}

describe("verifyPreload", () => {
  it("empty preload → empty accepted + empty dropped", async () => {
    const out = await verifyPreload({
      preload: undefined,
      userId: "00000000-0000-4000-8000-000000000001",
      role: "nanny",
      childrenScope: [oliver, lily],
      supabase: makeSupabase(),
    });
    expect(Object.keys(out.accepted)).toEqual([]);
    expect(out.dropped).toEqual([]);
  });

  it("as_of older than MAX_PRELOAD_AGE_SECONDS → drops ALL slots", async () => {
    const tooOld = past(MAX_PRELOAD_AGE_SECONDS + 5);
    const preload: PreloadedContext = {
      as_of: tooOld,
      children_profiles: [
        {
          child_id: oliver.id,
          profile: {
            id: oliver.id,
            first_name: oliver.firstName,
            date_of_birth: "2024-11-08",
            gender: "male",
            under_three: true,
            status: "created_manual",
          },
        },
      ],
      my_profile_basics: {
        first_name: "Test",
        last_name: null,
        role: "nanny",
      },
    };
    const out = await verifyPreload({
      preload,
      userId: "00000000-0000-4000-8000-000000000001",
      role: "nanny",
      childrenScope: [oliver, lily],
      supabase: makeSupabase(),
    });
    expect(Object.keys(out.accepted)).toEqual([]);
    // Every input slot appears in dropped with reason "as_of_too_old"
    const reasons = out.dropped.map((d) => d.reason);
    expect(reasons.every((r) => r === "as_of_too_old")).toBe(true);
    expect(out.dropped.length).toBeGreaterThanOrEqual(2);
  });

  it("children_profiles — all in-scope entries accepted", async () => {
    const preload: PreloadedContext = {
      as_of: now(),
      children_profiles: [
        {
          child_id: oliver.id,
          profile: {
            id: oliver.id,
            first_name: oliver.firstName,
            date_of_birth: "2024-11-08",
            gender: "male",
            under_three: true,
            status: "created_manual",
          },
        },
        {
          child_id: lily.id,
          profile: {
            id: lily.id,
            first_name: lily.firstName,
            date_of_birth: "2025-09-08",
            gender: "female",
            under_three: true,
            status: "created_manual",
          },
        },
      ],
    };
    const out = await verifyPreload({
      preload,
      userId: "00000000-0000-4000-8000-000000000001",
      role: "nanny",
      childrenScope: [oliver, lily],
      supabase: makeSupabase(),
    });
    expect(out.accepted.children_profiles).toHaveLength(2);
    expect(out.dropped).toEqual([]);
  });

  it("children_profiles — out-of-scope entry dropped per-entry, others survive", async () => {
    const preload: PreloadedContext = {
      as_of: now(),
      children_profiles: [
        {
          child_id: oliver.id,
          profile: {
            id: oliver.id,
            first_name: oliver.firstName,
            date_of_birth: "2024-11-08",
            gender: "male",
            under_three: true,
            status: "created_manual",
          },
        },
        {
          child_id: "child-not-mine",
          profile: {
            id: "child-not-mine",
            first_name: "Other",
            date_of_birth: "2024-01-01",
            gender: null,
            under_three: true,
            status: "created_manual",
          },
        },
      ],
    };
    const out = await verifyPreload({
      preload,
      userId: "00000000-0000-4000-8000-000000000001",
      role: "nanny",
      childrenScope: [oliver],
      supabase: makeSupabase(),
    });
    expect(out.accepted.children_profiles).toHaveLength(1);
    expect(out.accepted.children_profiles?.[0].child_id).toBe(oliver.id);
    expect(out.dropped).toHaveLength(1);
    const drop0 = out.dropped[0];
    expect(drop0.slot).toBe("children_profiles");
    expect(drop0.reason).toBe("child_not_in_user_scope");
    if (
      drop0.slot === "children_profiles" ||
      drop0.slot === "children_recent_feeds"
    ) {
      expect(drop0.child_id).toBe("child-not-mine");
    } else {
      throw new Error(`expected array-slot drop, got ${drop0.slot}`);
    }
  });

  it("children_profiles — every entry invalid → slot omitted from accepted", async () => {
    const preload: PreloadedContext = {
      as_of: now(),
      children_profiles: [
        {
          child_id: "ghost-1",
          profile: {
            id: "ghost-1",
            first_name: "Ghost1",
            date_of_birth: "2024-01-01",
            gender: null,
            under_three: true,
            status: "created_manual",
          },
        },
      ],
    };
    const out = await verifyPreload({
      preload,
      userId: "00000000-0000-4000-8000-000000000001",
      role: "nanny",
      childrenScope: [oliver],
      supabase: makeSupabase(),
    });
    expect(out.accepted.children_profiles).toBeUndefined();
    expect(out.dropped).toHaveLength(1);
  });

  it("children_recent_feeds — same per-entry rule", async () => {
    const preload: PreloadedContext = {
      as_of: now(),
      children_recent_feeds: [
        { child_id: oliver.id, items: [] },
        { child_id: "ghost", items: [] },
      ],
    };
    const out = await verifyPreload({
      preload,
      userId: "00000000-0000-4000-8000-000000000001",
      role: "nanny",
      childrenScope: [oliver],
      supabase: makeSupabase(),
    });
    expect(out.accepted.children_recent_feeds).toHaveLength(1);
    expect(out.dropped).toHaveLength(1);
    const drop0 = out.dropped[0];
    expect(drop0.slot).toBe("children_recent_feeds");
    if (
      drop0.slot === "children_profiles" ||
      drop0.slot === "children_recent_feeds"
    ) {
      expect(drop0.child_id).toBe("ghost");
    } else {
      throw new Error(`expected array-slot drop, got ${drop0.slot}`);
    }
  });

  it("my_jobs accepted for parent, dropped for nanny", async () => {
    const make = (role: "nanny" | "parent") =>
      verifyPreload({
        preload: {
          as_of: now(),
          my_jobs: { role: "parent", open_positions_count: 1, summaries: [] },
        },
        userId: "00000000-0000-4000-8000-000000000001",
        role,
        childrenScope: [],
        supabase: makeSupabase(),
      });
    const parentOut = await make("parent");
    expect(parentOut.accepted.my_jobs).toBeDefined();
    expect(parentOut.dropped).toHaveLength(0);
    const nannyOut = await make("nanny");
    expect(nannyOut.accepted.my_jobs).toBeUndefined();
    expect(nannyOut.dropped[0].reason).toBe("role_mismatch");
  });

  it("my_job_matches — same role rule", async () => {
    const out = await verifyPreload({
      preload: {
        as_of: now(),
        my_job_matches: { role: "parent", matches: [] },
      },
      userId: "00000000-0000-4000-8000-000000000001",
      role: "nanny",
      childrenScope: [],
      supabase: makeSupabase(),
    });
    expect(out.accepted.my_job_matches).toBeUndefined();
    expect(out.dropped[0].reason).toBe("role_mismatch");
  });

  it("connection_detail — connection_id user is not party to is dropped", async () => {
    const out = await verifyPreload({
      preload: {
        as_of: now(),
        connection_detail: {
          connection_id: "conn-not-mine",
          summary: {
            partner_name: "X",
            stage: "request_sent",
            last_message_at: null,
          },
        },
      },
      userId: "00000000-0000-4000-8000-000000000001",
      role: "nanny",
      childrenScope: [],
      supabase: makeSupabase(),
    });
    expect(out.accepted.connection_detail).toBeUndefined();
    expect(out.dropped[0].reason).toBe("connection_not_owned");
  });

  describe("connection_detail — ownership read from connection_requests (5e, R-4)", () => {
    const NANNY_USER = "00000000-0000-4000-8000-0000000000a1";
    const PARENT_USER = "00000000-0000-4000-8000-0000000000b2";
    const OTHER_USER = "00000000-0000-4000-8000-0000000000c3";
    const CONN = "11111111-1111-4111-8111-111111111111";
    const slot = {
      connection_id: CONN,
      summary: { partner_name: "X", stage: "intro_scheduled", last_message_at: null },
    };
    beforeEach(() => {
      state.connectionsByUserId.set(NANNY_USER, [
        { id: CONN, nannies: { user_id: NANNY_USER }, parents: { user_id: PARENT_USER } },
      ]);
    });

    it("the nanny on the connection keeps the slot", async () => {
      const out = await verifyPreload({
        preload: { as_of: now(), connection_detail: slot },
        userId: NANNY_USER,
        role: "nanny",
        childrenScope: [],
        supabase: makeSupabase(),
      });
      expect(out.accepted.connection_detail).toEqual(slot);
      expect(out.dropped).toEqual([]);
    });

    it("the parent on the connection keeps the slot", async () => {
      const out = await verifyPreload({
        preload: { as_of: now(), connection_detail: slot },
        userId: PARENT_USER,
        role: "parent",
        childrenScope: [],
        supabase: makeSupabase(),
      });
      expect(out.accepted.connection_detail).toEqual(slot);
    });

    it("a user who is not a party is dropped even though the row exists", async () => {
      const out = await verifyPreload({
        preload: { as_of: now(), connection_detail: slot },
        userId: OTHER_USER,
        role: "nanny",
        childrenScope: [],
        supabase: makeSupabase(),
      });
      expect(out.accepted.connection_detail).toBeUndefined();
      expect(out.dropped).toEqual([{ slot: "connection_detail", reason: "connection_not_owned" }]);
    });

    it("selects only columns that exist, with the user ids through the nannies/parents embeds", async () => {
      await verifyPreload({
        preload: { as_of: now(), connection_detail: slot },
        userId: NANNY_USER,
        role: "nanny",
        childrenScope: [],
        supabase: makeSupabase(),
      });
      expect(state.connectionSelects).toHaveLength(1);
      const cols = state.connectionSelects[0];
      expect(cols).not.toMatch(/parent_user_id|nanny_user_id/);
      expect(cols).toMatch(/nannies!inner\(user_id\)/);
      expect(cols).toMatch(/parents!inner\(user_id\)/);
    });

    it("a DB error fails closed (slot dropped, no throw)", async () => {
      state.connectionError = new Error("boom");
      const out = await verifyPreload({
        preload: { as_of: now(), connection_detail: slot },
        userId: NANNY_USER,
        role: "nanny",
        childrenScope: [],
        supabase: makeSupabase(),
      });
      expect(out.accepted.connection_detail).toBeUndefined();
      expect(out.dropped[0].reason).toBe("connection_not_owned");
    });
  });

  it("recent_agent_memory — shared_child item with in-scope child is accepted", async () => {
    const out = await verifyPreload({
      preload: {
        as_of: now(),
        recent_agent_memory: {
          items: [
            {
              key: "k",
              value: "v",
              scope: "shared_child",
              child_id: oliver.id,
              updated_at: now(),
            },
            {
              key: "k2",
              value: "v2",
              scope: "user",
              updated_at: now(),
            },
          ],
        },
      },
      userId: "00000000-0000-4000-8000-000000000001",
      role: "nanny",
      childrenScope: [oliver],
      supabase: makeSupabase(),
    });
    expect(out.accepted.recent_agent_memory).toBeDefined();
    expect(out.accepted.recent_agent_memory?.items).toHaveLength(2);
  });

  it("recent_agent_memory — shared_child item with OUT-OF-scope child drops the WHOLE slot", async () => {
    const out = await verifyPreload({
      preload: {
        as_of: now(),
        recent_agent_memory: {
          items: [
            {
              key: "k",
              value: "v",
              scope: "shared_child",
              child_id: "child-not-mine",
              updated_at: now(),
            },
          ],
        },
      },
      userId: "00000000-0000-4000-8000-000000000001",
      role: "nanny",
      childrenScope: [oliver],
      supabase: makeSupabase(),
    });
    expect(out.accepted.recent_agent_memory).toBeUndefined();
    expect(out.dropped[0].slot).toBe("recent_agent_memory");
  });

  it("carries verified as_of into accepted (so renderer can stamp per-slot timestamps)", async () => {
    const ts = now();
    const out = await verifyPreload({
      preload: {
        as_of: ts,
        my_profile_basics: {
          first_name: "Test",
          last_name: null,
          role: "nanny",
        },
      },
      userId: "00000000-0000-4000-8000-000000000001",
      role: "nanny",
      childrenScope: [],
      supabase: makeSupabase(),
    });
    expect(out.accepted.as_of).toBe(ts);
  });

  it("connection_inbox, verification_status, my_profile_basics (matching role) — always accepted", async () => {
    const out = await verifyPreload({
      preload: {
        as_of: now(),
        connection_inbox: { pending_count: 2, recent: [] },
        verification_status: {
          level: 4,
          status_code: 40,
          label: "Fully Verified",
          blocking_issues: [],
        },
        my_profile_basics: {
          first_name: "Test",
          last_name: "User",
          role: "nanny",
        },
      },
      userId: "00000000-0000-4000-8000-000000000001",
      role: "nanny",
      childrenScope: [],
      supabase: makeSupabase(),
    });
    expect(out.accepted.connection_inbox).toBeDefined();
    expect(out.accepted.verification_status).toBeDefined();
    expect(out.accepted.my_profile_basics).toBeDefined();
    expect(out.dropped).toHaveLength(0);
  });

  it("my_profile_basics — role mismatch is dropped (defense-in-depth)", async () => {
    const out = await verifyPreload({
      preload: {
        as_of: now(),
        my_profile_basics: {
          first_name: "Forged",
          last_name: null,
          role: "admin", // attacker tries to claim admin
        },
      },
      userId: "00000000-0000-4000-8000-000000000001",
      role: "nanny", // server-known role
      childrenScope: [],
      supabase: makeSupabase(),
    });
    expect(out.accepted.my_profile_basics).toBeUndefined();
    expect(out.dropped[0].slot).toBe("my_profile_basics");
    expect(out.dropped[0].reason).toBe("role_mismatch");
  });

  it("missing as_of drops the WHOLE payload (closes replay vector)", async () => {
    const out = await verifyPreload({
      preload: {
        // as_of intentionally omitted
        children_profiles: [
          {
            child_id: oliver.id,
            profile: {
              id: oliver.id,
              first_name: "Oliver",
              date_of_birth: "2024-11-08",
              gender: "male",
              under_three: true,
              status: "created_manual",
            },
          },
        ],
        my_profile_basics: {
          first_name: "X",
          last_name: null,
          role: "nanny",
        },
      },
      userId: "00000000-0000-4000-8000-000000000001",
      role: "nanny",
      childrenScope: [oliver],
      supabase: makeSupabase(),
    });
    expect(Object.keys(out.accepted)).toEqual([]);
    expect(out.dropped.length).toBeGreaterThanOrEqual(2);
    expect(out.dropped.every((d) => d.reason === "as_of_missing")).toBe(true);
  });

  it("mixed payload: some valid + some invalid → accepts valid, drops invalid", async () => {
    const out = await verifyPreload({
      preload: {
        as_of: now(),
        children_profiles: [
          {
            child_id: oliver.id,
            profile: {
              id: oliver.id,
              first_name: "Oliver",
              date_of_birth: "2024-11-08",
              gender: "male",
              under_three: true,
              status: "created_manual",
            },
          },
        ],
        my_jobs: { role: "parent", open_positions_count: 0, summaries: [] },
      },
      userId: "00000000-0000-4000-8000-000000000001",
      role: "nanny", // role-mismatch on my_jobs
      childrenScope: [oliver],
      supabase: makeSupabase(),
    });
    expect(out.accepted.children_profiles).toHaveLength(1);
    expect(out.accepted.my_jobs).toBeUndefined();
    expect(out.dropped).toHaveLength(1);
    expect(out.dropped[0].reason).toBe("role_mismatch");
  });

  it("my_placement — fresh DB lookup match is accepted", async () => {
    state.placementByUserId.set("00000000-0000-4000-8000-000000000001", {
      id: "placement-1",
      parent_id: "parent-id",
      nanny_id: "00000000-0000-4000-8000-000000000001",
      status: "active",
    });
    const out = await verifyPreload({
      preload: {
        as_of: now(),
        my_placement: {
          placement_id: "placement-1",
          summary: {
            partner_name: "Sarah",
            started_at: now(),
            role: "nanny",
          },
        },
      },
      userId: "00000000-0000-4000-8000-000000000001",
      role: "nanny",
      childrenScope: [oliver],
      supabase: makeSupabase(),
    });
    expect(out.accepted.my_placement).toBeDefined();
  });

  it("my_placement — stale placement_id is dropped", async () => {
    state.placementByUserId.set("00000000-0000-4000-8000-000000000001", {
      id: "placement-current",
      parent_id: "parent-id",
      nanny_id: "00000000-0000-4000-8000-000000000001",
      status: "active",
    });
    const out = await verifyPreload({
      preload: {
        as_of: now(),
        my_placement: {
          placement_id: "placement-stale",
          summary: {
            partner_name: "Old",
            started_at: now(),
            role: "nanny",
          },
        },
      },
      userId: "00000000-0000-4000-8000-000000000001",
      role: "nanny",
      childrenScope: [oliver],
      supabase: makeSupabase(),
    });
    expect(out.accepted.my_placement).toBeUndefined();
    expect(out.dropped[0].reason).toBe("placement_id_mismatch");
  });

  it("dropped entries on array slots include child_id", async () => {
    const out = await verifyPreload({
      preload: {
        as_of: now(),
        children_profiles: [
          {
            child_id: "ghost-1",
            profile: {
              id: "ghost-1",
              first_name: "G",
              date_of_birth: "2024-01-01",
              gender: null,
              under_three: true,
              status: "created_manual",
            },
          },
        ],
      },
      userId: "00000000-0000-4000-8000-000000000001",
      role: "nanny",
      childrenScope: [oliver],
      supabase: makeSupabase(),
    });
    const drop0 = out.dropped[0];
    if (
      drop0.slot === "children_profiles" ||
      drop0.slot === "children_recent_feeds"
    ) {
      expect(drop0.child_id).toBe("ghost-1");
    } else {
      throw new Error(`expected array-slot drop, got ${drop0.slot}`);
    }
  });
});
