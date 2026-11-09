/**
 * `observations` module — captures observations and cascades into
 * progress on apply.
 *
 * Two-turn (WU 8.22d): the LLM-callable `log_observation` is the
 * propose path — it validates and returns a `kind: "draft"` tile.
 * Nothing is inserted, and the progress cascade does NOT fire. The
 * apply path (`applyLogObservation` below, called by
 * /api/chat/drafts/accept) does the bapp_logs insert and, when
 * milestone_id + score are present, recalculates progress and writes
 * a history snapshot.
 */

import type { BloomBotModule, ToolResult, ChildSummary } from "./types";
import type { ObservationChatTile } from "@/lib/chat/tiles";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveChild } from "./utils";
import { hasParentMediaConsent } from "@/lib/legal/media-consent-gate";
import {
  recalculateProgress,
  writeHistorySnapshot,
} from "@/lib/bapp/progress-write";
import { notifyParentOfFeedPost } from "@/lib/email/feed-post-notification";

const OBSERVATION_DOMAINS = [
  "General",
  "CL",
  "EAD",
  "LIT",
  "NUM",
  "PD",
  "PSE",
  "UW",
] as const;

interface PreparedObservation {
  child: ChildSummary;
  domain: string;
  milestoneId: string | null;
  score: number | null;
  observationData: Record<string, unknown>;
}

function prepareObservation(
  args: Record<string, unknown>,
  children: ChildSummary[],
):
  | { ok: true; prepared: PreparedObservation }
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

  const note = typeof args.note === "string" ? args.note.trim() : "";
  if (note.length === 0) {
    return {
      ok: false,
      error: "log_observation needs a `note` describing what was observed.",
    };
  }

  const domainArg =
    typeof args.domain === "string" && args.domain.trim().length > 0
      ? args.domain.trim()
      : "General";
  const domain = (OBSERVATION_DOMAINS as readonly string[]).includes(domainArg)
    ? domainArg
    : "General";

  const milestoneId =
    typeof args.milestone_id === "string" && args.milestone_id.trim().length > 0
      ? args.milestone_id.trim()
      : null;

  let score: number | null = null;
  if (args.score !== undefined && args.score !== null) {
    const raw = typeof args.score === "number" ? Math.round(args.score) : NaN;
    if (!Number.isFinite(raw) || raw < 1 || raw > 4) {
      return {
        ok: false,
        error: "score must be a number between 1 and 4.",
      };
    }
    score = raw;
  }

  const title =
    typeof args.title === "string" && args.title.trim().length > 0
      ? args.title.trim()
      : note.slice(0, 60);

  const imageUrl =
    typeof args.image_url === "string" && args.image_url.trim().length > 0
      ? args.image_url.trim()
      : null;

  return {
    ok: true,
    prepared: {
      child,
      domain,
      milestoneId,
      score,
      observationData: {
        title,
        domain,
        milestone_id: milestoneId,
        score,
        note,
        image_url: imageUrl,
      },
    },
  };
}

function buildObservationTile(
  logId: string,
  childId: string,
  authorId: string,
  data: Record<string, unknown>,
  createdAtIso: string,
): ObservationChatTile {
  return {
    kind: "observation",
    data: {
      item: {
        id: logId,
        child_client_id: childId,
        author_id: authorId,
        author_name: "Katie",
        type: "observation",
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

// ── Silent milestone scrubber (WU 10.4) ──────────────────────────────────
//
// If Katie hands us a `milestone_id` that doesn't exist in
// `bapp_milestones`, we strip it (and the dependent `score`) silently
// and let the observation through as a textual-only entry. The user
// never sees a "milestone not found" error — that would expose internal
// machinery and admit the model hallucinated. The observation is still
// useful without a milestone attachment.
//
// We log to console for our own observability so we can measure the
// hallucination rate post-deploy. Catch path: if the lookup itself
// throws (DB blip), we fail-open — keep the milestone_id as-is and let
// downstream surfaces handle it. The cost of a rare false-positive
// (real milestone dropped due to a transient DB error) is a missed
// progress recalc, which the user can re-trigger by repeating the
// observation. The cost of fail-closed (blocking the observation) is
// worse: lost user content.
async function scrubInvalidMilestone(
  args: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<Record<string, unknown>> {
  const raw = args.milestone_id;
  if (typeof raw !== "string" || raw.trim().length === 0) return args;
  const milestoneId = raw.trim();
  try {
    const { data, error } = await supabase
      .from("bapp_milestones")
      .select("id")
      .eq("id", milestoneId)
      .eq("is_active", true)
      .maybeSingle();
    if (error) {
      // Fail-open on DB error — don't block the user's observation.
      console.warn("[observations] milestone lookup error (fail-open):", {
        milestoneId,
        error: error.message,
      });
      return args;
    }
    if (data) return args; // valid — pass through
    // Hallucinated id — strip silently. Clone so callers see new args.
    console.warn("[observations] hallucinated milestone_id stripped:", {
      milestoneId,
    });
    const cloned = { ...args };
    delete cloned.milestone_id;
    delete cloned.score;
    return cloned;
  } catch (err) {
    console.warn("[observations] milestone lookup threw (fail-open):", {
      milestoneId,
      err,
    });
    return args;
  }
}

// ── Propose path (LLM-callable) ──────────────────────────────────────────

async function proposeLogObservation(
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const scrubbedArgs = await scrubInvalidMilestone(args, ctx.supabase);
  const r = prepareObservation(scrubbedArgs, ctx.children);
  if (!r.ok) {
    return { success: false, error: r.error, terminal: r.terminal };
  }
  const { child, observationData } = r.prepared;
  const draftId = `draft_${crypto.randomUUID()}`;
  const nowIso = new Date().toISOString();
  return {
    success: true,
    data: {
      draft_id: draftId,
      child_name: child.firstName,
      preview: observationData,
    },
    tile: {
      kind: "draft",
      data: {
        draftId,
        toolName: "log_observation",
        // Use scrubbed args so a hallucinated milestone_id doesn't ride
        // through to the apply call. The user's draft tile and the
        // eventual persisted row stay aligned — both either have a real
        // milestone or none at all.
        args: scrubbedArgs,
        preview: buildObservationTile(
          draftId,
          child.id,
          ctx.userId,
          observationData,
          nowIso,
        ),
      },
    },
  };
}

// ── Apply path (frontend-callable via /api/chat/drafts/accept) ───────────

export interface ObservationApplyResult {
  ok: true;
  tile: ObservationChatTile;
  data: {
    log_id: string;
    child_name: string;
    progress_updated: boolean;
  };
  /**
   * Set when the observation row was persisted successfully but a
   * downstream side-effect (progress recalc / history snapshot)
   * failed. The caller should surface this to the user without
   * suggesting they retry — the row IS in the feed.
   */
  warning?: string;
}

export interface ObservationApplyError {
  ok: false;
  error: string;
}

export async function applyLogObservation(
  args: Record<string, unknown>,
  ctx: { userId: string; children: ChildSummary[]; supabase: SupabaseClient },
): Promise<ObservationApplyResult | ObservationApplyError> {
  // Defense-in-depth: scrub here too so a forged accept call (with
  // args edited client-side or replayed from cache) can't bypass the
  // validation that the propose path already ran.
  const scrubbedArgs = await scrubInvalidMilestone(args, ctx.supabase);
  const r = prepareObservation(scrubbedArgs, ctx.children);
  if (!r.ok) {
    return { ok: false, error: r.error };
  }
  const { child, milestoneId, score, observationData } = r.prepared;

  // T-015 media gate — Katie tile-accept path. If the tile includes
  // an image_url, the parent must have current `parent-app-consent`
  // for this child.
  const imageUrl =
    typeof (observationData as { image_url?: unknown }).image_url === "string"
      ? ((observationData as { image_url?: string }).image_url ?? null)
      : null;
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

  const { data: inserted, error: insertError } = await ctx.supabase
    .from("bapp_logs")
    .insert({
      child_client_id: child.id,
      author_id: ctx.userId,
      type: "observation",
      status: "completed",
      context: "adhoc",
      data: observationData,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    return {
      ok: false,
      error: `Failed to log observation: ${insertError?.message ?? "unknown"}`,
    };
  }

  const logId = (inserted as { id: string }).id;

  // Cascade: recalculate progress + write history snapshot if the
  // observation is evidence of a specific milestone with a score.
  // The bapp_logs row is already committed at this point — if the
  // cascade throws, we return ok:true with a `warning` instead of
  // ok:false, because the user's observation IS persisted and a
  // retry would just create a duplicate. The caller surfaces the
  // warning text to the user without an error toast.
  let progressUpdated = false;
  let cascadeWarning: string | undefined;
  if (milestoneId && score) {
    try {
      await recalculateProgress(child.id, [{ id: milestoneId, score }]);
      await writeHistorySnapshot(child.id, logId);
      progressUpdated = true;
    } catch (err) {
      console.error("[applyLogObservation] cascade failure (row persisted):", {
        logId,
        child: child.id,
        milestoneId,
        score,
        err,
      });
      cascadeWarning = `Observation saved, but progress couldn't recalculate: ${
        err instanceof Error ? err.message : String(err)
      }. Your observation is in the feed.`;
    }
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
    logType: "observation",
    logContext: "adhoc",
  });

  const nowIso = new Date().toISOString();
  return {
    ok: true,
    data: {
      log_id: logId,
      child_name: child.firstName,
      progress_updated: progressUpdated,
    },
    tile: buildObservationTile(
      logId,
      child.id,
      ctx.userId,
      observationData,
      nowIso,
    ),
    ...(cascadeWarning ? { warning: cascadeWarning } : {}),
  };
}

// ── Module export ────────────────────────────────────────────────────────

export const observationsModule: BloomBotModule = {
  id: "observations",
  name: "Observations",
  description:
    "Drafts observations about a child. Passing a milestone_id + score (1-4) cascades — on Accept — into a progress recalculation and a history snapshot.",
  childScoped: true,

  proactiveTriggers: [
    {
      id: "observations.milestone_scored",
      description:
        "Nanny logged an observation tied to a milestone with a score — acknowledge + nudge toward next one.",
      event: "observation.milestone_scored",
      mode: "template",
      template:
        "Nice — logged that {child_name} is at {score}/4 on {milestone_label}. I'll pull up next steps if you want.",
      resolvePayload: async (event) => {
        const childName =
          typeof event.payload.child_name === "string" &&
          event.payload.child_name.length > 0
            ? event.payload.child_name
            : "your child";
        const score =
          typeof event.payload.score === "number"
            ? String(event.payload.score)
            : typeof event.payload.score === "string"
              ? event.payload.score
              : "";
        const milestoneLabel =
          typeof event.payload.milestone_label === "string" &&
          event.payload.milestone_label.length > 0
            ? event.payload.milestone_label
            : "that milestone";
        return {
          child_name: childName,
          score,
          milestone_label: milestoneLabel,
        };
      },
    },
  ],

  tools: [
    {
      name: "log_observation",
      description:
        "Draft an observation about a child — what the user saw them do, a moment worth capturing, or a milestone attempt. Returns a draft tile the user must Accept. NOTE: nothing is logged and progress is NOT recalculated until Accept.",
      parameters: {
        type: "object",
        properties: {
          child_name: {
            type: "string",
            description:
              "Which child (required if the user has multiple children; can omit if only one).",
          },
          note: {
            type: "string",
            description:
              "What you observed, in the user's voice. Required. Try to preserve the phrasing they gave you.",
          },
          title: {
            type: "string",
            description: "Short headline for the entry. Optional.",
          },
          domain: {
            type: "string",
            enum: ["General", "CL", "EAD", "LIT", "NUM", "PD", "PSE", "UW"],
            description:
              "EYLF domain (CL/EAD/LIT/NUM/PD/PSE/UW) or 'General' if the observation isn't tied to a specific domain. Defaults to General.",
          },
          milestone_id: {
            type: "string",
            description:
              "Optional — a milestone id from bapp_milestones (e.g. 'CL_12_18_1') if this observation is evidence of a specific milestone.",
          },
          score: {
            type: "number",
            description:
              "Optional — mastery score 1-4. Only meaningful when milestone_id is also set. Triggers progress recalculation on Accept.",
          },
          image_url: {
            type: "string",
            description: "Optional image URL if the user attached a photo.",
          },
        },
        required: ["note"],
      },
    },
  ],

  async execute(toolName, args, ctx) {
    if (toolName === "log_observation") return proposeLogObservation(args, ctx);
    return { success: false, error: `Unknown tool: ${toolName}` };
  },

  systemPromptFragment:
    "Use `log_observation` whenever the user describes something they saw the child do — it returns a DRAFT tile the user must Accept. If the observation is clearly evidence of a specific milestone include `milestone_id` + `score` (1-4) so progress updates on Accept. Otherwise leave them out. Don't claim 'logged' before the user accepts — say 'Drafted — review and accept' or similar.",
};
