/**
 * `progress` module — reads EYLF milestones + a child's observed scores.
 *
 * Phase 2A read module. One tool: read_milestones.
 *
 * The 210 milestones live in `bapp_milestones` (7 domains × 6 age brackets
 * × 5 per bracket). A child's scores live in `bapp_progress_scores`
 * (`scores` JSONB keyed by milestone id, `percent` per domain).
 *
 * Returned shape is intentionally compact so Gemini can reason across
 * domains without drowning in rows. Unobserved milestones carry
 * observed_score = 0.
 */

import type { BloomBotModule, ToolResult, ChildSummary } from "./types";
import type { ProgressChatTile } from "@/lib/chat/tiles";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveChild } from "./utils";
import { hasParentMediaConsent } from "@/lib/legal/media-consent-gate";
import { isChildNameInPreloadProfiles } from "@/lib/chat/preload/predicates";
import { notifyParentOfFeedPost } from "@/lib/email/feed-post-notification";
import {
  recalculateProgress,
  writeHistorySnapshot,
} from "@/lib/bapp/progress-write";

interface MilestoneRow {
  id: string;
  domain: string;
  age_bracket: string;
  description: string;
}

interface ProgressScoreRow {
  domain: string;
  percent: number;
  scores: Record<string, number> | null;
  updated_at: string | null;
}

async function readMilestones(
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const r = resolveChild(args.child_name, ctx.children);
  if (r.error) return r.error;
  const child = r.child;

  const ageBracket =
    typeof args.age_bracket === "string" && args.age_bracket.trim().length > 0
      ? args.age_bracket
      : child.ageBracket;

  // WU 13.3 — optional domain filter. Lets the caller scope to one
  // domain when they only need that subset (e.g. "what are her
  // language milestones?"). Without this filter the tool returns all
  // 35 (5 × 7) bracket-rows even when the model just wanted CL.
  const domainFilter =
    typeof args.domain === "string" && args.domain.trim().length > 0
      ? args.domain.trim().toUpperCase()
      : null;

  // 1. Load milestones for the bracket (public read — active only).
  // sort_order isn't selected — the model never uses it for reasoning,
  // and dropping it matches the snapshot trim from WU 13.1.
  let milestonesQuery = ctx.supabase
    .from("bapp_milestones")
    .select("id, domain, age_bracket, description")
    .eq("age_bracket", ageBracket)
    .eq("is_active", true);
  if (domainFilter) {
    milestonesQuery = milestonesQuery.eq("domain", domainFilter);
  }
  const { data: milestones, error: mError } =
    await milestonesQuery.order("domain");

  if (mError) {
    return {
      success: false,
      error: `Failed to read milestones: ${mError.message}`,
    };
  }

  // 2. Load this child's progress scores across all domains.
  const { data: scores, error: sError } = await ctx.supabase
    .from("bapp_progress_scores")
    .select("domain, percent, scores, updated_at")
    .eq("child_client_id", child.id);

  if (sError) {
    return {
      success: false,
      error: `Failed to read progress scores: ${sError.message}`,
    };
  }

  const scoreRows = (scores ?? []) as ProgressScoreRow[];

  // Flatten scores JSONB → id → score map for quick lookup.
  const observed = new Map<string, number>();
  for (const row of scoreRows) {
    if (!row.scores) continue;
    for (const [milestoneId, score] of Object.entries(row.scores)) {
      if (typeof score === "number") observed.set(milestoneId, score);
    }
  }

  // Per-domain summary.
  const domainSummary: Record<
    string,
    { percent: number; updated_at: string | null }
  > = {};
  for (const row of scoreRows) {
    domainSummary[row.domain] = {
      percent: Number(row.percent ?? 0),
      updated_at: row.updated_at,
    };
  }

  // Shape milestones for response.
  const shaped = ((milestones as MilestoneRow[] | null) ?? []).map((m) => ({
    id: m.id,
    domain: m.domain,
    age_bracket: m.age_bracket,
    description: m.description,
    observed_score: observed.get(m.id) ?? 0,
  }));

  return {
    success: true,
    data: {
      child_name: child.firstName,
      age_bracket: ageBracket,
      total: shaped.length,
      milestones: shaped,
      domain_summary: domainSummary,
    },
  };
}

interface MilestoneUpdateInput {
  milestone_id: unknown;
  score: unknown;
}

const DOMAIN_CODES = ["CL", "PSE", "PD", "LIT", "NUM", "UW", "EAD"] as const;
type DomainCode = (typeof DOMAIN_CODES)[number];

interface HistoryRow {
  id: string;
  created_at: string;
  cl_total: number | null;
  pse_total: number | null;
  pd_total: number | null;
  lit_total: number | null;
  num_total: number | null;
  uw_total: number | null;
  ead_total: number | null;
  ref_log_id: string | null;
}

function rowToTotals(row: HistoryRow): Record<DomainCode, number> {
  return {
    CL: row.cl_total ?? 0,
    PSE: row.pse_total ?? 0,
    PD: row.pd_total ?? 0,
    LIT: row.lit_total ?? 0,
    NUM: row.num_total ?? 0,
    UW: row.uw_total ?? 0,
    EAD: row.ead_total ?? 0,
  };
}

async function readProgressHistory(
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const r = resolveChild(args.child_name, ctx.children);
  if (r.error) return r.error;
  const child = r.child;

  const from =
    typeof args.from === "string" && args.from.trim() ? args.from : null;
  const to = typeof args.to === "string" && args.to.trim() ? args.to : null;
  const limit = Math.min(
    200,
    Math.max(1, typeof args.limit === "number" ? Math.round(args.limit) : 50),
  );

  let query = ctx.supabase
    .from("bapp_progress_history")
    .select(
      "id, created_at, cl_total, pse_total, pd_total, lit_total, num_total, uw_total, ead_total, ref_log_id",
    )
    .eq("child_client_id", child.id);
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);
  query = query.order("created_at", { ascending: true }).limit(limit);

  const { data, error } = await query;
  if (error) {
    return {
      success: false,
      error: `Failed to read progress history: ${error.message}`,
    };
  }

  const rows = (data ?? []) as HistoryRow[];
  const empty: Record<DomainCode, number> = {
    CL: 0,
    PSE: 0,
    PD: 0,
    LIT: 0,
    NUM: 0,
    UW: 0,
    EAD: 0,
  };

  const snapshots = rows.map((row) => ({
    id: row.id,
    snapshot_at: row.created_at,
    ref_log_id: row.ref_log_id,
    totals: rowToTotals(row),
  }));

  let delta: Record<DomainCode, number> = { ...empty };
  if (rows.length >= 2) {
    const first = rowToTotals(rows[0]);
    const last = rowToTotals(rows[rows.length - 1]);
    delta = {
      CL: last.CL - first.CL,
      PSE: last.PSE - first.PSE,
      PD: last.PD - first.PD,
      LIT: last.LIT - first.LIT,
      NUM: last.NUM - first.NUM,
      UW: last.UW - first.UW,
      EAD: last.EAD - first.EAD,
    };
  }

  return {
    success: true,
    data: {
      child_name: child.firstName,
      window: { from, to, limit },
      count: snapshots.length,
      snapshots,
      delta,
      latest: snapshots.length > 0 ? snapshots[snapshots.length - 1] : null,
    },
  };
}

interface PreparedProgress {
  child: ChildSummary;
  cleaned: Array<{ id: string; score: number }>;
  progressData: Record<string, unknown>;
}

function prepareProgressUpdate(
  args: Record<string, unknown>,
  children: ChildSummary[],
):
  | { ok: true; prepared: PreparedProgress }
  | { ok: false; error: string; terminal?: boolean } {
  const r = resolveChild(args.child_name, children);
  if (r.error) {
    return {
      ok: false,
      error: r.error.error ?? "Could not resolve child.",
      terminal: r.error.terminal,
    };
  }
  const child = r.child;

  const raw = args.updates;
  if (!Array.isArray(raw) || raw.length === 0) {
    return {
      ok: false,
      error: "Pass at least one milestone update in the `updates` array.",
    };
  }

  const cleaned: Array<{ id: string; score: number }> = [];
  for (const u of raw as MilestoneUpdateInput[]) {
    const id = typeof u?.milestone_id === "string" ? u.milestone_id : null;
    const score = typeof u?.score === "number" ? Math.round(u.score) : NaN;
    if (!id || !Number.isFinite(score) || score < 1 || score > 4) {
      return {
        ok: false,
        error: `Invalid update ${JSON.stringify(u)} — each update needs a milestone_id and a score between 1 and 4.`,
      };
    }
    cleaned.push({ id, score });
  }

  const note =
    typeof args.note === "string" && args.note.trim().length > 0
      ? args.note.trim()
      : null;
  const imageUrl =
    typeof args.image_url === "string" && args.image_url.trim().length > 0
      ? args.image_url.trim()
      : null;

  return {
    ok: true,
    prepared: {
      child,
      cleaned,
      progressData: {
        updates: cleaned,
        title: "Progress Update",
        image_url: imageUrl,
        note,
      },
    },
  };
}

function buildProgressTile(
  logId: string,
  childId: string,
  authorId: string,
  data: Record<string, unknown>,
  createdAtIso: string,
): ProgressChatTile {
  return {
    kind: "progress",
    data: {
      item: {
        id: logId,
        child_client_id: childId,
        author_id: authorId,
        author_name: "Katie",
        type: "progress",
        status: "completed",
        context: "adhoc",
        parent_log_id: null,
        data,
        created_at: createdAtIso,
        updated_at: createdAtIso,
      },
    },
  };
}

async function proposeUpdateProgress(
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const r = prepareProgressUpdate(args, ctx.children);
  if (!r.ok) {
    return { success: false, error: r.error, terminal: r.terminal };
  }
  const { child, cleaned, progressData } = r.prepared;
  const draftId = `draft_${crypto.randomUUID()}`;
  const nowIso = new Date().toISOString();
  return {
    success: true,
    data: {
      draft_id: draftId,
      child_name: child.firstName,
      proposed_count: cleaned.length,
    },
    tile: {
      kind: "draft",
      data: {
        draftId,
        toolName: "update_progress",
        args,
        preview: buildProgressTile(
          draftId,
          child.id,
          ctx.userId,
          progressData,
          nowIso,
        ),
      },
    },
  };
}

// ── Apply path (frontend-callable via /api/chat/drafts/accept) ───────────

export interface ProgressApplyResult {
  ok: true;
  tile: ProgressChatTile;
  data: { log_id: string; child_name: string; updated_count: number };
  /**
   * Set when the progress row was persisted successfully but the
   * recalc/history-snapshot cascade failed. Caller surfaces this
   * without prompting a retry — the row is committed.
   */
  warning?: string;
}

export interface ProgressApplyError {
  ok: false;
  error: string;
}

export async function applyUpdateProgress(
  args: Record<string, unknown>,
  ctx: { userId: string; children: ChildSummary[]; supabase: SupabaseClient },
): Promise<ProgressApplyResult | ProgressApplyError> {
  const r = prepareProgressUpdate(args, ctx.children);
  if (!r.ok) {
    return { ok: false, error: r.error };
  }
  const { child, cleaned, progressData } = r.prepared;

  // T-015 media gate — block image_url writes without parent consent.
  if (progressData.image_url) {
    const gate = await hasParentMediaConsent(
      { childId: child.id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { admin: ctx.supabase as any },
    );
    if (!gate.allowed) {
      return { ok: false, error: "media_consent_required" };
    }
  }

  // Mirror logBulkProgress: write the progress row first so the
  // child's feed shows this update, then recalc + snapshot. Shape
  // matches ProgressData in src/types/bapp.ts so the same row
  // renders identically on the child's development page.
  const { data: inserted, error: insertError } = await ctx.supabase
    .from("bapp_logs")
    .insert({
      child_client_id: child.id,
      author_id: ctx.userId,
      type: "progress",
      status: "completed",
      context: "adhoc",
      data: progressData,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    return {
      ok: false,
      error: `Failed to write progress row: ${insertError?.message ?? "unknown"}`,
    };
  }

  const logId = (inserted as { id: string }).id;

  // Same partial-state pattern as applyLogObservation: the row is
  // committed by this point. If the cascade fails, return ok:true
  // with a `warning` so the user sees the row stay in the feed.
  let cascadeWarning: string | undefined;
  try {
    await recalculateProgress(child.id, cleaned);
    await writeHistorySnapshot(child.id, logId);
  } catch (err) {
    console.error("[applyUpdateProgress] cascade failure (row persisted):", {
      logId,
      child: child.id,
      err,
    });
    cascadeWarning = `Progress row saved, but recalculation failed: ${
      err instanceof Error ? err.message : String(err)
    }. Your update is in the feed.`;
  }

  // Email the linked parent that a new tile landed (non-fatal — internal
  // errors are absorbed, never cause action failure). Skip rules + lookups
  // are inside the helper. Placed AFTER the cascade block for readability:
  // the cascade is wrapped in its own try/catch, so placement does NOT
  // affect exception safety — the email semantically belongs at the end,
  // after the post-insert side-effects have settled.
  await notifyParentOfFeedPost({
    childId: child.id,
    authorId: ctx.userId,
    logType: "progress",
    logContext: "adhoc",
  });

  const nowIso = new Date().toISOString();
  return {
    ok: true,
    data: {
      log_id: logId,
      child_name: child.firstName,
      updated_count: cleaned.length,
    },
    tile: buildProgressTile(logId, child.id, ctx.userId, progressData, nowIso),
    ...(cascadeWarning ? { warning: cascadeWarning } : {}),
  };
}

export const progressModule: BloomBotModule = {
  id: "progress",
  name: "Child Progress",
  description:
    "Reads EYLF milestones for a child's age bracket along with their observed scores and per-domain completion percent, and applies direct progress updates.",
  childScoped: true,

  tools: [
    {
      name: "read_milestones",
      description:
        "Read the 35 EYLF milestones for a child's age bracket (7 domains × 5) alongside their current observed scores and per-domain completion percent. Use before suggesting activities so you know what's already been observed and which domains lag.",
      parameters: {
        type: "object",
        properties: {
          child_name: {
            type: "string",
            description:
              "Which child (required if the user has multiple children; can omit if only one).",
          },
          age_bracket: {
            type: "string",
            enum: [
              "0-3 months",
              "3-6 months",
              "6-12 months",
              "12-18 months",
              "18-24 months",
              "24-32 months",
            ],
            description:
              "Override the child's current age bracket (optional). Defaults to the child's own bracket.",
          },
          domain: {
            type: "string",
            enum: ["CL", "PSE", "PD", "LIT", "NUM", "UW", "EAD"],
            description:
              "Optional — scope to a single domain when the user's question is domain-specific (e.g. 'what are her language milestones'). Returns 5 rows instead of 35. Omit when you want the full bracket.",
          },
        },
        required: [],
      },
      isPrefulfilled: isChildNameInPreloadProfiles,
    },
    {
      name: "read_progress_history",
      description:
        "Read a child's EYLF progress snapshots over time (bapp_progress_history). Each snapshot is a point-in-time sum of scored milestone points per domain — written whenever an observation is logged with a milestone + score. Use for trend questions ('how has progress changed this month?', 'which domain improved most?'). Returns snapshots + a computed delta (latest minus earliest in the window).",
      parameters: {
        type: "object",
        properties: {
          child_name: {
            type: "string",
            description:
              "Which child (required if the user has multiple children; can omit if only one).",
          },
          from: {
            type: "string",
            description:
              "Optional ISO 8601 datetime. Only return snapshots at or after this instant.",
          },
          to: {
            type: "string",
            description:
              "Optional ISO 8601 datetime. Only return snapshots at or before this instant.",
          },
          limit: {
            type: "number",
            description: "Max snapshots to return (default 50, capped at 200).",
          },
        },
        required: [],
      },
    },
    {
      name: "update_progress",
      description:
        "Draft a direct progress update against specific milestones. Returns a draft tile the user must Accept — nothing is written and no recalculation happens until Accept. Scores only go UP (recalculateProgress takes max with existing). Use this for bulk corrections or quick updates; for single observations prefer log_observation so the evidence is captured.",
      parameters: {
        type: "object",
        properties: {
          child_name: {
            type: "string",
            description:
              "Which child (required if the user has multiple children; can omit if only one).",
          },
          updates: {
            type: "array",
            description:
              "Milestone updates to apply. Each item is { milestone_id, score } where score is 1–4.",
            items: {
              type: "object",
              properties: {
                milestone_id: {
                  type: "string",
                  description:
                    "Milestone id from bapp_milestones (e.g. `CL_12_18_1`).",
                },
                score: {
                  type: "number",
                  description: "Observed score, integer 1-4.",
                },
              },
              required: ["milestone_id", "score"],
            },
            minItems: 1,
          },
          note: {
            type: "string",
            description:
              "Optional note attached to the progress entry (e.g. 'catching up after a quiet week').",
          },
          image_url: {
            type: "string",
            description: "Optional image URL if the user attached a photo.",
          },
        },
        required: ["updates"],
      },
    },
  ],

  async execute(toolName, args, ctx) {
    if (toolName === "read_milestones") return readMilestones(args, ctx);
    if (toolName === "read_progress_history")
      return readProgressHistory(args, ctx);
    if (toolName === "update_progress") return proposeUpdateProgress(args, ctx);
    return { success: false, error: `Unknown tool: ${toolName}` };
  },

  systemPromptFragment:
    "Use `read_milestones` to see which EYLF milestones are on-plan for a child's age bracket and which have already been observed (observed_score > 0). Pair with `read_recent_feed` for the observation evidence. Use `read_progress_history` when the user asks about trends (last week, last month, 'how has X changed?') — it returns point-in-time domain-total snapshots plus a delta across the window. Use `update_progress` only for bulk or direct corrections — logging an observation via the observations module is preferred when the user is describing something they saw.",
};
