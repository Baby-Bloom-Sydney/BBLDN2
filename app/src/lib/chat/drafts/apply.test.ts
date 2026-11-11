import { describe, it, expect, vi } from "vitest";
import { applyDraft } from "./apply";
import type { ChildSummary } from "@/lib/chat/modules/types";

// Stub out external side-effects so the dispatcher tests stay
// hermetic — observation-cascade and OpenAI both have their own
// module-level test coverage.
vi.mock("@/lib/bapp/progress-write", () => ({
  recalculateProgress: vi.fn().mockResolvedValue(undefined),
  writeHistorySnapshot: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/ai/client", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  creativeName: "Stub Plan",
                  description: "x",
                  steps: [],
                  milestone_domains: ["NUM"],
                }),
              },
            },
          ],
        }),
      },
    },
  },
}));
vi.mock("@/lib/ai/prompts/bapp-activity-generation", () => ({
  ACTIVITY_SYSTEM_PROMPT: "sys",
  buildActivityUserPrompt: () => "user",
}));

function makeCtx(
  insertMock = vi.fn().mockResolvedValue({
    data: { id: "log-9" },
    error: null,
  }),
) {
  // Multi-table mock — supports the modules each apply dispatch
  // calls into. bapp_milestones is read by the activity apply
  // path; bapp_logs is the insert target for everything.
  const milestoneSelect = vi.fn().mockResolvedValue({
    data: [
      {
        id: "NUM_12_18_1",
        domain: "NUM",
        age_bracket: "12-18 months",
        description: "Recognises 1-3 quantities",
      },
    ],
    error: null,
  });
  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "bapp_milestones") {
        return {
          select: () => ({
            in: () => milestoneSelect(),
          }),
        };
      }
      return {
        insert: () => ({
          select: () => ({
            single: () => insertMock(),
          }),
        }),
      };
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  const children: ChildSummary[] = [
    {
      id: "c1",
      firstName: "Oliver",
      ageMonths: 14,
      ageBracket: "12-18 months",
      gender: "male",
    },
  ];
  return { supabase, children, insertMock, milestoneSelect };
}

describe("applyDraft", () => {
  it("dispatches log_food to applyLogFood", async () => {
    const { supabase, children, insertMock } = makeCtx();
    const r = await applyDraft(
      "log_food",
      { meal_type: "breakfast", items: ["banana"] },
      null,
      { userId: "u-1", children, supabase },
    );
    expect(r.ok).toBe(true);
    expect(insertMock).toHaveBeenCalled();
  });

  it("dispatches log_sleep to applyLogSleep", async () => {
    const { supabase, children, insertMock } = makeCtx();
    const r = await applyDraft("log_sleep", { duration_minutes: 45 }, null, {
      userId: "u-1",
      children,
      supabase,
    });
    expect(r.ok).toBe(true);
    expect(insertMock).toHaveBeenCalled();
  });

  it("dispatches log_update to applyLogUpdate", async () => {
    const { supabase, children, insertMock } = makeCtx();
    const r = await applyDraft("log_update", { note: "Park visit." }, null, {
      userId: "u-1",
      children,
      supabase,
    });
    expect(r.ok).toBe(true);
    expect(insertMock).toHaveBeenCalled();
    if (r.ok && r.tile.kind === "diary") {
      const d = r.tile.data.item.data as Record<string, unknown>;
      expect(d.subtype).toBe("update");
      expect(d.title).toBe("Diary Entry");
    }
  });

  it("merges imageUrl into args before applying", async () => {
    const { supabase, children, insertMock } = makeCtx();
    const r = await applyDraft(
      "log_food",
      { meal_type: "snack", items: ["apple"] },
      "https://example.com/apple.jpg",
      { userId: "u-1", children, supabase },
    );
    expect(r.ok).toBe(true);
    expect(insertMock).toHaveBeenCalled();
    if (r.ok) {
      const d = (
        r.tile.kind === "diary" ? r.tile.data.item.data : null
      ) as Record<string, unknown> | null;
      expect(d?.image_url).toBe("https://example.com/apple.jpg");
    }
  });

  it("clears image_url when imageUrl is null", async () => {
    // mergeImageUrl(args, null) deletes image_url from args. The
    // module's prepareFood then writes image_url: null into the
    // canonical FoodData (the DB sentinel for "no image"). Verify
    // the persisted shape ends up with image_url === null, not
    // the previous URL.
    const { supabase, children } = makeCtx();
    const r = await applyDraft(
      "log_food",
      {
        meal_type: "snack",
        items: ["apple"],
        image_url: "https://example.com/old.jpg",
      },
      null,
      { userId: "u-1", children, supabase },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const d = (
        r.tile.kind === "diary" ? r.tile.data.item.data : null
      ) as Record<string, unknown> | null;
      expect(d?.image_url).toBeNull();
    }
  });

  it("returns an error for unknown toolName", async () => {
    const { supabase, children } = makeCtx();
    const r = await applyDraft("log_unknown", {}, null, {
      userId: "u-1",
      children,
      supabase,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/Unknown draft toolName/);
    }
  });

  it("dispatches log_observation to applyLogObservation", async () => {
    const { supabase, children, insertMock } = makeCtx();
    const r = await applyDraft(
      "log_observation",
      { note: "Smiling at the dog" },
      null,
      { userId: "u-1", children, supabase },
    );
    expect(r.ok).toBe(true);
    expect(insertMock).toHaveBeenCalled();
  });

  it("dispatches update_progress to applyUpdateProgress", async () => {
    const { supabase, children, insertMock } = makeCtx();
    const r = await applyDraft(
      "update_progress",
      { updates: [{ milestone_id: "CL_12_18_1", score: 3 }] },
      null,
      { userId: "u-1", children, supabase },
    );
    expect(r.ok).toBe(true);
    expect(insertMock).toHaveBeenCalled();
  });

  it("dispatches plan_activity to applyPlanActivity", async () => {
    const { supabase, children, insertMock } = makeCtx();
    const r = await applyDraft(
      "plan_activity",
      {
        milestone_ids: ["NUM_12_18_1"],
        _generated: {
          activityData: {
            milestone_ids: ["NUM_12_18_1"],
            prompt_context: [
              {
                domain: "NUM",
                age: "12-18 months",
                desc: "Recognises 1-3 quantities",
              },
            ],
            activity_json: {
              creativeName: "Stub Plan",
              description: "x",
              steps: [],
              milestone_domains: ["NUM"],
            },
            title: "Stub Plan",
            image_url: null,
          },
        },
      },
      null,
      { userId: "u-1", children, supabase },
    );
    expect(r.ok).toBe(true);
    expect(insertMock).toHaveBeenCalled();
  });

  it("dispatches create_tile to applyCreateTile", async () => {
    const { supabase, children, insertMock } = makeCtx();
    const r = await applyDraft(
      "create_tile",
      { title: "Today", body: "A nice day" },
      null,
      { userId: "u-1", children, supabase },
    );
    expect(r.ok).toBe(true);
    expect(insertMock).toHaveBeenCalled();
  });
});
