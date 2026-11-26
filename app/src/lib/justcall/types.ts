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
