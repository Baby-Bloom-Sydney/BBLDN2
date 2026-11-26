/**
 * The webhook ledger (plan 05 §5 A7, R8, R9; the Stripe route's insert-before-dispatch). Only a verified event is
 * recorded; the stored body has the webhook_url query (the preview's bypass) removed; a redelivery is a duplicate; a
 * stored row is re-issued as a verified event for the replay.
 */
import { describe, expect, it, vi } from "vitest";
import { beginEvent, finishEvent, replayableEvent, retryOfUnresolved, storedBody, unresolvedEventIds } from "./ledger";
import type { JustCallRepo } from "./repo";
import { issueVerifiedJustCallEvent, isVerifiedJustCallEvent } from "./verified";

const EVENT = issueVerifiedJustCallEvent({
  eventType: "call.completed", callSid: "CAtest0001", justcallId: "1786000001", requestId: "01HTEST",
  requestTimestamp: "2027-02-09 14:03:00", source: "webhook",
});
const URL_OURS = "https://app.example.test/api/webhooks/justcall";
const BODY = { request_id: "01HTEST", webhook_url: `${URL_OURS}?x-vercel-protection-bypass=placeholder`, type: "call.completed", data: { call_sid: "CAtest0001", contact_number: "447700900517" } };

function repo(over: Partial<JustCallRepo> = {}) {
  return {
    insertEvent: vi.fn(async () => ({ ok: true as const, value: { id: "event-1" } })),
    finishEvent: vi.fn(async () => ({ ok: true as const, value: true as const })),
    readEvent: vi.fn(async () => ({ ok: true as const, value: null })),
    readUnresolvedEvents: vi.fn(async () => ({ ok: true as const, value: [] })),
    ...over,
  } as unknown as JustCallRepo;
}

describe("storedBody (plan §10: no number, key or URL query in the stored body; security review M1)", () => {
  it("keeps only the envelope: request id, url id, type, the URL without its query, and the call's id and sid", () => {
    const stored = storedBody({ ...BODY, url_id: "u-1", data: { ...BODY.data, id: 1786000001, notes: "private" } });
    expect(stored).toEqual({ request_id: "01HTEST", url_id: "u-1", type: "call.completed", webhook_url: URL_OURS, data: { call_sid: "CAtest0001", id: "1786000001" } });
    expect(JSON.stringify(stored)).not.toMatch(/447700900517|private|placeholder/);
  });

  it("removes a fragment too; a body with no data or no URL stores nulls", () => {
    expect(storedBody({ webhook_url: `${URL_OURS}#x`, type: "t" })).toEqual({ request_id: null, url_id: null, type: "t", webhook_url: URL_OURS, data: null });
    expect(storedBody({ type: "t" })).toEqual({ request_id: null, url_id: null, type: "t", webhook_url: null, data: null });
    expect(storedBody({ webhook_url: "not a url", type: "t" })).toMatchObject({ webhook_url: "[removed]" });
  });

  it("stores nothing it can't name: arrays, nested objects and long strings become null", () => {
    expect(storedBody(["x"])).toEqual({ request_id: null, url_id: null, type: null, webhook_url: null, data: null });
    expect(storedBody({ type: { nested: true }, request_id: "r".repeat(300), data: { call_sid: ["x"] } })).toEqual({
      request_id: null, url_id: null, type: null, webhook_url: null, data: { call_sid: null, id: null },
    });
  });
});

describe("beginEvent", () => {
  it("records a verified delivery (type, sid, ids, timestamp, the stored body) and returns its id", async () => {
    const r = repo();
    expect(await beginEvent(EVENT, BODY, r)).toEqual({ kind: "new", id: "event-1" });
    expect(r.insertEvent).toHaveBeenCalledWith({
      requestId: "01HTEST", eventType: "call.completed", callSid: "CAtest0001", justcallId: "1786000001",
      requestTimestamp: "2027-02-09 14:03:00", rawBody: storedBody(BODY),
    });
  });

  it("refuses a look-alike, writing nothing", async () => {
    const r = repo();
    const lookAlike = { ...EVENT };
    expect(await beginEvent(lookAlike as typeof EVENT, BODY, r)).toEqual({ kind: "error" });
    expect(r.insertEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["duplicate", { ok: false, error: "duplicate" }, { kind: "duplicate" }],
    ["error", { ok: false, error: "error" }, { kind: "error" }],
  ])("a %s insert", async (_label, reply, expected) => {
    const r = repo({ insertEvent: vi.fn(async () => reply) as unknown as JustCallRepo["insertEvent"] });
    expect(await beginEvent(EVENT, BODY, r)).toEqual(expected);
  });
});

describe("finishEvent", () => {
  it("writes the outcome and code", async () => {
    const r = repo();
    expect(await finishEvent("event-1", { outcome: "unresolved", code: "api_500" }, r)).toBe(true);
    expect(r.finishEvent).toHaveBeenCalledWith("event-1", "unresolved", "api_500");
  });

  it("a failed write → false", async () => {
    const r = repo({ finishEvent: vi.fn(async () => ({ ok: false as const, error: "error" as const })) });
    expect(await finishEvent("event-1", { outcome: "applied", code: null }, r)).toBe(false);
  });
});

describe("the replay's reads", () => {
  const STORED = { id: "event-1", eventType: "call.updated", callSid: "CAtest0001", justcallId: null, requestId: null, requestTimestamp: "1801000000", outcome: "unresolved" as const };

  it("re-issues a stored row as a verified event from the ledger", async () => {
    const r = repo({ readEvent: vi.fn(async () => ({ ok: true as const, value: STORED })) });
    const result = await replayableEvent("event-1", r);
    expect(result.ok).toBe(true);
    const event = result.ok ? result.event : null;
    expect(isVerifiedJustCallEvent(event)).toBe(true);
    expect(event).toMatchObject({ eventType: "call.updated", callSid: "CAtest0001", requestTimestamp: "1801000000", source: "ledger" });
  });

  it.each(["applied", "ignored"] as const)("a row already %s is not replayed (its outcome stays as written)", async (outcome) => {
    const r = repo({ readEvent: vi.fn(async () => ({ ok: true as const, value: { ...STORED, outcome } })) });
    expect(await replayableEvent("event-1", r)).toEqual({ ok: false, error: "finished" });
  });

  it("a row still in flight (no outcome) is replayed", async () => {
    const r = repo({ readEvent: vi.fn(async () => ({ ok: true as const, value: { ...STORED, outcome: null } })) });
    expect((await replayableEvent("event-1", r)).ok).toBe(true);
  });

  it("an unknown id → not_found; a failed read → error", async () => {
    expect(await replayableEvent("nope", repo())).toEqual({ ok: false, error: "not_found" });
    const failing = repo({ readEvent: vi.fn(async () => ({ ok: false as const, error: "error" as const })) });
    expect(await replayableEvent("event-1", failing)).toEqual({ ok: false, error: "error" });
  });

  it("lists the unresolved ids", async () => {
    const r = repo({ readUnresolvedEvents: vi.fn(async () => ({ ok: true as const, value: [STORED, { ...STORED, id: "event-2" }] })) });
    expect(await unresolvedEventIds(r)).toEqual({ ok: true, value: ["event-1", "event-2"] });
    const failing = repo({ readUnresolvedEvents: vi.fn(async () => ({ ok: false as const, error: "error" as const })) });
    expect(await unresolvedEventIds(failing)).toEqual({ ok: false });
  });
});

describe("retryOfUnresolved (a redelivery of a row left unresolved is applied again; reviews TS H1, code M1, security M2)", () => {
  const stored = (outcome: "applied" | "ignored" | "unresolved" | null) => ({
    id: "event-1", eventType: "call.completed", callSid: "CAtest0001", justcallId: "1786000001", requestId: "01HTEST", requestTimestamp: "2027-02-09 14:03:00", outcome,
  });

  it("finds the stored row by the delivery's key; unresolved → retry it", async () => {
    const readEventByKey = vi.fn(async () => ({ ok: true as const, value: stored("unresolved") }));
    expect(await retryOfUnresolved(EVENT, repo({ readEventByKey } as Partial<JustCallRepo>))).toEqual({ kind: "retry", id: "event-1" });
    expect(readEventByKey).toHaveBeenCalledWith("CAtest0001", "call.completed", "2027-02-09 14:03:00");
  });

  it.each(["applied", "ignored", null] as const)("a row %s (or in flight) → nothing to do", async (outcome) => {
    const readEventByKey = vi.fn(async () => ({ ok: true as const, value: stored(outcome) }));
    expect(await retryOfUnresolved(EVENT, repo({ readEventByKey } as Partial<JustCallRepo>))).toEqual({ kind: "done" });
  });

  it("no row, or a failed read → error", async () => {
    const none = vi.fn(async () => ({ ok: true as const, value: null }));
    expect(await retryOfUnresolved(EVENT, repo({ readEventByKey: none } as Partial<JustCallRepo>))).toEqual({ kind: "error" });
    const failing = vi.fn(async () => ({ ok: false as const, error: "error" as const }));
    expect(await retryOfUnresolved(EVENT, repo({ readEventByKey: failing } as Partial<JustCallRepo>))).toEqual({ kind: "error" });
  });
});
