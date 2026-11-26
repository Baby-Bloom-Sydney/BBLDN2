/**
 * The webhook body (plan 05 §5 A9 steps 3–4; brief §8 "the body size is capped").
 *
 * - `readBoundedBody`: refuses a `content-length` over 256 KB before reading, then reads the stream and stops as soon
 *   as the bytes sent pass the cap (a missing or false `content-length` can't get round it).
 * - `parseEnvelope`: JSON, then what the body says about itself — `webhook_url` and `type` (signed, so required),
 *   `request_id`, and from `data` only `call_sid` and `id`. Nothing else in the body is ever acted on (plan R8); the
 *   parsed body is kept only for the ledger.
 *
 * BB-wave2-231126/05-build, 2026-11-26.
 */

import { z } from "zod";
import { CALL_SID_PATTERN, type WebhookEnvelope } from "./types";

export const MAX_BODY_BYTES = 256 * 1024;

export type BodyRead = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: "too_large" | "unreadable" };

export type EnvelopeParse =
  | { readonly ok: true; readonly body: unknown; readonly envelope: WebhookEnvelope }
  | { readonly ok: false; readonly reason: "not_json" | "no_envelope" };

const TOO_LARGE: BodyRead = Object.freeze({ ok: false, reason: "too_large" });

export type StreamRead =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: "too_large" }
  | { readonly ok: false; readonly reason: "unreadable"; readonly errorName: string };

/** A stream's text, stopping as soon as it passes `max` bytes; a stream that fails is `unreadable` (with its error's name). */
export async function readCappedStream(stream: ReadableStream<Uint8Array>, max: number): Promise<StreamRead> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch (thrown) {
    await reader.cancel().catch(() => undefined);
    return { ok: false, reason: "unreadable", errorName: thrown instanceof Error || thrown instanceof DOMException ? thrown.name : typeof thrown };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(bytes) };
}

export async function readBoundedBody(request: Request, max: number = MAX_BODY_BYTES): Promise<BodyRead> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return TOO_LARGE;
  if (request.body === null) return { ok: true, text: "" };
  const read = await readCappedStream(request.body, max);
  return read.ok || read.reason === "too_large" ? read : { ok: false, reason: "unreadable" };
}

const shortText = (max: number) =>
  z.unknown().transform((v) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null));
const idText = z.unknown().transform((v) =>
  (typeof v === "number" && Number.isSafeInteger(v)) || (typeof v === "string" && /^\d{1,40}$/.test(v)) ? String(v) : null,
);
const dataSchema = z
  .unknown()
  .transform((v) => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null))
  .transform((d) => ({
    callSid: typeof d?.call_sid === "string" && CALL_SID_PATTERN.test(d.call_sid) ? d.call_sid : null,
    justcallId: idText.parse(d?.id),
  }));
const envelopeSchema = z.object({
  webhook_url: z.string(),
  type: z.string(),
  request_id: shortText(200),
  data: dataSchema,
});

export function parseEnvelope(text: string): EnvelopeParse {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not_json" };
  }
  const parsed = envelopeSchema.safeParse(body);
  if (!parsed.success) return { ok: false, reason: "no_envelope" };
  const e = parsed.data;
  return {
    ok: true,
    body,
    envelope: { webhookUrl: e.webhook_url, type: e.type, requestId: e.request_id, callSid: e.data.callSid, justcallId: e.data.justcallId },
  };
}
