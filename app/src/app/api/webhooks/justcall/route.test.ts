/**
 * POST /api/webhooks/justcall (plan 05 §5 A9; brief §0.5–§0.9, §0.12, §8 security; §9 rows 1, 6–9, 12, 13). The order:
 *   1 switch off → 404 before anything is read · 2 a setting missing → 503, names logged · 3 body over 256 KB → 413 ·
 *   4 not JSON → 400 · 5 signature, version, window or URL wrong → 401, nothing written · 6 the validation ping → 200,
 *   nothing written · 7 a type 05 doesn't act on → 200, ledger `ignored` · 8 a redelivery → 200 · 9 dispatch → 200, or
 *   500 when `unresolved`. Responses carry no detail; logs carry no number, key, secret or URL query.
 * The database is the shared RPC fake; JustCall's API is a mocked `fetch`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";
import {
  HER_NUMBER, TEST_KEY, TEST_SECRET, TEST_SID, TEST_WEBHOOK_URL, apiCall, docsTimestamp, signedRequest, webhookBody,
} from "@/lib/justcall/webhook-fixture.test-util";

const h = vi.hoisted(() => ({ fake: null as null | { client: unknown }, created: 0 }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    h.created += 1;
    return h.fake?.client;
  },
}));

import * as route from "./route";
import { POST } from "./route";

const PARENT = "b0500000-0000-4000-8000-000000000017";
const ENTRY = "c0500000-0000-4000-8000-000000000001";
const BYPASS_URL = `${TEST_WEBHOOK_URL}?x-vercel-protection-bypass=test-bypass-not-real`;

let f: FakeAdmin;
let fetchMock: ReturnType<typeof vi.fn>;
let logs: unknown[][];

function apiAnswers(status: number, body: unknown = apiCall()) {
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

beforeEach(() => {
  vi.stubEnv("CALL_BOOKING_ENABLED", "true");
  vi.stubEnv("JUSTCALL_WEBHOOK_ENABLED", "true");
  vi.stubEnv("JUSTCALL_API_KEY", TEST_KEY);
  vi.stubEnv("JUSTCALL_API_SECRET", TEST_SECRET);
  vi.stubEnv("JUSTCALL_WEBHOOK_URL", TEST_WEBHOOK_URL);
  f = fakeAdmin({ user_profiles: [{ user_id: PARENT }], user_roles: [{ user_id: PARENT }] });
  f.writeResults.justcall_webhook_events = { id: "event-1" };
  f.rpcResults.justcall_record_call = { data: { status: "applied", entry_id: ENTRY, entry_created: true, matched: true }, error: null };
  h.fake = f;
  h.created = 0;
  fetchMock = vi.fn();
  apiAnswers(200);
  vi.stubGlobal("fetch", fetchMock);
  logs = [];
  for (const level of ["error", "warn", "info", "log"] as const) vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logs.push(a));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const post = (request: Request) => POST(request);
const signed = (body = webhookBody(), options = {}) => signedRequest(body, new Date(), options);
const ledgerInserts = () => f.ops.filter((o) => o.table === "justcall_webhook_events" && o.kind === "insert");
const ledgerFinish = () => f.ops.find((o) => o.table === "justcall_webhook_events" && o.kind === "update")?.payload as Record<string, unknown> | undefined;
const nothingWritten = () => {
  expect(f.ops.filter((o) => o.kind !== "select")).toEqual([]);
  expect(f.rpcCalls).toEqual([]);
};
const allLogged = () => JSON.stringify(logs);

describe("route module", () => {
  it("runs on Node, dynamic, and answers POST only", () => {
    expect(route.runtime).toBe("nodejs");
    expect(route.dynamic).toBe("force-dynamic");
    expect(Object.keys(route).filter((k) => /^[A-Z]+$/.test(k))).toEqual(["POST"]);
  });
});

describe("1. the switch off (§9 row 1)", () => {
  it.each([
    ["JUSTCALL_WEBHOOK_ENABLED unset", { JUSTCALL_WEBHOOK_ENABLED: "" }],
    ["call booking off", { CALL_BOOKING_ENABLED: "" }],
    ["both off, settings missing too", { JUSTCALL_WEBHOOK_ENABLED: "", CALL_BOOKING_ENABLED: "", JUSTCALL_API_SECRET: "" }],
  ])("%s → 404 before anything is read; no JustCall request leaves the app", async (_label, env) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    let read = false;
    // highWaterMark 0: the stream pulls only when the route reads it
    const body = new ReadableStream({ pull(c) { read = true; c.enqueue(new TextEncoder().encode("{}")); c.close(); } }, { highWaterMark: 0 });
    const request = new Request("http://localhost/api/webhooks/justcall", { method: "POST", body, duplex: "half" } as RequestInit);
    const response = await post(request);
    expect(response.status).toBe(404);
    expect(read).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.created).toBe(0);
    expect(logs).toEqual([]);
  });
});

describe("2. a setting missing", () => {
  it.each(["JUSTCALL_API_KEY", "JUSTCALL_API_SECRET", "JUSTCALL_WEBHOOK_URL"])("%s unset → 503; its name is logged, never a value", async (name) => {
    vi.stubEnv(name, "");
    const response = await post(signed());
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Service unavailable");
    expect(allLogged()).toContain(name);
    expect(allLogged()).not.toMatch(new RegExp(`${TEST_KEY}|${TEST_SECRET}|example\\.test`));
    nothingWritten();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("3–4. the body", () => {
  it("over 256 KB (content-length) → 413, nothing written", async () => {
    const request = new Request("http://localhost/api/webhooks/justcall", { method: "POST", body: "{}", headers: { "content-length": String(256 * 1024 + 1) } });
    expect((await post(request)).status).toBe(413);
    nothingWritten();
  });

  it("over 256 KB (the bytes sent) → 413, nothing written", async () => {
    const big = webhookBody({ data: { notes: "n".repeat(256 * 1024) } });
    expect((await post(signed(big))).status).toBe(413);
    nothingWritten();
  });

  it("not JSON → 400, nothing written", async () => {
    const request = new Request("http://localhost/api/webhooks/justcall", { method: "POST", body: "not json" });
    const response = await post(request);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Bad request");
    nothingWritten();
  });
});

describe("5. refused 401 with nothing written (§9 row 9)", () => {
  const old = docsTimestamp(new Date(Date.now() - 6 * 60_000));
  it.each([
    ["a wrong signature", webhookBody(), { secret: "another-secret" }],
    ["no signature header", webhookBody(), { signature: null }],
    ["no version header", webhookBody(), { version: null }],
    ["version v2", webhookBody(), { version: "v2" }],
    ["a timestamp 6 minutes old", webhookBody(), { timestamp: old }],
    ["someone else's webhook_url", webhookBody({ webhookUrl: "https://elsewhere.example.test/hook" }), {}],
    ["a type the signature didn't cover", webhookBody({ type: "call.updated" }), { signedType: "call.completed" }],
  ])("%s", async (_label, body, options) => {
    const response = await post(signedRequest(body, new Date(), options));
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Unauthorized");
    nothingWritten();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a missing timestamp header", async () => {
    const request = signed();
    const headers = new Headers(request.headers);
    headers.delete("x-justcall-request-timestamp");
    const response = await post(new Request(request.url, { method: "POST", headers, body: JSON.stringify(webhookBody()) }));
    expect(response.status).toBe(401);
    nothingWritten();
  });

  it("a body that isn't a webhook envelope", async () => {
    const request = new Request("http://localhost/api/webhooks/justcall", { method: "POST", body: JSON.stringify({ hello: "world" }) });
    expect((await post(request)).status).toBe(401);
    nothingWritten();
  });
});

describe("6. the validation ping", () => {
  it("valid headers and no data → 200, nothing written, no API request", async () => {
    const ping = { webhook_url: TEST_WEBHOOK_URL, type: "call.completed" };
    const response = await post(signedRequest(ping, new Date()));
    expect(response.status).toBe(200);
    nothingWritten();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("data with no usable call_sid → 200, nothing written", async () => {
    expect((await post(signed(webhookBody({ callSid: null })))).status).toBe(200);
    nothingWritten();
  });
});

describe("7. a type 05 doesn't act on", () => {
  it("→ 200, the ledger row `ignored`, no API request", async () => {
    const response = await post(signed(webhookBody({ type: "call.answered" })));
    expect(response.status).toBe(200);
    expect(ledgerInserts()).toHaveLength(1);
    expect(ledgerFinish()).toMatchObject({ outcome: "ignored", processing_error: "unhandled_type" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(f.rpcCalls).toEqual([]);
  });
});

describe("8. a redelivery", () => {
  it("the ledger's unique key refuses it → 200, applied once (§9 row 9)", async () => {
    f.writeErrors.justcall_webhook_events = { message: "duplicate key", code: "23505" };
    const response = await post(signed());
    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(f.rpcCalls).toEqual([]);
  });

  it("a ledger that can't be written → 500, nothing applied", async () => {
    f.writeErrors.justcall_webhook_events = { message: "boom", code: "XX000" };
    expect((await post(signed())).status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("9. dispatch", () => {
  it("re-reads the call, matches her, records it, finishes the row applied → 200 (§9 row 6)", async () => {
    const response = await post(signed());
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`https://api.justcall.io/v2.1/calls/${TEST_SID}`, expect.anything());
    expect(f.rpcCalls).toHaveLength(1);
    expect(f.rpcCalls[0]).toMatchObject({
      fn: "justcall_record_call",
      args: { p_sid: TEST_SID, p_parent: PARENT, p_match_note: null, p_direction: "outgoing", p_mapped_result: "answered", p_duration: 372, p_started_at: "2027-02-09T14:03:00.000Z" },
    });
    expect(ledgerFinish()).toMatchObject({ outcome: "applied", processing_error: null });
    expect(typeof ledgerFinish()?.processed_at).toBe("string");
  });

  it("a forged body under a valid signature writes only the API's answer (§9 row 9)", async () => {
    const forged = webhookBody({ data: { contact_number: "447700900999", call_info: { direction: "Incoming", type: "Missed" }, call_duration: { total_duration: 1 } } });
    await post(signed(forged));
    expect(f.rpcCalls[0]?.args).toMatchObject({ p_contact: HER_NUMBER, p_direction: "outgoing", p_type: "Answered", p_duration: 372 });
  });

  it("Unanswered → no_answer (§9 row 7)", async () => {
    apiAnswers(200, apiCall({ call_info: { direction: "Outgoing", type: "Unanswered" }, call_duration: { total_duration: 0 } }));
    await post(signed());
    expect(f.rpcCalls[0]?.args).toMatchObject({ p_mapped_result: "no_answer" });
  });

  it("a number on no parent → recorded unmatched (§9 row 10)", async () => {
    f.reads.user_profiles = [];
    await post(signed());
    expect(f.rpcCalls[0]?.args).toMatchObject({ p_parent: null, p_match_note: "none" });
  });

  it("the stored body has the webhook_url query removed (D11)", async () => {
    vi.stubEnv("JUSTCALL_WEBHOOK_URL", BYPASS_URL);
    expect((await post(signed(webhookBody({ webhookUrl: BYPASS_URL })))).status).toBe(200);
    const stored = ledgerInserts()[0]?.payload as { raw_body: { webhook_url: string }; call_sid: string; event_type: string };
    expect(stored.raw_body.webhook_url).toBe(TEST_WEBHOOK_URL);
    expect(JSON.stringify(stored)).not.toContain("test-bypass-not-real");
    expect(stored).toMatchObject({ call_sid: TEST_SID, event_type: "call.completed" });
  });

  it("the API's 404 → 200, the row ignored, nothing recorded", async () => {
    apiAnswers(404, { message: "not found" });
    expect((await post(signed())).status).toBe(200);
    expect(ledgerFinish()).toMatchObject({ outcome: "ignored", processing_error: "api_not_found" });
    expect(f.rpcCalls).toEqual([]);
  });

  it.each([500, 429])("the API answering %i → 500, the row unresolved, nothing recorded (§9 row 12)", async (status) => {
    apiAnswers(status, {});
    const response = await post(signed());
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("Error");
    expect(ledgerFinish()).toMatchObject({ outcome: "unresolved", processing_error: `api_${status}`, processed_at: null });
    expect(f.rpcCalls).toEqual([]);
  });

  it("the database unavailable → 500, unresolved", async () => {
    f.rpcResults.justcall_record_call = { data: null, error: { message: "lock timeout", code: "55P03" } };
    expect((await post(signed())).status).toBe(500);
    expect(ledgerFinish()).toMatchObject({ outcome: "unresolved", processing_error: "record_failed" });
  });

  it("an outcome that can't be written still answers by the outcome", async () => {
    f.writeErrors.justcall_webhook_events = undefined;
    const original = f.client.from.bind(f.client);
    (f.client as unknown as { from: (t: string) => unknown }).from = (table: string) => {
      const chain = original(table) as unknown as Record<string, unknown>;
      return table === "justcall_webhook_events" ? { ...chain, update: () => ({ eq: async () => ({ data: null, error: { message: "boom" } }) }) } : chain;
    };
    expect((await post(signed())).status).toBe(200);
    expect(allLogged()).toContain("outcome");
  });
});

describe("what leaves the route", () => {
  it("no response body carries detail, and no log carries a number, key, secret or URL query", async () => {
    vi.stubEnv("JUSTCALL_WEBHOOK_URL", BYPASS_URL);
    const bodies: string[] = [];
    const cases: Array<() => Promise<Response>> = [
      () => post(signed(webhookBody({ webhookUrl: BYPASS_URL }))),
      () => post(signed(webhookBody({ webhookUrl: BYPASS_URL }), { secret: "wrong" })),
      () => { apiAnswers(500, {}); return post(signed(webhookBody({ webhookUrl: BYPASS_URL }))); },
      () => { apiAnswers(200, { ...apiCall(), call_time: "bad" }); return post(signed(webhookBody({ webhookUrl: BYPASS_URL }))); },
      () => post(new Request("http://localhost/api/webhooks/justcall", { method: "POST", body: "{" })),
    ];
    for (const run of cases) bodies.push(await (await run()).text());
    expect(new Set(bodies)).toEqual(new Set(["OK", "Unauthorized", "Error", "Bad request"]));
    expect(allLogged()).not.toMatch(new RegExp(`${TEST_KEY}|${TEST_SECRET}|test-bypass-not-real|${HER_NUMBER}|7700900`));
  });
});
