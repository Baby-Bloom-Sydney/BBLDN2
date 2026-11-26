/**
 * The webhook signature (plan 05 §5 A4, D10; brief §0.8, §8 security). v1 HMAC-SHA256 hex keyed with the API secret over
 * `secret|encodeURIComponent(webhook_url)|type|timestamp`; the version, a ±5-minute window (both timestamp forms, UTC),
 * `webhook_url` equal to ours, and a constant-time compare.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const crypto = vi.hoisted(() => ({ compares: 0 }));
vi.mock("node:crypto", async (original) => {
  const real = await original<typeof import("node:crypto")>();
  const timingSafeEqual = (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => {
    crypto.compares += 1;
    return real.timingSafeEqual(a, b);
  };
  return { ...real, default: { ...real, timingSafeEqual }, timingSafeEqual };
});

import { justCallSignature, requestTimeMs, verifyJustCallDelivery } from "./signature";
import { isVerifiedJustCallEvent } from "./verified";
import type { SignedHeaders, WebhookEnvelope } from "./types";

// JustCall's own published example ("Dynamic Webhook Signatures", developer.justcall.io): its sample secret, URL and
// timestamp, and the signature it prints. Public sample values, not ours.
const DOCS = {
  secret: "ea39089c40790e9dc7a080ec95e849b8fa0fa5fb",
  webhookUrl: "https://webhook.site/3bcea770-370a-4b09-8b66-426f687e08a4",
  type: "call.completed",
  timestamp: "2024-03-21 17:08:22",
  signature: "56761bae5b27a784a3ddd2af828bc5def7176bc0a8650199b04c737bd39bbecf",
};
const DOCS_NOW = Date.UTC(2024, 2, 21, 17, 8, 22);

const SECRET = "test-secret-not-real";
const OURS = "https://app.example.test/api/webhooks/justcall";
const NOW = Date.UTC(2027, 1, 9, 14, 3, 0);
const STAMP = "2027-02-09 14:03:00";

const envelope = (over: Partial<WebhookEnvelope> = {}): WebhookEnvelope => ({
  webhookUrl: OURS, type: "call.completed", requestId: "01HTESTREQUEST", callSid: "CAtest0001", justcallId: "1786000001", ...over,
});
const signed = (env: WebhookEnvelope, over: Partial<SignedHeaders> = {}, stamp = STAMP): SignedHeaders => ({
  signature: justCallSignature(SECRET, env.webhookUrl, env.type, stamp), version: "v1", timestamp: stamp, ...over,
});
const config = { apiSecret: SECRET, webhookUrl: OURS };

describe("justCallSignature", () => {
  it("reproduces JustCall's published example exactly (known answer)", () => {
    expect(justCallSignature(DOCS.secret, DOCS.webhookUrl, DOCS.type, DOCS.timestamp)).toBe(DOCS.signature);
  });

  it("URL-encodes the webhook URL, so the preview's bypass query is covered (plan D11)", () => {
    const url = `${OURS}?x-vercel-protection-bypass=placeholder`;
    const expected = createHmac("sha256", SECRET).update(`${SECRET}|${encodeURIComponent(url)}|call.updated|${STAMP}`).digest("hex");
    expect(justCallSignature(SECRET, url, "call.updated", STAMP)).toBe(expected);
  });
});

describe("requestTimeMs (D10: both forms, read as UTC)", () => {
  it.each([
    ["the docs' form", "2024-03-21 17:08:22", Date.UTC(2024, 2, 21, 17, 8, 22)],
    ["whole seconds", "1711040902", Date.UTC(2024, 2, 21, 17, 8, 22)],
    ["milliseconds", "1711040902000", Date.UTC(2024, 2, 21, 17, 8, 22)],
    ["the form, padded", " 2024-03-21 17:08:22 ", Date.UTC(2024, 2, 21, 17, 8, 22)],
  ])("reads %s", (_label, raw, expected) => {
    expect(requestTimeMs(raw)).toBe(expected);
  });

  it.each(["", "yesterday", "2024-02-30 10:00:00", "2024-03-21T17:08:22Z", "2024-03-21 25:00:00", "17110409", "1711040902.5", "-1711040902"])(
    "refuses %j",
    (raw) => {
      expect(requestTimeMs(raw)).toBeNull();
    },
  );
});

describe("verifyJustCallDelivery", () => {
  it("accepts JustCall's published example at its own time", () => {
    const env = envelope({ webhookUrl: DOCS.webhookUrl, type: DOCS.type });
    const headers = { signature: DOCS.signature, version: "v1", timestamp: DOCS.timestamp };
    const result = verifyJustCallDelivery(env, headers, { apiSecret: DOCS.secret, webhookUrl: DOCS.webhookUrl }, DOCS_NOW);
    expect(result.ok).toBe(true);
  });

  it("issues a verified event carrying only the type, the sid, the ids and the timestamp", () => {
    const result = verifyJustCallDelivery(envelope(), signed(envelope()), config, NOW);
    expect(result).toEqual({ ok: true, event: expect.anything() });
    const event = result.ok ? result.event : null;
    expect(isVerifiedJustCallEvent(event)).toBe(true);
    expect(event).toMatchObject({ eventType: "call.completed", callSid: "CAtest0001", justcallId: "1786000001", requestId: "01HTESTREQUEST", requestTimestamp: STAMP, source: "webhook" });
  });

  it("compares the signature in constant time", () => {
    const before = crypto.compares;
    verifyJustCallDelivery(envelope(), signed(envelope()), config, NOW);
    expect(crypto.compares).toBe(before + 1);
  });

  it.each([
    ["4 min 59 s old", NOW + 299_000],
    ["4 min 59 s ahead", NOW - 299_000],
  ])("accepts a timestamp %s", (_label, now) => {
    expect(verifyJustCallDelivery(envelope(), signed(envelope()), config, now).ok).toBe(true);
  });

  it("accepts the integer form inside the window", () => {
    const stamp = String(Math.floor(NOW / 1000) - 60);
    expect(verifyJustCallDelivery(envelope(), signed(envelope(), {}, stamp), config, NOW).ok).toBe(true);
  });

  it("accepts the hex in either case", () => {
    const headers = signed(envelope());
    expect(verifyJustCallDelivery(envelope(), { ...headers, signature: headers.signature!.toUpperCase() }, config, NOW).ok).toBe(true);
  });

  it.each<[string, WebhookEnvelope, Partial<SignedHeaders>, number, string]>([
    ["no signature header", envelope(), { signature: null }, NOW, "missing_header"],
    ["no version header", envelope(), { version: null }, NOW, "missing_header"],
    ["no timestamp header", envelope(), { timestamp: null }, NOW, "missing_header"],
    ["an empty signature header", envelope(), { signature: "" }, NOW, "missing_header"],
    ["version v2", envelope(), { version: "v2" }, NOW, "bad_version"],
    ["a timestamp it can't read", envelope(), { timestamp: "soon" }, NOW, "bad_timestamp"],
    ["a timestamp 6 minutes old", envelope(), {}, NOW + 360_000, "outside_window"],
    ["a timestamp 6 minutes ahead", envelope(), {}, NOW - 360_000, "outside_window"],
    ["someone else's webhook_url", envelope({ webhookUrl: "https://elsewhere.example.test/hook" }), {}, NOW, "wrong_url"],
    ["our URL with a trailing slash", envelope({ webhookUrl: `${OURS}/` }), {}, NOW, "wrong_url"],
  ])("refuses %s", (_label, env, over, now, reason) => {
    expect(verifyJustCallDelivery(env, signed(env, over), config, now)).toEqual({ ok: false, reason });
  });

  it.each([
    ["one character changed", (s: string) => `${s.slice(0, -1)}${s.endsWith("0") ? "1" : "0"}`],
    ["too short", (s: string) => s.slice(0, 10)],
    ["too long", (s: string) => `${s}00`],
    ["made with another secret", () => justCallSignature("another-secret", OURS, "call.completed", STAMP)],
  ])("refuses a signature %s", (_label, mangle) => {
    const headers = signed(envelope());
    expect(verifyJustCallDelivery(envelope(), { ...headers, signature: mangle(headers.signature!) }, config, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a type the signature didn't cover (the type is signed)", () => {
    const headers = signed(envelope({ type: "call.updated" }));
    expect(verifyJustCallDelivery(envelope({ type: "call.completed" }), headers, config, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a timestamp the signature didn't cover", () => {
    const headers = signed(envelope(), {}, "2027-02-09 14:02:00");
    expect(verifyJustCallDelivery(envelope(), { ...headers, timestamp: STAMP }, config, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("passes the validation ping (no data) with no event", () => {
    const ping = envelope({ callSid: null, justcallId: null, requestId: null });
    expect(verifyJustCallDelivery(ping, signed(ping), config, NOW)).toEqual({ ok: true, event: null });
  });
});
