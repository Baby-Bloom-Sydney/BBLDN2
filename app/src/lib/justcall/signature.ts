/**
 * The JustCall webhook signature (brief 05 §0.8, §8 security; plan 05 §5 A4, D10).
 *
 * JustCall signs `secret|encodeURIComponent(webhook_url)|type|timestamp` with HMAC-SHA256 keyed with the API secret,
 * hex, version `v1` ("Dynamic Webhook Signatures"). **It covers no call data**: a valid signature proves the sender, the
 * event type and the time, not the body — so the only facts ever written come from the API re-read (plan R8).
 *
 * A delivery passes only if, in this order:
 * 1. all three headers are present (`x-justcall-signature`, `-signature-version`, `-request-timestamp`);
 * 2. the version is `v1`;
 * 3. the timestamp reads as UTC in either form — `"YYYY-MM-DD HH:MM:SS"` (the docs' example) or an integer (seconds,
 *    or milliseconds; the docs' header table says `int`) — and is within ±5 minutes of now (D10);
 * 4. the body's `webhook_url` is exactly `JUSTCALL_WEBHOOK_URL` (on a preview that includes the bypass query, D11),
 *    compared in constant time;
 * 5. the signature matches, compared in constant time on digests of equal length (the `invoices/cron-proof.ts` way).
 * Every refusal is the route's 401 with nothing written; the reason is for the log only.
 *
 * BB-wave2-231126/05-build, 2026-11-26.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { SignedHeaders, WebhookEnvelope } from "./types";
import { issueVerifiedJustCallEvent, type VerifiedJustCallEvent } from "./verified";

export const SIGNATURE_VERSION = "v1";
/** The accepted clock difference either way (brief §0.8: "more than 5 minutes old" is refused). */
export const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;

export type SignatureRefusal =
  | "missing_header"
  | "bad_version"
  | "bad_timestamp"
  | "outside_window"
  | "wrong_url"
  | "bad_signature";

export type DeliveryCheck =
  | { readonly ok: true; readonly event: VerifiedJustCallEvent | null }
  | { readonly ok: false; readonly reason: SignatureRefusal };

const DOCS_FORM = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const SECONDS = /^\d{10}$/;
const MILLISECONDS = /^\d{13}$/;

/** The hex signature JustCall sends for these values. */
export function justCallSignature(secret: string, webhookUrl: string, type: string, timestamp: string): string {
  return createHmac("sha256", secret).update(`${secret}|${encodeURIComponent(webhookUrl)}|${type}|${timestamp}`).digest("hex");
}

function fromDocsForm(raw: string): number | null {
  const m = DOCS_FORM.exec(raw);
  if (m === null) return null;
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number);
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const back = new Date(ms);
  const exists = back.getUTCFullYear() === year && back.getUTCMonth() === month - 1 && back.getUTCDate() === day
    && back.getUTCHours() === hour && back.getUTCMinutes() === minute && back.getUTCSeconds() === second;
  return exists ? ms : null;
}

/** The request time in epoch milliseconds (UTC), or null when it reads as neither form (D10). */
export function requestTimeMs(raw: string): number | null {
  const value = raw.trim();
  if (SECONDS.test(value)) return Number(value) * 1000;
  if (MILLISECONDS.test(value)) return Number(value);
  return fromDocsForm(value);
}

const digest = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();

/** Equal strings, compared without a timing difference (on digests of equal length). */
function sameText(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

interface PresentHeaders {
  readonly signature: string;
  readonly timestamp: string;
}

/** Steps 1–3: the headers, the version and the window; the two values the rest needs, narrowed. */
function checkHeaders(headers: SignedHeaders, nowMs: number): PresentHeaders | SignatureRefusal {
  const { signature, version, timestamp } = headers;
  if (!signature || !version || !timestamp) return "missing_header";
  if (version.trim() !== SIGNATURE_VERSION) return "bad_version";
  const at = requestTimeMs(timestamp);
  if (at === null) return "bad_timestamp";
  return Math.abs(nowMs - at) > SIGNATURE_WINDOW_MS ? "outside_window" : { signature, timestamp };
}

/**
 * Check one delivery. On success the event is issued for a body that names a call (`data.call_sid`); the validation
 * ping (no `data`) passes with no event, so the route answers 200 and writes nothing.
 */
export function verifyJustCallDelivery(
  envelope: WebhookEnvelope,
  headers: SignedHeaders,
  config: { readonly apiSecret: string; readonly webhookUrl: string },
  nowMs: number,
): DeliveryCheck {
  const present = checkHeaders(headers, nowMs);
  if (typeof present === "string") return { ok: false, reason: present };
  // the URL may hold the preview's bypass value, so it too is compared in constant time (security review L4)
  if (!sameText(envelope.webhookUrl, config.webhookUrl)) return { ok: false, reason: "wrong_url" };
  const { signature, timestamp } = present;
  const expected = justCallSignature(config.apiSecret, config.webhookUrl, envelope.type, timestamp);
  if (!sameText(signature.trim().toLowerCase(), expected)) return { ok: false, reason: "bad_signature" };
  if (envelope.callSid === null) return { ok: true, event: null };
  return {
    ok: true,
    event: issueVerifiedJustCallEvent({
      eventType: envelope.type,
      callSid: envelope.callSid,
      justcallId: envelope.justcallId,
      requestId: envelope.requestId,
      requestTimestamp: timestamp,
      source: "webhook",
    }),
  };
}
