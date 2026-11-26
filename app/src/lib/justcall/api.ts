/**
 * JustCall's "Get a call" (brief 05 §4 API; plan 05 §5 A5, R8). Every fact 05 writes comes from here: the webhook's
 * signature covers no call data, so the route re-reads the call by its sid and writes only this answer.
 *
 * - `GET https://api.justcall.io/v2.1/calls/{call_sid}` (the API takes the numeric id or the sid), header
 *   `Authorization: <key>:<secret>`, `no-store`, no redirects, one 8-second timeout over the request and the body, a
 *   1 MB body cap. One request per event (Team plan: 30 a minute). An answer it doesn't read is released.
 * - zod over the fields used only (recordings, AI fields and the contact's name are never read — brief §5 "Not
 *   stored"); the call may be top-level or wrapped in `data` (one object, or a one-item list) — `[unverified]`, L4.
 * - 404 → `not_found` (the ledger says `ignored`). 429, any other status, a network failure, the timeout, a body that
 *   doesn't fit or a call with another sid → `unavailable` with a short code (the ledger says `unresolved`, R9).
 * - Logs the HTTP status or the error's name only — never a number, the key or the secret.
 *
 * BB-wave2-231126/05-build, 2026-11-26.
 */

import { z } from "zod";
import { readCappedStream } from "./envelope";
import { CALL_SID_PATTERN } from "./types";

export const JUSTCALL_API_BASE = "https://api.justcall.io/v2.1";
export const API_TIMEOUT_MS = 8_000;
/** A call object is a few kilobytes; anything past this is not one (security review L6). */
export const MAX_API_BODY_BYTES = 1024 * 1024;

/** The fields 05 uses, as JustCall sent them (strings trimmed; blanks → null). */
export interface JustCallCall {
  readonly callSid: string;
  readonly justcallId: string | null;
  readonly contactNumber: string | null;
  readonly justcallNumber: string | null;
  readonly agentEmail: string | null;
  /** UTC "YYYY-MM-DD". */
  readonly callDate: string;
  /** UTC "HH:MM:SS". */
  readonly callTime: string;
  readonly direction: string;
  readonly type: string;
  readonly disposition: string | null;
  readonly notes: string | null;
  readonly durationSeconds: number | null;
}

export type GetCallResult =
  | { readonly ok: true; readonly value: JustCallCall }
  | { readonly ok: false; readonly error: "not_found" }
  | { readonly ok: false; readonly error: "unavailable"; readonly code: string };

export interface ApiDeps {
  readonly fetch: typeof fetch;
  readonly config: { readonly apiKey: string; readonly apiSecret: string };
  readonly timeoutMs?: number;
}

const optionalText = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim()));

const callSchema = z
  .object({
    id: optionalText,
    call_sid: z.string(),
    contact_number: optionalText,
    justcall_number: optionalText,
    agent_email: optionalText,
    call_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    call_time: z.string().regex(/^\d{2}:\d{2}:\d{2}$/),
    call_info: z.object({ direction: z.string(), type: z.string(), disposition: optionalText, notes: optionalText }),
    call_duration: z.object({ total_duration: z.number().int().nonnegative().nullish() }).nullish(),
  })
  .transform(
    (c): JustCallCall => ({
      callSid: c.call_sid,
      justcallId: c.id,
      contactNumber: c.contact_number,
      justcallNumber: c.justcall_number,
      agentEmail: c.agent_email,
      callDate: c.call_date,
      callTime: c.call_time,
      direction: c.call_info.direction,
      type: c.call_info.type,
      disposition: c.call_info.disposition,
      notes: c.call_info.notes,
      durationSeconds: c.call_duration?.total_duration ?? null,
    }),
  );

const wrappedSchema = z.object({ data: z.union([callSchema, z.array(callSchema).length(1).transform((list) => list[0])]) });

function parseCall(body: unknown): JustCallCall | null {
  const top = callSchema.safeParse(body);
  if (top.success) return top.data;
  const wrapped = wrappedSchema.safeParse(body);
  return wrapped.success ? wrapped.data.data : null;
}

const unavailable = (code: string): GetCallResult => {
  console.error("[justcall/api] get call failed", { code });
  return { ok: false, error: "unavailable", code };
};

const isTimeout = (name: string): boolean => name === "TimeoutError" || name === "AbortError";

/** The answer's JSON, read under the same timeout and a size cap (review TS M2): a call, or why there isn't one. */
async function readCall(response: Response): Promise<JustCallCall | { readonly code: string }> {
  if (response.body === null) return { code: "api_shape" };
  const read = await readCappedStream(response.body, MAX_API_BODY_BYTES);
  if (!read.ok) return { code: read.reason === "too_large" ? "api_too_large" : isTimeout(read.errorName) ? "api_timeout" : "api_network" };
  let body: unknown;
  try {
    body = JSON.parse(read.text);
  } catch {
    return { code: "api_shape" };
  }
  return parseCall(body) ?? { code: "api_shape" };
}

/** Free the connection of an answer that isn't read. */
async function release(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

/** The call with this sid, as JustCall's API answers it now. Never throws. */
export async function getCall(callSid: string, deps: ApiDeps): Promise<GetCallResult> {
  if (!CALL_SID_PATTERN.test(callSid)) return { ok: false, error: "not_found" };
  let response: Response;
  try {
    response = await deps.fetch(`${JUSTCALL_API_BASE}/calls/${encodeURIComponent(callSid)}`, {
      method: "GET",
      headers: { Authorization: `${deps.config.apiKey}:${deps.config.apiSecret}`, Accept: "application/json" },
      cache: "no-store",
      // the key travels in a header: never follow a redirect with it (security review L6)
      redirect: "error",
      signal: AbortSignal.timeout(deps.timeoutMs ?? API_TIMEOUT_MS),
    });
  } catch (thrown) {
    const name = thrown instanceof Error || thrown instanceof DOMException ? thrown.name : typeof thrown;
    return unavailable(isTimeout(name) ? "api_timeout" : "api_network");
  }
  if (response.status === 404) return (await release(response), { ok: false, error: "not_found" });
  if (response.status !== 200) return (await release(response), unavailable(`api_${response.status}`));
  const call = await readCall(response);
  if ("code" in call) return unavailable(call.code);
  if (call.callSid !== callSid) return unavailable("api_sid_mismatch");
  return { ok: true, value: call };
}
