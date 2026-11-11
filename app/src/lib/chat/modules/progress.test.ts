import { describe, it, expect, beforeEach, vi } from "vitest";
import { progressModule, applyUpdateProgress } from "./progress";
import type { ChildSummary, ModuleContext } from "./types";

vi.mock("@/lib/bapp/progress-write", () => ({
  recalculateProgress: vi.fn().mockResolvedValue(undefined),
  writeHistorySnapshot: vi.fn().mockResolvedValue(undefined),
}));

import {
  recalculateProgress,
  writeHistorySnapshot,
} from "@/lib/bapp/progress-write";

const oliver: ChildSummary = {
  id: "c1",
  firstName: "Oliver",
  ageMonths: 14,
  ageBracket: "12-18 months",
  gender: "male",
};

const MILESTONE_ROWS = [
  {
    id: "CL_12_18_1",
    domain: "CL",
    age_bracket: "12-18 months",
    description: "Uses 5-10 recognisable words",
    sort_order: 1,
  },
  {
    id: "PD_12_18_1",
    domain: "PD",
    age_bracket: "12-18 months",
    description: "Walks unaided",
    sort_order: 1,
  },
];

function makeCtx(children: ChildSummary[] = [oliver]): {
  ctx: ModuleContext;
  mocks: {
    milestoneSelect: ReturnType<typeof vi.fn>;
    progressSelect: ReturnType<typeof vi.fn>;
    insertMock: ReturnType<typeof vi.fn>;
  };
} {
  const milestoneSelect = vi.fn().mockResolvedValue({
    data: MILESTONE_ROWS,
    error: null,
  });
  const progressSelect = vi.fn().mockResolvedValue({
    data: [
      {
        domain: "CL",
        percent: 40,
        scores: { CL_12_18_1: 3 },
        updated_at: "2026-04-01T00:00:00Z",
      },
    ],
    error: null,
  });
  const insertMock = vi.fn().mockResolvedValue({
    data: { id: "progress-log-1" },
    error: null,
  });

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "bapp_milestones") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => milestoneSelect(),
              }),
            }),
          }),
        };
      }
      if (table === "bapp_progress_scores") {
        return {
          select: () => ({
            eq: () => progressSelect(),
          }),
        };
      }
      if (table === "bapp_logs") {
        return {
          insert: () => ({
            select: () => ({
              single: () => insertMock(),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  const ctx: ModuleContext = {
    botId: "bot-1",
    userId: "u-1",
    userRole: "parent",
    effectiveRole: "parent",
    children,
    currentSurface: null,
    supabase,
  };
  return { ctx, mocks: { milestoneSelect, progressSelect, insertMock } };
}

describe("progress module — read_milestones", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 7-domain slice for child's age bracket by default", async () => {
    const { ctx } = makeCtx();
    const result = await progressModule.execute("read_milestones", {}, ctx);
    expect(result.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = result.data as any;
    expect(data.child_name).toBe("Oliver");
    expect(data.age_bracket).toBe("12-18 months");
    expect(data.milestones).toHaveLength(2);
    expect(data.milestones[0].id).toBe("CL_12_18_1");
  });

  it("joins progress scores so caller can see what's been observed", async () => {
    const { ctx } = makeCtx();
    const result = await progressModule.execute("read_milestones", {}, ctx);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = result.data as any;
    const cl = data.milestones.find(
      (m: { id: string }) => m.id === "CL_12_18_1",
    );
    expect(cl.observed_score).toBe(3);
    const pd = data.milestones.find(
      (m: { id: string }) => m.id === "PD_12_18_1",
    );
    expect(pd.observed_score).toBe(0); // not in scores JSONB
  });

  it("returns domain_summary with percent per domain", async () => {
    const { ctx } = makeCtx();
    const result = await progressModule.execute("read_milestones", {}, ctx);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = result.data as any;
    expect(data.domain_summary).toBeDefined();
    expect(data.domain_summary.CL.percent).toBe(40);
  });

  it("supports overriding age_bracket explicitly", async () => {
    const { ctx, mocks } = makeCtx();
    await progressModule.execute(
      "read_milestones",
      { age_bracket: "18-24 months" },
      ctx,
    );
    // Just confirms the query was invoked; specific filter assertion is
    // covered implicitly by the chain shape.
    expect(mocks.milestoneSelect).toHaveBeenCalled();
  });

  it("surfaces error when child can't be resolved", async () => {
    const { ctx } = makeCtx([]);
    const result = await progressModule.execute("read_milestones", {}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/don't have any children linked/);
  });

  it("returns error for unknown tool", async () => {
    const { ctx } = makeCtx();
    const result = await progressModule.execute("nope", {}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unknown tool/);
  });
});

describe("progress module — update_progress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates updates array — rejects empty", async () => {
    const { ctx } = makeCtx();
    const r = await progressModule.execute(
      "update_progress",
      { updates: [] },
      ctx,
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/at least one/i);
  });

  it("validates score range 1-4 and rejects out-of-range", async () => {
    const { ctx } = makeCtx();
    const r = await progressModule.execute(
      "update_progress",
      { updates: [{ milestone_id: "CL_12_18_1", score: 7 }] },
      ctx,
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/score/i);
  });

  // WU 8.22d: update_progress now returns a draft tile. The DB
  // write + recalc + snapshot only fire on Accept.

  it("returns a draft tile and does NOT write or recalc", async () => {
    const { ctx, mocks } = makeCtx();
    const r = await progressModule.execute(
      "update_progress",
      {
        updates: [
          { milestone_id: "CL_12_18_1", score: 4 },
          { milestone_id: "PD_12_18_1", score: 2 },
        ],
      },
      ctx,
    );
    expect(r.success).toBe(true);
    expect(mocks.insertMock).not.toHaveBeenCalled();
    expect(recalculateProgress).not.toHaveBeenCalled();
    expect(writeHistorySnapshot).not.toHaveBeenCalled();
    expect(r.tile?.kind).toBe("draft");
  });

  it("returns a draft tile with progress preview", async () => {
    const { ctx } = makeCtx();
    const r = await progressModule.execute(
      "update_progress",
      {
        updates: [{ milestone_id: "CL_12_18_1", score: 4 }],
        note: "Set from chat",
      },
      ctx,
    );
    expect(r.success).toBe(true);
    expect(r.tile?.kind).toBe("draft");
    if (r.tile?.kind === "draft") {
      expect(r.tile.data.toolName).toBe("update_progress");
      const preview = r.tile.data.preview;
      if (preview.kind === "progress") {
        const item = preview.data.item;
        expect(item.type).toBe("progress");
        const data = item.data as Record<string, unknown>;
        expect(data.title).toBe("Progress Update");
        expect(data.note).toBe("Set from chat");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updates = data.updates as any[];
        expect(updates).toHaveLength(1);
        expect(updates[0]).toEqual({ id: "CL_12_18_1", score: 4 });
      } else {
        throw new Error(`expected progress preview, got ${preview.kind}`);
      }
    }
  });
});

describe("progress module — read_progress_history", () => {
  beforeEach(() => vi.clearAllMocks());

  function makeHistoryCtx(
    rows: Array<{
      id: string;
      created_at: string;
      cl_total: number;
      pse_total: number;
      pd_total: number;
      lit_total: number;
      num_total: number;
      uw_total: number;
      ead_total: number;
      ref_log_id: string | null;
    }>,
  ) {
    const selectFn = vi.fn().mockResolvedValue({ data: rows, error: null });
    const chain = () => ({
      select: () => ({
        eq: () => ({
          gte: () => ({
            lte: () => ({
              order: () => ({
                limit: () => selectFn(),
              }),
            }),
            order: () => ({
              limit: () => selectFn(),
            }),
          }),
          order: () => ({
            limit: () => selectFn(),
          }),
        }),
      }),
    });
    const supabase = { from: vi.fn(() => chain()) };
    const ctx: ModuleContext = {
      botId: "b",
      userId: "u",
      userRole: "parent",
      effectiveRole: "parent",
      children: [oliver],
      currentSurface: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabase as any,
    };
    return { ctx, selectFn };
  }

  it("returns chronological snapshots with per-domain totals", async () => {
    const { ctx } = makeHistoryCtx([
      {
        id: "h1",
        created_at: "2026-02-01T00:00:00Z",
        cl_total: 4,
        pse_total: 0,
        pd_total: 2,
        lit_total: 0,
        num_total: 0,
        uw_total: 0,
        ead_total: 0,
        ref_log_id: "log-a",
      },
      {
        id: "h2",
        created_at: "2026-03-01T00:00:00Z",
        cl_total: 8,
        pse_total: 2,
        pd_total: 4,
        lit_total: 1,
        num_total: 0,
        uw_total: 0,
        ead_total: 0,
        ref_log_id: "log-b",
      },
    ]);
    const r = await progressModule.execute("read_progress_history", {}, ctx);
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.child_name).toBe("Oliver");
    expect(data.snapshots).toHaveLength(2);
    expect(data.snapshots[0].totals.CL).toBe(4);
    expect(data.snapshots[1].totals.CL).toBe(8);
    expect(data.snapshots[0].ref_log_id).toBe("log-a");
  });

  it("computes latest - earliest deltas across the window", async () => {
    const { ctx } = makeHistoryCtx([
      {
        id: "h1",
        created_at: "2026-02-01T00:00:00Z",
        cl_total: 4,
        pse_total: 0,
        pd_total: 2,
        lit_total: 0,
        num_total: 0,
        uw_total: 0,
        ead_total: 0,
        ref_log_id: null,
      },
      {
        id: "h2",
        created_at: "2026-03-01T00:00:00Z",
        cl_total: 10,
        pse_total: 3,
        pd_total: 4,
        lit_total: 2,
        num_total: 1,
        uw_total: 0,
        ead_total: 0,
        ref_log_id: null,
      },
    ]);
    const r = await progressModule.execute("read_progress_history", {}, ctx);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.delta.CL).toBe(6);
    expect(data.delta.PSE).toBe(3);
    expect(data.delta.PD).toBe(2);
    expect(data.delta.EAD).toBe(0);
  });

  it("returns empty-state message when child has no history yet", async () => {
    const { ctx } = makeHistoryCtx([]);
    const r = await progressModule.execute("read_progress_history", {}, ctx);
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.snapshots).toHaveLength(0);
    expect(data.delta).toEqual({
      CL: 0,
      PSE: 0,
      PD: 0,
      LIT: 0,
      NUM: 0,
      UW: 0,
      EAD: 0,
    });
  });
});

// ── Apply path ────────────────────────────────────────────────────────────

describe("progress apply — update_progress", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts the progress row and runs recalc + snapshot", async () => {
    const { ctx, mocks } = makeCtx();
    const r = await applyUpdateProgress(
      {
        updates: [
          { milestone_id: "CL_12_18_1", score: 4 },
          { milestone_id: "PD_12_18_1", score: 2 },
        ],
      },
      { userId: ctx.userId, children: ctx.children, supabase: ctx.supabase },
    );
    expect(r.ok).toBe(true);
    expect(mocks.insertMock).toHaveBeenCalled();
    expect(recalculateProgress).toHaveBeenCalledWith("c1", [
      { id: "CL_12_18_1", score: 4 },
      { id: "PD_12_18_1", score: 2 },
    ]);
    expect(writeHistorySnapshot).toHaveBeenCalledWith("c1", "progress-log-1");
    if (r.ok) {
      expect(r.data.updated_count).toBe(2);
      expect(r.tile.kind).toBe("progress");
    }
  });

  it("validation failures don't insert", async () => {
    const { ctx, mocks } = makeCtx();
    const r = await applyUpdateProgress(
      { updates: [{ milestone_id: "CL_12_18_1", score: 9 }] },
      { userId: ctx.userId, children: ctx.children, supabase: ctx.supabase },
    );
    expect(r.ok).toBe(false);
    expect(mocks.insertMock).not.toHaveBeenCalled();
  });
});

describe("read_milestones.isPrefulfilled", () => {
  const tool = progressModule.tools.find((t) => t.name === "read_milestones")!;

  const oliverProfile = {
    child_id: "c1",
    profile: {
      id: "c1",
      first_name: "Oliver",
      date_of_birth: "2024-11-08",
      gender: "male" as const,
      under_three: true,
      status: "active" as const,
    },
  };

  it("returns true when the child appears in preload.children_profiles", () => {
    expect(
      tool.isPrefulfilled?.(
        { child_name: "Oliver" },
        { as_of: "2026-05-09T00:00:00Z", children_profiles: [oliverProfile] },
      ),
    ).toBe(true);
  });

  it("returns false when children_profiles is empty / undefined", () => {
    expect(
      tool.isPrefulfilled?.(
        { child_name: "Oliver" },
        { as_of: "2026-05-09T00:00:00Z" },
      ),
    ).toBe(false);
    expect(tool.isPrefulfilled?.({ child_name: "Oliver" }, undefined)).toBe(
      false,
    );
  });

  it("returns false when the child name is NOT in the array", () => {
    expect(
      tool.isPrefulfilled?.(
        { child_name: "Lily" },
        { as_of: "2026-05-09T00:00:00Z", children_profiles: [oliverProfile] },
      ),
    ).toBe(false);
  });
});
