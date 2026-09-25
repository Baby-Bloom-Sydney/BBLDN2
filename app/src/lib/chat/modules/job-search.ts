/**
 * `job-search` module — nanny-only read view over DFY
 * (done-for-you) match notifications.
 *
 * When a parent creates a position, the matchmaking system sends
 * notifications to matching nannies. This module surfaces those
 * notifications in plain English so Katie can narrate "3 new
 * positions matched, closest is Clapham, 30h/week, £26/hr".
 *
 * v1 scope: READ-ONLY. Applying / declining happens via the main
 * surface (`/nanny/jobs` or the connections module). The connections
 * module already owns `propose_send_connection_request` (parent-side)
 * which is the write equivalent for the other direction.
 */

import type { BloomBotModule, ToolResult } from "./types";
import {
  getDfyNotificationsForNanny,
  type DfyNotification,
} from "@/lib/actions/matching";
import { asUserFacingRole } from "./utils";
import { distanceText, childrenSummary } from "./bsr-translator";
import { POSITION_STAGE } from "@/lib/position/constants";

interface JobMatchSummary {
  id: string;
  position_id: string;
  suburb: string | null;
  distance: string;
  hours_per_week: number | null;
  hourly_rate: number | null;
  days_required: string[];
  urgency: string | null;
  start_date: string | null;
  children: string;
  parent_first_name: string;
  // Plain-English tags Katie can call out. Intentionally boolean-free
  // — the prose already conveys the fact.
  requirements: string[];
}

function summariseRequirements(pos: DfyNotification["position"]): string[] {
  const out: string[] = [];
  if (pos.driversLicenseRequired) out.push("driver's license");
  if (pos.carRequired) out.push("own car");
  if (pos.vaccinationRequired) out.push("vaccinations up to date");
  if (pos.comfortableWithPetsRequired) out.push("pet-friendly");
  if (pos.nonSmokerRequired) out.push("non-smoker");
  if (pos.qualificationRequirement) {
    out.push(`qualification: ${pos.qualificationRequirement}`);
  }
  if (pos.languagePreference) {
    out.push(`language: ${pos.languagePreference}`);
  }
  return out;
}

function summariseMatch(n: DfyNotification): JobMatchSummary {
  return {
    id: n.id,
    position_id: n.positionId,
    suburb: n.position.suburb,
    distance: distanceText(n.distanceKm),
    hours_per_week: n.position.hoursPerWeek,
    hourly_rate: n.position.hourlyRate,
    days_required: n.position.daysRequired ?? [],
    urgency: n.position.urgency,
    start_date: n.position.startDate,
    children: childrenSummary(
      n.position.children.map((c) => ({
        age_months: c.ageMonths,
        gender: c.gender,
      })),
    ),
    parent_first_name: n.parent.firstName,
    requirements: summariseRequirements(n.position),
  };
}

function roleOnlyError(): ToolResult {
  return {
    success: false,
    error:
      "Job matches are only visible on a nanny account. Parents can see their own position via read_my_position.",
  };
}

// ── Tools ─────────────────────────────────────────────────────────────────

async function readMyJobMatches(
  _args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const role = asUserFacingRole(ctx.effectiveRole);
  if (!role) return roleOnlyError();
  if (role !== "nanny") return roleOnlyError();

  const result = await getDfyNotificationsForNanny();
  if (result.error) return { success: false, error: result.error };

  const notifications = result.data ?? [];
  const summaries = notifications.map(summariseMatch);
  return {
    success: true,
    data: {
      count: summaries.length,
      matches: summaries,
      summary:
        summaries.length === 0
          ? "No open-position matches right now. New matches appear as families post positions that fit your profile."
          : `${summaries.length} matched position${summaries.length === 1 ? "" : "s"} waiting for your response.`,
    },
  };
}

async function readJobMatchDetail(
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const role = asUserFacingRole(ctx.effectiveRole);
  if (!role) return roleOnlyError();
  if (role !== "nanny") return roleOnlyError();

  const matchId = typeof args.match_id === "string" ? args.match_id.trim() : "";
  if (!matchId) {
    return {
      success: false,
      error:
        "Pass `match_id` — the id returned by read_my_job_matches (the notification id, not the position id).",
    };
  }

  const result = await getDfyNotificationsForNanny();
  if (result.error) return { success: false, error: result.error };
  const notifications = result.data ?? [];
  const match = notifications.find((n) => n.id === matchId);
  if (!match) {
    return {
      success: false,
      error: `No open match found with id "${matchId}" in your notifications.`,
    };
  }

  const summary = summariseMatch(match);
  return {
    success: true,
    data: {
      ...summary,
      description: match.position.description,
      reason_for_nanny: match.position.reasonForNanny ?? [],
      schedule: match.position.schedule,
      level_of_support: match.position.levelOfSupport ?? [],
      placement_length: match.position.placementLength,
    },
    tile: { kind: "job_match", data: { id: match.id } },
  };
}

// ── browse_open_positions ─────────────────────────────────────────────────

interface OpenPositionSummary {
  position_id: string;
  suburb: string | null;
  postcode: string | null;
  hours_per_week: number | null;
  hourly_rate: number | null;
  days_required: string[];
  urgency: string | null;
  start_date: string | null;
  parent_first_name: string;
  /**
   * True if this position is in the nanny's DFY match list — they're
   * already a recommended fit. False = open but the user wasn't matched
   * (could still apply, but with the caveat that some criteria don't
   * line up).
   */
  matched: boolean;
}

interface PositionRow {
  id: string;
  suburb: string | null;
  postcode: string | null;
  hours_per_week: number | null;
  hourly_rate: number | null;
  days_required: string[] | null;
  urgency: string | null;
  start_date: string | null;
  created_at: string;
  // Supabase returns the joined `parents` relation as an array even
  // for !inner one-to-one joins. We unwrap to first element below.
  parents: Array<{ user_id: string }> | null;
}

function firstParentUserId(row: PositionRow): string | null {
  if (!row.parents || row.parents.length === 0) return null;
  return row.parents[0]?.user_id ?? null;
}

async function browseOpenPositions(
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const role = asUserFacingRole(ctx.effectiveRole);
  if (!role) return roleOnlyError();
  if (role !== "nanny") return roleOnlyError();

  // Optional filters — bound the user-supplied input.
  const suburbFilter =
    typeof args.suburb === "string" && args.suburb.length > 0
      ? args.suburb.trim().slice(0, 60)
      : null;
  const limit =
    typeof args.limit === "number" && args.limit > 0 && args.limit <= 50
      ? Math.floor(args.limit)
      : 10;

  // Pull DFY notifications first so we can mark each browse result with
  // the matched flag. One query — much cheaper than checking per-row.
  // Track whether the lookup failed so we can be honest in the response
  // rather than silently labelling every position as `matched: false`.
  const notifResult = await getDfyNotificationsForNanny();
  const matchStatusUnavailable = Boolean(notifResult.error);
  if (matchStatusUnavailable) {
    console.warn(
      "[job-search] getDfyNotificationsForNanny failed during browse; matched=false for all rows",
      notifResult.error,
    );
  }
  const matchedPositionIds = new Set(
    (notifResult.data ?? []).map((n) => n.positionId),
  );

  let query = ctx.supabase
    .from("nanny_positions")
    .select(
      "id, suburb, postcode, hours_per_week, hourly_rate, days_required, urgency, start_date, created_at, parents:parents!inner(user_id)",
    )
    .eq("stage", POSITION_STAGE.OPEN)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (suburbFilter) {
    // ilike matches case-insensitive substring — useful for "show me
    // jobs in Clap" matching "Clapham". Escape the LIKE wildcards
    // ('%', '_', '\') from the user-supplied value so a literal '%'
    // typed by the user doesn't bypass the filter and return everything.
    const escaped = suburbFilter.replace(/[%_\\]/g, "\\$&");
    query = query.ilike("suburb", `%${escaped}%`);
  }

  const { data, error } = await query;
  if (error) {
    return {
      success: false,
      error: `Couldn't load open positions: ${error.message}`,
    };
  }

  const rows = (data ?? []) as PositionRow[];

  // Resolve parent first names. Avoid an N+1 by pulling all in one shot
  // via the user_profiles table.
  const parentUserIds = rows
    .map((r) => firstParentUserId(r))
    .filter((id): id is string => typeof id === "string");
  const parentNamesById = new Map<string, string>();
  if (parentUserIds.length > 0) {
    const { data: profiles } = await ctx.supabase
      .from("user_profiles")
      .select("user_id, first_name")
      .in("user_id", parentUserIds);
    for (const p of (profiles ?? []) as Array<{
      user_id: string;
      first_name: string | null;
    }>) {
      if (p.first_name) parentNamesById.set(p.user_id, p.first_name);
    }
  }

  const summaries: OpenPositionSummary[] = rows.map((r) => {
    const parentUid = firstParentUserId(r);
    return {
      position_id: r.id,
      suburb: r.suburb,
      postcode: r.postcode,
      hours_per_week: r.hours_per_week,
      hourly_rate: r.hourly_rate,
      days_required: r.days_required ?? [],
      urgency: r.urgency,
      start_date: r.start_date,
      parent_first_name: parentUid
        ? (parentNamesById.get(parentUid) ?? "A family")
        : "A family",
      matched: matchedPositionIds.has(r.id),
    };
  });

  const matchedCount = summaries.filter((s) => s.matched).length;
  return {
    success: true,
    data: {
      count: summaries.length,
      matched_count: matchedCount,
      positions: summaries,
      // When the DFY lookup failed, every row carries matched=false but
      // that's a tooling artefact, not the truth. Surface the gap so
      // Katie doesn't claim "none match your profile" when she
      // genuinely doesn't know.
      match_status_unavailable: matchStatusUnavailable,
      summary:
        summaries.length === 0
          ? suburbFilter
            ? `No open positions in areas matching "${suburbFilter}". Try a different area or remove the filter.`
            : "No open positions right now. Check back as families post new positions."
          : `${summaries.length} open position${summaries.length === 1 ? "" : "s"}${matchedCount > 0 ? ` (${matchedCount} match your profile)` : ""}.`,
    },
  };
}

// ── Module export ─────────────────────────────────────────────────────────

export const jobSearchModule: BloomBotModule = {
  id: "job-search",
  name: "Job Search",
  description:
    "Nanny-only read view over matched-position notifications (DFY matchmaking). Translates position details to plain English so Katie can surface active matches, their distance / hours / rate, and their requirements.",

  rolesAllowed: ["nanny"],

  tools: [
    {
      name: "read_my_job_matches",
      description:
        "Return the list of open positions the matchmaking system has notified this nanny about. Each entry has the area, distance, hours/week, hourly rate, days required, child ages, and any hard requirements (license / car / qualification etc.). Use for 'any new jobs for me?', 'what positions have I been matched to?'.",
      parameters: { type: "object", properties: {}, required: [] },
    },
    {
      name: "read_job_match_detail",
      description:
        "Return full detail for a single matched position by the match (notification) id. Includes the position description, reasons the family is hiring, weekly schedule, and level of support. Use when the nanny asks about a specific match referenced in read_my_job_matches.",
      parameters: {
        type: "object",
        properties: {
          match_id: {
            type: "string",
            description:
              "The notification id returned by read_my_job_matches (the `id` field, NOT the `position_id`).",
          },
        },
        required: ["match_id"],
      },
    },
    {
      name: "browse_open_positions",
      description:
        "Return open positions across the platform — NOT filtered to this nanny's matches. Use when the nanny asks 'what jobs are available?', 'show me all open positions', 'are there any positions in [suburb]?', or otherwise wants to see what's out there beyond their matchmaker queue. Each result has a `matched: boolean` flag — true means the nanny is already recommended for it (in their match list), false means the position is open but they aren't a matchmaker recommendation. Default returns the 10 most recent. Optional `suburb` filter (case-insensitive substring match — 'Clap' matches 'Clapham') and `limit` (1-50).",
      parameters: {
        type: "object",
        properties: {
          suburb: {
            type: "string",
            description:
              "Optional area filter — case-insensitive substring match. E.g. 'Clap' matches 'Clapham' and 'Clapton'. Omit to see positions everywhere.",
          },
          limit: {
            type: "number",
            description:
              "Max results (1-50). Default 10. Smaller for quick scans, larger for exhaustive browsing.",
          },
        },
        required: [],
      },
    },
  ],

  async execute(toolName, args, ctx) {
    if (toolName === "read_my_job_matches") return readMyJobMatches(args, ctx);
    if (toolName === "read_job_match_detail")
      return readJobMatchDetail(args, ctx);
    if (toolName === "browse_open_positions")
      return browseOpenPositions(args, ctx);
    return { success: false, error: `Unknown tool: ${toolName}` };
  },

  systemPromptFragment:
    "Three nanny job tools:\n" +
    "• `read_my_job_matches` — open positions the matchmaker recommended for THIS nanny. Use for 'any matches for me?', 'new jobs in my queue?'.\n" +
    "• `read_job_match_detail` — full detail on a specific match by id. Use after read_my_job_matches when the user picks one. EMITS A TILE (`job_match`).\n" +
    "• `browse_open_positions` — ALL open positions across the platform, regardless of match status. Use for 'what jobs are available?', 'show me all open positions', 'any positions in [suburb]?'. Each result has `matched: true|false` so the user can see which ones the matchmaker already flagged for them. The user CAN still apply to non-matched positions — they just don't have the matchmaker's endorsement.\n\n" +
    "Tile / narration pattern for list reads:\n" +
    "• `read_my_job_matches` and `browse_open_positions` return MULTIPLE positions but emit NO tile — they're list views. Narrate the list briefly (count + 1-2 standout entries), then offer to drill in: 'I found 4 matches — want to see the closest one in detail?' If the user picks one, call `read_job_match_detail` with that match's `id`, which DOES emit a tile.\n" +
    "• Don't dump every field of every position into the chat text. The list narration is a quick scan; the per-item tile is the deep view.\n\n" +
    "Hard rules:\n" +
    "• When the user asks for available jobs / positions WITHOUT specifying matched-only, default to `browse_open_positions` so they see the full picture, not just the matchmaker queue. Do NOT redirect them to the manual /nanny/jobs page — show the data in chat.\n" +
    "• NEVER speak raw field names (`match_score`, `dfy_tier`, `respondedAt`, etc.) — the tools return plain-English text already.\n" +
    "• NEVER fabricate a parent's name — only use `parent_first_name` returned by the tool.\n" +
    "• Distances are pre-rendered (e.g. '3.5 km', '<1 km'). Don't recompute.\n" +
    "• When framing a non-matched position, mention the gap factually: 'Open in Clapham, 30h/week — you're not on the matchmaker list for this one but you can still apply.' Don't editorialise ('your profile is wrong') — just state it.\n" +
    "• To actually apply to any position, the nanny goes through the connection flow — parent must send the request first, or the nanny applies via the main `/nanny/jobs` page. This module is read-only.",
};
