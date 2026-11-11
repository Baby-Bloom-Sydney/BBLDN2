import { describe, it, expect, beforeEach, vi } from "vitest";
import { observationsModule, applyLogObservation } from "./observations";
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

function makeCtx(children: ChildSummary[] = [oliver]): {
  ctx: ModuleContext;
  insertMock: ReturnType<typeof vi.fn>;
} {
  const insertMock = vi.fn().mockResolvedValue({
    data: { id: "obs-1" },
    error: null,
  });

  const supabase = {
    from: vi.fn(() => ({
      insert: () => ({
        select: () => ({
          single: () => insertMock(),
        }),
      }),
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  const ctx: ModuleContext = {
    botId: "bot-1",
    userId: "u-1",
    userRole: "nanny",
    effectiveRole: "nanny",
    children,
    currentSurface: null,
    supabase,
  };
  return { ctx, insertMock };
}

// ── Propose path ──────────────────────────────────────────────────────────
//
// WU 8.22d: log_observation now returns a draft tile. The progress
// cascade (recalculateProgress + writeHistorySnapshot) does NOT fire
// at propose time — only on Accept (applyLogObservation).

describe("observations module — log_observation (propose)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a draft tile and does NOT insert or recalc", async () => {
    const { ctx, insertMock } = makeCtx();
    const r = await observationsModule.execute(
      "log_observation",
      { note: "Shared toys with the cat nicely" },
      ctx,
    );
    expect(r.success).toBe(true);
    expect(insertMock).not.toHaveBeenCalled();
    expect(recalculateProgress).not.toHaveBeenCalled();
    expect(writeHistorySnapshot).not.toHaveBeenCalled();
    expect(r.tile?.kind).toBe("draft");
    if (r.tile?.kind === "draft") {
      expect(r.tile.data.toolName).toBe("log_observation");
      const preview = r.tile.data.preview;
      if (preview.kind === "observation") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((preview.data.item.data as any).note).toBe(
          "Shared toys with the cat nicely",
        );
      } else {
        throw new Error(`expected observation preview, got ${preview.kind}`);
      }
    }
  });

  it("requires a note", async () => {
    const { ctx } = makeCtx();
    const r = await observationsModule.execute(
      "log_observation",
      { note: "" },
      ctx,
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/note/i);
  });

  it("does NOT trigger progress recalc at propose time even with milestone_id + score", async () => {
    const { ctx } = makeCtx();
    const r = await observationsModule.execute(
      "log_observation",
      {
        note: "Said 'mummy' for the first time",
        milestone_id: "CL_12_18_1",
        score: 3,
        domain: "CL",
      },
      ctx,
    );
    expect(r.success).toBe(true);
    expect(r.tile?.kind).toBe("draft");
    expect(recalculateProgress).not.toHaveBeenCalled();
    expect(writeHistorySnapshot).not.toHaveBeenCalled();
  });

  it("rejects score outside 1-4", async () => {
    const { ctx } = makeCtx();
    const r = await observationsModule.execute(
      "log_observation",
      {
        note: "Counting to 10",
        milestone_id: "NUM_12_18_1",
        score: 9,
      },
      ctx,
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/score/i);
  });

  it("surfaces error when child can't be resolved", async () => {
    const { ctx } = makeCtx([]);
    const r = await observationsModule.execute(
      "log_observation",
      { note: "x" },
      ctx,
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/any children/);
  });

  it("returns error for unknown tool", async () => {
    const { ctx } = makeCtx();
    const r = await observationsModule.execute("nope", {}, ctx);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Unknown tool/);
  });
});

// ── Apply path ────────────────────────────────────────────────────────────

describe("observations apply — log_observation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts and returns a persisted observation tile", async () => {
    const { ctx, insertMock } = makeCtx();
    const r = await applyLogObservation(
      { note: "Shared toys" },
      { userId: ctx.userId, children: ctx.children, supabase: ctx.supabase },
    );
    expect(r.ok).toBe(true);
    expect(insertMock).toHaveBeenCalled();
    expect(recalculateProgress).not.toHaveBeenCalled();
    if (r.ok) {
      expect(r.tile.kind).toBe("observation");
      expect(r.data.log_id).toBe("obs-1");
      expect(r.data.progress_updated).toBe(false);
    }
  });

  it("triggers progress recalc + history snapshot when milestone_id + score present", async () => {
    const { ctx } = makeCtx();
    const r = await applyLogObservation(
      {
        note: "Said 'mummy'",
        milestone_id: "CL_12_18_1",
        score: 3,
      },
      { userId: ctx.userId, children: ctx.children, supabase: ctx.supabase },
    );
    expect(r.ok).toBe(true);
    expect(recalculateProgress).toHaveBeenCalledWith("c1", [
      { id: "CL_12_18_1", score: 3 },
    ]);
    expect(writeHistorySnapshot).toHaveBeenCalledWith("c1", "obs-1");
    if (r.ok) {
      expect(r.data.progress_updated).toBe(true);
    }
  });

  it("does not trigger recalc when only milestone_id (no score)", async () => {
    const { ctx } = makeCtx();
    const r = await applyLogObservation(
      { note: "Working on walking", milestone_id: "PD_12_18_1" },
      { userId: ctx.userId, children: ctx.children, supabase: ctx.supabase },
    );
    expect(r.ok).toBe(true);
    expect(recalculateProgress).not.toHaveBeenCalled();
  });

  it("validation failures don't insert", async () => {
    const { ctx, insertMock } = makeCtx();
    const r = await applyLogObservation(
      { note: "" },
      { userId: ctx.userId, children: ctx.children, supabase: ctx.supabase },
    );
    expect(r.ok).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });
});
