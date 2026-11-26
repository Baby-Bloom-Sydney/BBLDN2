/**
 * 04's readers over the rows 05's webhook writes (plan 05 §9 row 7; brief §0.6 "a 'No answer' puts the family back on
 * brief 04's to-call list"; B04 handoff: "a logged No answer shows 'We tried to call you'"). The rows below are exactly
 * as `justcall_record_call` stores them (method and source `justcall`, `recorded_by` NULL, no outcome or note — the
 * local stack's `next dev` proof, PROOF/B05/next-dev-proof-output.txt). 04's code is read, never changed.
 */
import { describe, expect, it } from "vitest";
import { attemptWords } from "@/lib/calls/dashboard-row";
import { isAfterNoAnswer } from "@/lib/calls/parent-view";
import { entriesFromRows } from "@/lib/calls/repo-map";

const row = (over: Record<string, unknown>) => ({
  id: "c0500000-0000-4000-8000-000000000001", parent_user_id: "b0500000-0000-4000-8000-000000000019", booking_id: null,
  occurred_at: "2027-02-09T14:03:00+00:00", recorded_by: null, method: "justcall", source: "justcall", result: "no_answer",
  outcome: null, note: null, call_back_at: null, justcall_call_id: "CAb05dev3", ...over,
});

describe("04's readers over a webhook-written attempt", () => {
  it("04's row parser accepts it (a refusal would fail her dashboard closed)", () => {
    const entries = entriesFromRows([row({}), row({ id: "c0500000-0000-4000-8000-000000000002", result: "answered", justcall_call_id: "CAb05dev1" })]);
    expect(entries).toHaveLength(2);
    expect(entries?.[0]).toMatchObject({ method: "justcall", source: "justcall", recordedBy: null, result: "no_answer", occurredAt: "2027-02-09T14:03:00.000Z" });
  });

  it("a JustCall No answer gives her page \"We tried to call you\", exactly as a manual one does", () => {
    const entries = entriesFromRows([row({})]) ?? [];
    expect(isAfterNoAnswer([], entries)).toBe(true);
    const manual = entriesFromRows([row({ method: "phone", source: "manual", recorded_by: "b0500000-0000-4000-8000-000000000060", justcall_call_id: null })]) ?? [];
    expect(isAfterNoAnswer([], manual)).toBe(isAfterNoAnswer([], entries));
  });

  it("an answered webhook attempt reads as 04's \"Answered\" until 05a-2 adds \"outcome needed\"", () => {
    const [entry] = entriesFromRows([row({ result: "answered" })]) ?? [];
    expect(attemptWords(entry)).toBe("Answered");
    expect(isAfterNoAnswer([], [entry])).toBe(false);
  });
});
