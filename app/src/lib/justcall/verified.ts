/**
 * The verified-event brand (plan 05 D8). The webhook has no admin session, so it can't pass 04's `AdminProof`; every
 * JustCall write takes one of these instead — the `calls/admin-proof.ts` pattern.
 *
 * - Issued only where the event's authenticity was established: `signature.ts` (a delivery whose signature, version,
 *   window and URL passed) and `ledger.ts` (a stored row, which only such a delivery creates — for the replay).
 *   `verified.test.ts` pins those two as the only issuers.
 * - Branded at the type level (the brand symbol isn't exported) and at run time: `isVerifiedJustCallEvent` accepts only
 *   an object issued in this process; a look-alike, a copy or a cast is refused.
 * - It carries the type and the sid, never call data: the signature covers no call data (plan R8), so every fact
 *   written is re-read from JustCall's API.
 *
 * BB-wave2-231126/05-build, 2026-11-26.
 */

declare const VERIFIED_JUSTCALL_EVENT: unique symbol;

export interface VerifiedEventFields {
  readonly eventType: string;
  readonly callSid: string;
  readonly justcallId: string | null;
  readonly requestId: string | null;
  readonly requestTimestamp: string;
  readonly source: "webhook" | "ledger";
}

export type VerifiedJustCallEvent = VerifiedEventFields & {
  readonly kind: "justcall_event";
  readonly [VERIFIED_JUSTCALL_EVENT]: true;
};

const issued = new WeakSet<object>();

/** Only `signature.ts` and `ledger.ts` call this (see the header). */
export function issueVerifiedJustCallEvent(fields: VerifiedEventFields): VerifiedJustCallEvent {
  const event = Object.freeze({ kind: "justcall_event", ...fields }) as VerifiedJustCallEvent;
  issued.add(event);
  return event;
}

export function isVerifiedJustCallEvent(value: unknown): value is VerifiedJustCallEvent {
  return typeof value === "object" && value !== null && issued.has(value);
}
