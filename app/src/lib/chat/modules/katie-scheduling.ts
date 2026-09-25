/**
 * `katie-scheduling` module — Katie creates, inspects, and cancels her own
 * proactive schedules.
 *
 * Maps to `proactive_schedules` (see katie-foundation.sql). Five tools:
 *   create_schedule   — new schedule row (one_time_at OR cron_expr)
 *   read_schedules    — list active schedules for this bot
 *   update_schedule   — edit timing / content / active by id
 *   cancel_schedule   — set active=false (soft-cancel)
 *   set_waking_hours  — writes bloombot.settings.waking_hours so the
 *                       dispatcher knows when it's allowed to fire
 *
 * Cron expressions parsed via `cron-parser`. next_run_at is computed in
 * the caller's timezone (default `APP_TZ`) so users get local timing even
 * when the server lives elsewhere.
 */

import { CronExpressionParser } from "cron-parser";
import type { BloomBotModule, ToolResult } from "./types";
import { resolveChild } from "./utils";
import { APP_TZ, BRAND } from "@/lib/constants";

const MODES = ["template", "ai-minimal", "ai-full"] as const;
type Mode = (typeof MODES)[number];

const DEFAULT_TZ = APP_TZ;

function nextRunFromCron(expr: string, tz: string): string {
  const it = CronExpressionParser.parse(expr, { tz });
  return it.next().toDate().toISOString();
}

function parseHHMM(s: unknown): { h: number; m: number } | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, m: min };
}

function asMinutes({ h, m }: { h: number; m: number }): number {
  return h * 60 + m;
}

async function createSchedule(
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const description =
    typeof args.description === "string" ? args.description.trim() : "";
  if (description.length === 0) {
    return {
      success: false,
      error:
        "create_schedule needs a `description` (so it's legible in read_schedules).",
    };
  }

  const modeArg = typeof args.mode === "string" ? args.mode : null;
  if (!modeArg || !(MODES as readonly string[]).includes(modeArg)) {
    return {
      success: false,
      error: `create_schedule needs mode ∈ ${MODES.join("|")}.`,
    };
  }
  const mode = modeArg as Mode;

  const cronExpr =
    typeof args.cron_expr === "string" && args.cron_expr.trim().length > 0
      ? args.cron_expr.trim()
      : null;
  const oneTimeAt =
    typeof args.one_time_at === "string" && args.one_time_at.trim().length > 0
      ? args.one_time_at.trim()
      : null;

  if ((cronExpr && oneTimeAt) || (!cronExpr && !oneTimeAt)) {
    return {
      success: false,
      error:
        "Provide exactly one of `cron_expr` (recurring) or `one_time_at` (single ISO datetime).",
    };
  }

  const timezone =
    typeof args.timezone === "string" && args.timezone.trim().length > 0
      ? args.timezone.trim()
      : DEFAULT_TZ;

  let nextRunAt: string;
  let oneTimeIso: string | null = null;
  if (oneTimeAt) {
    const d = new Date(oneTimeAt);
    if (Number.isNaN(d.getTime())) {
      return { success: false, error: `Invalid one_time_at: ${oneTimeAt}` };
    }
    oneTimeIso = d.toISOString();
    nextRunAt = oneTimeIso;
  } else {
    try {
      nextRunAt = nextRunFromCron(cronExpr as string, timezone);
    } catch (err) {
      return {
        success: false,
        error: `Invalid cron_expr: ${err instanceof Error ? err.message : "parse failed"}`,
      };
    }
  }

  const template =
    typeof args.template === "string" && args.template.trim().length > 0
      ? args.template.trim()
      : null;
  const promptFragment =
    typeof args.prompt_fragment === "string" &&
    args.prompt_fragment.trim().length > 0
      ? args.prompt_fragment.trim()
      : null;

  if (mode === "template" && !template) {
    return {
      success: false,
      error: "mode=template requires `template` content.",
    };
  }
  if ((mode === "ai-minimal" || mode === "ai-full") && !promptFragment) {
    return {
      success: false,
      error: `mode=${mode} requires a \`prompt_fragment\` telling Katie what to say.`,
    };
  }

  // Optional child link
  let childId: string | null = null;
  if (args.child_name !== undefined && args.child_name !== null) {
    const r = resolveChild(args.child_name, ctx.children);
    if (r.error) return r.error;
    childId = r.child.id;
  }

  const triggerId =
    typeof args.trigger_id === "string" && args.trigger_id.trim().length > 0
      ? args.trigger_id.trim()
      : "katie.custom";

  const payload =
    args.payload &&
    typeof args.payload === "object" &&
    !Array.isArray(args.payload)
      ? (args.payload as Record<string, unknown>)
      : {};

  const { data, error } = await ctx.supabase
    .from("proactive_schedules")
    .insert({
      bloombot_id: ctx.botId,
      child_client_id: childId,
      trigger_id: triggerId,
      module_id: "katie-scheduling",
      description,
      created_by: "katie",
      cron_expr: cronExpr,
      one_time_at: oneTimeIso,
      timezone,
      next_run_at: nextRunAt,
      mode,
      template,
      prompt_fragment: promptFragment,
      payload,
    })
    .select()
    .single();

  if (error || !data) {
    return {
      success: false,
      error: `Failed to create schedule: ${error?.message ?? "unknown"}`,
    };
  }

  const row = data as { id: string; next_run_at: string };
  return {
    success: true,
    data: {
      id: row.id,
      next_run_at: row.next_run_at,
      description,
      mode,
    },
  };
}

async function readSchedules(
  _args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const { data, error } = await ctx.supabase
    .from("proactive_schedules")
    .select()
    .eq("bloombot_id", ctx.botId)
    .eq("active", true)
    .order("next_run_at", { ascending: true })
    .limit(50);

  if (error) {
    return {
      success: false,
      error: `Failed to read schedules: ${error.message}`,
    };
  }

  const rows =
    (data as Array<{
      id: string;
      description: string;
      cron_expr: string | null;
      one_time_at: string | null;
      next_run_at: string;
      mode: string;
      active: boolean;
      trigger_id: string;
    }>) ?? [];

  return {
    success: true,
    data: {
      count: rows.length,
      schedules: rows.map((r) => ({
        id: r.id,
        description: r.description,
        cron_expr: r.cron_expr,
        one_time_at: r.one_time_at,
        next_run_at: r.next_run_at,
        mode: r.mode,
        trigger_id: r.trigger_id,
      })),
    },
  };
}

async function updateSchedule(
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const id =
    typeof args.id === "string" && args.id.trim().length > 0
      ? args.id.trim()
      : null;
  if (!id) return { success: false, error: "update_schedule needs `id`." };

  const patch: Record<string, unknown> = {};
  if (
    typeof args.description === "string" &&
    args.description.trim().length > 0
  ) {
    patch.description = args.description.trim();
  }
  if (typeof args.template === "string") patch.template = args.template.trim();
  if (typeof args.prompt_fragment === "string")
    patch.prompt_fragment = args.prompt_fragment.trim();
  if (typeof args.active === "boolean") patch.active = args.active;

  // Timing changes require recomputing next_run_at.
  const cronExpr =
    typeof args.cron_expr === "string" ? args.cron_expr.trim() : null;
  const oneTimeAt =
    typeof args.one_time_at === "string" ? args.one_time_at.trim() : null;
  const timezone =
    typeof args.timezone === "string" && args.timezone.trim().length > 0
      ? args.timezone.trim()
      : DEFAULT_TZ;

  if (cronExpr && oneTimeAt) {
    return {
      success: false,
      error: "Provide only one of cron_expr or one_time_at.",
    };
  }
  if (cronExpr) {
    try {
      patch.cron_expr = cronExpr;
      patch.one_time_at = null;
      patch.next_run_at = nextRunFromCron(cronExpr, timezone);
      patch.timezone = timezone;
    } catch (err) {
      return {
        success: false,
        error: `Invalid cron_expr: ${err instanceof Error ? err.message : "parse failed"}`,
      };
    }
  } else if (oneTimeAt) {
    const d = new Date(oneTimeAt);
    if (Number.isNaN(d.getTime())) {
      return { success: false, error: `Invalid one_time_at: ${oneTimeAt}` };
    }
    patch.one_time_at = d.toISOString();
    patch.cron_expr = null;
    patch.next_run_at = d.toISOString();
  }

  if (Object.keys(patch).length === 0) {
    return { success: false, error: "Nothing to update." };
  }

  const { data, error } = await ctx.supabase
    .from("proactive_schedules")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    return {
      success: false,
      error: `Failed to update schedule: ${error?.message ?? "not found"}`,
    };
  }

  return { success: true, data: { id, updated: true } };
}

async function cancelSchedule(
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const id =
    typeof args.id === "string" && args.id.trim().length > 0
      ? args.id.trim()
      : null;
  if (!id) return { success: false, error: "cancel_schedule needs `id`." };

  const { error } = await ctx.supabase
    .from("proactive_schedules")
    .update({ active: false })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return {
      success: false,
      error: `Failed to cancel schedule: ${error.message}`,
    };
  }
  return { success: true, data: { id, cancelled: true } };
}

async function setWakingHours(
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const start = parseHHMM(args.start);
  const end = parseHHMM(args.end);
  if (!start || !end) {
    return {
      success: false,
      error: "start and end must be in HH:MM (24h) format, e.g. '07:30'.",
    };
  }
  if (asMinutes(start) >= asMinutes(end)) {
    return {
      success: false,
      error: "start must be before end within the same day.",
    };
  }

  const timezone =
    typeof args.timezone === "string" && args.timezone.trim().length > 0
      ? args.timezone.trim()
      : DEFAULT_TZ;

  const startStr = `${String(start.h).padStart(2, "0")}:${String(start.m).padStart(2, "0")}`;
  const endStr = `${String(end.h).padStart(2, "0")}:${String(end.m).padStart(2, "0")}`;

  // Merge into existing settings rather than overwrite — the JSONB column
  // also holds bloombot.settings.effective_role (Option C admin cross-role
  // simulation) plus any future preferences. A naive `update({ settings: ... })`
  // replaces the column, silently destroying everything except waking_hours.
  const { data: current, error: readErr } = await ctx.supabase
    .from("bloombot")
    .select("settings")
    .eq("id", ctx.botId)
    .single();
  if (readErr) {
    return {
      success: false,
      error: `Failed to read current settings: ${readErr.message}`,
    };
  }
  const existingSettings =
    (current as { settings: Record<string, unknown> | null } | null)
      ?.settings ?? {};
  const mergedSettings = {
    ...existingSettings,
    waking_hours: { start: startStr, end: endStr, timezone },
  };

  const { error } = await ctx.supabase
    .from("bloombot")
    .update({ settings: mergedSettings })
    .eq("id", ctx.botId)
    .select()
    .single();

  if (error) {
    return {
      success: false,
      error: `Failed to update waking hours: ${error.message}`,
    };
  }

  return {
    success: true,
    data: { start: startStr, end: endStr, timezone },
  };
}

export const katieSchedulingModule: BloomBotModule = {
  id: "katie-scheduling",
  name: "Proactive Scheduling",
  description:
    "Create, inspect, edit, and cancel proactive messages Katie fires on her own cadence. Stores rows in proactive_schedules. Dispatcher picks them up every 15 minutes.",
  childScoped: true,

  tools: [
    {
      name: "create_schedule",
      description:
        "Queue a proactive message to fire later. Pass either cron_expr (recurring) or one_time_at (single ISO datetime). Mode decides how the message is rendered: template (static text), ai-minimal (short Gemini reply), ai-full (full context + tool access). Use this when the user says 'remind me at X', 'every morning', or when you spot a routine worth reinforcing.",
      parameters: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description:
              "Short human-readable label (shown in read_schedules).",
          },
          cron_expr: {
            type: "string",
            description:
              "Crontab expression (5-field: min hour day-of-month month day-of-week). Mutually exclusive with one_time_at.",
          },
          one_time_at: {
            type: "string",
            description:
              "ISO 8601 datetime. Mutually exclusive with cron_expr.",
          },
          timezone: {
            type: "string",
            description:
              `IANA timezone for cron_expr. Defaults to ${APP_TZ}.`,
          },
          mode: {
            type: "string",
            enum: ["template", "ai-minimal", "ai-full"],
            description:
              "template = fixed string. ai-minimal = short Gemini response, no tools. ai-full = full agent run with tools.",
          },
          template: {
            type: "string",
            description: "Required when mode=template.",
          },
          prompt_fragment: {
            type: "string",
            description: "Required when mode=ai-minimal or ai-full.",
          },
          child_name: {
            type: "string",
            description:
              "Optional — link this schedule to a specific child (enables shared-scope memories).",
          },
          trigger_id: {
            type: "string",
            description:
              "Optional identifier (e.g. 'child.weekly_overview'). Defaults to 'katie.custom'.",
          },
          payload: {
            type: "object",
            description:
              "Arbitrary JSON metadata passed to the dispatcher at fire time.",
          },
        },
        required: ["description", "mode"],
      },
    },
    {
      name: "read_schedules",
      description:
        "List all active schedules for this bot, soonest first. Use before creating a new one to avoid duplicates.",
      parameters: { type: "object", properties: {}, required: [] },
    },
    {
      name: "update_schedule",
      description:
        "Edit a schedule by id. Any of description / cron_expr / one_time_at / template / prompt_fragment / active can be changed. Changing cron_expr or one_time_at recomputes next_run_at.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          description: { type: "string" },
          cron_expr: { type: "string" },
          one_time_at: { type: "string" },
          timezone: { type: "string" },
          template: { type: "string" },
          prompt_fragment: { type: "string" },
          active: { type: "boolean" },
        },
        required: ["id"],
      },
    },
    {
      name: "cancel_schedule",
      description:
        "Soft-cancel a schedule (sets active=false). Reversible — update_schedule can re-activate it.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "set_waking_hours",
      description:
        "Define the quiet-hours boundary the dispatcher respects. Proactive messages won't fire outside [start, end] in the given timezone.",
      parameters: {
        type: "object",
        properties: {
          start: { type: "string", description: "HH:MM (24h), e.g. '07:00'." },
          end: { type: "string", description: "HH:MM (24h), e.g. '22:00'." },
          timezone: {
            type: "string",
            description: `IANA timezone. Default ${APP_TZ}.`,
          },
        },
        required: ["start", "end"],
      },
    },
  ],

  async execute(toolName, args, ctx) {
    if (toolName === "create_schedule") return createSchedule(args, ctx);
    if (toolName === "read_schedules") return readSchedules(args, ctx);
    if (toolName === "update_schedule") return updateSchedule(args, ctx);
    if (toolName === "cancel_schedule") return cancelSchedule(args, ctx);
    if (toolName === "set_waking_hours") return setWakingHours(args, ctx);
    return { success: false, error: `Unknown tool: ${toolName}` };
  },

  systemPromptFragment:
    `You schedule your own proactive messages via \`create_schedule\`. Prefer cron_expr for routines (morning nudge, weekly overview) and one_time_at for specific reminders. Always pair each schedule with a clear \`description\` so future-you can reason about it via read_schedules. Respect the user's waking hours — ask once via \`set_waking_hours\` if they haven't set them; default is 07:00–22:00 ${BRAND.city}.`,
};
