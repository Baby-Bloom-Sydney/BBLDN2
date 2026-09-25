/**
 * Pre-meet-and-greet write handlers: decline, cancel, accept, schedule.
 *
 * These four propose/apply pairs cover the lifecycle from "request
 * received" through to "meet-and-greet booked". Post-meet outcomes +
 * placement confirmation + new request creation live in
 * `connections-writes-post-meet.ts`.
 */

import type { BloomBotModule, ToolDefinition, ToolResult } from "./types";
import {
  declineConnectionRequest,
  cancelConnectionRequest,
  acceptConnectionRequest,
  scheduleConnectionTime,
} from "@/lib/actions/connection";
import { CONNECTION_STAGE } from "@/lib/position/constants";
import { BRAND } from "@/lib/constants";
import {
  BRACKET_KEYS,
  TIME_BRACKETS,
  formatClockHourMinute,
  getBracketForHour,
  type BracketKey,
} from "@/lib/timezone";
import { isTerminal } from "./connections-translator";
import {
  resolveConnectionForWrite,
  requireCounterpartyDisplayName,
} from "./connections-shared";

// ── Decline (nanny-only, pending stages only) ────────────────────────────

async function proposeDeclineConnection(
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const resolved = await resolveConnectionForWrite(args.connection_id, ctx);
  if (!resolved.ok) return { success: false, error: resolved.error };
  const { role, connection } = resolved;

  if (role !== "nanny") {
    return {
      success: false,
      error:
        "Only nannies can decline a connection. As the parent, use cancel if you want to withdraw the request instead.",
    };
  }

  const stage = connection.connection_stage;
  const declinable =
    stage === CONNECTION_STAGE.REQUEST_SENT ||
    stage === CONNECTION_STAGE.NANNY_APPLIED_PENDING ||
    stage === CONNECTION_STAGE.ACCEPTED_PENDING;
  if (!declinable) {
    return {
      success: false,
      error:
        "This request is no longer in the pending stage — decline isn't available. If you want to step away, use cancel instead.",
    };
  }

  const cpRes = requireCounterpartyDisplayName(connection, role);
  if (!cpRes.ok) return { success: false, error: cpRes.error };
  const displayName = cpRes.displayName;

  const reason =
    typeof args.reason === "string" && args.reason.trim().length > 0
      ? args.reason.trim()
      : null;

  return {
    success: true,
    data: {
      action: "decline",
      connection_id: connection.id,
      counterparty_name: displayName,
      has_reason: reason !== null,
      email_side_effect: true,
      preview: `You're about to decline the connection request from ${displayName}. The family will get a neutral notification — we never share the reason you give us (it's kept in our records only).`,
      next_call:
        "Read this back to the user and ask 'yes / cancel'. When they confirm, call apply_decline_connection with the same connection_id (and reason if they provided one).",
    },
  };
}

async function applyDeclineConnection(
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const resolved = await resolveConnectionForWrite(args.connection_id, ctx);
  if (!resolved.ok) return { success: false, error: resolved.error };
  const { role, connection } = resolved;

  if (role !== "nanny") {
    return {
      success: false,
      error:
        "Only nannies can decline a connection. This shouldn't have been called — re-check the propose step.",
    };
  }

  const stage = connection.connection_stage;
  if (
    stage !== CONNECTION_STAGE.REQUEST_SENT &&
    stage !== CONNECTION_STAGE.NANNY_APPLIED_PENDING &&
    stage !== CONNECTION_STAGE.ACCEPTED_PENDING
  ) {
    return {
      success: false,
      error:
        "This request is no longer in the pending stage — decline isn't available. If you want to step away, use cancel instead.",
    };
  }

  const cpRes = requireCounterpartyDisplayName(connection, role);
  if (!cpRes.ok) return { success: false, error: cpRes.error };
  const displayName = cpRes.displayName;

  const reason =
    typeof args.reason === "string" && args.reason.trim().length > 0
      ? args.reason.trim()
      : undefined;

  const result = await declineConnectionRequest(connection.id, reason);
  if (!result.success) {
    return {
      success: false,
      error: result.error ?? "Failed to decline connection.",
    };
  }

  return {
    success: true,
    data: {
      action: "decline",
      connection_id: connection.id,
      counterparty_name: displayName,
      message: `Declined. ${displayName} will get a neutral notification — nothing about a specific reason.`,
    },
    tile: {
      kind: "connection_request",
      data: { id: connection.id },
    },
  };
}

// ── Cancel (either side, any active connection) ──────────────────────────

async function proposeCancelConnection(
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const resolved = await resolveConnectionForWrite(args.connection_id, ctx);
  if (!resolved.ok) return { success: false, error: resolved.error };
  const { role, connection } = resolved;

  if (connection.status === "cancelled") {
    return {
      success: false,
      error: "This connection has already been cancelled.",
    };
  }
  if (isTerminal(connection.connection_stage)) {
    return {
      success: false,
      error:
        "This connection is already closed — cancel isn't available. If you want to start something new, send a fresh request.",
    };
  }

  const cpRes = requireCounterpartyDisplayName(connection, role);
  if (!cpRes.ok) return { success: false, error: cpRes.error };
  const displayName = cpRes.displayName;
  const otherPartyNotice =
    role === "parent"
      ? `${displayName} will be notified in their inbox.`
      : `The family will be notified in their inbox.`;

  return {
    success: true,
    data: {
      action: "cancel",
      connection_id: connection.id,
      counterparty_name: displayName,
      email_side_effect: false,
      preview: `You're about to cancel your connection with ${displayName}. ${otherPartyNotice} You can send a new request later if you change your mind.`,
      next_call:
        "Read this back to the user and ask 'yes / cancel'. When they confirm, call apply_cancel_connection with the same connection_id.",
    },
  };
}

async function applyCancelConnection(
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const resolved = await resolveConnectionForWrite(args.connection_id, ctx);
  if (!resolved.ok) return { success: false, error: resolved.error };
  const { role, connection } = resolved;

  if (connection.status === "cancelled") {
    return {
      success: false,
      error: "This connection has already been cancelled.",
    };
  }
  if (isTerminal(connection.connection_stage)) {
    return {
      success: false,
      error:
        "This connection is already closed — cancel isn't available any more.",
    };
  }

  const cpRes = requireCounterpartyDisplayName(connection, role);
  if (!cpRes.ok) return { success: false, error: cpRes.error };
  const displayName = cpRes.displayName;

  const result = await cancelConnectionRequest(connection.id);
  if (!result.success) {
    return {
      success: false,
      error: result.error ?? "Failed to cancel connection.",
    };
  }

  return {
    success: true,
    data: {
      action: "cancel",
      connection_id: connection.id,
      counterparty_name: displayName,
      message: `Cancelled. ${displayName} will see this in their inbox.`,
    },
    tile: {
      kind: "connection_request",
      data: { id: connection.id },
    },
  };
}

// ── Accept (nanny, ≥5 slots across ≥3 days, all 4 brackets) ─────────────

const SLOT_REGEX = /^\d{4}-\d{2}-\d{2}_(morning|midday|afternoon|evening)$/;

function parseSlots(
  raw: unknown,
):
  | { ok: true; slots: string[]; brackets: Set<BracketKey>; days: Set<string> }
  | { ok: false; error: string } {
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      error:
        "Pass `slots` as an array of strings like ['2026-05-01_morning', '2026-05-01_evening', ...].",
    };
  }
  // Dedupe before counting — an LLM that sends the same slot 5× shouldn't
  // pass the ≥5 check. Also silently normalises case-insensitive
  // duplicates since the format is lowercase-locked by SLOT_REGEX.
  const seen = new Set<string>();
  const slots: string[] = [];
  const brackets = new Set<BracketKey>();
  const days = new Set<string>();
  for (const s of raw) {
    if (typeof s !== "string" || !SLOT_REGEX.test(s)) {
      return {
        ok: false,
        error: `Invalid slot "${String(s)}" — must look like "YYYY-MM-DD_morning" (bracket = morning/midday/afternoon/evening).`,
      };
    }
    if (seen.has(s)) continue; // drop duplicates quietly
    seen.add(s);
    const [date, bracket] = s.split("_");
    slots.push(s);
    brackets.add(bracket as BracketKey);
    days.add(date);
  }
  if (slots.length < 5) {
    return {
      ok: false,
      error: `Need at least 5 unique slots — got ${slots.length}.`,
    };
  }
  if (brackets.size < BRACKET_KEYS.length) {
    const missing = BRACKET_KEYS.filter((b) => !brackets.has(b));
    return {
      ok: false,
      error: `Need at least one slot in every bracket (Morning / Midday / Afternoon / Evening). Missing: ${missing.join(", ")}.`,
    };
  }
  if (days.size < 3) {
    return {
      ok: false,
      error: `Need slots across at least 3 different days — got ${days.size}.`,
    };
  }
  return { ok: true, slots, brackets, days };
}

async function proposeAcceptConnection(
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const resolved = await resolveConnectionForWrite(args.connection_id, ctx);
  if (!resolved.ok) return { success: false, error: resolved.error };
  const { role, connection } = resolved;

  if (role !== "nanny") {
    return {
      success: false,
      error: "Only nannies can accept a connection request.",
    };
  }

  const stage = connection.connection_stage;
  if (
    stage !== CONNECTION_STAGE.REQUEST_SENT &&
    stage !== CONNECTION_STAGE.NANNY_APPLIED_PENDING
  ) {
    return {
      success: false,
      error:
        "This request isn't in the pending stage — it can't be accepted right now.",
    };
  }

  const parsed = parseSlots(args.slots);
  if (!parsed.ok) return { success: false, error: parsed.error };

  const cpRes = requireCounterpartyDisplayName(connection, role);
  if (!cpRes.ok) return { success: false, error: cpRes.error };
  const displayName = cpRes.displayName;

  const byDay: Record<string, BracketKey[]> = {};
  for (const slot of parsed.slots) {
    const [date, bracket] = slot.split("_");
    byDay[date] = byDay[date] ?? [];
    byDay[date].push(bracket as BracketKey);
  }
  const dayLines = Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([date, bs]) =>
        `${date}: ${bs.map((b) => TIME_BRACKETS[b].label).join(", ")}`,
    );

  return {
    success: true,
    data: {
      action: "accept",
      connection_id: connection.id,
      counterparty_name: displayName,
      slot_count: parsed.slots.length,
      bracket_count: parsed.brackets.size,
      day_count: parsed.days.size,
      slots_by_day: dayLines,
      email_side_effect: true,
      preview: `You're about to accept the connection request from ${displayName} with ${parsed.slots.length} availability slot${parsed.slots.length === 1 ? "" : "s"} across ${parsed.days.size} days. Read these times back so they can double-check:\n${dayLines.map((l) => `- ${l}`).join("\n")}\nOnce accepted, ${displayName} gets a notification and has 3 days to pick one of these times.`,
      next_call:
        "Read the preview + slot list back to the user and wait for 'yes / cancel'. On confirmation, call apply_accept_connection with the SAME connection_id and slots array.",
    },
  };
}

async function applyAcceptConnection(
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const resolved = await resolveConnectionForWrite(args.connection_id, ctx);
  if (!resolved.ok) return { success: false, error: resolved.error };
  const { role, connection } = resolved;

  if (role !== "nanny") {
    return {
      success: false,
      error: "Only nannies can accept a connection request.",
    };
  }

  const stage = connection.connection_stage;
  if (
    stage !== CONNECTION_STAGE.REQUEST_SENT &&
    stage !== CONNECTION_STAGE.NANNY_APPLIED_PENDING
  ) {
    return {
      success: false,
      error:
        "This request isn't in the pending stage — it can't be accepted right now.",
    };
  }

  const parsed = parseSlots(args.slots);
  if (!parsed.ok) return { success: false, error: parsed.error };

  const cpRes = requireCounterpartyDisplayName(connection, role);
  if (!cpRes.ok) return { success: false, error: cpRes.error };
  const displayName = cpRes.displayName;

  const result = await acceptConnectionRequest(connection.id, parsed.slots);
  if (!result.success) {
    return {
      success: false,
      error: result.error ?? "Failed to accept connection.",
    };
  }

  return {
    success: true,
    data: {
      action: "accept",
      connection_id: connection.id,
      counterparty_name: displayName,
      slot_count: parsed.slots.length,
      message: `Accepted. ${displayName} will be notified with your availability and has 3 days to pick a meet-and-greet time.`,
    },
    tile: {
      kind: "connection_request",
      data: { id: connection.id },
    },
  };
}

// ── Schedule meet time (parent, picks from nanny's proposed_times) ──────

interface ParsedMeetTime {
  date: string;
  hour: number;
  minute: number;
  bracket: BracketKey;
}

function parseMeetTime(
  args: Record<string, unknown>,
): { ok: true; t: ParsedMeetTime } | { ok: false; error: string } {
  const date = typeof args.date === "string" ? args.date.trim() : "";
  const hour = typeof args.hour === "number" ? args.hour : NaN;
  const minute = typeof args.minute === "number" ? args.minute : NaN;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return {
      ok: false,
      error: `Pass \`date\` as an ISO date in ${BRAND.city} time (YYYY-MM-DD).`,
    };
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return { ok: false, error: "`hour` must be an integer 0–23." };
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    return { ok: false, error: "`minute` must be an integer 0–59." };
  }
  const bracket = getBracketForHour(hour);
  if (!bracket) {
    return {
      ok: false,
      error:
        `Selected time is outside the available window (meet and greets run 08:00–20:00 ${BRAND.city} time).`,
    };
  }
  return { ok: true, t: { date, hour, minute, bracket } };
}

function formatTimeForPreview(
  date: string,
  hour: number,
  minute: number,
): string {
  return `${date} ${formatClockHourMinute(hour, minute)} ${BRAND.city} time`;
}

async function proposeScheduleMeet(
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const resolved = await resolveConnectionForWrite(args.connection_id, ctx);
  if (!resolved.ok) return { success: false, error: resolved.error };
  const { role, connection } = resolved;

  if (role !== "parent") {
    return {
      success: false,
      error: "Only parents schedule the meet-and-greet time.",
    };
  }

  if (connection.connection_stage !== CONNECTION_STAGE.ACCEPTED) {
    return {
      success: false,
      error:
        "This connection isn't ready to be scheduled — the nanny needs to accept first.",
    };
  }

  const parsed = parseMeetTime(args);
  if (!parsed.ok) return { success: false, error: parsed.error };

  const slotKey = `${parsed.t.date}_${parsed.t.bracket}`;
  if (
    !connection.proposed_times ||
    !connection.proposed_times.includes(slotKey)
  ) {
    return {
      success: false,
      error:
        "The chosen date + bracket isn't one of the nanny's offered slots. Read the nanny's proposed times back (from read_connection_by_name) and pick one that matches.",
    };
  }

  const cpRes = requireCounterpartyDisplayName(connection, role);
  if (!cpRes.ok) return { success: false, error: cpRes.error };
  const displayName = cpRes.displayName;
  const timeStr = formatTimeForPreview(
    parsed.t.date,
    parsed.t.hour,
    parsed.t.minute,
  );

  return {
    success: true,
    data: {
      action: "schedule_meet",
      connection_id: connection.id,
      counterparty_name: displayName,
      scheduled_preview: timeStr,
      email_side_effect: true,
      preview: `You're about to book your meet and greet with ${displayName} for ${timeStr}. When this is confirmed, ${displayName}'s phone number will be shared with you so you can call them at the scheduled time.`,
      next_call:
        "Read the preview back to the user, confirming the date + time. On their 'yes', call apply_schedule_meet with the same connection_id, date, hour, minute.",
    },
  };
}

async function applyScheduleMeet(
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const resolved = await resolveConnectionForWrite(args.connection_id, ctx);
  if (!resolved.ok) return { success: false, error: resolved.error };
  const { role, connection } = resolved;

  if (role !== "parent") {
    return {
      success: false,
      error: "Only parents schedule the meet-and-greet time.",
    };
  }

  if (connection.connection_stage !== CONNECTION_STAGE.ACCEPTED) {
    return {
      success: false,
      error:
        "This connection isn't ready to be scheduled — the nanny needs to accept first.",
    };
  }

  const parsed = parseMeetTime(args);
  if (!parsed.ok) return { success: false, error: parsed.error };

  const cpRes = requireCounterpartyDisplayName(connection, role);
  if (!cpRes.ok) return { success: false, error: cpRes.error };
  const displayName = cpRes.displayName;

  const result = await scheduleConnectionTime(
    connection.id,
    parsed.t.date,
    parsed.t.hour,
    parsed.t.minute,
  );
  if (!result.success) {
    return {
      success: false,
      error: result.error ?? "Failed to schedule connection.",
    };
  }

  return {
    success: true,
    data: {
      action: "schedule_meet",
      connection_id: connection.id,
      counterparty_name: displayName,
      message: `Booked! Your meet and greet with ${displayName} is scheduled. Check the connection tile for the confirmed time in ${BRAND.city} time and ${displayName}'s phone number.`,
    },
    tile: {
      kind: "connection_request",
      data: { id: connection.id },
    },
  };
}

// ── Exports ──────────────────────────────────────────────────────────────

export const preMeetWriteTools: ToolDefinition[] = [
  {
    name: "propose_decline_connection",
    description:
      "Preview declining a connection request (nanny only; request must still be pending). Returns the user-facing wording to read back to the user and wait for yes/cancel. Does NOT hit the server. Always call this first, never apply_decline_connection directly.",
    parameters: {
      type: "object",
      properties: {
        connection_id: {
          type: "string",
          description:
            "The connection id (returned by read_connection_by_name / read_connection_inbox).",
        },
        reason: {
          type: "string",
          description:
            "Optional private reason — stored in our records, never shared with the family.",
        },
      },
      required: ["connection_id"],
    },
  },
  {
    name: "apply_decline_connection",
    description:
      "Actually decline the connection request. Only call after propose_decline_connection and after the user has explicitly confirmed. Sends a neutral notification email to the family (INT-004) — no reason shared with them.",
    parameters: {
      type: "object",
      properties: {
        connection_id: {
          type: "string",
          description:
            "Same connection id passed to propose_decline_connection.",
        },
        reason: {
          type: "string",
          description:
            "Same optional reason passed to propose_decline_connection (stored internally only).",
        },
      },
      required: ["connection_id"],
    },
  },
  {
    name: "propose_cancel_connection",
    description:
      "Preview cancelling a connection (either side can cancel an active connection). Returns the user-facing wording to read back plus a note that the other party will be notified. Does NOT hit the server.",
    parameters: {
      type: "object",
      properties: {
        connection_id: {
          type: "string",
          description: "The connection id to cancel.",
        },
      },
      required: ["connection_id"],
    },
  },
  {
    name: "apply_cancel_connection",
    description:
      "Actually cancel the connection. Only call after propose_cancel_connection and explicit user confirmation. Sends an inbox notification to the other party (no email).",
    parameters: {
      type: "object",
      properties: {
        connection_id: {
          type: "string",
          description:
            "Same connection id passed to propose_cancel_connection.",
        },
      },
      required: ["connection_id"],
    },
  },
  {
    name: "propose_accept_connection",
    description:
      "Preview accepting a connection request with an availability slot list (nanny only; request must be pending). Slots are strings of the form 'YYYY-MM-DD_bracket' where bracket = morning|midday|afternoon|evening. Requires ≥5 slots, ≥3 distinct days, and at least one slot in every one of the four brackets. Returns a per-day summary. Does NOT hit the server.",
    parameters: {
      type: "object",
      properties: {
        connection_id: { type: "string", description: "The connection id." },
        slots: {
          type: "array",
          description:
            "Availability slots in 'YYYY-MM-DD_bracket' form. Bracket must be one of: morning, midday, afternoon, evening.",
          items: { type: "string" },
          minItems: 5,
        },
      },
      required: ["connection_id", "slots"],
    },
  },
  {
    name: "apply_accept_connection",
    description:
      "Actually accept the connection request with the given slots. Only call after propose_accept_connection and explicit user confirmation. Sends an email (INT-002) to the family and advances the connection to the ACCEPTED stage.",
    parameters: {
      type: "object",
      properties: {
        connection_id: { type: "string" },
        slots: { type: "array", items: { type: "string" }, minItems: 5 },
      },
      required: ["connection_id", "slots"],
    },
  },
  {
    name: "propose_schedule_meet",
    description:
      `Preview scheduling a meet-and-greet time for a connection (parent only; connection must be in ACCEPTED stage). Date is ${BRAND.city}-local ISO (YYYY-MM-DD), hour is 24h (0-23), minute is 0-59. Must fall inside one of the nanny's proposed brackets (morning 8-11, midday 11-14, afternoon 14-17, evening 17-20). Does NOT hit the server.`,
    parameters: {
      type: "object",
      properties: {
        connection_id: { type: "string" },
        date: {
          type: "string",
          description: `${BRAND.city}-local date in YYYY-MM-DD format.`,
        },
        hour: { type: "number", description: "Hour in 24-hour format, 0-23." },
        minute: { type: "number", description: "Minute, 0-59." },
      },
      required: ["connection_id", "date", "hour", "minute"],
    },
  },
  {
    name: "apply_schedule_meet",
    description:
      "Actually schedule the meet-and-greet. Only after propose_schedule_meet + explicit confirmation. Sends INT-002 to parent (with nanny's phone) and INT-003 to nanny.",
    parameters: {
      type: "object",
      properties: {
        connection_id: { type: "string" },
        date: { type: "string" },
        hour: { type: "number" },
        minute: { type: "number" },
      },
      required: ["connection_id", "date", "hour", "minute"],
    },
  },
];

export async function tryExecutePreMeetWrite(
  toolName: string,
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult | null> {
  if (toolName === "propose_decline_connection")
    return proposeDeclineConnection(args, ctx);
  if (toolName === "apply_decline_connection")
    return applyDeclineConnection(args, ctx);
  if (toolName === "propose_cancel_connection")
    return proposeCancelConnection(args, ctx);
  if (toolName === "apply_cancel_connection")
    return applyCancelConnection(args, ctx);
  if (toolName === "propose_accept_connection")
    return proposeAcceptConnection(args, ctx);
  if (toolName === "apply_accept_connection")
    return applyAcceptConnection(args, ctx);
  if (toolName === "propose_schedule_meet")
    return proposeScheduleMeet(args, ctx);
  if (toolName === "apply_schedule_meet") return applyScheduleMeet(args, ctx);
  return null;
}
