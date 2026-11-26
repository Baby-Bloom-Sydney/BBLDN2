/**
 * The JustCall webhook ledger (plan 05 §5 A7; R8, R9; brief §0.8, §3 edges) — the Stripe route's pattern: a row is
 * inserted **before** dispatch, so a redelivery (same `call_sid`, type and request timestamp) loses the unique race and
 * is answered 200 without running twice; the row then ends `applied`, `ignored` or `unresolved` with a short code.
 *
 * - Only a `VerifiedJustCallEvent` is recorded: nothing reaches the ledger before the signature check.
 * - The stored body is the envelope only (`storedBody`): no phone number, notes or URL query is kept (plan §10, D11).
 * - A redelivery of a row left `unresolved` is applied again (`retryOfUnresolved`), so JustCall's own retry heals it.
 * - The replay (R9, BAI's word only) reads a row back — unresolved, or still in flight 10 minutes on — and re-issues it
 *   as a verified event from the ledger (only a verified delivery ever created one), then runs it through the same
 *   idempotent path. A row already applied or ignored is not replayed.
 *
 * BB-wave2-231126/05-build, 2026-11-26.
 */

import type { JustCallRepo } from "./repo";
import type { ApplyResult } from "./types";
import { issueVerifiedJustCallEvent, isVerifiedJustCallEvent, type VerifiedJustCallEvent } from "./verified";

export type BeginResult = { readonly kind: "new"; readonly id: string } | { readonly kind: "duplicate" } | { readonly kind: "error" };

type LedgerRepo = Pick<JustCallRepo, "insertEvent" | "finishEvent" | "readEvent" | "readUnresolvedEvents">;

function withoutQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "[removed]";
  }
}

const MAX_STORED_TEXT = 200;
const plainText = (value: unknown): string | null =>
  typeof value === "string" && value.length <= MAX_STORED_TEXT ? value : typeof value === "number" && Number.isSafeInteger(value) ? String(value) : null;
const asRecord = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : null;

/**
 * The body as stored: the envelope only — request id, url id, type, the URL without its query or fragment, and the
 * call's id and sid (plan §10: no number, key or URL query in the stored body; security review M1). The replay needs
 * no more: every fact written is re-read from JustCall's API (R8), and no caller-shaped JSON is kept.
 */
export function storedBody(body: unknown): Readonly<Record<string, unknown>> {
  const b = asRecord(body);
  const data = asRecord(b?.data);
  const url = b?.webhook_url;
  return {
    request_id: plainText(b?.request_id),
    url_id: plainText(b?.url_id),
    type: plainText(b?.type),
    webhook_url: typeof url === "string" ? withoutQuery(url) : null,
    data: data === null ? null : { call_sid: plainText(data.call_sid), id: plainText(data.id) },
  };
}

export async function beginEvent(event: VerifiedJustCallEvent, body: unknown, repo: LedgerRepo): Promise<BeginResult> {
  if (!isVerifiedJustCallEvent(event)) {
    console.error("[justcall/ledger] refused an event that was not verified");
    return { kind: "error" };
  }
  const inserted = await repo.insertEvent({
    requestId: event.requestId,
    eventType: event.eventType,
    callSid: event.callSid,
    justcallId: event.justcallId,
    requestTimestamp: event.requestTimestamp,
    rawBody: storedBody(body),
  });
  if (inserted.ok) return { kind: "new", id: inserted.value.id };
  return inserted.error === "duplicate" ? { kind: "duplicate" } : { kind: "error" };
}

/** True when the outcome was written. */
export async function finishEvent(id: string, result: ApplyResult, repo: LedgerRepo): Promise<boolean> {
  return (await repo.finishEvent(id, result.outcome, result.code)).ok;
}

export type ReplayableEvent =
  | { readonly ok: true; readonly event: VerifiedJustCallEvent }
  | { readonly ok: false; readonly error: "not_found" | "finished" | "error" };

/** A stored delivery not yet finished (unresolved, or still in flight), re-issued for the replay. */
export async function replayableEvent(id: string, repo: LedgerRepo): Promise<ReplayableEvent> {
  const read = await repo.readEvent(id);
  if (!read.ok) return { ok: false, error: "error" };
  if (read.value === null) return { ok: false, error: "not_found" };
  const row = read.value;
  // a row already applied or ignored keeps the outcome it was given (review TS L10)
  if (row.outcome === "applied" || row.outcome === "ignored") return { ok: false, error: "finished" };
  return {
    ok: true,
    event: issueVerifiedJustCallEvent({
      eventType: row.eventType,
      callSid: row.callSid,
      justcallId: row.justcallId,
      requestId: row.requestId,
      requestTimestamp: row.requestTimestamp,
      source: "ledger",
    }),
  };
}

export async function unresolvedEventIds(
  repo: LedgerRepo,
): Promise<{ readonly ok: true; readonly value: readonly string[] } | { readonly ok: false }> {
  const read = await repo.readUnresolvedEvents();
  return read.ok ? { ok: true, value: read.value.map((row) => row.id) } : { ok: false };
}

export type RetryCheck = { readonly kind: "retry"; readonly id: string } | { readonly kind: "done" } | { readonly kind: "error" };

/**
 * A redelivery (the same sid, type and request timestamp) of a row left `unresolved` is applied again under that row,
 * so JustCall's retry after our 500 heals it (reviews TS H1, code M1, security M2). A row applied, ignored or still in
 * flight is done: answered 200, applied once.
 */
export async function retryOfUnresolved(event: VerifiedJustCallEvent, repo: Pick<JustCallRepo, "readEventByKey">): Promise<RetryCheck> {
  const read = await repo.readEventByKey(event.callSid, event.eventType, event.requestTimestamp);
  if (!read.ok || read.value === null) return { kind: "error" };
  return read.value.outcome === "unresolved" ? { kind: "retry", id: read.value.id } : { kind: "done" };
}
