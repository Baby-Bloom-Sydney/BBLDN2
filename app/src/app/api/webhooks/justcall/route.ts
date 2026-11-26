/**
 * JustCall webhook (brief 05 §0.5–§0.9, §0.12, §8; plan 05 §5 A9, R8, R9). JustCall posts "Call completed" and
 * "Call updated" here; each call is logged against the parent with that mobile, or listed as Unmatched.
 *
 * Order (each step answers before the next runs):
 *   1. `JUSTCALL_WEBHOOK_ENABLED` (and call booking) off → 404, before anything is read.
 *   2. A JustCall setting missing → 503; the variable's name is logged, never its value.
 *   3. A body over 256 KB (its `content-length`, then the bytes sent) → 413.
 *   4. Not JSON → 400.
 *   5. Signature, version, ±5-minute window or `webhook_url` wrong → 401, nothing written (`signature.ts`).
 *   6. No call in it (JustCall's validation ping when a URL is saved) → 200, nothing written.
 *   7. A type 05 doesn't act on → 200, the ledger row `ignored`.
 *   8. A redelivery (same `call_sid`, type and request timestamp) → 200, applied once (`ledger.ts`) — unless its row
 *      was left `unresolved`: then it is applied again under that row, so JustCall's own retry heals it.
 *   9. Dispatch (`apply.ts`: the API re-read, map, match, record) → 200, or 500 when `unresolved`, so JustCall retries;
 *      the row also waits for the replay by hand (R9).
 * Responses carry no detail. Logs carry the step, the type and the outcome code — never a number, a key, the secret or
 * the URL's query. The route has no session: `src/lib/supabase/middleware.ts` protects only `/nanny`, `/parent` and
 * `/admin`, as the Stripe webhook needs.
 *
 * BB-wave2-231126/05-build, 2026-11-26.
 */

import { NextResponse } from "next/server";
import { justcallWebhookEnabled } from "@/lib/features/flags";
import { applyJustCallEvent, defaultApplyDeps } from "@/lib/justcall/apply";
import { readJustCallConfig, type JustCallConfig } from "@/lib/justcall/config";
import { parseEnvelope, readBoundedBody } from "@/lib/justcall/envelope";
import { beginEvent, finishEvent, retryOfUnresolved } from "@/lib/justcall/ledger";
import { createJustCallRepo, type JustCallRepo } from "@/lib/justcall/repo";
import { verifyJustCallDelivery } from "@/lib/justcall/signature";
import { isHandledEventType, type SignedHeaders } from "@/lib/justcall/types";
import type { VerifiedJustCallEvent } from "@/lib/justcall/verified";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TAG = "[justcall-webhook]";

const reply = (status: number, text: string): NextResponse =>
  new NextResponse(text, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

function signedHeadersOf(request: Request): SignedHeaders {
  return {
    signature: request.headers.get("x-justcall-signature"),
    version: request.headers.get("x-justcall-signature-version"),
    timestamp: request.headers.get("x-justcall-request-timestamp"),
  };
}

/** Step 9 for one ledger row: apply (a type 05 doesn't act on is `ignored`), write the outcome, answer by it. */
async function applyAndFinish(id: string, event: VerifiedJustCallEvent, config: JustCallConfig, repo: JustCallRepo): Promise<NextResponse> {
  const result = isHandledEventType(event.eventType)
    ? await applyJustCallEvent(event, defaultApplyDeps(config, repo))
    : { outcome: "ignored" as const, code: "unhandled_type" };
  if (!(await finishEvent(id, result, repo))) {
    console.error(`${TAG} the outcome could not be written; the row stays in flight`, { outcome: result.outcome });
  }
  console.info(`${TAG} event`, { type: event.eventType, outcome: result.outcome, code: result.code });
  return result.outcome === "unresolved" ? reply(500, "Error") : reply(200, "OK");
}

/** Steps 7–9, for a verified delivery that names a call. A redelivery of a row left unresolved is applied again. */
async function dispatch(event: VerifiedJustCallEvent, body: unknown, config: JustCallConfig): Promise<NextResponse> {
  const repo = createJustCallRepo();
  const begun = await beginEvent(event, body, repo);
  if (begun.kind === "new") return applyAndFinish(begun.id, event, config, repo);
  if (begun.kind === "error") return reply(500, "Error");
  const retry = await retryOfUnresolved(event, repo);
  if (retry.kind === "retry") return applyAndFinish(retry.id, event, config, repo);
  return retry.kind === "done" ? reply(200, "OK") : reply(500, "Error");
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!justcallWebhookEnabled()) return reply(404, "Not found");

  const config = readJustCallConfig();
  if (!config.ok) {
    console.error(`${TAG} refusing: missing or malformed settings`, { missing: config.missing });
    return reply(503, "Service unavailable");
  }

  const raw = await readBoundedBody(request);
  if (!raw.ok) return raw.reason === "too_large" ? reply(413, "Payload too large") : reply(400, "Bad request");

  const parsed = parseEnvelope(raw.text);
  if (!parsed.ok && parsed.reason === "not_json") return reply(400, "Bad request");
  if (!parsed.ok) {
    console.warn(`${TAG} refused`, { reason: "no_envelope" });
    return reply(401, "Unauthorized");
  }

  const check = verifyJustCallDelivery(parsed.envelope, signedHeadersOf(request), config.value, Date.now());
  if (!check.ok) {
    console.warn(`${TAG} refused`, { reason: check.reason });
    return reply(401, "Unauthorized");
  }
  if (check.event === null) return reply(200, "OK");

  try {
    return await dispatch(check.event, parsed.body, config.value);
  } catch (thrown) {
    // every module below answers closed results; this is the last guard, so nothing leaves as Next's bare 500
    console.error(`${TAG} dispatch failed`, { name: thrown instanceof Error ? thrown.name : typeof thrown });
    return reply(500, "Error");
  }
}
