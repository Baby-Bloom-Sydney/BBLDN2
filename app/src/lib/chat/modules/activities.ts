/**
 * `activities` module — generates activity plans tied to milestones.
 *
 * Two-turn (WU 8.22d, model swapped to Gemini Pro in WU 9.7):
 *   - propose_X (LLM-callable `plan_activity`): validates args,
 *     loads milestone context, runs Gemini Pro inline, returns a
 *     `kind: "draft"` tile carrying the GENERATED plan in args.
 *     No DB writes. The user sees the actual plan in the draft
 *     preview before deciding to Accept.
 *   - apply (`applyPlanActivity`, called by /api/chat/drafts/accept):
 *     takes the propose-output args (which already include the
 *     generated plan) and INSERTS a bapp_logs row with
 *     status='ready'. No re-generation — the plan is already in
 *     args, so Accept is cheap.
 *
 * Trade-off: generation runs at propose time (so the user sees the
 * actual plan before accepting). A Dismiss therefore wastes the
 * generation cost. Amend cycles are user-initiated and re-run
 * propose with revised milestone_ids; the cost is bounded.
 */

import type { BloomBotModule, ToolResult, ChildSummary } from "./types";
import type { ActivityChatTile } from "@/lib/chat/tiles";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveChild } from "./utils";
import { hasParentMediaConsent } from "@/lib/legal/media-consent-gate";
import { generate, GEMINI_MODELS } from "@/lib/ai/gemini-client";
import { notifyParentOfFeedPost } from "@/lib/email/feed-post-notification";
import {
  ACTIVITY_SYSTEM_PROMPT,
  buildActivityUserPrompt,
} from "@/lib/ai/prompts/bapp-activity-generation";
import type { ActivityPlan } from "@/types/bapp";
import {
  recalculateProgress,
  writeHistorySnapshot,
} from "@/lib/bapp/progress-write";

interface MilestoneContextRow {
  id: string;
  domain: string;
  age_bracket: string;
  description: string;
}

interface PromptContextEntry {
  domain: string;
  age: string;
  desc: string;
}

interface PreparedActivity {
  child: ChildSummary;
  milestoneIds: string[];
  promptContext: PromptContextEntry[];
}

async function prepareActivity(
  args: Record<string, unknown>,
  ctx: { children: ChildSummary[]; supabase: SupabaseClient },
): Promise<
  | { ok: true; prepared: PreparedActivity }
  | { ok: false; error: string; terminal?: boolean }
> {
  const r = resolveChild(args.child_name, ctx.children);
  if (r.error) {
    return {
      ok: false,
      error: r.error.error ?? "Could not resolve child.",
      terminal: r.error.terminal,
    };
  }
  const child = r.child;

  const milestoneIds = Array.isArray(args.milestone_ids)
    ? (args.milestone_ids.filter(
        (m) => typeof m === "string" && m.trim().length > 0,
      ) as string[])
    : [];
  if (milestoneIds.length === 0) {
    return {
      ok: false,
      error:
        "plan_activity needs a `milestone_ids` array. Call read_milestones first to pick the milestones to target.",
    };
  }

  const { data: milestones } = await ctx.supabase
    .from("bapp_milestones")
    .select("id, domain, age_bracket, description")
    .in("id", milestoneIds);

  const rows = ((milestones ?? []) as MilestoneContextRow[]).filter(Boolean);
  if (rows.length === 0) {
    return {
      ok: false,
      error: `No milestones found for ids: ${milestoneIds.join(", ")}`,
    };
  }
  const promptContext: PromptContextEntry[] = rows.map((m) => ({
    domain: m.domain,
    age: m.age_bracket,
    desc: m.description,
  }));

  return {
    ok: true,
    prepared: { child, milestoneIds, promptContext },
  };
}

/**
 * Generate the actual ActivityPlan JSON via Gemini 3 Pro.
 *
 * Pro is intentional, not Flash: activity creativity is the dominant
 * cost factor for tile quality. Pro gets us evocative themes + memorable
 * names ("Bubble Catcher's Quest") instead of dry labels ("Name and use
 * picture props"). The cost delta per activity is small relative to the
 * UX impact.
 *
 * The model is a separate decision from Katie's chat model — Katie
 * (Flash for non-admin) calls `propose_plan_activity` which calls THIS
 * function; the result is what the user sees in the draft tile.
 */
async function generateActivityPlan(
  child: ChildSummary,
  promptContext: PromptContextEntry[],
): Promise<{ ok: true; plan: ActivityPlan } | { ok: false; error: string }> {
  try {
    const userPrompt = buildActivityUserPrompt(
      child.firstName,
      child.ageMonths,
      promptContext,
    );
    const resp = await generate({
      model: GEMINI_MODELS.pro,
      systemPrompt: ACTIVITY_SYSTEM_PROMPT,
      contents: userPrompt,
    });
    const content = resp.text ?? "";
    if (!content) throw new Error("Empty response from Gemini");
    // Gemini doesn't have OpenAI's response_format=json_object knob,
    // but the system prompt instructs "No markdown, no code fences,
    // no extra text". Strip any stray fences defensively in case the
    // model wraps the JSON anyway.
    const cleaned = content
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const plan = JSON.parse(cleaned) as ActivityPlan;
    return { ok: true, plan };
  } catch (err) {
    return {
      ok: false,
      error: `Activity generation failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function buildActivityTile(
  logId: string,
  childId: string,
  authorId: string,
  data: Record<string, unknown>,
  createdAtIso: string,
): ActivityChatTile {
  return {
    kind: "activity",
    data: {
      item: {
        id: logId,
        child_client_id: childId,
        author_id: authorId,
        author_name: "Katie",
        type: "activity",
        status: "ready",
        context: "adhoc",
        parent_log_id: null,
        data,
        created_at: createdAtIso,
        updated_at: createdAtIso,
      },
    },
  };
}

// ── Propose path (LLM-callable) ──────────────────────────────────────────

async function proposePlanActivity(
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const r = await prepareActivity(args, {
    children: ctx.children,
    supabase: ctx.supabase,
  });
  if (!r.ok) {
    return { success: false, error: r.error, terminal: r.terminal };
  }
  const { child, milestoneIds, promptContext } = r.prepared;

  // Run generation NOW so the user sees the actual plan in the
  // draft preview. Apply just inserts the already-generated plan.
  const gen = await generateActivityPlan(child, promptContext);
  if (!gen.ok) {
    return { success: false, error: gen.error };
  }
  const plan = gen.plan;

  const title = plan?.creativeName ?? "Activity Plan";
  const imageUrl =
    typeof args.image_url === "string" && args.image_url.trim().length > 0
      ? args.image_url.trim()
      : null;

  const activityData = {
    milestone_ids: milestoneIds,
    prompt_context: promptContext,
    activity_json: plan,
    title,
    image_url: imageUrl,
  };

  // Re-pack args with the generated plan so applyPlanActivity can
  // insert without re-calling OpenAI. The plan + prompt_context
  // ride along; a future amend cycle replaces them by re-running
  // propose with new milestone_ids.
  const argsWithPlan = {
    ...args,
    _generated: { activityData },
  };

  const draftId = `draft_${crypto.randomUUID()}`;
  const nowIso = new Date().toISOString();
  return {
    success: true,
    data: {
      draft_id: draftId,
      child_name: child.firstName,
      title,
      milestone_ids: milestoneIds,
      plan,
    },
    tile: {
      kind: "draft",
      data: {
        draftId,
        toolName: "plan_activity",
        args: argsWithPlan,
        preview: buildActivityTile(
          draftId,
          child.id,
          ctx.userId,
          activityData,
          nowIso,
        ),
      },
    },
  };
}

// ── Apply path (frontend-callable via /api/chat/drafts/accept) ───────────

export interface ActivityApplyResult {
  ok: true;
  tile: ActivityChatTile;
  data: { log_id: string; child_name: string; title: string };
}

export interface ActivityApplyError {
  ok: false;
  error: string;
}

export async function applyPlanActivity(
  args: Record<string, unknown>,
  ctx: { userId: string; children: ChildSummary[]; supabase: SupabaseClient },
): Promise<ActivityApplyResult | ActivityApplyError> {
  const r = await prepareActivity(args, {
    children: ctx.children,
    supabase: ctx.supabase,
  });
  if (!r.ok) {
    return { ok: false, error: r.error };
  }
  const { child } = r.prepared;

  // Apply uses the generation produced at propose-time. If the
  // chat client somehow strips `_generated`, falls through to a
  // re-generation so we don't insert an empty plan.
  //
  // Consistency check: a prior amend cycle could have changed
  // `milestone_ids` in args without re-running propose, leaving
  // `_generated.activityData` keyed against an older milestone set.
  // If the IDs don't match, regenerate rather than persisting a
  // plan that doesn't reflect the user's current intent.
  let activityData: Record<string, unknown>;
  const generated = (
    args as { _generated?: { activityData?: Record<string, unknown> } }
  )._generated?.activityData;
  const isPlainObject =
    generated && typeof generated === "object" && !Array.isArray(generated);
  let useGenerated = false;
  if (isPlainObject) {
    const generatedIds = Array.isArray(
      (generated as { milestone_ids?: unknown }).milestone_ids,
    )
      ? (
          (generated as { milestone_ids?: unknown[] }).milestone_ids ?? []
        ).filter((v): v is string => typeof v === "string")
      : [];
    const currentIds = r.prepared.milestoneIds;
    const setsMatch =
      generatedIds.length === currentIds.length &&
      currentIds.every((id) => generatedIds.includes(id));
    if (setsMatch) {
      useGenerated = true;
    }
  }
  if (useGenerated) {
    activityData = { ...(generated as Record<string, unknown>) };
  } else {
    const gen = await generateActivityPlan(
      r.prepared.child,
      r.prepared.promptContext,
    );
    if (!gen.ok) return { ok: false, error: gen.error };
    activityData = {
      milestone_ids: r.prepared.milestoneIds,
      prompt_context: r.prepared.promptContext,
      activity_json: gen.plan,
      title: gen.plan?.creativeName ?? "Activity Plan",
      image_url: null,
    };
  }

  // Image_url may have been added on the draft tile post-propose.
  if (typeof args.image_url === "string" && args.image_url.trim().length > 0) {
    activityData = { ...activityData, image_url: args.image_url.trim() };
  } else if (args.image_url === null) {
    activityData = { ...activityData, image_url: null };
  }

  // T-015 media gate.
  const activityImageUrl =
    typeof (activityData as { image_url?: unknown }).image_url === "string"
      ? ((activityData as { image_url?: string }).image_url ?? null)
      : null;
  if (activityImageUrl) {
    const gate = await hasParentMediaConsent(
      { childId: child.id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { admin: ctx.supabase as any },
    );
    if (!gate.allowed) {
      return { ok: false, error: "media_consent_required" };
    }
  }

  const { data: inserted, error: insertErr } = await ctx.supabase
    .from("bapp_logs")
    .insert({
      child_client_id: child.id,
      author_id: ctx.userId,
      type: "activity",
      status: "ready",
      context: "adhoc",
      data: activityData,
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    return {
      ok: false,
      error: `Failed to write activity log: ${insertErr?.message ?? "unknown"}`,
    };
  }
  const logId = (inserted as { id: string }).id;

  // Email the linked parent that a new tile landed (non-fatal — internal
  // errors are absorbed, never cause action failure). Skip rules + lookups
  // are inside the helper.
  //
  // NOTE — Katie-path is the GOOD case: the activity tile lands at
  // `status='ready'` because Gemini ran inline at propose time, so the
  // parent's email link resolves to a fully-rendered tile. (The bapp-side
  // `actions/bapp/activities.ts:generateActivity` path has the opposite
  // shape — it inserts at `status='pending'` and the email arrives before
  // OpenAI finishes. KEY decision deferred to BAI at Phase D smoke per
  // T-033 PROGRESS § decisions.)
  await notifyParentOfFeedPost({
    childId: child.id,
    authorId: ctx.userId,
    logType: "activity",
    logContext: "adhoc",
  });

  const title =
    typeof activityData.title === "string"
      ? activityData.title
      : "Activity Plan";
  const nowIso = new Date().toISOString();
  return {
    ok: true,
    data: { log_id: logId, child_name: child.firstName, title },
    tile: buildActivityTile(logId, child.id, ctx.userId, activityData, nowIso),
  };
}

// ── complete_activity (WU 11.1) ──────────────────────────────────────────
//
// Closes the activity loop. plan_activity creates a row at status='ready';
// without complete_activity the dashboard accumulates "ready" rows that
// never resolve and the targeted milestones never get scored.
//
// Two-turn shape: propose drafts a katie_note preview describing what the
// completion will do; apply runs the report cascade (insert report +
// progress logs, recalc progress, write history snapshot, mark activity
// 'completed').
//
// Idempotency: the apply path checks the activity's current status before
// running the cascade — if already 'completed', returns the existing
// report log id without re-cascading. Protects against double-clicks +
// the WU 11.3 draft-accept dedup as defence-in-depth.

interface ActivityRowForCompletion {
  id: string;
  child_client_id: string;
  status: string;
  data: { milestone_ids?: string[]; title?: string } | null;
}

interface ActivityRating {
  milestone_id: string;
  score: 1 | 2 | 3 | 4;
}

interface PreparedCompletion {
  child: ChildSummary;
  activity: ActivityRowForCompletion;
  ratings: ActivityRating[];
  feedback: string | null;
  imageUrl: string | null;
}

async function prepareCompletion(
  args: Record<string, unknown>,
  ctx: { children: ChildSummary[]; supabase: SupabaseClient },
): Promise<
  | { ok: true; prepared: PreparedCompletion }
  | { ok: false; error: string; terminal?: boolean }
> {
  const activityId =
    typeof args.activity_id === "string" && args.activity_id.trim().length > 0
      ? args.activity_id.trim()
      : null;
  if (!activityId) {
    return {
      ok: false,
      error:
        "complete_activity needs `activity_id` — the bapp_logs id of the activity row to mark done. Call read_recent_feed with type_filter='activity' to find pending activities (status='ready').",
    };
  }

  const { data: row, error } = await ctx.supabase
    .from("bapp_logs")
    .select("id, child_client_id, status, type, data")
    .eq("id", activityId)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      error: `Failed to load activity: ${error.message}`,
    };
  }
  if (!row || (row as { type?: string }).type !== "activity") {
    return {
      ok: false,
      error: `Activity ${activityId} not found.`,
      terminal: true,
    };
  }
  const activity = row as ActivityRowForCompletion;

  // Resolve child via the activity's child_client_id, not the args.
  // This protects against the model passing a wrong child_name when
  // the user has multiple children — the activity row is the source
  // of truth.
  const child = ctx.children.find((c) => c.id === activity.child_client_id);
  if (!child) {
    return {
      ok: false,
      error:
        "That activity belongs to a child you don't have access to in this account.",
      terminal: true,
    };
  }

  // Ratings: optional but strongly encouraged. The activity targets
  // specific milestones; completing without scoring them defeats the
  // whole purpose of the loop. If ratings missing, we still allow the
  // completion (textual report only) — Katie's prompt nudges her to
  // collect them.
  const ratings: ActivityRating[] = [];
  if (Array.isArray(args.ratings)) {
    for (const r of args.ratings as Array<unknown>) {
      if (typeof r !== "object" || r === null) continue;
      const obj = r as { milestone_id?: unknown; score?: unknown };
      if (typeof obj.milestone_id !== "string") continue;
      if (typeof obj.score !== "number") continue;
      const s = Math.round(obj.score);
      if (s < 1 || s > 4) continue;
      ratings.push({
        milestone_id: obj.milestone_id.trim(),
        score: s as 1 | 2 | 3 | 4,
      });
    }
  }

  const feedback =
    typeof args.feedback === "string" && args.feedback.trim().length > 0
      ? args.feedback.trim()
      : null;

  const imageUrl =
    typeof args.image_url === "string" && args.image_url.trim().length > 0
      ? args.image_url.trim()
      : null;

  return {
    ok: true,
    prepared: { child, activity, ratings, feedback, imageUrl },
  };
}

function buildCompletionPreviewBody(
  prepared: PreparedCompletion,
  milestoneDescriptions: Map<string, string>,
): string {
  const lines: string[] = [];
  const title = prepared.activity.data?.title ?? "Activity";
  lines.push(`**${title}** — marking complete.`);

  if (prepared.ratings.length > 0) {
    lines.push("");
    lines.push("Progress updates on accept:");
    for (const r of prepared.ratings) {
      const desc = milestoneDescriptions.get(r.milestone_id) ?? r.milestone_id;
      lines.push(`- ${desc} → ${r.score}/4`);
    }
  } else {
    lines.push("");
    lines.push(
      "No milestone scores attached — completion will save without progress updates.",
    );
  }

  if (prepared.feedback) {
    lines.push("");
    lines.push(`Note: ${prepared.feedback}`);
  }

  return lines.join("\n");
}

async function proposeCompleteActivity(
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const r = await prepareCompletion(args, {
    children: ctx.children,
    supabase: ctx.supabase,
  });
  if (!r.ok) {
    return { success: false, error: r.error, terminal: r.terminal };
  }

  // Translate the milestone IDs in the ratings to human-readable
  // descriptions for the draft preview. The user reads the preview, not
  // the IDs — this is the same hide-internal-IDs rule applied at the
  // tile level.
  const milestoneDescriptions = new Map<string, string>();
  if (r.prepared.ratings.length > 0) {
    const ids = r.prepared.ratings.map((rt) => rt.milestone_id);
    const { data: descRows } = await ctx.supabase
      .from("bapp_milestones")
      .select("id, description")
      .in("id", ids);
    for (const row of (descRows ?? []) as Array<{
      id: string;
      description: string;
    }>) {
      milestoneDescriptions.set(row.id, row.description);
    }
  }

  const body = buildCompletionPreviewBody(r.prepared, milestoneDescriptions);
  const draftId = `draft_${crypto.randomUUID()}`;
  return {
    success: true,
    data: {
      draft_id: draftId,
      child_name: r.prepared.child.firstName,
      activity_id: r.prepared.activity.id,
      ratings_count: r.prepared.ratings.length,
    },
    tile: {
      kind: "draft",
      data: {
        draftId,
        toolName: "complete_activity",
        args,
        preview: {
          kind: "katie_note",
          data: {
            badge: "Activity completion",
            title: r.prepared.activity.data?.title ?? "Activity",
            body,
            ...(r.prepared.imageUrl ? { image_url: r.prepared.imageUrl } : {}),
          },
        },
      },
    },
  };
}

// ── Apply path for complete_activity ─────────────────────────────────────

export interface CompleteActivityApplyResult {
  ok: true;
  tile: ActivityChatTile;
  data: {
    activity_id: string;
    /**
     * UUID of the report log row created by this completion. `null`
     * only on the idempotent "already completed" branch when no
     * prior report row could be located (rare — would mean the
     * activity was marked completed without going through the
     * cascade, e.g. via direct SQL).
     */
    report_log_id: string | null;
    child_name: string;
    progress_updated: boolean;
  };
  warning?: string;
}

export interface CompleteActivityApplyError {
  ok: false;
  error: string;
}

export async function applyCompleteActivity(
  args: Record<string, unknown>,
  ctx: { userId: string; children: ChildSummary[]; supabase: SupabaseClient },
): Promise<CompleteActivityApplyResult | CompleteActivityApplyError> {
  const r = await prepareCompletion(args, {
    children: ctx.children,
    supabase: ctx.supabase,
  });
  if (!r.ok) {
    return { ok: false, error: r.error };
  }
  const { child, activity, ratings, feedback, imageUrl } = r.prepared;

  // Idempotency: if the activity is already completed we treat it as
  // a no-op success and return the most-recent report row associated
  // with it. Avoids double-cascading on retried accept.
  if (activity.status === "completed") {
    const { data: existingReport } = await ctx.supabase
      .from("bapp_logs")
      .select("id, data, created_at, updated_at")
      .eq("parent_log_id", activity.id)
      .eq("type", "report")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const reportId = (existingReport as { id?: string } | null)?.id ?? null;
    return {
      ok: true,
      data: {
        activity_id: activity.id,
        report_log_id: reportId,
        child_name: child.firstName,
        progress_updated: false,
      },
      tile: buildActivityTile(
        activity.id,
        child.id,
        ctx.userId,
        { ...(activity.data ?? {}), status_label: "completed" },
        new Date().toISOString(),
      ),
      warning: "This activity was already marked complete.",
    };
  }

  // T-015 media gate.
  if (imageUrl) {
    const gate = await hasParentMediaConsent(
      { childId: child.id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { admin: ctx.supabase as any },
    );
    if (!gate.allowed) {
      return { ok: false, error: "media_consent_required" };
    }
  }

  // 1. Insert the report log (parent_log_id = activityId)
  const { data: reportRow, error: reportErr } = await ctx.supabase
    .from("bapp_logs")
    .insert({
      child_client_id: child.id,
      author_id: ctx.userId,
      type: "report",
      status: "completed",
      context: "adhoc",
      parent_log_id: activity.id,
      data: {
        feedback,
        rating_count: ratings.length,
        title: "Activity Report",
        image_url: imageUrl,
      },
    })
    .select("id")
    .single<{ id: string }>();
  if (reportErr || !reportRow) {
    return {
      ok: false,
      error: `Failed to write report log: ${reportErr?.message ?? "unknown"}`,
    };
  }
  const reportId = reportRow.id;

  // 2. Optional progress + observation child logs (mirror submitReport).
  // Both are best-effort: if either fails the report is already saved.
  let cascadeWarning: string | undefined;
  if (ratings.length > 0) {
    const { error: progressErr } = await ctx.supabase.from("bapp_logs").insert({
      child_client_id: child.id,
      author_id: ctx.userId,
      type: "progress",
      status: "completed",
      context: "activity",
      parent_log_id: reportId,
      data: {
        ratings,
        source_activity_id: activity.id,
      },
    });
    if (progressErr) {
      cascadeWarning = `Progress log couldn't be written: ${progressErr.message}.`;
    }
  }

  if (feedback) {
    const { error: obsErr } = await ctx.supabase.from("bapp_logs").insert({
      child_client_id: child.id,
      author_id: ctx.userId,
      type: "observation",
      status: "completed",
      context: "activity",
      parent_log_id: reportId,
      data: {
        note: feedback,
        title: "Activity feedback",
        image_url: imageUrl,
        source_activity_id: activity.id,
      },
    });
    if (obsErr) {
      cascadeWarning = cascadeWarning
        ? `${cascadeWarning} Feedback observation also failed.`
        : `Feedback observation couldn't be written: ${obsErr.message}.`;
    }
  }

  // 3. Cascade progress: recalc + history snapshot. recalculateProgress
  // is idempotent on equal-score repeats (Math.max), so a partial
  // re-run from a retried accept doesn't inflate scores.
  let progressUpdated = false;
  if (ratings.length > 0) {
    try {
      await recalculateProgress(
        child.id,
        ratings.map((rt) => ({ id: rt.milestone_id, score: rt.score })),
      );
      await writeHistorySnapshot(child.id, reportId);
      progressUpdated = true;
    } catch (err) {
      console.error("[applyCompleteActivity] cascade failure:", { err });
      cascadeWarning =
        cascadeWarning ??
        `Activity is marked complete but progress couldn't recalculate: ${
          err instanceof Error ? err.message : String(err)
        }.`;
    }
  }

  // 4. Mark the activity completed. Run AFTER the cascade so a cascade
  // crash leaves the activity 'ready' and the next accept re-runs.
  const { error: updateErr } = await ctx.supabase
    .from("bapp_logs")
    .update({ status: "completed" })
    .eq("id", activity.id);
  if (updateErr) {
    cascadeWarning = cascadeWarning
      ? `${cascadeWarning} Activity also couldn't be marked completed.`
      : `Couldn't mark the activity completed: ${updateErr.message}.`;
  }

  // 5. Email the linked parent that a new tile landed (non-fatal — internal
  // errors are absorbed, never cause action failure). Skip rules + lookups
  // are inside the helper. Only the HEAD `report` insert (context='adhoc')
  // triggers an email — the progress + observation sub-tiles above carry
  // context='activity', which the helper's 4th skip rule would short-
  // circuit anyway, so we don't wire them.
  await notifyParentOfFeedPost({
    childId: child.id,
    authorId: ctx.userId,
    logType: "report",
    logContext: "adhoc",
  });

  const nowIso = new Date().toISOString();
  return {
    ok: true,
    data: {
      activity_id: activity.id,
      report_log_id: reportId,
      child_name: child.firstName,
      progress_updated: progressUpdated,
    },
    tile: buildActivityTile(
      activity.id,
      child.id,
      ctx.userId,
      { ...(activity.data ?? {}), status_label: "completed" },
      nowIso,
    ),
    ...(cascadeWarning ? { warning: cascadeWarning } : {}),
  };
}

// ── Module export ────────────────────────────────────────────────────────

export const activitiesModule: BloomBotModule = {
  id: "activities",
  name: "Activities",
  description:
    "Drafts activity plans targeting specific milestones, and closes the loop by completing them after they've been done. Generation for plans runs at propose time so the user sees the plan before accepting; Accept inserts the bapp_logs row. Completion runs the full report cascade on Accept.",
  childScoped: true,

  tools: [
    {
      name: "plan_activity",
      description:
        "Draft an age-appropriate activity plan for the child targeting one or more specific milestones. Returns a draft tile carrying the GENERATED plan. The user must Accept to write it to the feed. Call read_milestones first — milestones already at high scores are poor targets.",
      parameters: {
        type: "object",
        properties: {
          child_name: {
            type: "string",
            description:
              "Which child (required if the user has multiple children; can omit if only one).",
          },
          milestone_ids: {
            type: "array",
            items: { type: "string" },
            description:
              "Milestone ids from bapp_milestones (e.g. ['NUM_12_18_1','CL_12_18_2']). At least one required.",
            minItems: 1,
          },
          image_url: {
            type: "string",
            description: "Optional image URL if the user attached a photo.",
          },
        },
        required: ["milestone_ids"],
      },
    },
    {
      name: "complete_activity",
      description:
        "Mark a previously-planned activity as done. Drafts a tile that, when Accepted, runs the full report cascade — writes the report row, optionally records milestone progress updates, records feedback as an observation, recalculates progress, and flips the activity row from status='ready' to 'completed'. Use this after the user has actually done the activity (or says they did) — typically the next day. Call read_recent_feed with type_filter='activity' first to find the pending activity_id.",
      parameters: {
        type: "object",
        properties: {
          activity_id: {
            type: "string",
            description:
              "The bapp_logs id of the ready activity. Get it from read_recent_feed (look for type='activity' status='ready').",
          },
          ratings: {
            type: "array",
            description:
              "Milestone scores you observed during the activity. Strongly encouraged — without ratings the completion produces a textual report only and progress isn't updated. Use the milestone_ids that the activity originally targeted (visible in the activity's data.milestone_ids).",
            items: {
              type: "object",
              properties: {
                milestone_id: { type: "string" },
                score: {
                  type: "number",
                  description:
                    "1=emerging, 2=developing, 3=established, 4=secure.",
                },
              },
              required: ["milestone_id", "score"],
            },
          },
          feedback: {
            type: "string",
            description:
              "Optional short note from the user about how the activity went.",
          },
          image_url: {
            type: "string",
            description:
              "Optional image URL if the user attached a photo of the activity in progress.",
          },
        },
        required: ["activity_id"],
      },
    },
  ],

  async execute(toolName, args, ctx) {
    if (toolName === "plan_activity") return proposePlanActivity(args, ctx);
    if (toolName === "complete_activity")
      return proposeCompleteActivity(args, ctx);
    return { success: false, error: `Unknown tool: ${toolName}` };
  },

  systemPromptFragment:
    "Activities have a two-step lifecycle: PLAN (status='ready') and COMPLETE (status='completed'). Use `plan_activity` to draft a new activity targeting LOW-scored milestones (call read_milestones first; pick observed_score < 3). Use `complete_activity` after the user has done it — surface an existing 'ready' activity from read_recent_feed if the user mentions doing one or asks how to track results. ALWAYS attach `ratings` (milestone_id + score 1-4) when completing, otherwise progress doesn't update and the loop is broken. Both tools return a DRAFT tile — say 'Drafted: <title>. Review and accept.' and stop.",
};
