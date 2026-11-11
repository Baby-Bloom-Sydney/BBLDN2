/**
 * Post-meet-and-greet write handlers: report_outcome, confirm_placement,
 * send_connection_request.
 *
 * These three propose/apply pairs cover the lifecycle from "meet-and-greet
 * has happened" through placement confirmation, plus the parent-initiated
 * new-request flow (which lives here because it doesn't fit the
 * pre-meet lifecycle). The pre-meet actions live in
 * `connections-writes-pre-meet.ts`.
 */

import type { BloomBotModule, ToolDefinition, ToolResult } from "./types";
import { createConnectionRequest } from "@/lib/actions/connection";
import { CONNECTION_ERRORS } from "@/lib/actions/connection-errors";
import {
  reportIntroOutcome,
  reportParentOutcome,
  confirmPlacement,
  nannyConfirmPosition,
} from "@/lib/actions/position-funnel";
import { CONNECTION_STAGE } from "@/lib/position/constants";
import { isTerminal, type ConnectionRole } from "./connections-translator";
import {
  loadConnections,
  resolveRole,
  roleOnlyError,
  resolveConnectionForWrite,
  requireCounterpartyDisplayName,
} from "./connections-shared";

// ── Report outcome (nanny-side + parent-side) ────────────────────────────

type NannyOutcome = "hired" | "not_hired" | "awaiting" | "trial" | "incomplete";
type ParentOutcome = "hired" | "not_hired" | "awaiting" | "trial";

const NANNY_OUTCOMES: NannyOutcome[] = [
  "hired",
  "not_hired",
  "awaiting",
  "trial",
  "incomplete",
];
const PARENT_OUTCOMES: ParentOutcome[] = [
  "hired",
  "not_hired",
  "awaiting",
  "trial",
];

function outcomeStagesFor(role: ConnectionRole): number[] {
  return [
    CONNECTION_STAGE.INTRO_SCHEDULED,
    CONNECTION_STAGE.INTRO_COMPLETE,
    CONNECTION_STAGE.AWAITING_RESPONSE,
    CONNECTION_STAGE.TRIAL_ARRANGED,
    CONNECTION_STAGE.TRIAL_COMPLETE,
    ...(role === "nanny" ? [CONNECTION_STAGE.INTRO_INCOMPLETE] : []),
  ];
}

function validateOutcome(
  role: ConnectionRole,
  raw: unknown,
):
  | { ok: true; outcome: NannyOutcome | ParentOutcome }
  | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "Pass `outcome` as a string." };
  }
  if (role === "nanny" && NANNY_OUTCOMES.includes(raw as NannyOutcome)) {
    return { ok: true, outcome: raw as NannyOutcome };
  }
  if (role === "parent" && PARENT_OUTCOMES.includes(raw as ParentOutcome)) {
    return { ok: true, outcome: raw as ParentOutcome };
  }
  const allowed = role === "nanny" ? NANNY_OUTCOMES : PARENT_OUTCOMES;
  return {
    ok: false,
    error: `Invalid outcome for ${role} — expected one of ${allowed.join(", ")}.`,
  };
}

function outcomeDescription(
  outcome: NannyOutcome | ParentOutcome,
  role: ConnectionRole,
  counterparty: string,
): string {
  switch (outcome) {
    case "hired":
      return role === "nanny"
        ? `You're telling us ${counterparty} selected you. They'll be notified and asked to confirm, which locks in the placement.`
        : `You're telling us you've chosen ${counterparty}. They'll be notified and asked to confirm — that locks in the placement and releases your other candidates.`;
    case "not_hired":
      return role === "nanny"
        ? `You're logging that ${counterparty} went a different direction. No email — just keeps your pipeline tidy.`
        : `You're logging that ${counterparty} isn't the one. No email sent — just keeps your pipeline tidy.`;
    case "awaiting":
      return `You're marking this as "still deciding". No notification; take your time.`;
    case "trial":
      return role === "nanny"
        ? `You're telling us you've arranged a trial shift. The family will be notified in their inbox to confirm the date.`
        : `You're telling us you've arranged a trial shift. ${counterparty} will be notified in their inbox to confirm.`;
    case "incomplete":
      return `You're logging that the meet and greet didn't happen. This is terminal — the connection closes.`;
    default:
      return "";
  }
}

async function proposeReportOutcome(
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const resolved = await resolveConnectionForWrite(args.connection_id, ctx);
  if (!resolved.ok) return { success: false, error: resolved.error };
  const { role, connection } = resolved;

  const outcomeResult = validateOutcome(role, args.outcome);
  if (!outcomeResult.ok) return { success: false, error: outcomeResult.error };
  const outcome = outcomeResult.outcome;

  const stages = outcomeStagesFor(role);
  if (!stages.includes(connection.connection_stage ?? -1)) {
    return {
      success: false,
      error:
        "This connection isn't at a stage where an outcome can be reported. Check what stage it's in first.",
    };
  }

  const extraDate =
    typeof args.date === "string" && args.date.trim().length > 0
      ? args.date.trim()
      : null;
  if (extraDate && !/^\d{4}-\d{2}-\d{2}$/.test(extraDate)) {
    return {
      success: false,
      error:
        "If you pass a date for the outcome (trial date, start week), it must be in YYYY-MM-DD format.",
    };
  }

  const cpRes = requireCounterpartyDisplayName(connection, role);
  if (!cpRes.ok) return { success: false, error: cpRes.error };
  const displayName = cpRes.displayName;
  const description = outcomeDescription(outcome, role, displayName);
  const emailSideEffect =
    outcome === "hired" || (role === "parent" && outcome === "trial");

  // The server accepts `hired` and `trial` without a date, but the user
  // usually means "starting week X" or "trial date Y". Flag to Katie so
  // she asks the user rather than logging a dateless outcome silently.
  const needsDateAsk =
    (outcome === "trial" || outcome === "hired") && !extraDate;
  const next_call = needsDateAsk
    ? `The user didn't include a ${outcome === "trial" ? "trial date" : "start week"}. Ask them for it in YYYY-MM-DD form before re-proposing — don't skip to apply_ without it.`
    : "Read the preview back verbatim, then wait for explicit yes/cancel. On yes, call apply_report_outcome with the same connection_id, outcome, and date (if any).";

  return {
    success: true,
    data: {
      action: "report_outcome",
      connection_id: connection.id,
      role,
      outcome,
      date: extraDate,
      date_missing: needsDateAsk,
      counterparty_name: displayName,
      email_side_effect: emailSideEffect,
      preview: `${description}${extraDate ? ` Date: ${extraDate}.` : ""}`,
      next_call,
    },
  };
}

async function applyReportOutcome(
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const resolved = await resolveConnectionForWrite(args.connection_id, ctx);
  if (!resolved.ok) return { success: false, error: resolved.error };
  const { role, connection } = resolved;

  const outcomeResult = validateOutcome(role, args.outcome);
  if (!outcomeResult.ok) return { success: false, error: outcomeResult.error };
  const outcome = outcomeResult.outcome;

  const stages = outcomeStagesFor(role);
  if (!stages.includes(connection.connection_stage ?? -1)) {
    return {
      success: false,
      error:
        "This connection isn't at a stage where an outcome can be reported any more. It may have already advanced.",
    };
  }

  const extraDate =
    typeof args.date === "string" && args.date.trim().length > 0
      ? args.date.trim()
      : undefined;
  if (extraDate && !/^\d{4}-\d{2}-\d{2}$/.test(extraDate)) {
    return {
      success: false,
      error:
        "If you pass a date for the outcome, it must be in YYYY-MM-DD format.",
    };
  }

  const cpRes = requireCounterpartyDisplayName(connection, role);
  if (!cpRes.ok) return { success: false, error: cpRes.error };
  const displayName = cpRes.displayName;

  const result =
    role === "nanny"
      ? await reportIntroOutcome(
          connection.id,
          outcome as NannyOutcome,
          extraDate,
        )
      : await reportParentOutcome(
          connection.id,
          outcome as ParentOutcome,
          extraDate,
        );

  if (!result.success) {
    return {
      success: false,
      error: result.error ?? "Failed to report outcome.",
    };
  }
  return {
    success: true,
    data: {
      action: "report_outcome",
      connection_id: connection.id,
      role,
      outcome,
      counterparty_name: displayName,
      message: `Logged. ${displayName}'s status has been updated.`,
    },
    tile: {
      kind: "connection_request",
      data: { id: connection.id },
    },
  };
}

// ── Placement confirmation (Path A parent / Path B nanny) ────────────────

async function proposeConfirmPlacement(
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const resolved = await resolveConnectionForWrite(args.connection_id, ctx);
  if (!resolved.ok) return { success: false, error: resolved.error };
  const { role, connection } = resolved;

  if (connection.connection_stage !== CONNECTION_STAGE.OFFERED) {
    return {
      success: false,
      error:
        "This connection isn't at the 'offered' stage — confirmation isn't available.",
    };
  }

  const initiatedBy = connection.fill_initiated_by;
  if (role === "parent" && initiatedBy !== "nanny") {
    return {
      success: false,
      error:
        "The family only confirms when the nanny has signalled they've been selected (Path A). This one is waiting on the nanny to confirm.",
    };
  }
  if (role === "nanny" && initiatedBy !== "parent") {
    return {
      success: false,
      error:
        "The nanny only confirms when the family has selected them (Path B). This one is waiting on the family to confirm.",
    };
  }

  const startDate =
    typeof args.start_week === "string" && args.start_week.trim().length > 0
      ? args.start_week.trim()
      : null;
  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return {
      success: false,
      error: "If you pass `start_week`, it must be in YYYY-MM-DD format.",
    };
  }

  const cpRes = requireCounterpartyDisplayName(connection, role);
  if (!cpRes.ok) return { success: false, error: cpRes.error };
  const displayName = cpRes.displayName;

  const preview =
    role === "parent"
      ? `You're about to confirm ${displayName} as your nanny. This is significant:\n- It creates an active placement starting${startDate ? ` the week of ${startDate}` : " soon (you can update the start week later)"}.\n- Your other candidates will be automatically released with a "position filled" notification.\n- You'll both receive a hire-confirmation PDF by email.\nThis can't be undone from here.`
      : `You're about to confirm the position with the ${displayName} family. This is significant:\n- It creates an active placement starting${startDate ? ` the week of ${startDate}` : " soon"}.\n- Any other connections you have at an active stage will be closed.\n- You'll both receive a hire-confirmation PDF by email.\nThis can't be undone from here.`;

  return {
    success: true,
    data: {
      action: "confirm_placement",
      connection_id: connection.id,
      role,
      counterparty_name: displayName,
      start_week: startDate,
      email_side_effect: true,
      preview,
      next_call:
        "Read the preview back VERBATIM. This is a mandatory two-turn confirm — only proceed on an unambiguous affirmative. Call apply_confirm_placement with the same connection_id (and start_week if provided).",
    },
  };
}

async function applyConfirmPlacement(
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const resolved = await resolveConnectionForWrite(args.connection_id, ctx);
  if (!resolved.ok) return { success: false, error: resolved.error };
  const { role, connection } = resolved;

  if (connection.connection_stage !== CONNECTION_STAGE.OFFERED) {
    return {
      success: false,
      error:
        "This connection isn't at the 'offered' stage any more — confirmation isn't available.",
    };
  }
  const initiatedBy = connection.fill_initiated_by;
  if (role === "parent" && initiatedBy !== "nanny") {
    return {
      success: false,
      error:
        "The family only confirms when the nanny has signalled they've been selected (Path A). This one is waiting on the nanny to confirm.",
    };
  }
  if (role === "nanny" && initiatedBy !== "parent") {
    return {
      success: false,
      error:
        "The nanny only confirms when the family has selected them (Path B). This one is waiting on the family to confirm.",
    };
  }

  const startWeek =
    typeof args.start_week === "string" && args.start_week.trim().length > 0
      ? args.start_week.trim()
      : undefined;

  const cpRes = requireCounterpartyDisplayName(connection, role);
  if (!cpRes.ok) return { success: false, error: cpRes.error };
  const displayName = cpRes.displayName;

  const result =
    role === "parent"
      ? await confirmPlacement(connection.id, startWeek)
      : await nannyConfirmPosition(connection.id);

  if (!result.success) {
    return {
      success: false,
      error: result.error ?? "Failed to confirm placement.",
    };
  }
  return {
    success: true,
    data: {
      action: "confirm_placement",
      connection_id: connection.id,
      role,
      counterparty_name: displayName,
      message:
        role === "parent"
          ? `Confirmed! ${displayName} is your nanny. Hire PDFs are on the way to both of you, and your other candidates have been released.`
          : `Confirmed! You're starting with the ${displayName} family. Hire PDFs are on the way.`,
    },
    tile: {
      kind: "connection_request",
      data: { id: connection.id },
    },
  };
}

// ── Send new connection request (parent-initiated) ───────────────────────

async function proposeSendConnectionRequest(
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const role = resolveRole(ctx.effectiveRole);
  if (!role) return roleOnlyError();
  if (role !== "parent") {
    return {
      success: false,
      error: "Only parents send connection requests to nannies.",
    };
  }

  const nannyId = typeof args.nanny_id === "string" ? args.nanny_id.trim() : "";
  if (nannyId.length === 0) {
    return {
      success: false,
      error:
        "Pass `nanny_id` — the id of the nanny to connect with. Users can grab it from a nanny profile page.",
    };
  }

  const message =
    typeof args.message === "string" && args.message.trim().length > 0
      ? args.message.trim()
      : null;
  if (message && message.length > 1000) {
    return {
      success: false,
      error: "Keep your message under 1000 characters.",
    };
  }

  const { list, error } = await loadConnections(role);
  if (error) return { success: false, error };

  const pending = list.filter(
    (r) => r.status === "pending" && !isTerminal(r.connection_stage),
  );
  if (pending.length >= 5) {
    return {
      success: false,
      error:
        "You already have 5 open connection requests waiting for a response. Wait for one to resolve or cancel one before sending a new one.",
    };
  }

  const duplicate = list.find(
    (r) =>
      r.nanny_id === nannyId &&
      ["pending", "accepted", "confirmed"].includes(r.status),
  );
  if (duplicate) {
    return {
      success: false,
      error:
        "You already have an active connection with this nanny — you can't send a second request until that one closes.",
    };
  }

  return {
    success: true,
    data: {
      action: "send_connection_request",
      nanny_id: nannyId,
      has_message: message !== null,
      message_preview: message ? message.slice(0, 200) : null,
      email_side_effect: true,
      preview: message
        ? `You're about to send a connection request to this nanny with this message:\n"${message}"\nThey'll get an email and inbox notification and have 7 days to respond.`
        : `You're about to send a connection request to this nanny (no personal message attached). They'll get an email and inbox notification and have 7 days to respond.`,
      next_call:
        "Read the preview back. On a clear yes, call apply_send_connection_request with the same nanny_id and message.",
    },
  };
}

async function applySendConnectionRequest(
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const role = resolveRole(ctx.effectiveRole);
  if (!role) return roleOnlyError();
  if (role !== "parent") {
    return {
      success: false,
      error: "Only parents send connection requests to nannies.",
    };
  }

  const nannyId = typeof args.nanny_id === "string" ? args.nanny_id.trim() : "";
  if (!nannyId) {
    return {
      success: false,
      error: "Missing nanny_id — call propose_send_connection_request first.",
    };
  }
  const message =
    typeof args.message === "string" && args.message.trim().length > 0
      ? args.message.trim()
      : undefined;
  if (message && message.length > 1000) {
    return {
      success: false,
      error: "Keep your message under 1000 characters.",
    };
  }

  const { list, error: listError } = await loadConnections(role);
  if (listError) return { success: false, error: listError };

  const pending = list.filter(
    (r) => r.status === "pending" && !isTerminal(r.connection_stage),
  );
  if (pending.length >= 5) {
    return {
      success: false,
      error:
        "You've hit the 5-open-request limit since we last checked. Cancel one or wait for a response before sending this.",
    };
  }
  const duplicate = list.find(
    (r) =>
      r.nanny_id === nannyId &&
      ["pending", "accepted", "confirmed"].includes(r.status),
  );
  if (duplicate) {
    return {
      success: false,
      error:
        "A connection with this nanny just became active — you can't send a new request while that one is open.",
    };
  }

  const result = await createConnectionRequest(nannyId, message);
  if (!result.success) {
    // T-041: server emits "POSITION_REQUIRED" as a sentinel for the modal
    // UI to swap to a "create your position first" surface. Katie speaks
    // English to parents, so translate the sentinel into a human message
    // (and point at the same destination as the modal CTA).
    if (result.error === CONNECTION_ERRORS.POSITION_REQUIRED) {
      return {
        success: false,
        error:
          "You'll need to create a nanny position first. Open the Position section from your hub (or visit /parent/request) and tell us about your family's needs — it only takes a few minutes.",
      };
    }
    if (result.error === CONNECTION_ERRORS.AT_LIMIT) {
      return {
        success: false,
        error:
          "You have 5 open requests. That's the most at one time. To connect with this nanny, please step back from one of your other requests first.",
      };
    }
    return {
      success: false,
      error: result.error ?? "Failed to send connection request.",
    };
  }

  if (!result.requestId) {
    return {
      success: false,
      error:
        "The request may have been sent but we couldn't confirm it. Please refresh your inbox to check before retrying.",
    };
  }

  return {
    success: true,
    data: {
      action: "send_connection_request",
      nanny_id: nannyId,
      request_id: result.requestId,
      message:
        "Request sent. They've got 7 days to respond — I'll let you know when they do.",
    },
    tile: {
      kind: "connection_request",
      data: { id: result.requestId },
    },
  };
}

// ── Exports ──────────────────────────────────────────────────────────────

export const postMeetWriteTools: ToolDefinition[] = [
  {
    name: "propose_report_outcome",
    description:
      "Preview reporting a meet-and-greet / trial outcome on a connection. Nanny outcomes: hired, not_hired, awaiting, trial, incomplete. Parent outcomes: hired, not_hired, awaiting, trial. Optional `date` (YYYY-MM-DD) for trial date or hire start week. Does NOT hit the server. Valid only when the connection is in a post-meet stage.",
    parameters: {
      type: "object",
      properties: {
        connection_id: { type: "string" },
        outcome: {
          type: "string",
          description:
            "Nanny: hired|not_hired|awaiting|trial|incomplete. Parent: hired|not_hired|awaiting|trial.",
        },
        date: {
          type: "string",
          description:
            "Optional YYYY-MM-DD. For outcome='trial' this is the trial date; for outcome='hired' this is the start week.",
        },
      },
      required: ["connection_id", "outcome"],
    },
  },
  {
    name: "apply_report_outcome",
    description:
      "Actually log the outcome. Routes to reportIntroOutcome (nanny) or reportParentOutcome (parent) based on role. For outcome='hired' this sends the hire-offer email and advances the connection toward placement. Only call after propose_report_outcome + explicit confirmation.",
    parameters: {
      type: "object",
      properties: {
        connection_id: { type: "string" },
        outcome: { type: "string" },
        date: { type: "string" },
      },
      required: ["connection_id", "outcome"],
    },
  },
  {
    name: "propose_confirm_placement",
    description:
      "Preview confirming a placement. Path A: parent confirms when nanny signalled 'hired' — creates placement, releases other candidates, emails hire PDFs. Path B: nanny confirms when parent signalled 'hired' — same outcome, initiated from the other side. Connection must be in OFFERED stage; Path is validated against fill_initiated_by. Does NOT hit the server. MANDATORY two-turn confirm — preview must be read back verbatim.",
    parameters: {
      type: "object",
      properties: {
        connection_id: { type: "string" },
        start_week: {
          type: "string",
          description:
            "Optional YYYY-MM-DD for the start-of-placement week. If omitted, the placement starts according to the server's default.",
        },
      },
      required: ["connection_id"],
    },
  },
  {
    name: "apply_confirm_placement",
    description:
      "Actually confirm the placement. Parent path → confirmPlacement(requestId, startWeek?); nanny path → nannyConfirmPosition(requestId). Sends hire-confirmation PDFs to both parties. Only after propose_confirm_placement + unambiguous explicit confirmation.",
    parameters: {
      type: "object",
      properties: {
        connection_id: { type: "string" },
        start_week: { type: "string" },
      },
      required: ["connection_id"],
    },
  },
  {
    name: "propose_send_connection_request",
    description:
      "Preview sending a new connection request to a nanny (parent only). Validates: ≤5 open requests already pending, no existing active connection with this nanny, message ≤ 1000 chars. Does NOT hit the server.",
    parameters: {
      type: "object",
      properties: {
        nanny_id: {
          type: "string",
          description:
            "The nanny's id (from a nanny profile page, not the auth user id).",
        },
        message: {
          type: "string",
          description:
            "Optional personal message from the parent, ≤ 1000 characters.",
        },
      },
      required: ["nanny_id"],
    },
  },
  {
    name: "apply_send_connection_request",
    description:
      "Actually send the request. Sends INT-001 to the nanny, creates the inbox message, and moves the parent's position Open→Connecting if it's the first request. Only after propose_send_connection_request + explicit confirmation.",
    parameters: {
      type: "object",
      properties: {
        nanny_id: { type: "string" },
        message: { type: "string" },
      },
      required: ["nanny_id"],
    },
  },
];

export async function tryExecutePostMeetWrite(
  toolName: string,
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult | null> {
  if (toolName === "propose_report_outcome")
    return proposeReportOutcome(args, ctx);
  if (toolName === "apply_report_outcome") return applyReportOutcome(args, ctx);
  if (toolName === "propose_confirm_placement")
    return proposeConfirmPlacement(args, ctx);
  if (toolName === "apply_confirm_placement")
    return applyConfirmPlacement(args, ctx);
  if (toolName === "propose_send_connection_request")
    return proposeSendConnectionRequest(args, ctx);
  if (toolName === "apply_send_connection_request")
    return applySendConnectionRequest(args, ctx);
  return null;
}
