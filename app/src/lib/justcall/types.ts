/**
 * Shared JustCall types (plan 05 §5, PR 05a-1). Types only.
 *
 * BB-wave2-231126/05-build, 2026-11-26.
 */

/** The two event types 05 acts on; any other type is recorded `ignored` (plan §5 route step 7). */
export const HANDLED_EVENT_TYPES = ["call.completed", "call.updated"] as const;
export type HandledEventType = (typeof HANDLED_EVENT_TYPES)[number];

export function isHandledEventType(type: string): type is HandledEventType {
  return (HANDLED_EVENT_TYPES as readonly string[]).includes(type);
}

/** A call sid as the dialer, the webhook and the API share it (plan D5); also safe in the API's URL path. */
export const CALL_SID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

/** What a webhook body says about itself. Only `type` and `callSid` are ever acted on (plan R8). */
export interface WebhookEnvelope {
  readonly webhookUrl: string;
  readonly type: string;
  readonly requestId: string | null;
  /** Null for the validation ping (no `data`), or when `data` carries no usable `call_sid`. */
  readonly callSid: string | null;
  readonly justcallId: string | null;
}

/** The signed headers (`x-justcall-signature`, `-signature-version`, `-request-timestamp`), as sent. */
export interface SignedHeaders {
  readonly signature: string | null;
  readonly version: string | null;
  readonly timestamp: string | null;
}

/** A ledger row's end state (amendment 20 `justcall_webhook_events.outcome`). */
export type EventOutcome = "applied" | "ignored" | "unresolved";

/** What applying one event did. `code` is short and carries no phone number, key or name. */
export interface ApplyResult {
  readonly outcome: EventOutcome;
  readonly code: string | null;
}

// ── 05a-2: the admin views and the actions' refusals (BB-wave2-231126/05-build) ──────────────────────────────────

/** One JustCall call's details as 05's admin reads give them (amendment 20 `justcall_calls`). */
export interface JustCallDetails {
  readonly callSid: string;
  readonly direction: "incoming" | "outgoing";
  readonly justcallType: string | null;
  readonly mappedResult: "answered" | "no_answer" | null;
  readonly durationSeconds: number | null;
  readonly startedAt: string;
  readonly notes: string | null;
  readonly disposition: string | null;
}

/** A call that matched no family, or several: Unmatched until BAI attaches or dismisses it. */
export interface UnmatchedCall extends JustCallDetails {
  readonly contactNumber: string | null;
  readonly matchNote: "none" | "several";
}

/** An Unmatched call in words, for the list on /admin/calls. */
export interface UnmatchedCallView {
  readonly callSid: string;
  readonly number: string;
  /** "Tue 9 Feb, 14:03 (London time)" */
  readonly when: string;
  readonly direction: string;
  readonly result: string;
  readonly duration: string;
  readonly reason: string;
}

export interface UnmatchedList {
  readonly calls: readonly UnmatchedCallView[];
  /** Every Unmatched call, the shown ones included (the list shows the newest 100). */
  readonly total: number;
}

/** A family found by Attach to family's search. */
export interface ParentChoice {
  readonly parentUserId: string;
  readonly name: string;
  /** "+44 (0) 7700 900 517", or null with no mobile on file. */
  readonly mobile: string | null;
}

/** What 04's readers add to an attempt made through JustCall (with logging on). */
export interface JustCallAttempt {
  readonly callSid: string;
  /** Answered, made by the webhook, no outcome yet: BAI's words are still to come. */
  readonly needsOutcome: boolean;
  /** "JustCall · Outgoing · Answered — outcome needed · 6 min 12 s" */
  readonly what: string;
  /** JustCall's own notes and disposition, one line each. */
  readonly lines: readonly string[];
  /** "JustCall · Outgoing · 6 min 12 s · Ref CA…", read-only above the outcome form. */
  readonly summary: string;
}

/** The JustCall actions' closed refusal codes (`justcall_disabled`: the logging switch is off). */
export type JustCallActionError =
  | "justcall_disabled"
  | "not_authorized"
  | "invalid"
  | "not_found"
  | "not_yours"
  | "not_unmatched"
  | "not_a_parent"
  | "booked_call_exists"
  | "error";

export type JustCallActionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: JustCallActionError };
