/**
 * Tests for the modified list + get-single admin position actions (T-044).
 *
 * Coverage targets:
 *   - source filter dropped on both endpoints (returns parent positions too)
 *   - explicit `?source=` still narrows
 *   - five new fields surfaced (DFY + placement state)
 *   - `family_display_name` fallback resolves through the two-hop join
 *     position.parent_id -> parents.user_id -> user_profiles.last_name
 *   - parents-fetch is batched on the list path (no N+1)
 *
 * The action uses the Supabase admin client with chained builders. The mock
 * below makes every chain method return the same builder; .then(),
 * .maybeSingle() and .single() resolve based on the recorded filters so a
 * test can assert against either the full set or a single row.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  positionsData: [] as Row[],
  childrenData: [] as Row[],
  parentsData: [] as Row[],
  userProfilesData: [] as Row[],
  scheduleData: [] as Row[],
  fromCalls: [] as string[],
  selectCounts: {} as Record<string, number>,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => makeChain(table),
  }),
}));

function makeChain(table: string) {
  state.fromCalls.push(table);
  const filters: Array<
    | { kind: "in"; col: string; vals: unknown[] }
    | { kind: "eq"; col: string; val: unknown }
  > = [];

  const dataset = (): Row[] => {
    switch (table) {
      case "nanny_positions":
        return state.positionsData;
      case "position_children":
        return state.childrenData;
      case "position_schedule":
        return state.scheduleData;
      case "parents":
        return state.parentsData;
      case "user_profiles":
        return state.userProfilesData;
      default:
        return [];
    }
  };

  const applyFilters = (rows: Row[]): Row[] => {
    let result = rows;
    for (const f of filters) {
      if (f.kind === "in") {
        result = result.filter((r) => f.vals.includes(r[f.col]));
      } else {
        result = result.filter((r) => r[f.col] === f.val);
      }
    }
    return result;
  };

  const resolveList = () => {
    const rows = applyFilters(dataset());
    return { data: rows, count: rows.length, error: null };
  };

  const resolveSingle = () => {
    const rows = applyFilters(dataset());
    return { data: rows[0] ?? null, error: null };
  };

  // Builder + terminal share the same shape so chain order doesn't matter.
  const builder: Record<string, unknown> = {
    select: (_cols: string, _opts?: Record<string, unknown>) => {
      state.selectCounts[table] = (state.selectCounts[table] ?? 0) + 1;
      return builder;
    },
    order: (_col: string, _opts?: Record<string, unknown>) => builder,
    range: (_s: number, _e: number) => builder,
    in: (col: string, vals: unknown[]) => {
      filters.push({ kind: "in", col, vals });
      return builder;
    },
    eq: (col: string, val: unknown) => {
      filters.push({ kind: "eq", col, val });
      return builder;
    },
    maybeSingle: () => Promise.resolve(resolveSingle()),
    single: () => Promise.resolve(resolveSingle()),
    then: (onFulfilled: (value: unknown) => unknown) =>
      onFulfilled(resolveList()),
  };
  return builder;
}

const SYSTEM_PARENT_ID = "00000000-0000-0000-0000-000000000000";
const REAL_PARENT_ID = "11111111-1111-4111-8111-111111111111";
const REAL_USER_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_POSITION_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const PARENT_POSITION_ID = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

const SAMPLE_DFY_TIME = "2026-05-25T12:00:00.000Z";
const SAMPLE_FILLED_TIME = "2026-05-28T09:00:00.000Z";

function makeAdminPosition(): Row {
  return {
    id: ADMIN_POSITION_ID,
    parent_id: SYSTEM_PARENT_ID,
    family_display_name: "Test Admin Family",
    suburb: "Clapham",
    hourly_rate: 38,
    hours_per_week: 25,
    schedule_type: "Fixed",
    days_required: ["Monday"],
    placement_length: "Ongoing",
    urgency: "As soon as possible",
    start_date: "2026-06-10",
    status: "active",
    stage: 1,
    position_status: 1,
    source: "admin",
    created_at: "2026-06-01T10:00:00.000Z",
    expires_at: null,
    description: "Existing admin position",
    dfy_activated_at: null,
    dfy_tier: null,
    dfy_expires_at: null,
    filled_at: null,
    filled_by_nanny_id: null,
  };
}

function makeParentPosition(): Row {
  return {
    id: PARENT_POSITION_ID,
    parent_id: REAL_PARENT_ID,
    family_display_name: null,
    suburb: "Islington",
    hourly_rate: 42,
    hours_per_week: 30,
    schedule_type: "Flexible",
    days_required: ["Tuesday", "Wednesday"],
    placement_length: "Ongoing",
    urgency: "As soon as possible",
    start_date: "2026-06-15",
    status: "active",
    stage: 5,
    position_status: 11,
    source: "parent",
    created_at: "2026-06-02T11:00:00.000Z",
    expires_at: null,
    description: "Real parent position",
    dfy_activated_at: SAMPLE_DFY_TIME,
    dfy_tier: "priority",
    dfy_expires_at: "2026-07-25T12:00:00.000Z",
    filled_at: SAMPLE_FILLED_TIME,
    filled_by_nanny_id: "cccccccc-3333-4333-8333-cccccccccccc",
  };
}

beforeEach(() => {
  state.positionsData = [];
  state.childrenData = [];
  state.parentsData = [];
  state.userProfilesData = [];
  state.scheduleData = [];
  state.fromCalls = [];
  state.selectCounts = {};
  process.env.SYSTEM_PARENT_ID = SYSTEM_PARENT_ID;
  process.env.NEXT_PUBLIC_APP_URL = "https://app-test.local";
});

describe("listAdminPositions — full read access (T-044)", () => {
  it("returns positions of all sources when no source filter passed (admin + parent)", async () => {
    state.positionsData = [makeAdminPosition(), makeParentPosition()];
    state.parentsData = [{ id: REAL_PARENT_ID, user_id: REAL_USER_ID }];
    state.userProfilesData = [{ user_id: REAL_USER_ID, last_name: "Smith" }];

    const { listAdminPositions } = await import("./admin-positions");
    const result = await listAdminPositions({});

    expect(result.error).toBeNull();
    expect(result.positions).toHaveLength(2);
    const sources = (result.positions as Row[]).map((p) => p.source);
    expect(sources).toContain("admin");
    expect(sources).toContain("parent");
  });

  it("respects an explicit ?source=parent filter (narrowing still works)", async () => {
    state.positionsData = [makeAdminPosition(), makeParentPosition()];
    state.parentsData = [{ id: REAL_PARENT_ID, user_id: REAL_USER_ID }];
    state.userProfilesData = [{ user_id: REAL_USER_ID, last_name: "Smith" }];

    const { listAdminPositions } = await import("./admin-positions");
    const result = await listAdminPositions({ source: "parent" });

    expect(result.positions).toHaveLength(1);
    expect((result.positions[0] as Row).source).toBe("parent");
  });

  it("surfaces DFY + placement fields on each row", async () => {
    state.positionsData = [makeParentPosition()];
    state.parentsData = [{ id: REAL_PARENT_ID, user_id: REAL_USER_ID }];
    state.userProfilesData = [{ user_id: REAL_USER_ID, last_name: "Smith" }];

    const { listAdminPositions } = await import("./admin-positions");
    const result = await listAdminPositions({});
    const row = result.positions[0] as Row;

    expect(row.dfy_activated_at).toBe(SAMPLE_DFY_TIME);
    expect(row.dfy_tier).toBe("priority");
    expect(row.dfy_expires_at).toBe("2026-07-25T12:00:00.000Z");
    expect(row.filled_at).toBe(SAMPLE_FILLED_TIME);
    expect(row.filled_by_nanny_id).toBe("cccccccc-3333-4333-8333-cccccccccccc");
  });

  it("falls back family_display_name = '{last_name} ({suburb})' when null (KEY-1)", async () => {
    state.positionsData = [makeParentPosition()];
    state.parentsData = [{ id: REAL_PARENT_ID, user_id: REAL_USER_ID }];
    state.userProfilesData = [{ user_id: REAL_USER_ID, last_name: "Smith" }];

    const { listAdminPositions } = await import("./admin-positions");
    const result = await listAdminPositions({});

    expect((result.positions[0] as Row).family_display_name).toBe(
      "Smith (Islington)",
    );
  });

  it("preserves family_display_name on admin/ai_agent positions (no fallback applied)", async () => {
    state.positionsData = [makeAdminPosition()];
    const { listAdminPositions } = await import("./admin-positions");
    const result = await listAdminPositions({});
    expect((result.positions[0] as Row).family_display_name).toBe(
      "Test Admin Family",
    );
  });

  it("batches the parents fetch — parents.select called at most ONCE regardless of N positions", async () => {
    const manyParentPositions: Row[] = [];
    for (let i = 0; i < 5; i++) {
      const p = makeParentPosition();
      p.id = `dddddddd-${i}${i}${i}${i}-4${i}${i}${i}-8${i}${i}${i}-dddddddd${i}dd`;
      p.parent_id = `eeeeeeee-${i}${i}${i}${i}-4${i}${i}${i}-8${i}${i}${i}-eeeeeeee${i}ee`;
      manyParentPositions.push(p);
    }
    state.positionsData = manyParentPositions;
    state.parentsData = manyParentPositions.map((p) => ({
      id: p.parent_id,
      user_id: `ffffffff-${(p.parent_id as string).slice(9, 13)}-4111-8111-ffffffffffff`,
    }));
    state.userProfilesData = state.parentsData.map((pr) => ({
      user_id: pr.user_id,
      last_name: "Doe",
    }));

    const { listAdminPositions } = await import("./admin-positions");
    await listAdminPositions({});

    // Each .from('parents') -> .select(...) increments the counter exactly once
    // per call. Batched fetch means one call total even with 5 positions.
    expect(state.selectCounts.parents ?? 0).toBe(1);
    expect(state.selectCounts.user_profiles ?? 0).toBe(1);
  });

  it("falls back to '(<district>)' when no resolvable last name (orphaned parent)", async () => {
    state.positionsData = [makeParentPosition()];
    // No parents row + no user_profiles row -> name unresolvable
    const { listAdminPositions } = await import("./admin-positions");
    const result = await listAdminPositions({});

    expect((result.positions[0] as Row).family_display_name).toBe(
      "(Islington)",
    );
  });
});

describe("getAdminPosition — full read access (T-044)", () => {
  it("returns a real parent position by UUID (no longer 404s)", async () => {
    state.positionsData = [makeParentPosition()];
    state.parentsData = [{ id: REAL_PARENT_ID, user_id: REAL_USER_ID }];
    state.userProfilesData = [{ user_id: REAL_USER_ID, last_name: "Smith" }];

    const { getAdminPosition } = await import("./admin-positions");
    const result = await getAdminPosition(PARENT_POSITION_ID);

    expect(result.error).toBeNull();
    expect(result.position).not.toBeNull();
    expect((result.position as Row).id).toBe(PARENT_POSITION_ID);
    expect((result.position as Row).source).toBe("parent");
  });

  it("returns DFY + placement fields on the get-by-id payload", async () => {
    state.positionsData = [makeParentPosition()];
    state.parentsData = [{ id: REAL_PARENT_ID, user_id: REAL_USER_ID }];
    state.userProfilesData = [{ user_id: REAL_USER_ID, last_name: "Smith" }];

    const { getAdminPosition } = await import("./admin-positions");
    const result = await getAdminPosition(PARENT_POSITION_ID);
    const pos = result.position as Row;

    expect(pos.dfy_activated_at).toBe(SAMPLE_DFY_TIME);
    expect(pos.dfy_tier).toBe("priority");
    expect(pos.dfy_expires_at).toBe("2026-07-25T12:00:00.000Z");
    expect(pos.filled_at).toBe(SAMPLE_FILLED_TIME);
    expect(pos.filled_by_nanny_id).toBe("cccccccc-3333-4333-8333-cccccccccccc");
  });

  it("resolves family_display_name fallback on the single-get path", async () => {
    state.positionsData = [makeParentPosition()];
    state.parentsData = [{ id: REAL_PARENT_ID, user_id: REAL_USER_ID }];
    state.userProfilesData = [{ user_id: REAL_USER_ID, last_name: "Smith" }];

    const { getAdminPosition } = await import("./admin-positions");
    const result = await getAdminPosition(PARENT_POSITION_ID);

    expect((result.position as Row).family_display_name).toBe(
      "Smith (Islington)",
    );
  });

  it("returns null position + error message for non-existent UUID", async () => {
    state.positionsData = [];
    const { getAdminPosition } = await import("./admin-positions");
    const result = await getAdminPosition(
      "99999999-9999-4999-8999-999999999999",
    );
    expect(result.position).toBeNull();
    expect(result.error).toBeTruthy();
  });
});
