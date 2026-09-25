/**
 * Proactive dispatcher — consumes proactive_schedules rows whose
 * next_run_at ≤ now and fires messages.
 *
 * Called from /api/cron/proactive every 15 minutes. Also safe to call
 * manually during development.
 *
 * Policy:
 *   - Only fire when now() is inside bot.settings.waking_hours
 *     (default 07:00–22:00 Australia/Sydney).
 *   - Template mode renders verbatim with {child_name}/{today}
 *     interpolation. No AI cost.
 *   - ai-minimal mode makes one Gemini call with a minimal system
 *     prompt + the schedule's prompt_fragment. No tools. Single turn.
 *   - ai-full is deferred — requires reproducing the chat route
 *     agentic loop. Current cron just skips ai-full with
 *     full agentic loop with tool calling (see fireAiFull).
 *
 * After firing:
 *   - Insert chat_messages (role='assistant', is_read=false,
 *     trigger_source='proactive', proactive_trigger_id=<trigger_id>).
 *   - If cron_expr: recompute next_run_at to the next occurrence.
 *   - If one_time_at: set active=false (single-fire).
 *   - Update last_run_at / last_status / last_error.
 */

import { CronExpressionParser } from "cron-parser";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generate, type GeminiTool } from "@/lib/ai/gemini-client";
import { APP_LOCALE } from "@/lib/constants";
import { selectGeminiModel, type BotRole } from "@/lib/ai/model-selector";
import { collectTools, findToolHandler } from "@/lib/chat/modules/registry";
import type { ChatTile } from "@/lib/chat/tiles";
import { buildSystemPrompt } from "@/lib/chat/context";
import { buildMemoryTable } from "@/lib/chat/memory/context-builder";
import { updateDailyCost } from "@/lib/chat/cost-tracker";
import { getUserChildren } from "@/lib/chat/bot";
import { runScheduledAgenticLoop } from "./agentic-loop";
import type { BotSettings } from "@/types/bapp";

export interface WakingHours {
  start: string; // HH:MM
  end: string; // HH:MM
  timezone: string; // IANA
}

const DEFAULT_WAKING: WakingHours = {
  start: "07:00",
  end: "22:00",
  timezone: "Australia/Sydney",
};

function parseHHMMToMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function inWakingHours(
  hours: WakingHours | undefined,
  now: Date,
): boolean {
  const hrs = hours ?? DEFAULT_WAKING;
  const start = parseHHMMToMinutes(hrs.start);
  const end = parseHHMMToMinutes(hrs.end);
  if (start == null || end == null || start >= end) return false;

  // Project `now` into the bot's timezone to compare minutes-of-day.
  const fmt = new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: hrs.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const mins = h * 60 + m;
  return mins >= start && mins < end;
}

export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match,
  );
}

interface ScheduleRow {
  id: string;
  bloombot_id: string;
  child_client_id: string | null;
  trigger_id: string;
  description: string;
  cron_expr: string | null;
  one_time_at: string | null;
  timezone: string;
  next_run_at: string;
  mode: "template" | "ai-minimal" | "ai-full";
  template: string | null;
  prompt_fragment: string | null;
  payload: Record<string, unknown>;
  active: boolean;
}

interface BotRow {
  id: string;
  user_id: string;
  role: BotRole;
  /** Typed off canonical `BotSettings`. The chat route + the dispatcher
   *  must agree on which modules are active for the same bot — if they
   *  diverge, a proactive message could fire with a tool that the
   *  synchronous chat path has already removed via `enabledForBot`. */
  settings: BotSettings | null;
}

interface ChildRow {
  id: string;
  first_name: string;
}

export interface DispatchResult {
  schedule_id: string;
  status:
    | "fired"
    | "skipped_waking"
    | "skipped_no_child" // WU 14 — bot's user has no connected child_client; AI cron is skipped
    | "error";
  reason?: string;
  message_id?: string;
  next_run_at?: string;
}

async function fireTemplate(
  row: ScheduleRow,
  bot: BotRow,
  child: ChildRow | null,
  admin: SupabaseClient,
): Promise<{ content: string; messageId: string | null }> {
  const today = new Date().toLocaleDateString(APP_LOCALE, {
    weekday: "long",
    timeZone: row.timezone,
  });
  const content = renderTemplate(row.template ?? "", {
    child_name: child?.first_name ?? "your child",
    today,
  });

  const { data } = await admin
    .from("chat_messages")
    .insert({
      bloombot_id: bot.id,
      role: "assistant",
      content,
      trigger_source: "proactive",
      proactive_trigger_id: row.trigger_id,
      is_read: false,
      metadata: {
        mode: "template",
        schedule_id: row.id,
        description: row.description,
      },
    })
    .select("id")
    .single();

  return { content, messageId: (data as { id: string } | null)?.id ?? null };
}

async function fireAiMinimal(
  row: ScheduleRow,
  bot: BotRow,
  child: ChildRow | null,
  admin: SupabaseClient,
): Promise<{ content: string; messageId: string | null }> {
  const model = selectGeminiModel(bot.role);
  const contextBlock = [
    child ? `You are addressing about ${child.first_name}.` : "",
    `Today is ${new Date().toLocaleDateString(APP_LOCALE, { weekday: "long", timeZone: row.timezone })}.`,
  ]
    .filter(Boolean)
    .join(" ");

  const systemPrompt = [
    "You are Katie, the user's proactive assistant. You are sending a short, unsolicited message.",
    "Keep it under 3 sentences. No preamble, no sign-off. Sound human, not scripted.",
    contextBlock,
    "",
    row.prompt_fragment ?? "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const resp = await generate({
    model,
    systemPrompt,
    contents: [
      {
        role: "user",
        parts: [{ text: row.description }],
      },
    ],
  });

  const content = (resp.text ?? "").trim() || "…";
  const { data } = await admin
    .from("chat_messages")
    .insert({
      bloombot_id: bot.id,
      role: "assistant",
      content,
      trigger_source: "proactive",
      proactive_trigger_id: row.trigger_id,
      is_read: false,
      metadata: {
        mode: "ai-minimal",
        schedule_id: row.id,
        description: row.description,
        model,
      },
    })
    .select("id")
    .single();

  return { content, messageId: (data as { id: string } | null)?.id ?? null };
}

async function fireAiFull(
  row: ScheduleRow,
  bot: BotRow,
  child: ChildRow | null,
  admin: SupabaseClient,
): Promise<{
  content: string;
  messageId: string | null;
  tile: ChatTile | null;
}> {
  const model = selectGeminiModel(bot.role);

  // Resolve children + memory + system prompt up-front. The cron path
  // doesn't have a currentSurface (no UI in flight) — pass null.
  const children = await getUserChildren(bot.user_id, bot.role);
  const memoryTable = await buildMemoryTable({
    botId: bot.id,
    childIds: children.map((c) => c.id),
    supabase: admin,
  });
  const systemPrompt = await buildSystemPrompt({
    botId: bot.id,
    userId: bot.user_id,
    role: bot.role,
    effectiveRole: bot.role,
    userName: "there",
    children,
    currentSurface: null,
    memoryTable,
  });

  const today = new Date().toLocaleDateString(APP_LOCALE, {
    weekday: "long",
    timeZone: row.timezone,
  });
  const initialPromptText = [
    `Today is ${today}.`,
    child
      ? `You are running the scheduled trigger "${row.trigger_id}" for ${child.first_name}.`
      : `You are running the scheduled trigger "${row.trigger_id}".`,
    "Run the trigger now. Use read tools for context, write tiles when appropriate. End with a short text recap (under 4 sentences).",
    "",
    row.prompt_fragment ?? row.description,
  ].join("\n\n");

  const toolDefs = collectTools(bot.role, bot.settings ?? undefined);
  const tools: GeminiTool[] | undefined =
    toolDefs.length > 0
      ? [
          {
            functionDeclarations: toolDefs.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            })),
          },
        ]
      : undefined;

  const result = await runScheduledAgenticLoop({
    model,
    systemPrompt,
    initialPromptText,
    tools,
    runTool: async (call) => {
      // Defensive: Gemini's functionCall name is `string | undefined` at
      // the SDK boundary. Guard before dispatch so a malformed response
      // never crashes the loop.
      if (!call.name) {
        return { success: false, error: "tool call missing name" };
      }
      const handlerModule = findToolHandler(
        call.name,
        bot.role,
        bot.settings ?? undefined,
      );
      if (!handlerModule) {
        return { success: false, error: `Unknown tool: ${call.name}` };
      }
      return handlerModule.execute(
        call.name,
        (call.args ?? {}) as Record<string, unknown>,
        {
          botId: bot.id,
          userId: bot.user_id,
          userRole: bot.role,
          effectiveRole: bot.role,
          children,
          currentSurface: null,
          supabase: admin,
        },
      );
    },
  });

  // Hard fail on the silent-no-content path — empty text AND no tile is
  // never a valid scheduled fire. Throwing propagates to runDueSchedules'
  // catch which records last_status='error', so the schedule retries on
  // its next tick instead of advancing past a wasted run.
  if (!result.fullText.trim() && !result.lastTile) {
    throw new Error(
      `ai-full produced no content (no text, no tile) for trigger ${row.trigger_id}`,
    );
  }

  // Empty text but tile present: persist a placeholder string so the
  // chat_messages row is well-formed; the tile carries the meaning.
  const content = result.fullText.trim() || "…";

  await updateDailyCost(bot.id, model, result.usage, "proactive");

  const { data, error: insertError } = await admin
    .from("chat_messages")
    .insert({
      bloombot_id: bot.id,
      role: "assistant",
      content,
      trigger_source: "proactive",
      proactive_trigger_id: row.trigger_id,
      proactive_schedule_id: row.id,
      is_read: false,
      tile: result.lastTile,
      metadata: {
        mode: "ai-full",
        schedule_id: row.id,
        description: row.description,
        model,
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        cached_tokens: result.usage.cachedTokens,
      },
    })
    .select("id")
    .single();

  if (insertError) {
    // Surface the failure so runDueSchedules records last_status='error'
    // instead of advancing the schedule as if it fired.
    throw new Error(
      `chat_messages insert failed for ai-full trigger ${row.trigger_id}: ${insertError.message}`,
    );
  }

  return {
    content,
    messageId: (data as { id: string } | null)?.id ?? null,
    tile: result.lastTile,
  };
}

async function updateScheduleAfterFire(
  row: ScheduleRow,
  status: DispatchResult["status"],
  reason: string | undefined,
  admin: SupabaseClient,
): Promise<string | undefined> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    last_run_at: now,
    last_status: status,
    last_error: reason ?? null,
  };

  let nextRunAt: string | undefined;
  if (row.cron_expr) {
    try {
      const it = CronExpressionParser.parse(row.cron_expr, {
        tz: row.timezone,
      });
      nextRunAt = it.next().toDate().toISOString();
      patch.next_run_at = nextRunAt;
    } catch {
      // Leave next_run_at alone; dispatcher will keep re-reading it
      // next tick — which will spin. Best-effort: deactivate.
      patch.active = false;
      patch.last_error = `cron parse failed; deactivating`;
    }
  } else {
    // one_time_at — single fire, deactivate after success.
    patch.active = false;
  }

  await admin.from("proactive_schedules").update(patch).eq("id", row.id);
  return nextRunAt;
}

export async function runDueSchedules(
  admin: SupabaseClient,
  now: Date = new Date(),
  limit = 50,
): Promise<DispatchResult[]> {
  const results: DispatchResult[] = [];

  const { data: rows, error } = await admin
    .from("proactive_schedules")
    .select()
    .eq("active", true)
    .lte("next_run_at", now.toISOString())
    .order("next_run_at", { ascending: true })
    .limit(limit);

  if (error || !rows || rows.length === 0) return results;

  // Batch-load bots + children referenced by this tick.
  const botIds = Array.from(
    new Set((rows as ScheduleRow[]).map((r) => r.bloombot_id)),
  );
  const childIds = Array.from(
    new Set(
      (rows as ScheduleRow[])
        .map((r) => r.child_client_id)
        .filter((id): id is string => id !== null),
    ),
  );

  const { data: bots } = await admin
    .from("bloombot")
    .select("id, user_id, role, settings")
    .in("id", botIds);
  const botMap = new Map<string, BotRow>();
  for (const b of (bots ?? []) as BotRow[]) botMap.set(b.id, b);

  // WU 14 — connected-child gate. Inactive nannies (signed up to the
  // marketplace but never placed) are the cost-explosion case: they
  // have a `bloombot` row but no developmental data to act on. Skip
  // AI cron for any user without a connected child_client. Templates
  // (mode === "template") still fire — they're cheap and may carry
  // marketplace-relevant content. AI tiers (ai-minimal / ai-full)
  // get short-circuited with status="skipped_no_child".
  const { getUsersWithChildren } = await import("@/lib/chat/bot");
  const userIdsToCheck = Array.from(
    new Set(Array.from(botMap.values()).map((b) => b.user_id)),
  );
  const usersWithChildren = await getUsersWithChildren(userIdsToCheck);

  const childMap = new Map<string, ChildRow>();
  if (childIds.length > 0) {
    const { data: children } = await admin
      .from("child_client")
      .select("id, first_name")
      .in("id", childIds);
    for (const c of (children ?? []) as ChildRow[]) childMap.set(c.id, c);
  }

  for (const row of rows as ScheduleRow[]) {
    const bot = botMap.get(row.bloombot_id);
    if (!bot) {
      results.push({
        schedule_id: row.id,
        status: "error",
        reason: "bot not found",
      });
      await updateScheduleAfterFire(row, "error", "bot not found", admin);
      continue;
    }

    if (!inWakingHours(bot.settings?.waking_hours, now)) {
      results.push({ schedule_id: row.id, status: "skipped_waking" });
      // Don't advance next_run_at — we want to re-try at the next tick
      // once we're inside the window. Update last_run_at timestamp so
      // the row isn't totally inert.
      await admin
        .from("proactive_schedules")
        .update({
          last_run_at: now.toISOString(),
          last_status: "skipped_waking",
        })
        .eq("id", row.id);
      continue;
    }

    const child = row.child_client_id
      ? (childMap.get(row.child_client_id) ?? null)
      : null;

    // WU 14 — connected-child gate for AI tiers. Templates always run
    // (they're cheap, scripted, and may carry marketplace content).
    // ai-minimal and ai-full are SKIPPED for users without a connected
    // child_client. The schedule's next_run_at is still advanced so we
    // don't re-attempt every tick — once the user gets a placement
    // their next firing will succeed, so we treat the skip as a
    // non-event from the schedule's perspective.
    const userHasChild = usersWithChildren.has(bot.user_id);
    if (!userHasChild && row.mode !== "template") {
      results.push({ schedule_id: row.id, status: "skipped_no_child" });
      await updateScheduleAfterFire(row, "skipped_waking", undefined, admin);
      // Reusing the "skipped_waking" status for last_status so we don't
      // need a schema migration. The DispatchResult above carries the
      // accurate "skipped_no_child" signal for observability.
      continue;
    }

    try {
      if (row.mode === "template") {
        const { messageId } = await fireTemplate(row, bot, child, admin);
        const nextRunAt = await updateScheduleAfterFire(
          row,
          "fired",
          undefined,
          admin,
        );
        results.push({
          schedule_id: row.id,
          status: "fired",
          message_id: messageId ?? undefined,
          next_run_at: nextRunAt,
        });
      } else if (row.mode === "ai-minimal") {
        const { messageId } = await fireAiMinimal(row, bot, child, admin);
        const nextRunAt = await updateScheduleAfterFire(
          row,
          "fired",
          undefined,
          admin,
        );
        results.push({
          schedule_id: row.id,
          status: "fired",
          message_id: messageId ?? undefined,
          next_run_at: nextRunAt,
        });
      } else {
        // ai-full — full agentic loop with tool calling + memory + tiles.
        const { messageId } = await fireAiFull(row, bot, child, admin);
        const nextRunAt = await updateScheduleAfterFire(
          row,
          "fired",
          undefined,
          admin,
        );
        results.push({
          schedule_id: row.id,
          status: "fired",
          message_id: messageId ?? undefined,
          next_run_at: nextRunAt,
        });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await updateScheduleAfterFire(row, "error", reason, admin);
      results.push({ schedule_id: row.id, status: "error", reason });
    }
  }

  return results;
}
