/**
 * Applying one verified event (plan 05 §5 A8; R3, R7, R8): re-read the call from JustCall's API, map it, match her
 * number, then `justcall_record_call`. Only the API's answer is written — the event carries the type and the sid, never
 * call data. 404 → ignored; an API or database failure → unresolved (kept for the replay).
 */
import { describe, expect, it, vi } from "vitest";
import type { GetCallResult, JustCallCall } from "./api";
import { applyJustCallEvent, type ApplyDeps } from "./apply";
import { mapCall } from "./map";
import type { RecordCallInput, RepoResult, RecordedCall } from "./repo";
import { issueVerifiedJustCallEvent } from "./verified";

const PARENT = "b0500000-0000-4000-8000-000000000017";
const event = (over: { eventType?: string; callSid?: string } = {}) =>
  issueVerifiedJustCallEvent({
    eventType: over.eventType ?? "call.completed", callSid: over.callSid ?? "CAtest0001", justcallId: "999",
    requestId: "01HTEST", requestTimestamp: "2027-02-09 14:09:00", source: "webhook",
  });

const CALL: JustCallCall = {
  callSid: "CAtest0001", justcallId: "1786000001", contactNumber: "447700900517", justcallNumber: "447700900990",
  agentEmail: "agent@example.test", callDate: "2027-02-09", callTime: "14:03:00",
  direction: "Outgoing", type: "Answered", disposition: null, notes: null, durationSeconds: 372,
};

function deps(over: {
  call?: GetCallResult;
  parents?: { ok: true; value: readonly string[] } | { ok: false };
  record?: RepoResult<RecordedCall, "error" | "invalid">;
} = {}) {
  const getCall = vi.fn(async () => over.call ?? ({ ok: true, value: CALL } as const));
  const parentsByMobile = vi.fn(async () => over.parents ?? ({ ok: true, value: [PARENT] } as const));
  const recordCall = vi.fn(async (_input: RecordCallInput) => over.record ?? ({ ok: true, value: { entryId: "entry-1", entryCreated: true, matched: true } } as const));
  const d: ApplyDeps = { getCall, repo: { parentsByMobile, recordCall } };
  return { d, getCall, parentsByMobile, recordCall };
}

describe("applyJustCallEvent", () => {
  it("re-reads the call by its sid, matches her number and records it → applied", async () => {
    const { d, getCall, parentsByMobile, recordCall } = deps();
    expect(await applyJustCallEvent(event(), d)).toEqual({ outcome: "applied", code: null });
    expect(getCall).toHaveBeenCalledExactlyOnceWith("CAtest0001");
    expect(parentsByMobile).toHaveBeenCalledExactlyOnceWith("+447700900517");
    const mapped = mapCall(CALL);
    expect(recordCall).toHaveBeenCalledExactlyOnceWith({ ...(mapped.ok ? mapped.value : {}), parentUserId: PARENT, matchNote: null });
  });

  it("writes only what the API answered (the signature covers no call data, §9.9)", async () => {
    const { d, recordCall } = deps();
    await applyJustCallEvent(event(), d);
    const [input] = recordCall.mock.calls[0];
    expect(input.justcallId).toBe("1786000001");
    expect(input.contactNumber).toBe("447700900517");
    expect(input.startedAt).toBe("2027-02-09T14:03:00.000Z");
  });

  it.each([
    ["no parent", [], "none"],
    ["the same number on two parents", ["p-1", "p-2"], "several"],
  ] as const)("%s → recorded unmatched (%s)", async (_label, ids, note) => {
    const { d, recordCall } = deps({ parents: { ok: true, value: ids } });
    expect(await applyJustCallEvent(event(), d)).toEqual({ outcome: "applied", code: null });
    expect(recordCall).toHaveBeenCalledWith(expect.objectContaining({ parentUserId: null, matchNote: note }));
  });

  it("a not-an-attempt call is recorded with no result (D7)", async () => {
    const { d, recordCall } = deps({ call: { ok: true, value: { ...CALL, direction: "Incoming", type: "Missed" } } });
    expect(await applyJustCallEvent(event(), d)).toEqual({ outcome: "applied", code: null });
    expect(recordCall).toHaveBeenCalledWith(expect.objectContaining({ mappedResult: null, direction: "incoming" }));
  });

  it("a call.updated is applied the same way (notes later, §9.8)", async () => {
    const { d, recordCall } = deps({ call: { ok: true, value: { ...CALL, notes: "wants Tuesdays" } } });
    expect(await applyJustCallEvent(event({ eventType: "call.updated" }), d)).toEqual({ outcome: "applied", code: null });
    expect(recordCall).toHaveBeenCalledWith(expect.objectContaining({ notes: "wants Tuesdays" }));
  });

  it("an unknown type → ignored, naming it; nothing recorded", async () => {
    const { d, recordCall, parentsByMobile } = deps({ call: { ok: true, value: { ...CALL, type: "Transferred" } } });
    expect(await applyJustCallEvent(event(), d)).toEqual({ outcome: "ignored", code: "unknown_type: Transferred" });
    expect(parentsByMobile).not.toHaveBeenCalled();
    expect(recordCall).not.toHaveBeenCalled();
  });

  it("the API's 404 → ignored, nothing else read or written", async () => {
    const { d, parentsByMobile, recordCall } = deps({ call: { ok: false, error: "not_found" } });
    expect(await applyJustCallEvent(event(), d)).toEqual({ outcome: "ignored", code: "api_not_found" });
    expect(parentsByMobile).not.toHaveBeenCalled();
    expect(recordCall).not.toHaveBeenCalled();
  });

  it("the API unavailable → unresolved with its code (§9.12)", async () => {
    const { d, recordCall } = deps({ call: { ok: false, error: "unavailable", code: "api_500" } });
    expect(await applyJustCallEvent(event(), d)).toEqual({ outcome: "unresolved", code: "api_500" });
    expect(recordCall).not.toHaveBeenCalled();
  });

  it("a failed parent read → unresolved, never Unmatched by mistake", async () => {
    const { d, recordCall } = deps({ parents: { ok: false } });
    expect(await applyJustCallEvent(event(), d)).toEqual({ outcome: "unresolved", code: "match_read_failed" });
    expect(recordCall).not.toHaveBeenCalled();
  });

  it.each([
    [{ ok: false, error: "invalid" } as const, { outcome: "ignored", code: "record_invalid" }],
    [{ ok: false, error: "error" } as const, { outcome: "unresolved", code: "record_failed" }],
  ])("the database refusing → %j", async (record, expected) => {
    const { d } = deps({ record });
    expect(await applyJustCallEvent(event(), d)).toEqual(expected);
  });

  it("a look-alike event → ignored, with no API request", async () => {
    const { d, getCall } = deps();
    expect(await applyJustCallEvent({ ...event() }, d)).toEqual({ outcome: "ignored", code: "not_verified" });
    expect(getCall).not.toHaveBeenCalled();
  });

  it("a type 05 doesn't act on → ignored, with no API request", async () => {
    const { d, getCall } = deps();
    expect(await applyJustCallEvent(event({ eventType: "call.answered" }), d)).toEqual({ outcome: "ignored", code: "unhandled_type" });
    expect(getCall).not.toHaveBeenCalled();
  });
});
