/**
 * JustCall's answer → 05's call row (plan 05 §5 A6): the direction, the R3 type → 04 result table, the start time from
 * the UTC date and time (R6), and the stored fields clipped to amendment 20's limits.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { londonLabel } from "@/lib/calls/dashboard-row";
import type { JustCallCall } from "./api";
import { directionOf, mapCall, mapType, startedAtOf } from "./map";

const CALL: JustCallCall = {
  callSid: "CAtest0001", justcallId: "1786000001", contactNumber: "447700900517", justcallNumber: "447700900990",
  agentEmail: "agent@example.test", callDate: "2027-02-09", callTime: "14:03:00",
  direction: "Outgoing", type: "Answered", disposition: null, notes: null, durationSeconds: 372,
};

describe("directionOf", () => {
  it.each([
    ["Outgoing", "outgoing"], ["outgoing", "outgoing"], [" OUTGOING ", "outgoing"], ["outbound", "outgoing"],
    ["Incoming", "incoming"], ["inbound", "incoming"], ["Inbound", "incoming"],
  ])("%j → %s", (raw, expected) => {
    expect(directionOf(raw)).toBe(expected);
  });

  it.each(["", "sideways", "in", "Outgoing call"])("%j → null", (raw) => {
    expect(directionOf(raw)).toBeNull();
  });
});

describe("mapType — plan R3, every row", () => {
  it.each<[string, "incoming" | "outgoing", string, ReturnType<typeof mapType>]>([
    ["outgoing Answered", "outgoing", "Answered", { kind: "attempt", result: "answered" }],
    ["outgoing Unanswered", "outgoing", "Unanswered", { kind: "attempt", result: "no_answer" }],
    ["outgoing Busy", "outgoing", "Busy", { kind: "attempt", result: "no_answer" }],
    ["outgoing Abandoned before ringing", "outgoing", "Abandoned before ringing", { kind: "not_attempt" }],
    ["outgoing Failed", "outgoing", "Failed", { kind: "not_attempt" }],
    ["incoming Answered", "incoming", "Answered", { kind: "attempt", result: "answered" }],
    ["incoming Missed", "incoming", "Missed", { kind: "not_attempt" }],
    ["incoming Voicemail", "incoming", "Voicemail", { kind: "not_attempt" }],
    ["incoming Abandoned before ringing", "incoming", "Abandoned before ringing", { kind: "not_attempt" }],
    ["the webhook sample's lower case", "incoming", "answered", { kind: "attempt", result: "answered" }],
    ["padding and doubled spaces", "outgoing", "  abandoned   BEFORE ringing ", { kind: "not_attempt" }],
    ["incoming Unanswered (not in the table)", "incoming", "Unanswered", { kind: "unknown" }],
    ["incoming Busy (not in the table)", "incoming", "Busy", { kind: "unknown" }],
    ["outgoing Missed (not in the table)", "outgoing", "Missed", { kind: "unknown" }],
    ["outgoing Voicemail (not in the table)", "outgoing", "Voicemail", { kind: "unknown" }],
    ["an empty type", "outgoing", "", { kind: "unknown" }],
    ["something new", "outgoing", "Transferred", { kind: "unknown" }],
  ])("%s", (_label, direction, type, expected) => {
    expect(mapType(direction, type)).toEqual(expected);
  });

  it("never maps to 04's voicemail or wrong_number (BAI's own picks)", () => {
    const results = ["Answered", "Unanswered", "Busy", "Voicemail", "Missed", "Failed"].flatMap((t) =>
      (["incoming", "outgoing"] as const).map((d) => mapType(d, t)),
    );
    expect(results.filter((r) => r.kind === "attempt").map((r) => (r.kind === "attempt" ? r.result : ""))).not.toContain("voicemail");
  });
});

const HOST_ZONES = ["UTC", "Etc/GMT-11", "America/New_York"] as const;

describe.each(HOST_ZONES)("startedAtOf with the host in %s (R6)", (zone) => {
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env.TZ;
    process.env.TZ = zone;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  });

  it("reads the date and time as UTC", () => {
    expect(startedAtOf("2027-02-09", "14:03:00")).toBe("2027-02-09T14:03:00.000Z");
  });

  it("across 28 Mar 2027: 00:30 UTC is 00:30 London, 01:30 UTC is 02:30 London (24-hour, §9 row 14)", () => {
    const before = startedAtOf("2027-03-28", "00:30:00") as string;
    const after = startedAtOf("2027-03-28", "01:30:00") as string;
    expect(before).toBe("2027-03-28T00:30:00.000Z");
    expect(after).toBe("2027-03-28T01:30:00.000Z");
    expect(londonLabel(before)).toBe("Sun 28 Mar, 00:30 (London time)");
    expect(londonLabel(after)).toBe("Sun 28 Mar, 02:30 (London time)");
  });

  it("across 31 Oct 2027: 00:30 UTC is 01:30 London (BST), 01:30 UTC is 01:30 London (GMT)", () => {
    expect(londonLabel(startedAtOf("2027-10-31", "00:30:00") as string)).toBe("Sun 31 Oct, 01:30 (London time)");
    expect(londonLabel(startedAtOf("2027-10-31", "01:30:00") as string)).toBe("Sun 31 Oct, 01:30 (London time)");
  });

  it.each([
    ["2027-02-30", "10:00:00"],
    ["2027-02-09", "24:00:00"],
    ["2027-02-09", "14:60:00"],
    ["2027-13-01", "10:00:00"],
    ["09/02/2027", "14:03:00"],
    ["2027-02-09", "2pm"],
  ])("refuses %s %s", (date, time) => {
    expect(startedAtOf(date, time)).toBeNull();
  });
});

describe("mapCall", () => {
  it("maps an outgoing answered call", () => {
    expect(mapCall(CALL)).toEqual({
      ok: true,
      value: {
        callSid: "CAtest0001", justcallId: "1786000001", direction: "outgoing", type: "Answered", mappedResult: "answered",
        durationSeconds: 372, startedAt: "2027-02-09T14:03:00.000Z", contactNumber: "447700900517",
        justcallNumber: "447700900990", agentEmail: "agent@example.test", disposition: null, notes: null,
      },
    });
  });

  it("keeps a not-an-attempt call with no result (D7)", () => {
    const mapped = mapCall({ ...CALL, direction: "Incoming", type: "Missed", durationSeconds: 0 });
    expect(mapped.ok && mapped.value.mappedResult).toBeNull();
    expect(mapped.ok && mapped.value.direction).toBe("incoming");
  });

  it("refuses an unknown type, naming it (the ledger says ignored with the type)", () => {
    expect(mapCall({ ...CALL, type: "Transferred" })).toEqual({ ok: false, code: "unknown_type: Transferred" });
  });

  it("clips a long unknown type in its code", () => {
    const result = mapCall({ ...CALL, type: "x".repeat(400) });
    expect(!result.ok && result.code.length).toBeLessThanOrEqual(80);
  });

  it("refuses an unknown direction and an impossible time", () => {
    expect(mapCall({ ...CALL, direction: "sideways" })).toEqual({ ok: false, code: "unknown_direction" });
    expect(mapCall({ ...CALL, callDate: "2027-02-30" })).toEqual({ ok: false, code: "bad_call_time" });
  });

  it("clips stored text to amendment 20's limits, by character", () => {
    const long = "é".repeat(2500);
    const mapped = mapCall({ ...CALL, notes: long, disposition: long, contactNumber: "4".repeat(60), justcallNumber: "9".repeat(60), agentEmail: `${"a".repeat(400)}@example.test`, justcallId: "1".repeat(60) });
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(Array.from(mapped.value.notes ?? "")).toHaveLength(2000);
    expect(Array.from(mapped.value.disposition ?? "")).toHaveLength(200);
    expect(mapped.value.contactNumber).toHaveLength(40);
    expect(mapped.value.justcallNumber).toHaveLength(40);
    expect(mapped.value.agentEmail).toHaveLength(320);
    expect(mapped.value.justcallId).toHaveLength(40);
  });

  it("never splits a character in two when clipping", () => {
    const mapped = mapCall({ ...CALL, notes: "😀".repeat(2100) });
    expect(mapped.ok && Array.from(mapped.value.notes ?? "").every((ch) => ch === "😀")).toBe(true);
  });
});
