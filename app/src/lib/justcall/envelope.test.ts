/**
 * The webhook body (plan 05 §5 A9 steps 3–4; brief §8 "the body size is capped"): read with a 256 KB cap (the
 * content-length first, then the bytes actually sent), then parsed into what the body says about itself.
 */
import { describe, expect, it } from "vitest";
import { MAX_BODY_BYTES, parseEnvelope, readBoundedBody } from "./envelope";

function streamed(chunks: readonly Uint8Array[], headers: Record<string, string> = {}) {
  let pulled = 0;
  // highWaterMark 0: the stream pulls only when someone reads, so `pulled` counts real reads
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (pulled < chunks.length) controller.enqueue(chunks[pulled++]);
        else controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  const request = new Request("http://localhost/x", { method: "POST", body, headers, duplex: "half" } as RequestInit);
  return { request, pulled: () => pulled };
}

describe("readBoundedBody", () => {
  it("reads a body up to the cap", async () => {
    const text = "x".repeat(MAX_BODY_BYTES);
    expect(MAX_BODY_BYTES).toBe(256 * 1024);
    expect(await readBoundedBody(new Request("http://localhost/x", { method: "POST", body: text }))).toEqual({ ok: true, text });
  });

  it("refuses a content-length over the cap before reading anything", async () => {
    const s = streamed([new Uint8Array(10)], { "content-length": String(MAX_BODY_BYTES + 1) });
    expect(await readBoundedBody(s.request)).toEqual({ ok: false, reason: "too_large" });
    expect(s.pulled()).toBe(0);
  });

  it("refuses a body that grows past the cap whatever its content-length says, and stops reading", async () => {
    const chunk = new Uint8Array(100 * 1024).fill(120);
    const s = streamed([chunk, chunk, chunk, chunk, chunk], { "content-length": "10" });
    expect(await readBoundedBody(s.request)).toEqual({ ok: false, reason: "too_large" });
    expect(s.pulled()).toBeLessThan(5);
  });

  it("a stream that fails while it is read → unreadable", async () => {
    const failing = new ReadableStream({ pull(c) { c.error(new Error("socket closed")); } }, { highWaterMark: 0 });
    const request = new Request("http://localhost/x", { method: "POST", body: failing, duplex: "half" } as RequestInit);
    expect(await readBoundedBody(request)).toEqual({ ok: false, reason: "unreadable" });
  });

  it("an empty body is an empty string", async () => {
    expect(await readBoundedBody(new Request("http://localhost/x", { method: "POST" }))).toEqual({ ok: true, text: "" });
  });
});

describe("parseEnvelope", () => {
  const body = { request_id: "01HTEST", webhook_url: "https://app.example.test/hook", type: "call.completed", data: { id: 1786000001, call_sid: "CAtest0001", contact_number: "447700900517" } };

  it("reads the URL, the type, the ids and the sid — and keeps the parsed body", () => {
    expect(parseEnvelope(JSON.stringify(body))).toEqual({
      ok: true,
      body,
      envelope: { webhookUrl: "https://app.example.test/hook", type: "call.completed", requestId: "01HTEST", callSid: "CAtest0001", justcallId: "1786000001" },
    });
  });

  it("the validation ping (no data) has no sid", () => {
    const ping = { webhook_url: "https://app.example.test/hook", type: "call.completed" };
    expect(parseEnvelope(JSON.stringify(ping))).toMatchObject({ ok: true, envelope: { callSid: null, justcallId: null, requestId: null } });
  });

  it.each([
    ["a sid with a slash", { call_sid: "CA/../x" }],
    ["no sid", {}],
    ["a numeric sid", { call_sid: 7 }],
  ])("data with %s → no sid", (_label, data) => {
    expect(parseEnvelope(JSON.stringify({ ...body, data }))).toMatchObject({ ok: true, envelope: { callSid: null } });
  });

  it("data that isn't an object → no sid", () => {
    expect(parseEnvelope(JSON.stringify({ ...body, data: ["CAtest0001"] }))).toMatchObject({ ok: true, envelope: { callSid: null } });
  });

  it("a null id or an over-long request id → null", () => {
    const parsed = parseEnvelope(JSON.stringify({ ...body, request_id: "r".repeat(201), data: { ...body.data, id: null } }));
    expect(parsed).toMatchObject({ ok: true, envelope: { requestId: null, justcallId: null } });
  });

  it.each(["", "{", "not json", "[1,2"])("%j → not_json", (text) => {
    expect(parseEnvelope(text)).toEqual({ ok: false, reason: "not_json" });
  });

  it.each([
    ["no webhook_url", { type: "call.completed" }],
    ["no type", { webhook_url: "https://app.example.test/hook" }],
    ["a numeric type", { webhook_url: "https://app.example.test/hook", type: 1 }],
    ["an array", [1]],
    ["null", null],
  ])("%s → no_envelope (can't be verified)", (_label, value) => {
    expect(parseEnvelope(JSON.stringify(value))).toEqual({ ok: false, reason: "no_envelope" });
  });
});
