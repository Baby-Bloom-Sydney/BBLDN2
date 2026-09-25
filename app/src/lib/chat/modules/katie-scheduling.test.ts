import { describe, it, expect, beforeEach, vi } from "vitest";
import { APP_TZ } from "@/lib/constants";
import { katieSchedulingModule } from "./katie-scheduling";
import type { ChildSummary, ModuleContext } from "./types";

const oliver: ChildSummary = {
  id: "c1",
  firstName: "Oliver",
  ageMonths: 14,
  ageBracket: "12-18 months",
  gender: "male",
};

interface State {
  schedules: Array<Record<string, unknown>>;
  botSettings: Record<string, unknown>;
}

function makeCtx(init?: Partial<State>): {
  ctx: ModuleContext;
  state: State;
} {
  const state: State = {
    schedules: init?.schedules ? [...init.schedules] : [],
    botSettings: init?.botSettings ?? {
      waking_hours: {
        start: "07:00",
        end: "22:00",
        timezone: APP_TZ,
      },
    },
  };

  function chain(table: string) {
    if (table === "proactive_schedules") {
      const filters: Array<(r: Record<string, unknown>) => boolean> = [];
      const api: Record<string, unknown> = {
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              const inserted = {
                id: `s-${state.schedules.length + 1}`,
                ...row,
                active: true,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              };
              state.schedules.push(inserted);
              return { data: inserted, error: null };
            },
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: (col: string, val: unknown) => ({
            select: () => ({
              single: async () => {
                const idx = state.schedules.findIndex((r) => r[col] === val);
                if (idx < 0)
                  return { data: null, error: { message: "not found" } };
                state.schedules[idx] = { ...state.schedules[idx], ...patch };
                return { data: state.schedules[idx], error: null };
              },
            }),
          }),
        }),
        select: () => api,
        eq: (col: string, val: unknown) => {
          filters.push((r) => r[col] === val);
          return api;
        },
        order: () => api,
        limit: async () => {
          const rows = state.schedules.filter((r) =>
            filters.every((f) => f(r)),
          );
          return { data: rows, error: null };
        },
      };
      return api;
    }
    if (table === "bloombot") {
      const filters: Array<(r: Record<string, unknown>) => boolean> = [];
      const api: Record<string, unknown> = {
        update: (patch: Record<string, unknown>) => ({
          eq: (_col: string, _val: unknown) => ({
            select: () => ({
              single: async () => {
                Object.assign(
                  state.botSettings,
                  (patch.settings ?? {}) as Record<string, unknown>,
                );
                return {
                  data: { id: "bot-1", settings: state.botSettings },
                  error: null,
                };
              },
            }),
          }),
        }),
        select: () => api,
        eq: (col: string, val: unknown) => {
          filters.push((r) => r[col] === val);
          return api;
        },
        maybeSingle: async () => {
          return {
            data: { id: "bot-1", settings: state.botSettings },
            error: null,
          };
        },
        single: async () => {
          return {
            data: { id: "bot-1", settings: state.botSettings },
            error: null,
          };
        },
      };
      return api;
    }
    throw new Error(`unexpected table: ${table}`);
  }

  const supabase = {
    from: vi.fn((t: string) => chain(t)),
  };

  const ctx: ModuleContext = {
    botId: "bot-1",
    userId: "u-1",
    userRole: "parent",
    effectiveRole: "parent",
    children: [oliver],
    currentSurface: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: supabase as any,
  };
  return { ctx, state };
}

describe("katie-scheduling — create_schedule", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a one_time_at schedule with template mode", async () => {
    const { ctx, state } = makeCtx();
    const r = await katieSchedulingModule.execute(
      "create_schedule",
      {
        description: "Remind at 6pm",
        one_time_at: "2099-01-01T09:00:00Z",
        mode: "template",
        template: "It's 6pm — time to wrap up",
      },
      ctx,
    );
    expect(r.success).toBe(true);
    expect(state.schedules).toHaveLength(1);
    expect(state.schedules[0].one_time_at).toBe("2099-01-01T09:00:00.000Z");
    expect(state.schedules[0].next_run_at).toBe("2099-01-01T09:00:00.000Z");
    expect(state.schedules[0].mode).toBe("template");
  });

  it("creates a recurring cron schedule and computes next_run_at", async () => {
    const { ctx, state } = makeCtx();
    const r = await katieSchedulingModule.execute(
      "create_schedule",
      {
        description: "Every morning at 8",
        cron_expr: "0 8 * * *",
        mode: "ai-minimal",
        prompt_fragment: "Give a one-line morning nudge.",
        timezone: APP_TZ,
      },
      ctx,
    );
    expect(r.success).toBe(true);
    expect(state.schedules[0].cron_expr).toBe("0 8 * * *");
    expect(typeof state.schedules[0].next_run_at).toBe("string");
    // next_run_at should be in the future
    expect(
      new Date(state.schedules[0].next_run_at as string).getTime(),
    ).toBeGreaterThan(Date.now());
  });

  it("rejects when neither cron_expr nor one_time_at given", async () => {
    const { ctx } = makeCtx();
    const r = await katieSchedulingModule.execute(
      "create_schedule",
      { description: "x", mode: "template", template: "t" },
      ctx,
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/cron_expr|one_time_at/i);
  });

  it("rejects when both cron_expr and one_time_at given", async () => {
    const { ctx } = makeCtx();
    const r = await katieSchedulingModule.execute(
      "create_schedule",
      {
        description: "x",
        mode: "template",
        template: "t",
        cron_expr: "0 8 * * *",
        one_time_at: "2099-01-01T00:00:00Z",
      },
      ctx,
    );
    expect(r.success).toBe(false);
  });

  it("rejects invalid cron expressions", async () => {
    const { ctx } = makeCtx();
    const r = await katieSchedulingModule.execute(
      "create_schedule",
      {
        description: "x",
        cron_expr: "not a cron",
        mode: "template",
        template: "t",
      },
      ctx,
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/cron/i);
  });

  it("rejects mode=template without template content", async () => {
    const { ctx } = makeCtx();
    const r = await katieSchedulingModule.execute(
      "create_schedule",
      {
        description: "x",
        one_time_at: "2099-01-01T00:00:00Z",
        mode: "template",
      },
      ctx,
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/template/i);
  });

  it("rejects mode=ai-minimal|ai-full without prompt_fragment", async () => {
    const { ctx } = makeCtx();
    const r = await katieSchedulingModule.execute(
      "create_schedule",
      {
        description: "x",
        one_time_at: "2099-01-01T00:00:00Z",
        mode: "ai-full",
      },
      ctx,
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/prompt/i);
  });
});

describe("katie-scheduling — read_schedules", () => {
  it("returns active schedules for this bot", async () => {
    const { ctx } = makeCtx({
      schedules: [
        {
          id: "s-1",
          bloombot_id: "bot-1",
          description: "Morning nudge",
          cron_expr: "0 8 * * *",
          one_time_at: null,
          next_run_at: "2026-05-01T22:00:00Z",
          mode: "ai-minimal",
          active: true,
        },
      ],
    });
    const r = await katieSchedulingModule.execute("read_schedules", {}, ctx);
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.count).toBe(1);
    expect(data.schedules[0].id).toBe("s-1");
  });
});

describe("katie-scheduling — cancel_schedule", () => {
  it("sets active=false", async () => {
    const { ctx, state } = makeCtx({
      schedules: [
        {
          id: "s-1",
          bloombot_id: "bot-1",
          description: "x",
          cron_expr: "0 8 * * *",
          one_time_at: null,
          next_run_at: "2026-05-01T00:00:00Z",
          mode: "template",
          template: "t",
          active: true,
        },
      ],
    });
    const r = await katieSchedulingModule.execute(
      "cancel_schedule",
      { id: "s-1" },
      ctx,
    );
    expect(r.success).toBe(true);
    expect(state.schedules[0].active).toBe(false);
  });
});

describe("katie-scheduling — update_schedule", () => {
  it("recomputes next_run_at when cron_expr changes", async () => {
    const { ctx, state } = makeCtx({
      schedules: [
        {
          id: "s-1",
          bloombot_id: "bot-1",
          description: "x",
          cron_expr: "0 8 * * *",
          one_time_at: null,
          timezone: APP_TZ,
          next_run_at: "2026-05-01T22:00:00Z",
          mode: "template",
          template: "t",
          active: true,
        },
      ],
    });
    const r = await katieSchedulingModule.execute(
      "update_schedule",
      { id: "s-1", cron_expr: "0 9 * * *" },
      ctx,
    );
    expect(r.success).toBe(true);
    expect(state.schedules[0].cron_expr).toBe("0 9 * * *");
    expect(typeof state.schedules[0].next_run_at).toBe("string");
  });
});

describe("katie-scheduling — set_waking_hours", () => {
  it("writes to bloombot.settings.waking_hours", async () => {
    const { ctx, state } = makeCtx();
    const r = await katieSchedulingModule.execute(
      "set_waking_hours",
      { start: "06:30", end: "21:30", timezone: APP_TZ },
      ctx,
    );
    expect(r.success).toBe(true);
    expect(state.botSettings.waking_hours).toEqual({
      start: "06:30",
      end: "21:30",
      timezone: APP_TZ,
    });
  });

  it("rejects invalid HH:MM", async () => {
    const { ctx } = makeCtx();
    const r = await katieSchedulingModule.execute(
      "set_waking_hours",
      { start: "25:00", end: "22:00" },
      ctx,
    );
    expect(r.success).toBe(false);
  });

  it("rejects start >= end", async () => {
    const { ctx } = makeCtx();
    const r = await katieSchedulingModule.execute(
      "set_waking_hours",
      { start: "22:00", end: "07:00" },
      ctx,
    );
    expect(r.success).toBe(false);
  });
});
