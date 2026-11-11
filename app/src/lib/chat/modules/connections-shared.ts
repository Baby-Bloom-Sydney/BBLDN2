/**
 * Shared helpers for the connections module — types, resolver, plain-
 * English summariser, counterparty extractor. Imported by
 * `connections-reads.ts` and `connections-writes.ts`.
 *
 * Kept separate so the main file boundaries respect the 800-line rule
 * and so the same helpers don't get duplicated between the read and
 * write sub-modules. Everything here is an internal module detail;
 * the public tool/module export lives in `connections.ts`.
 */

import type { BloomBotModule, ToolResult } from "./types";
import {
  getNannyConnectionRequests,
  getParentConnectionRequests,
  type ConnectionRequestWithDetails,
} from "@/lib/actions/connection";
import {
  stageHeadline,
  nextStepForUser,
  timeLeft,
  counterpartyDisplayName,
  type ConnectionRole,
} from "./connections-translator";
import { asUserFacingRole } from "./utils";
import { bookingDaysLeftLine } from "@/lib/connections/booking-days-left";

export interface ConnectionSummary {
  id: string;
  counterparty_name: string;
  suburb: string | null;
  headline: string;
  next_step: string | null;
  time_left: string | null;
  confirmed_time: string | null;
}

export async function loadConnections(
  role: ConnectionRole,
): Promise<{ list: ConnectionRequestWithDetails[]; error: string | null }> {
  const result =
    role === "nanny"
      ? await getNannyConnectionRequests()
      : await getParentConnectionRequests();
  // Defensive `?? []`: the server action type says `data: Array`, but some
  // Supabase shapes return `{ data: undefined, error: "…" }` under pressure.
  // Callers do `.filter()` on the list; without this guard that throws a
  // TypeError and never reaches the caller's error-check.
  return { list: result.data ?? [], error: result.error };
}

/**
 * Extract counterparty (nanny for the parent side, parent for the nanny
 * side). Returns null when the enriched connection is missing the
 * counterparty join — that's a data-integrity issue, not a legitimate
 * anonymous connection, and callers should surface it as an error
 * rather than narrate "Unknown" as if it were a real name.
 */
export function counterpartyFromRequest(
  req: ConnectionRequestWithDetails,
  role: ConnectionRole,
): { firstName: string; lastName: string; suburb: string | null } | null {
  const party = role === "nanny" ? req.parent : req.nanny;
  if (!party || !party.first_name) return null;
  return {
    firstName: party.first_name,
    lastName: party.last_name ?? "",
    suburb: party.suburb ?? null,
  };
}

/**
 * Write-handler helper. Resolves counterparty name for use in previews
 * + success messages; returns a ToolResult-shaped error when the join
 * is missing so we never narrate a fake name back to the user.
 */
export function requireCounterpartyDisplayName(
  req: ConnectionRequestWithDetails,
  role: ConnectionRole,
): { ok: true; displayName: string } | { ok: false; error: string } {
  const cp = counterpartyFromRequest(req, role);
  if (!cp) {
    console.error(
      "[connections] write handler blocked on missing counterparty",
      { id: req.id, role },
    );
    return {
      ok: false,
      error:
        "We couldn't load the other party's details for this connection. Please refresh and try again.",
    };
  }
  return {
    ok: true,
    displayName: counterpartyDisplayName(cp.firstName, cp.lastName),
  };
}

export function summarise(
  req: ConnectionRequestWithDetails,
  role: ConnectionRole,
): ConnectionSummary | null {
  // Bulk-read path: if the enriched row is missing the counterparty
  // join, skip this entry rather than narrate a fake "Unknown" name.
  // This keeps the list tidy and doesn't let partial data become
  // something the LLM can speak out loud.
  const cp = counterpartyFromRequest(req, role);
  if (!cp) {
    console.error("[connections] skipping row with missing counterparty", {
      id: req.id,
      role,
    });
    return null;
  }
  const { firstName, lastName, suburb } = cp;
  const displayName = counterpartyDisplayName(firstName, lastName);
  return {
    id: req.id,
    counterparty_name: displayName,
    suburb,
    headline: stageHeadline(req.connection_stage, role, {
      counterpartyName: displayName,
      fillInitiatedBy: req.fill_initiated_by,
    }),
    next_step: nextStepForUser(req.connection_stage, role, {
      fillInitiatedBy: req.fill_initiated_by,
    }),
    // the family hears only the days left to book once she has accepted; the nanny hears her time left
    time_left:
      role === "parent"
        ? bookingDaysLeftLine(
            { connectionStage: req.connection_stage, expiresAt: req.expires_at, proposedTimes: req.proposed_times },
            firstName,
          )
        : timeLeft(req.expires_at),
    confirmed_time: req.confirmed_time,
  };
}

export function resolveRole(effectiveRole: string): ConnectionRole | null {
  return asUserFacingRole(effectiveRole);
}

export function roleOnlyError(): ToolResult {
  return {
    success: false,
    error:
      "Connections are only available for nanny and parent accounts. Admin views use the admin inspection tools.",
  };
}

/**
 * Shared resolver — load the caller's connections, find the one by id,
 * return { connection, role } or an error. All write handlers start
 * here so the role gate + ownership check are consistent and the
 * failure modes produce the same user-safe error text.
 */
export async function resolveConnectionForWrite(
  connectionId: unknown,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<
  | { ok: true; role: ConnectionRole; connection: ConnectionRequestWithDetails }
  | { ok: false; error: string }
> {
  if (typeof connectionId !== "string" || connectionId.trim().length === 0) {
    return {
      ok: false,
      error: "Pass the `connection_id` of the connection to act on.",
    };
  }

  const role = resolveRole(ctx.effectiveRole);
  if (!role) {
    return {
      ok: false,
      error:
        "Connections are only available for nanny and parent accounts. Admin views use the admin inspection tools.",
    };
  }

  const { list, error } = await loadConnections(role);
  if (error) return { ok: false, error };

  const connection = list.find((r) => r.id === connectionId.trim());
  if (!connection) {
    return {
      ok: false,
      error: `No connection found with id "${connectionId}". Use read_connection_by_name or read_connection_inbox to find the right id.`,
    };
  }

  return { ok: true, role, connection };
}
