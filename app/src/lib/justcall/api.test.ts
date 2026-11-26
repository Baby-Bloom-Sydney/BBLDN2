/**
 * JustCall's "Get a call" (plan 05 §5 A5, R8; brief §4 API): `GET /v2.1/calls/{call_sid}` with `Authorization: key:secret`,
 * an 8-second timeout, zod over the fields used (top-level or wrapped in `data`, `[unverified]`). 404 → not_found;
 * 429 / 5xx / other / timeout / a body that doesn't fit → unavailable. Nothing logged carries a number or the key.
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
  agent_email: "admin+b05-agent@babybloomnannies.co.uk",
  call_date: "2027-02-09",
  call_time: "14:03:00",
  call_info: { direction: "Outgoing", type: "Answered", disposition: "", notes: "wants Tuesdays", recording: "https://example.test/rec" },
  call_duration: { friendly_duration: "00:06:12", total_duration: 372 },
};
const EXPECTED = {
  callSid: SID, justcallId: "1786000001", contactNumber: CONTACT, justcallNumber: "447700900990",
  agentEmail: "admin+b05-agent@babybloomnannies.co.uk", callDate: "2027-02-09", callTime: "14:03:00",
  direction: "Outgoing", type: "Answered", disposition: null, notes: "wants Tuesdays", durationSeconds: 372,
};

const reply = (status: number, body: unknown) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const deps = (fetchImpl: typeof fetch, timeoutMs?: number) => ({ fetch: fetchImpl, config: { apiKey: KEY, apiSecret: SECRET }, ...(timeoutMs ? { timeoutMs } : {}) });

let logged: unknown[][];
beforeEach(() => {
  logged = [];
  for (const level of ["error", "warn", "info", "log"] as const) vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logged.push(a));
});
afterEach(() => vi.restoreAllMocks());
const loggedText = () => JSON.stringify(logged);

describe("getCall", () => {
  it("asks JustCall for the call by its sid, with the key and secret, and nothing else", async () => {
    const fetchMock = vi.fn(async () => reply(200, CALL));
    await getCall(SID, deps(fetchMock as unknown as typeof fetch));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${JUSTCALL_API_BASE}/calls/${SID}`);
    expect(JUSTCALL_API_BASE).toBe("https://api.justcall.io/v2.1");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.cache).toBe("no-store");
    expect(new Headers(init.headers).get("authorization")).toBe(`${KEY}:${SECRET}`);
    expect(new Headers(init.headers).get("accept")).toBe("application/json");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["top-level", CALL],
    ["wrapped in data", { status: "success", data: CALL }],
    ["wrapped in a one-item data list", { status: "success", data: [CALL] }],
  ])("reads the fields used, %s", async (_label, body) => {
    const result = await getCall(SID, deps((async () => reply(200, body)) as unknown as typeof fetch));
    expect(result).toEqual({ ok: true, value: EXPECTED });
  });

  it("keeps a missing id, duration, notes and numbers as null", async () => {
    const body = { call_sid: SID, call_date: "2027-02-09", call_time: "14:03:00", call_info: { direction: "Incoming", type: "Missed" } };
    const result = await getCall(SID, deps((async () => reply(200, body)) as unknown as typeof fetch));
    expect(result).toEqual({
      ok: true,
      value: { callSid: SID, justcallId: null, contactNumber: null, justcallNumber: null, agentEmail: null, callDate: "2027-02-09",
        callTime: "14:03:00", direction: "Incoming", type: "Missed", disposition: null, notes: null, durationSeconds: null },
    });
  });

  it("404 → not_found", async () => {
    expect(await getCall(SID, deps((async () => reply(404, { message: "not found" })) as unknown as typeof fetch))).toEqual({ ok: false, error: "not_found" });
  });

  it.each([
    [429, "api_429"],
    [500, "api_500"],
    [503, "api_503"],
    [401, "api_401"],
    [400, "api_400"],
  ])("HTTP %i → unavailable (%s)", async (status, code) => {
    expect(await getCall(SID, deps((async () => reply(status, {})) as unknown as typeof fetch))).toEqual({ ok: false, error: "unavailable", code });
  });

  it("a network failure → unavailable", async () => {
    const result = await getCall(SID, deps((async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch));
    expect(result).toEqual({ ok: false, error: "unavailable", code: "api_network" });
  });

  it("gives up at the timeout → unavailable", async () => {
    const hang = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)))) as unknown as typeof fetch;
    expect(await getCall(SID, deps(hang, 20))).toEqual({ ok: false, error: "unavailable", code: "api_timeout" });
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
    expect(await getCall(SID, deps((async () => reply(200, body)) as unknown as typeof fetch))).toEqual({ ok: false, error: "unavailable", code: "api_shape" });
  });

  it("a call with another sid → unavailable (never written against this sid)", async () => {
    const result = await getCall(SID, deps((async () => reply(200, { ...CALL, call_sid: "CAother" })) as unknown as typeof fetch));
    expect(result).toEqual({ ok: false, error: "unavailable", code: "api_sid_mismatch" });
  });

  it.each(["", "CA test", "CA/../x", "x".repeat(101)])("a sid that can't be a call (%j) → not_found, with no request", async (sid) => {
    const fetchMock = vi.fn();
    expect(await getCall(sid, deps(fetchMock as unknown as typeof fetch))).toEqual({ ok: false, error: "not_found" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs no number, key or secret on any path", async () => {
    for (const status of [200, 404, 429, 500]) await getCall(SID, deps((async () => reply(status, CALL)) as unknown as typeof fetch));
    await getCall(SID, deps((async () => { throw new Error(`boom ${KEY}`); }) as unknown as typeof fetch));
    await getCall(SID, deps((async () => reply(200, { ...CALL, call_time: "bad" })) as unknown as typeof fetch));
    expect(loggedText()).not.toMatch(new RegExp(`${KEY}|${SECRET}|${CONTACT}|447700900990`));
  });
});
