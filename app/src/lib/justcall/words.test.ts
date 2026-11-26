/**
 * 05's words (plan 05 §5 B1; brief §0.5–§0.7, §0.9, §3 admin 6–7): History reads "JustCall · Outgoing · Answered ·
 * 6 min 12 s"; a webhook-made answered call with no outcome yet reads "Answered — outcome needed"; JustCall's notes and
 * disposition are lines of their own; the Unmatched list's number, reason and heading; one line per refusal.
 */
import { describe, expect, it } from "vitest";
import type { JustCallDetails } from "./types";
import {
  JUSTCALL_COPY,
  directionWord,
  durationWords,
  justcallAttempt,
  justcallErrorLine,
  needsOutcome,
  numberWords,
  unmatchedHeading,
  unmatchedReason,
  unmatchedView,
} from "./words";

const DETAILS: JustCallDetails = {
  callSid: "CAtest0001", direction: "outgoing", justcallType: "Answered", mappedResult: "answered", durationSeconds: 372,
  startedAt: "2027-02-09T14:03:00.000Z", notes: null, disposition: null,
};
const WEBHOOK = { result: "answered", outcome: null, recordedBy: null } as const;

describe("durationWords", () => {
  it.each([
    [372, "6 min 12 s"],
    [45, "45 s"],
    [60, "1 min"],
    [3725, "62 min 5 s"],
    [1, "1 s"],
  ])("%i → %s", (seconds, words) => {
    expect(durationWords(seconds)).toBe(words);
  });

  it.each([null, 0, -1, 1.5])("%j → nothing shown", (seconds) => {
    expect(durationWords(seconds)).toBeNull();
  });
});

describe("directionWord and needsOutcome", () => {
  it("names the direction", () => {
    expect(directionWord("outgoing")).toBe("Outgoing");
    expect(directionWord("incoming")).toBe("Incoming");
  });

  it.each([
    [WEBHOOK, true],
    [{ ...WEBHOOK, recordedBy: "admin-1" }, false],
    [{ ...WEBHOOK, outcome: "link_sent" }, false],
    [{ ...WEBHOOK, result: "no_answer" }, false],
    [{ ...WEBHOOK, result: null, outcome: "stop_calling" }, false],
  ] as const)("%j → %s", (entry, expected) => {
    expect(needsOutcome(entry)).toBe(expected);
  });
});

describe("justcallAttempt (an attempt's words with logging on)", () => {
  it("a webhook-made answered call: outcome needed (brief §0.6)", () => {
    expect(justcallAttempt(WEBHOOK, DETAILS)).toEqual({
      callSid: "CAtest0001",
      needsOutcome: true,
      what: "JustCall · Outgoing · Answered — outcome needed · 6 min 12 s",
      lines: [],
      summary: "JustCall · Outgoing · 6 min 12 s · Ref CAtest0001",
    });
  });

  it("once BAI's words are in: 04's words after JustCall's (brief §0.5)", () => {
    expect(justcallAttempt({ result: "answered", outcome: "link_sent", recordedBy: "admin-1" }, DETAILS).what).toBe("JustCall · Outgoing · Answered · Link sent · 6 min 12 s");
    expect(justcallAttempt({ result: "answered", outcome: null, recordedBy: "admin-1" }, DETAILS).what).toBe("JustCall · Outgoing · Answered · 6 min 12 s");
  });

  it("No answer with no time on the line; an incoming call says Incoming (Q3)", () => {
    expect(justcallAttempt({ result: "no_answer", outcome: null, recordedBy: null }, { ...DETAILS, durationSeconds: 0, mappedResult: "no_answer" }).what).toBe("JustCall · Outgoing · No answer");
    expect(justcallAttempt(WEBHOOK, { ...DETAILS, direction: "incoming", durationSeconds: 90 }).what).toBe("JustCall · Incoming · Answered — outcome needed · 1 min 30 s");
  });

  it("JustCall's notes and disposition are lines of their own, trimmed (brief §0.7, Q2)", () => {
    const a = justcallAttempt(WEBHOOK, { ...DETAILS, notes: "  wants Tuesdays ", disposition: "Link sent" });
    expect(a.lines).toEqual(["JustCall notes: wants Tuesdays", "JustCall disposition: Link sent"]);
    expect(justcallAttempt(WEBHOOK, { ...DETAILS, notes: "   ", disposition: "" }).lines).toEqual([]);
  });

  it("the summary leaves out a time it doesn't know", () => {
    expect(justcallAttempt(WEBHOOK, { ...DETAILS, durationSeconds: null }).summary).toBe("JustCall · Outgoing · Ref CAtest0001");
  });
});

describe("the Unmatched list's words", () => {
  it.each([
    ["447700900517", "+44 (0) 7700 900 517"],
    ["07700900517", "+44 (0) 7700 900 517"],
    ["12025550123", "+12025550123"],
    ["442079460000", "+442079460000"],
    [null, "Unknown number"],
    ["", "Unknown number"],
    ["anonymous", "Unknown number"],
  ])("number %j → %s", (raw, words) => {
    expect(numberWords(raw)).toBe(words);
  });

  it("the reasons, and the heading with its count", () => {
    expect(unmatchedReason("none")).toBe("No family with this number");
    expect(unmatchedReason("several")).toBe("Number on more than one family");
    expect(unmatchedHeading(3)).toBe("Unmatched JustCall calls (3)");
    expect(unmatchedHeading(0)).toBe("Unmatched JustCall calls (0)");
  });

  it("a call in words: London time, direction, result, length, reason", () => {
    expect(unmatchedView({ ...DETAILS, contactNumber: "447700900599", matchNote: "none" })).toEqual({
      callSid: "CAtest0001",
      number: "+44 (0) 7700 900 599",
      when: "Tue 9 Feb, 14:03 (London time)",
      direction: "Outgoing",
      result: "Answered",
      duration: "6 min 12 s",
      reason: "No family with this number",
    });
    expect(unmatchedView({ ...DETAILS, mappedResult: "no_answer", durationSeconds: null, contactNumber: null, matchNote: "several" })).toMatchObject({
      number: "Unknown number", result: "No answer", duration: "—", reason: "Number on more than one family",
    });
  });
});

describe("justcallErrorLine", () => {
  it.each([
    ["justcall_disabled", "JustCall logging is switched off."],
    ["not_unmatched", "That call has already been attached or dismissed — reload to see it."],
    ["not_a_parent", "That account isn't a family."],
    ["not_yours", "That call belongs to another family — reload to see it."],
    ["not_authorized", "Admins only."],
    ["invalid", "Check the result, outcome and time, then try again."],
    ["not_found", "That call has changed — reload to see it."],
    ["booked_call_exists", "Cancel the booked time first"],
    ["error", "That didn't save — try again."],
  ] as const)("%s → %s", (error, line) => {
    expect(justcallErrorLine(error)).toBe(line);
  });

  it("the copy is plain words", () => {
    expect(JUSTCALL_COPY.attach).toBe("Attach to family");
    expect(JUSTCALL_COPY.dismiss).toBe("Dismiss");
    expect(JUSTCALL_COPY.addOutcome).toBe("Add outcome");
  });
});
