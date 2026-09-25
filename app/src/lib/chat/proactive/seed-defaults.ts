/**
 * Default proactive schedules seeded on bot creation.
 *
 * Currently seeds one `child.weekly_overview` schedule per accessible
 * child — tier-3 ai-full, Friday 18:00 local. The dispatcher treats
 * ai-full as deferred for now (skipped_ai_full), but the row is in
 * place so when ai-full support lands, every existing user's weekly
 * overview fires automatically.
 *
 * See system/APP/BLOOMBOT/PROACTIVE-MESSAGES.md §"Katie spotting a
 * pattern and scheduling an overview".
 *
 * Idempotent: checks existing (bloombot_id, trigger_id, child_client_id)
 * triples before inserting, so calling this repeatedly with the same
 * children is a no-op.
 *
 * Concurrency: for v1 this read-then-write idempotency is sufficient
 * because the upstream `bloombot` INSERT is gated by UNIQUE(user_id) —
 * only one caller per user ever reaches this code path. If a future
 * change opens a second entry-point that could call with the same bot
 * id concurrently, add UNIQUE(bloombot_id, trigger_id, child_client_id)
 * + switch to upsert(onConflict: ..., ignoreDuplicates: true).
 *
 * Failure policy: seeding is a best-effort side effect of bot creation.
 * Errors are logged + swallowed so the first-chat experience isn't
 * blocked by a seed failure.
 */

import { CronExpressionParser } from "cron-parser";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChildSummary } from "@/lib/chat/context";
import { APP_TZ } from "@/lib/constants";

export const WEEKLY_OVERVIEW_TRIGGER_ID = "child.weekly_overview" as const;
/** Friday 18:00 local — matches the PROACTIVE-MESSAGES.md reference example. */
export const WEEKLY_OVERVIEW_CRON = "0 18 * * 5" as const;
const DEFAULT_TZ = APP_TZ;

export interface WeeklyOverviewPayload {
  child_name: string;
}

export interface WeeklyOverviewSeedRow {
  bloombot_id: string;
  child_client_id: string;
  trigger_id: typeof WEEKLY_OVERVIEW_TRIGGER_ID;
  module_id: "child-profile";
  description: string;
  created_by: "module";
  cron_expr: typeof WEEKLY_OVERVIEW_CRON;
  one_time_at: null;
  timezone: string;
  next_run_at: string;
  mode: "ai-full";
  template: null;
  prompt_fragment: string;
  payload: WeeklyOverviewPayload;
  active: true;
}

function weeklyOverviewPrompt(childName: string): string {
  return [
    `Write a 3-4 line weekly overview of ${childName}'s development this week.`,
    "Lead with one notable win, one thing to watch, and one suggestion for next week.",
    "Keep it warm and specific — this is a scheduled moment the user looks forward to.",
  ].join(" ");
}

export function buildWeeklyOverviewSeed(
  botId: string,
  child: Pick<ChildSummary, "id" | "firstName">,
  timezone: string = DEFAULT_TZ,
): WeeklyOverviewSeedRow {
  const it = CronExpressionParser.parse(WEEKLY_OVERVIEW_CRON, { tz: timezone });
  const nextRunAt = it.next().toDate().toISOString();
  return {
    bloombot_id: botId,
    child_client_id: child.id,
    trigger_id: WEEKLY_OVERVIEW_TRIGGER_ID,
    module_id: "child-profile",
    description: `Weekly overview of ${child.firstName}'s development`,
    created_by: "module",
    cron_expr: WEEKLY_OVERVIEW_CRON,
    one_time_at: null,
    timezone,
    next_run_at: nextRunAt,
    mode: "ai-full",
    template: null,
    prompt_fragment: weeklyOverviewPrompt(child.firstName),
    payload: { child_name: child.firstName },
    active: true,
  };
}

/**
 * Seeds the default weekly_overview schedule for each child. Idempotent.
 * Returns the number of rows inserted (0 if all children were already
 * seeded or the insert failed).
 */
export async function seedDefaultSchedules(
  admin: SupabaseClient,
  botId: string,
  children: ChildSummary[],
  timezone: string = DEFAULT_TZ,
): Promise<number> {
  if (children.length === 0) return 0;

  const { data: existing, error: selectError } = await admin
    .from("proactive_schedules")
    .select("child_client_id")
    .eq("bloombot_id", botId)
    .eq("trigger_id", WEEKLY_OVERVIEW_TRIGGER_ID)
    .in(
      "child_client_id",
      children.map((c) => c.id),
    );

  if (selectError) {
    // Log `code` alongside `message` so a permissions regression (PGRST
    // 42501) is distinguishable from a transient error in prod logs.
    console.warn(
      "[proactive] seed weekly_overview select failed:",
      (selectError as { code?: string }).code ?? "no-code",
      selectError.message,
    );
    return 0;
  }

  // Runtime-guard the shape: a column rename or schema drift would
  // otherwise silently empty `existingIds` and re-insert every time.
  const existingIds = new Set(
    (existing ?? [])
      .map(
        (row) => (row as { child_client_id?: string | null }).child_client_id,
      )
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );

  const newChildren = children.filter((c) => !existingIds.has(c.id));
  if (newChildren.length === 0) return 0;

  const rows = newChildren.map((c) =>
    buildWeeklyOverviewSeed(botId, c, timezone),
  );
  const { error: insertError } = await admin
    .from("proactive_schedules")
    .insert(rows);

  if (insertError) {
    console.warn(
      "[proactive] seed weekly_overview insert failed:",
      (insertError as { code?: string }).code ?? "no-code",
      insertError.message,
      { botId, rowCount: rows.length },
    );
    return 0;
  }
  return rows.length;
}
