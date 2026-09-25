/**
 * Read tools for the connections module.
 *
 * Reads never hit server writes — they wrap
 * getNannyConnectionRequests / getParentConnectionRequests and
 * translate the output to plain English for Katie. Bulk reads
 * (inbox / action_required) narrate without emitting tiles; single-
 * target reads (by_name / upcoming_meet) emit an id-only
 * `connection_request` tile that fetches live state itself.
 *
 * The read-side system prompt fragment + tool definitions are exported
 * here so `connections.ts` can assemble them into the final module
 * export without re-stating the rules in both places.
 */

import type { BloomBotModule, ToolDefinition, ToolResult } from "./types";
import type { ConnectionRequestWithDetails } from "@/lib/actions/connection";
import { isTerminal, isActionRequired } from "./connections-translator";
import { makeSlotPresentPredicate } from "@/lib/chat/preload/predicates";
import { BRAND } from "@/lib/constants";
import {
  loadConnections,
  summarise,
  resolveRole,
  roleOnlyError,
  counterpartyFromRequest,
  type ConnectionSummary,
} from "./connections-shared";

async function readConnectionInbox(
  _args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const role = resolveRole(ctx.effectiveRole);
  if (!role) return roleOnlyError();

  const { list, error } = await loadConnections(role);
  if (error) return { success: false, error };

  const active = list.filter((r) => !isTerminal(r.connection_stage));
  const summaries = active
    .map((r) => summarise(r, role))
    .filter((s): s is ConnectionSummary => s !== null);

  return {
    success: true,
    data: {
      role,
      count: summaries.length,
      active_count: summaries.length,
      connections: summaries,
    },
  };
}

async function readConnectionByName(
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const role = resolveRole(ctx.effectiveRole);
  if (!role) return roleOnlyError();

  const rawName =
    typeof args.counterparty_name === "string"
      ? args.counterparty_name.trim().toLowerCase()
      : "";
  if (rawName.length < 2) {
    return {
      success: false,
      error:
        "Pass a counterparty name (at least 2 characters) to match against nanny or family names.",
    };
  }

  const { list, error } = await loadConnections(role);
  if (error) return { success: false, error };

  const matches = list.filter((r) => {
    const cp = counterpartyFromRequest(r, role);
    if (!cp) return false; // skip malformed rows during fuzzy match
    const joined = `${cp.firstName} ${cp.lastName}`.toLowerCase();
    return joined.includes(rawName) || cp.firstName.toLowerCase() === rawName;
  });

  if (matches.length === 0) {
    return {
      success: true,
      data: {
        match_count: 0,
        summary: `No connection found matching "${args.counterparty_name}".`,
      },
    };
  }

  if (matches.length > 1) {
    const disambiguation = matches
      .map((r) => summarise(r, role))
      .filter((s): s is ConnectionSummary => s !== null);
    return {
      success: true,
      data: {
        match_count: disambiguation.length,
        disambiguation,
        summary: `Multiple connections match "${args.counterparty_name}" — ask the user which one.`,
      },
    };
  }

  const only = matches[0];
  const summary = summarise(only, role);
  if (!summary) {
    return {
      success: false,
      error:
        "We found the connection but couldn't load its details. Please refresh and try again.",
    };
  }
  return {
    success: true,
    data: {
      match_count: 1,
      connection: summary,
    },
    tile: {
      kind: "connection_request",
      data: { id: only.id },
    },
  };
}

async function readUpcomingMeet(
  _args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const role = resolveRole(ctx.effectiveRole);
  if (!role) return roleOnlyError();

  const { list, error } = await loadConnections(role);
  if (error) return { success: false, error };

  const now = Date.now();
  // Type-safe narrowing instead of `as string` — if confirmed_time is
  // ever `undefined` at runtime (e.g. schema drift), `new Date(undefined)`
  // silently produces NaN and only gets caught by Number.isFinite downstream.
  // The filter predicate does the narrowing the TypeScript compiler expects.
  const withFutureMeet = list
    .flatMap<{ r: ConnectionRequestWithDetails; ts: number }>((r) => {
      const time = r.confirmed_time;
      if (time == null) return [];
      const ts = new Date(time).getTime();
      if (!Number.isFinite(ts) || ts <= now) return [];
      return [{ r, ts }];
    })
    .sort((a, b) => a.ts - b.ts);

  if (withFutureMeet.length === 0) {
    return {
      success: true,
      data: {
        has_upcoming: false,
        summary: "You don't have any upcoming meet and greets booked.",
      },
    };
  }

  const next = withFutureMeet[0].r;
  const summary = summarise(next, role);
  if (!summary) {
    return {
      success: false,
      error:
        "Your upcoming meet and greet is booked but we couldn't load its details. Please refresh and try again.",
    };
  }
  return {
    success: true,
    data: {
      has_upcoming: true,
      connection: summary,
    },
    tile: {
      kind: "connection_request",
      data: { id: next.id },
    },
  };
}

async function readActionRequired(
  _args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const role = resolveRole(ctx.effectiveRole);
  if (!role) return roleOnlyError();

  const { list, error } = await loadConnections(role);
  if (error) return { success: false, error };

  const needing = list.filter((r) =>
    isActionRequired(r.connection_stage, role, r.fill_initiated_by),
  );
  const summaries = needing
    .map((r) => summarise(r, role))
    .filter((s): s is ConnectionSummary => s !== null);

  return {
    success: true,
    data: {
      role,
      count: summaries.length,
      connections: summaries,
    },
  };
}

// ── Public exports for connections.ts to assemble ────────────────────────

export const readTools: ToolDefinition[] = [
  {
    name: "read_connection_inbox",
    description:
      "List the user's active connections. For nannies: requests received + in-progress meet-and-greets. For parents: requests sent + in-progress candidates. Returns counterparty name, suburb, plain-English stage, next step (if any), time-left until expiry. Skips terminal stages (declined / expired / cancelled / finished). Use for 'who wants to interview me?', 'how many candidates am I talking to?', 'anyone waiting on me?'.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    isPrefulfilled: makeSlotPresentPredicate("connection_inbox"),
  },
  {
    name: "read_connection_by_name",
    description:
      "Find a single connection by counterparty first-name or 'first last' (case-insensitive, substring match). Returns the connection summary + an interactive tile the user can act on. If multiple connections match, returns a disambiguation list so you can ask the user which one.",
    parameters: {
      type: "object",
      properties: {
        counterparty_name: {
          type: "string",
          description:
            "The nanny's or family's first name (and optionally last name / initial) to match, e.g. 'Jessica' or 'Jessica M'.",
        },
      },
      required: ["counterparty_name"],
    },
  },
  {
    name: "read_upcoming_meet",
    description:
      "Return the user's next scheduled meet-and-greet (the soonest confirmed_time in the future). Returns { has_upcoming: false } when nothing is booked.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "read_action_required",
    description:
      "List every connection where the user specifically needs to do something next (not waiting on the other party). Each entry includes the counterparty name + plain-English action. Use for 'what do I need to do?', 'outstanding actions', 'anything needing my attention?'.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];

/**
 * Returns a ToolResult if the tool name matches a read handler, else
 * null so `connections.ts` can fall through to the write dispatcher.
 */
export async function tryExecuteRead(
  toolName: string,
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult | null> {
  if (toolName === "read_connection_inbox")
    return readConnectionInbox(args, ctx);
  if (toolName === "read_connection_by_name")
    return readConnectionByName(args, ctx);
  if (toolName === "read_upcoming_meet") return readUpcomingMeet(args, ctx);
  if (toolName === "read_action_required") return readActionRequired(args, ctx);
  return null;
}

export const readSystemPromptFragment =
  "Reads:\n" +
  "• 'Who wants to interview me?' / 'who have I reached out to?' → `read_connection_inbox`. Narrate the active list — do NOT emit a tile per connection; one tile per reply max. If the user picks one, follow up with `read_connection_by_name` which emits an interactive tile for just that one.\n" +
  "• User names a specific counterparty → `read_connection_by_name`. If match_count > 1, ask which one before proceeding.\n" +
  `• 'When is my meet?' → \`read_upcoming_meet\` and read the \`confirmed_time\` in ${BRAND.city} time plus the nanny phone (only if the tool returned one — don't paraphrase if absent).\n` +
  "• 'What do I need to do?' / 'anything outstanding?' → `read_action_required`.\n" +
  "• Never fabricate a counterparty name — only use names returned by the tools.";
