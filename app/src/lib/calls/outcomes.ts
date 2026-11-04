/**
 * What can be recorded after a call, and what it does (plan A5 + §12 R13; brief §3 admin 3, §11 Q4). Pure.
 *
 * | Rule | Source |
 * |---|---|
 * | An outcome needs the result Answered — except Stop calling | `call_log_entries_outcome_needs_answer` |
 * | A result is needed — except with Stop calling | `call_log_entries_result_or_stop` |
 * | Answered closes the booking as `done`; any other result as `no_answer` | `call_record_outcome` |
 * | Only Deposit taken, Not going ahead, Pre-booked next cohort and Stop calling take the family out of the list | R13 |
 * | Stop calling is refused while a booked time exists ("Cancel the booked time first") | `booked_call_exists` |
 *
 * BB-wave1-041126/04a-core, 2026-11-04.
 */

import type { BookingStatus, CallOutcomeCode, CallResultCode } from "./types";

export const CALL_RESULTS: readonly CallResultCode[] = Object.freeze([
  "answered",
  "no_answer",
  "voicemail",
  "wrong_number",
] as const);

export const CALL_OUTCOMES: readonly CallOutcomeCode[] = Object.freeze([
  "deposit_taken",
  "link_sent",
  "call_back_later",
  "not_going_ahead",
  "prebooked_next_cohort",
  "other",
  "stop_calling",
] as const);

const RESULT_LABELS: Readonly<Record<CallResultCode, string>> = Object.freeze({
  answered: "Answered",
  no_answer: "No answer",
  voicemail: "Voicemail left",
  wrong_number: "Wrong number",
});

const OUTCOME_LABELS: Readonly<Record<CallOutcomeCode, string>> = Object.freeze({
  deposit_taken: "Deposit taken",
  link_sent: "Link sent",
  call_back_later: "Call back later",
  not_going_ahead: "Not going ahead",
  prebooked_next_cohort: "Pre-booked next cohort",
  other: "Other",
  stop_calling: "Stop calling",
});

const REMOVING: ReadonlySet<CallOutcomeCode> = new Set<CallOutcomeCode>([
  "deposit_taken",
  "not_going_ahead",
  "prebooked_next_cohort",
  "stop_calling",
]);

export const resultLabel = (result: CallResultCode): string => RESULT_LABELS[result];
export const outcomeLabel = (outcome: CallOutcomeCode): string => OUTCOME_LABELS[outcome];

/** The booked call's status once a result is recorded against it. */
export function bookingStatusAfter(result: CallResultCode): Extract<BookingStatus, "done" | "no_answer"> {
  return result === "answered" ? "done" : "no_answer";
}

/** Does this outcome take the family out of the to-call list (R13)? */
export function removesFromList(outcome: CallOutcomeCode | null): boolean {
  return outcome !== null && REMOVING.has(outcome);
}

/** The two CHECKs on `call_log_entries`, so a bad pair is refused before it reaches the database. */
export function checkOutcome(entry: { readonly result: CallResultCode | null; readonly outcome: CallOutcomeCode | null }): boolean {
  if (entry.outcome === "stop_calling") return true;
  if (entry.result === null) return false;
  return entry.outcome === null || entry.result === "answered";
}
