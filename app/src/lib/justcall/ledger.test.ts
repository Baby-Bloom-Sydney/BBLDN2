/**
 * The webhook ledger (plan 05 §5 A7, R8, R9; the Stripe route's insert-before-dispatch). Only a verified event is
 * recorded; the stored body has the webhook_url query (the preview's bypass) removed; a redelivery is a duplicate; a
 * stored row is re-issued as a verified event for the replay.
 */
import { describe, expect, it, vi } from "vitest";
import { beginEvent, finishEvent, replayableEvent, storedBody, unresolvedEventIds } from "./ledger";
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

describe("storedBody", () => {
  it("removes the webhook_url query and keeps everything else", () => {
    expect(storedBody(BODY)).toEqual({ ...BODY, webhook_url: URL_OURS });
  });

  it("removes a fragment too, and leaves a body with no URL as it is", () => {
    expect(storedBody({ webhook_url: `${URL_OURS}#x`, type: "t" })).toEqual({ webhook_url: URL_OURS, type: "t" });
    expect(storedBody({ type: "t" })).toEqual({ type: "t" });
    expect(storedBody({ webhook_url: "not a url", type: "t" })).toEqual({ webhook_url: "[removed]", type: "t" });
  });
});

describe("beginEvent", () => {
  it("records a verified delivery (type, sid, ids, timestamp, the stored body) and returns its id", async () => {
    const r = repo();
    expect(await beginEvent(EVENT, BODY, r)).toEqual({ kind: "new", id: "event-1" });
    expect(r.insertEvent).toHaveBeenCalledWith({
      requestId: "01HTEST", eventType: "call.completed", callSid: "CAtest0001", justcallId: "1786000001",
      requestTimestamp: "2027-02-09 14:03:00", rawBody: { ...BODY, webhook_url: URL_OURS },
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
