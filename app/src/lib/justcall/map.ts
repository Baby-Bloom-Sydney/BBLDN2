/**
 * JustCall's answer → 05's call row (plan 05 §5 A6; brief §8 boundary). Pure.
 *
 * - **Direction:** `Incoming` / `Outgoing` (the call object) or `inbound` / `outbound` (the dialer's events), any case.
 * - **Type → 04 result (R3),** matched case-insensitively with spaces collapsed:
 *     outgoing Answered → answered; Unanswered, Busy → no_answer; Abandoned before ringing, Failed → not an attempt;
 *     incoming Answered → answered; Missed, Voicemail, Abandoned before ringing → not an attempt;
 *     anything else → unknown (the ledger says `ignored`, naming the type in its error column, so the gap shows;
 *     nothing is written for that call until the table knows the type).
 *   04's `voicemail` and `wrong_number` are BAI's own picks; JustCall can't know them.
 * - **Start (R6):** `call_date` + `call_time` are UTC; the attempt's time is that instant.
 * - Stored text is clipped to amendment 20's limits by character (never splitting one).
 *
 * BB-wave2-231126/05-build, 2026-11-26.
 */

import type { JustCallCall } from "./api";

export type Direction = "incoming" | "outgoing";
export type MappedResult = "answered" | "no_answer";

export type TypeMapping =
  | { readonly kind: "attempt"; readonly result: MappedResult }
  | { readonly kind: "not_attempt" }
  | { readonly kind: "unknown" };

/** The values `justcall_record_call` takes for one call. */
export interface MappedCall {
  readonly callSid: string;
  readonly justcallId: string | null;
  readonly direction: Direction;
  readonly type: string;
  readonly mappedResult: MappedResult | null;
  readonly durationSeconds: number | null;
  readonly startedAt: string;
  readonly contactNumber: string | null;
  readonly justcallNumber: string | null;
  readonly agentEmail: string | null;
  readonly disposition: string | null;
  readonly notes: string | null;
}

export type MapResult = { readonly ok: true; readonly value: MappedCall } | { readonly ok: false; readonly code: string };

const DIRECTIONS = new Map<string, Direction>([
  ["incoming", "incoming"],
  ["inbound", "incoming"],
  ["outgoing", "outgoing"],
  ["outbound", "outgoing"],
]);

const ANSWERED: TypeMapping = Object.freeze({ kind: "attempt", result: "answered" });
const NO_ANSWER: TypeMapping = Object.freeze({ kind: "attempt", result: "no_answer" });
const NOT_ATTEMPT: TypeMapping = Object.freeze({ kind: "not_attempt" });
const TYPES: Readonly<Record<Direction, ReadonlyMap<string, TypeMapping>>> = {
  outgoing: new Map<string, TypeMapping>([
    ["answered", ANSWERED],
    ["unanswered", NO_ANSWER],
    ["busy", NO_ANSWER],
    ["abandoned before ringing", NOT_ATTEMPT],
    ["failed", NOT_ATTEMPT],
  ]),
  incoming: new Map<string, TypeMapping>([
    ["answered", ANSWERED],
    ["missed", NOT_ATTEMPT],
    ["voicemail", NOT_ATTEMPT],
    ["abandoned before ringing", NOT_ATTEMPT],
  ]),
};

const LIMITS = { type: 60, contact: 40, justcallId: 40, agent: 320, disposition: 200, notes: 2000, code: 60 } as const;

const normalise = (raw: string): string => raw.trim().toLowerCase().replace(/\s+/g, " ");

/** At most `max` characters (code points), so a character is never split. */
function clip(value: string, max: number): string;
function clip(value: string | null, max: number): string | null;
function clip(value: string | null, max: number): string | null {
  if (value === null) return null;
  const chars = Array.from(value);
  return chars.length <= max ? value : chars.slice(0, max).join("");
}

export function directionOf(raw: string): Direction | null {
  return DIRECTIONS.get(normalise(raw)) ?? null;
}

export function mapType(direction: Direction, rawType: string): TypeMapping {
  return TYPES[direction].get(normalise(rawType)) ?? { kind: "unknown" };
}

/** The call's start as "…Z", from JustCall's UTC date and time; null when it isn't a real time. */
export function startedAtOf(callDate: string, callTime: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(callDate);
  const t = /^(\d{2}):(\d{2}):(\d{2})$/.exec(callTime);
  if (d === null || t === null) return null;
  const [year, month, day] = d.slice(1).map(Number);
  const [hour, minute, second] = t.slice(1).map(Number);
  if (hour > 23 || minute > 59 || second > 59) return null;
  const at = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const exists = at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day;
  return exists ? at.toISOString() : null;
}

export function mapCall(call: JustCallCall): MapResult {
  const direction = directionOf(call.direction);
  if (direction === null) return { ok: false, code: "unknown_direction" };
  const startedAt = startedAtOf(call.callDate, call.callTime);
  if (startedAt === null) return { ok: false, code: "bad_call_time" };
  const mapping = mapType(direction, call.type);
  if (mapping.kind === "unknown") return { ok: false, code: `unknown_type: ${clip(call.type.trim(), LIMITS.code)}` };
  return {
    ok: true,
    value: {
      callSid: call.callSid,
      justcallId: clip(call.justcallId, LIMITS.justcallId),
      direction,
      type: clip(call.type.trim(), LIMITS.type),
      mappedResult: mapping.kind === "attempt" ? mapping.result : null,
      durationSeconds: call.durationSeconds,
      startedAt,
      contactNumber: clip(call.contactNumber, LIMITS.contact),
      justcallNumber: clip(call.justcallNumber, LIMITS.contact),
      agentEmail: clip(call.agentEmail, LIMITS.agent),
      disposition: clip(call.disposition, LIMITS.disposition),
      notes: clip(call.notes, LIMITS.notes),
    },
  };
}
