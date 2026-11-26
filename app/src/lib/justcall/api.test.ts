/**
 * JustCall's "Get a call" (plan 05 §5 A5, R8; brief §4 API): `GET /v2.1/calls/{call_sid}` with `Authorization: key:secret`,
 * an 8-second timeout over the request and the body, no redirects, a 1 MB body cap, zod over the fields used (top-level
 * or wrapped in `data`, `[unverified]`). 404 → not_found; 429 / 5xx / other / timeout / a body that doesn't fit →
 * unavailable. A body it doesn't read is released. Nothing logged carries a number or the key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JUSTCALL_API_BASE, getCall } from "./api";

const KEY = "test-key-not-real";
const SECRET = "test-secret-not-real";
const SID = "CAtest0001";
const CONTACT = "447700900517";

/** A call as the docs' call object shows it (UK fixture numbers; drama range). */
const CALL = {
  id: 1786000001,
  call_sid: SID,
  contact_number: CONTACT,
  contact_name: "Not stored",
  justcall_number: "447700900990",
  agent_email: "agent@example.test",
  call_date: "2027-02-09",
  call_time: "14:03:00",
  call_info: { direction: "Outgoing", type: "Answered", disposition: "", notes: "wants Tuesdays", recording: "https://example.test/rec" },
  call_duration: { friendly_duration: "00:06:12", total_duration: 372 },
};
const EXPECTED = {
  callSid: SID, justcallId: "1786000001", contactNumber: CONTACT, justcallNumber: "447700900990",
  agentEmail: "agent@example.test", callDate: "2027-02-09", callTime: "14:03:00",
  direction: "Outgoing", type: "Answered", disposition: null, notes: "wants Tuesdays", durationSeconds: 372,
};

/** A typed stand-in for `fetch` (review TS L11). */
const asFetch = (fn: (url: string, init: RequestInit) => Promise<Response>): typeof fetch => fn as unknown as typeof fetch;
const reply = (status: number, body: unknown) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const answering = (status: number, body: unknown) => asFetch(async () => reply(status, body));
const deps = (fetchImpl: typeof fetch, timeoutMs?: number) => ({ fetch: fetchImpl, config: { apiKey: KEY, apiSecret: SECRET }, ...(timeoutMs ? { timeoutMs } : {}) });

let logged: unknown[][];
beforeEach(() => {
  logged = [];
  for (const level of ["error", "warn", "info", "log"] as const) vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logged.push(a));
});
afterEach(() => vi.restoreAllMocks());
const loggedText = () => JSON.stringify(logged);

describe("getCall", () => {
  it("asks JustCall for the call by its sid, with the key and secret, no redirects, and nothing else", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => reply(200, CALL));
    await getCall(SID, deps(asFetch(fetchMock)));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${JUSTCALL_API_BASE}/calls/${SID}`);
    expect(JUSTCALL_API_BASE).toBe("https://api.justcall.io/v2.1");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.cache).toBe("no-store");
    expect(init.redirect).toBe("error");
    expect(new Headers(init.headers).get("authorization")).toBe(`${KEY}:${SECRET}`);
    expect(new Headers(init.headers).get("accept")).toBe("application/json");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["top-level", CALL],
    ["wrapped in data", { status: "success", data: CALL }],
    ["wrapped in a one-item data list", { status: "success", data: [CALL] }],
  ])("reads the fields used, %s", async (_label, body) => {
    expect(await getCall(SID, deps(answering(200, body)))).toEqual({ ok: true, value: EXPECTED });
  });

  it("keeps a missing id, duration, notes and numbers as null", async () => {
    const body = { call_sid: SID, call_date: "2027-02-09", call_time: "14:03:00", call_info: { direction: "Incoming", type: "Missed" } };
    expect(await getCall(SID, deps(answering(200, body)))).toEqual({
      ok: true,
      value: { callSid: SID, justcallId: null, contactNumber: null, justcallNumber: null, agentEmail: null, callDate: "2027-02-09",
        callTime: "14:03:00", direction: "Incoming", type: "Missed", disposition: null, notes: null, durationSeconds: null },
    });
  });

  it("404 → not_found", async () => {
    expect(await getCall(SID, deps(answering(404, { message: "not found" })))).toEqual({ ok: false, error: "not_found" });
  });

  it.each([
    [429, "api_429"],
    [500, "api_500"],
    [503, "api_503"],
    [401, "api_401"],
    [400, "api_400"],
    [302, "api_302"],
  ])("HTTP %i → unavailable (%s)", async (status, code) => {
    expect(await getCall(SID, deps(answering(status, {})))).toEqual({ ok: false, error: "unavailable", code });
  });

  it("a network failure (or a refused redirect) → unavailable", async () => {
    const failing = asFetch(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await getCall(SID, deps(failing))).toEqual({ ok: false, error: "unavailable", code: "api_network" });
  });

  it("gives up at the timeout → unavailable", async () => {
    const hang = asFetch((_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))));
    expect(await getCall(SID, deps(hang, 20))).toEqual({ ok: false, error: "unavailable", code: "api_timeout" });
  });

  it("a body that stalls past the timeout → unavailable (timeout), not a shape error (review TS M2)", async () => {
    const stalled = asFetch(async (_url, init) =>
      new Response(new ReadableStream({ start(c) { init.signal?.addEventListener("abort", () => c.error(init.signal?.reason)); } }), { status: 200 }));
    expect(await getCall(SID, deps(stalled, 20))).toEqual({ ok: false, error: "unavailable", code: "api_timeout" });
  });

  it("a body over 1 MB → unavailable, and reading stops (security review L6)", async () => {
    let pulled = 0;
    const big = new ReadableStream<Uint8Array>({ pull(c) { pulled += 1; c.enqueue(new Uint8Array(256 * 1024).fill(32)); } }, { highWaterMark: 0 });
    expect(await getCall(SID, deps(asFetch(async () => new Response(big, { status: 200 }))))).toEqual({ ok: false, error: "unavailable", code: "api_too_large" });
    expect(pulled).toBeLessThanOrEqual(5);
  });

  it.each([404, 500])("an answer it doesn't read (%i) has its body released (review TS M2)", async (status) => {
    let cancelled = false;
    const body = new ReadableStream({ pull() {}, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    await getCall(SID, deps(asFetch(async () => new Response(body, { status }))));
    expect(cancelled).toBe(true);
  });

  it.each([
    ["not JSON", "<html>oops</html>"],
    ["no call_date", { ...CALL, call_date: undefined }],
    ["a call_time it can't read", { ...CALL, call_time: "2pm" }],
    ["no call_info", { ...CALL, call_info: undefined }],
    ["a negative duration", { ...CALL, call_duration: { total_duration: -1 } }],
    ["an empty data list", { data: [] }],
    ["two calls in data", { data: [CALL, CALL] }],
  ])("a body that doesn't fit (%s) → unavailable", async (_label, body) => {
    expect(await getCall(SID, deps(answering(200, body)))).toEqual({ ok: false, error: "unavailable", code: "api_shape" });
  });

  it("a call with another sid → unavailable (never written against this sid)", async () => {
    expect(await getCall(SID, deps(answering(200, { ...CALL, call_sid: "CAother" })))).toEqual({ ok: false, error: "unavailable", code: "api_sid_mismatch" });
  });

  it.each(["", "CA test", "CA/../x", "x".repeat(101)])("a sid that can't be a call (%j) → not_found, with no request", async (sid) => {
    const fetchMock = vi.fn(async () => reply(200, CALL));
    expect(await getCall(sid, deps(asFetch(fetchMock)))).toEqual({ ok: false, error: "not_found" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs no number, key or secret on any path", async () => {
    for (const status of [200, 404, 429, 500]) await getCall(SID, deps(answering(status, CALL)));
    await getCall(SID, deps(asFetch(async () => {
      throw new Error(`boom ${KEY}`);
    })));
    await getCall(SID, deps(answering(200, { ...CALL, call_time: "bad" })));
    expect(loggedText()).not.toMatch(new RegExp(`${KEY}|${SECRET}|${CONTACT}|447700900990`));
  });
});
