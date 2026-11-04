/**
 * The outcome rules table (plan A5 + §12 R13; brief §11 Q4 vocabulary; amendment 19's CHECKs).
 * - An outcome needs Answered, except Stop calling.
 * - A result is needed, except with Stop calling.
 * - Answered closes the booking as done; every other result closes it as no answer.
 * - Only Deposit taken, Not going ahead, Pre-booked next cohort and Stop calling take the family out of the list.
 */
import { describe, expect, it } from "vitest";
import {
  CALL_OUTCOMES,
  CALL_RESULTS,
  bookingStatusAfter,
  checkOutcome,
  outcomeLabel,
  removesFromList,
  resultLabel,
} from "./outcomes";

describe("the vocabulary", () => {
  it("lists the four results and seven outcomes, with their admin labels", () => {
    expect(CALL_RESULTS.map(resultLabel)).toEqual(["Answered", "No answer", "Voicemail left", "Wrong number"]);
    expect(CALL_OUTCOMES.map(outcomeLabel)).toEqual([
      "Deposit taken",
      "Link sent",
      "Call back later",
      "Not going ahead",
      "Pre-booked next cohort",
      "Other",
      "Stop calling",
    ]);
  });
});

describe("bookingStatusAfter", () => {
  it.each([
    ["answered", "done"],
    ["no_answer", "no_answer"],
    ["voicemail", "no_answer"],
    ["wrong_number", "no_answer"],
  ] as const)("%s → booking %s", (result, status) => {
    expect(bookingStatusAfter(result)).toBe(status);
  });
});

describe("removesFromList (R13)", () => {
  it.each([
    ["deposit_taken", true],
    ["not_going_ahead", true],
    ["prebooked_next_cohort", true],
    ["stop_calling", true],
    ["call_back_later", false],
    ["link_sent", false],
    ["other", false],
    [null, false],
  ] as const)("%s → %s", (outcome, expected) => {
    expect(removesFromList(outcome)).toBe(expected);
  });
});

describe("checkOutcome — the SQL CHECKs, before the database sees them", () => {
  it.each([
    [{ result: "answered", outcome: "deposit_taken" }, true],
    [{ result: "answered", outcome: null }, true],
    [{ result: "no_answer", outcome: null }, true],
    [{ result: "no_answer", outcome: "stop_calling" }, true],
    [{ result: null, outcome: "stop_calling" }, true],
    [{ result: "no_answer", outcome: "call_back_later" }, false],
    [{ result: "voicemail", outcome: "deposit_taken" }, false],
    [{ result: null, outcome: null }, false],
    [{ result: null, outcome: "other" }, false],
  ] as const)("%j → ok %s", (input, ok) => {
    expect(checkOutcome(input)).toBe(ok);
  });
});
