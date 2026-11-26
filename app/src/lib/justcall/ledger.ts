/**
 * The JustCall webhook ledger (plan 05 §5 A7; R8, R9; brief §0.8, §3 edges) — the Stripe route's pattern: a row is
 * inserted **before** dispatch, so a redelivery (same `call_sid`, type and request timestamp) loses the unique race and
 * is answered 200 without running twice; the row then ends `applied`, `ignored` or `unresolved` with a short code.
 *
 * - Only a `VerifiedJustCallEvent` is recorded: nothing reaches the ledger before the signature check.
 * - The stored body is the parsed body (the route caps it at 256 KB) with the `webhook_url` query and fragment removed,
 *   so the preview's protection-bypass value is never stored (plan D11, §10).
 * - The replay (R9, BAI's word only) reads a row back and re-issues it as a verified event from the ledger — only a
 *   verified delivery ever created one — then runs it through the same idempotent path.
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

/** The body as stored: the `webhook_url` query and fragment removed, everything else as JustCall sent it. */
export function storedBody(body: unknown): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return body;
  const url = (body as { readonly webhook_url?: unknown }).webhook_url;
  return typeof url === "string" ? { ...body, webhook_url: withoutQuery(url) } : body;
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
  | { readonly ok: false; readonly error: "not_found" | "error" };

/** A stored delivery, re-issued for the replay. */
export async function replayableEvent(id: string, repo: LedgerRepo): Promise<ReplayableEvent> {
  const read = await repo.readEvent(id);
  if (!read.ok) return { ok: false, error: "error" };
  if (read.value === null) return { ok: false, error: "not_found" };
  const row = read.value;
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
