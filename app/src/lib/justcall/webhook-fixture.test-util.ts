/**
 * Test-only: signed JustCall webhook requests made with a TEST secret (plan 05 §9 "signed fixtures"), and a call as
 * JustCall's API answers it. Fixture numbers are the Ofcom drama range (07700 900xxx). No real key exists.
 *
 * BB-wave2-231126/05-build, 2026-11-26.
 */
import { justCallSignature } from "./signature";

export const TEST_SECRET = "test-secret-not-real";
export const TEST_KEY = "test-key-not-real";
export const TEST_WEBHOOK_URL = "https://app.example.test/api/webhooks/justcall";
export const TEST_SID = "CAtest0001";
export const HER_NUMBER = "447700900517";

/** "YYYY-MM-DD HH:MM:SS" in UTC, the docs' form. */
export function docsTimestamp(at: Date): string {
  return at.toISOString().slice(0, 19).replace("T", " ");
}

export function webhookBody(over: { type?: string; callSid?: string | null; webhookUrl?: string; data?: Record<string, unknown> | null } = {}) {
  const data =
    over.data === null
      ? undefined
      : {
          id: 1786000001,
          call_sid: over.callSid === undefined ? TEST_SID : over.callSid,
          contact_number: HER_NUMBER,
          justcall_number: "447700900990",
          call_date: "2027-02-09",
          call_time: "14:03:00",
          call_info: { direction: "Outgoing", type: "Answered", disposition: "", notes: "" },
          call_duration: { total_duration: 372 },
          ...over.data,
        };
  return {
    request_id: "01HTESTREQUEST",
    webhook_url: over.webhookUrl ?? TEST_WEBHOOK_URL,
    url_id: "test-url-id",
    type: over.type ?? "call.completed",
    ...(data === undefined ? {} : { data }),
  };
}

export interface SignOptions {
  readonly secret?: string;
  readonly timestamp?: string;
  readonly version?: string | null;
  readonly signature?: string | null;
  /** Sign as if the body said this URL / type (to build a mismatch). */
  readonly signedUrl?: string;
  readonly signedType?: string;
}

export function signedHeaders(body: { webhook_url: string; type: string }, now: Date, options: SignOptions = {}): Record<string, string> {
  const timestamp = options.timestamp ?? docsTimestamp(now);
  const signature =
    options.signature === undefined
      ? justCallSignature(options.secret ?? TEST_SECRET, options.signedUrl ?? body.webhook_url, options.signedType ?? body.type, timestamp)
      : options.signature;
  const headers: Record<string, string> = { "content-type": "application/json", "x-justcall-request-timestamp": timestamp };
  if (signature !== null) headers["x-justcall-signature"] = signature;
  const version = options.version === undefined ? "v1" : options.version;
  if (version !== null) headers["x-justcall-signature-version"] = version;
  return headers;
}

export function signedRequest(body: { webhook_url: string; type: string }, now: Date, options: SignOptions = {}, url = "http://localhost/api/webhooks/justcall"): Request {
  return new Request(url, { method: "POST", headers: signedHeaders(body, now, options), body: JSON.stringify(body) });
}

/** The call as JustCall's API answers it (top-level). */
export function apiCall(over: Record<string, unknown> = {}) {
  return {
    id: 1786000001,
    call_sid: TEST_SID,
    contact_number: HER_NUMBER,
    contact_name: "Not stored",
    justcall_number: "447700900990",
    agent_email: "agent@example.test",
    call_date: "2027-02-09",
    call_time: "14:03:00",
    call_info: { direction: "Outgoing", type: "Answered", disposition: "", notes: "" },
    call_duration: { total_duration: 372 },
    ...over,
  };
}
