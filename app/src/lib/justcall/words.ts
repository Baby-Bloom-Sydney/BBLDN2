/**
 * 05's words on /admin/calls (plan 05 §5 B1; brief §0.5–§0.7, §0.9, §3 admin 6–7). Pure; safe in client components.
 *
 * - An attempt made through JustCall reads "JustCall · Outgoing · Answered · 6 min 12 s": JustCall, the direction,
 *   04's own words for the result and outcome, then the call's length (none for a call with no talk time).
 * - A webhook-made answered call with no outcome yet reads "Answered — outcome needed" until BAI adds his words.
 * - JustCall's notes and disposition are lines of their own (admin only, Q2).
 * - The Unmatched list: the number as dialled (a UK mobile in 04's display form), the London time, why it is Unmatched.
 * - One line per action refusal; the codes 04 shares keep 04's words.
 *
 * BB-wave2-231126/05-build, 2026-11-26.
 */

import { adminErrorLine } from "@/lib/calls/copy";
import { attemptWords, londonLabel } from "@/lib/calls/dashboard-row";
import { resultLabel } from "@/lib/calls/outcomes";
import type { CallOutcomeCode, CallResultCode } from "@/lib/calls/types";
import { formatUkMobile, isUkMobile } from "@/lib/uk-contact";
import type { JustCallActionError, JustCallAttempt, JustCallDetails, UnmatchedCall, UnmatchedCallView } from "./types";

export const JUSTCALL_COPY = Object.freeze({
  brand: "JustCall",
  outcomeNeeded: "Answered — outcome needed",
  notesPrefix: "JustCall notes:",
  dispositionPrefix: "JustCall disposition:",
  reference: "Ref",
  unknownNumber: "Unknown number",
  reasonNone: "No family with this number",
  reasonSeveral: "Number on more than one family",
  unmatchedTitle: "Unmatched JustCall calls",
  unmatchedFailed: "The JustCall calls could not be read — reload to try again.",
  unmatchedMore: "Showing the newest 100.",
  colNumber: "Number",
  colWhen: "When",
  colDirection: "Direction",
  colResult: "Result",
  colLength: "Length",
  colReason: "Why",
  colActions: "Actions",
  attach: "Attach to family",
  dismiss: "Dismiss",
  dismissConfirm: "Dismiss this call? It leaves the list.",
  keep: "Keep",
  attachTitle: "Attach this call to a family",
  attachSearchLabel: "Family name or mobile",
  search: "Search",
  searching: "Searching…",
  noFamilyFound: "No family found.",
  searchHint: "Type at least 2 letters of a name, or a mobile.",
  attachAction: (name: string) => `Attach to ${name}`,
  attached: "Attached.",
  dismissed: "Dismissed.",
  addOutcome: "Add outcome",
  close: "Close",
});

/** A full `Record`, so a new refusal code fails to compile until it has words; the codes 04 shares keep 04's. */
const FAILURE_LINES: Readonly<Record<JustCallActionError, string>> = Object.freeze({
  justcall_disabled: "JustCall logging is switched off.",
  not_unmatched: "That call has already been attached or dismissed — reload to see it.",
  not_a_parent: "That account isn't a family.",
  not_yours: "That call belongs to another family — reload to see it.",
  not_authorized: adminErrorLine("not_authorized"),
  invalid: adminErrorLine("invalid"),
  not_found: adminErrorLine("not_found"),
  booked_call_exists: adminErrorLine("booked_call_exists"),
  error: adminErrorLine("error"),
});

/** One line per refusal. */
export function justcallErrorLine(error: JustCallActionError): string {
  return FAILURE_LINES[error];
}

/** "6 min 12 s", "45 s", "1 min"; null for no talk time (none, 0, or not a whole number of seconds). */
export function durationWords(seconds: number | null): string | null {
  if (seconds === null || !Number.isInteger(seconds) || seconds <= 0) return null;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest} s`;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

export function directionWord(direction: JustCallDetails["direction"]): string {
  return direction === "incoming" ? "Incoming" : "Outgoing";
}

interface EntryFacts {
  readonly result: CallResultCode | null;
  readonly outcome: CallOutcomeCode | null;
  readonly recordedBy: string | null;
}

/** Answered by the webhook (no one recorded it) with no outcome yet. */
export function needsOutcome(entry: EntryFacts): boolean {
  return entry.result === "answered" && entry.outcome === null && entry.recordedBy === null;
}

const joined = (parts: readonly (string | null)[]): string => parts.filter((p): p is string => p !== null && p !== "").join(" · ");

function lines(details: JustCallDetails): readonly string[] {
  const notes = details.notes?.trim() ?? "";
  const disposition = details.disposition?.trim() ?? "";
  return [
    ...(notes === "" ? [] : [`${JUSTCALL_COPY.notesPrefix} ${notes}`]),
    ...(disposition === "" ? [] : [`${JUSTCALL_COPY.dispositionPrefix} ${disposition}`]),
  ];
}

/** An attempt made through JustCall, in words (brief §0.5–§0.7). */
export function justcallAttempt(entry: EntryFacts, details: JustCallDetails): JustCallAttempt {
  const needed = needsOutcome(entry);
  const direction = directionWord(details.direction);
  const duration = durationWords(details.durationSeconds);
  return {
    callSid: details.callSid,
    needsOutcome: needed,
    what: joined([JUSTCALL_COPY.brand, direction, needed ? JUSTCALL_COPY.outcomeNeeded : attemptWords(entry), duration]),
    lines: lines(details),
    summary: joined([JUSTCALL_COPY.brand, direction, duration, `${JUSTCALL_COPY.reference} ${details.callSid}`]),
  };
}

/** The number as dialled: a UK mobile in the app's display form, any other number as "+digits". */
export function numberWords(contactNumber: string | null): string {
  const raw = contactNumber?.trim() ?? "";
  if (raw !== "" && isUkMobile(raw)) return formatUkMobile(raw);
  const digits = raw.replace(/^\+/, "");
  return /^\d{6,20}$/.test(digits) ? `+${digits}` : JUSTCALL_COPY.unknownNumber;
}

export function unmatchedReason(note: UnmatchedCall["matchNote"]): string {
  return note === "several" ? JUSTCALL_COPY.reasonSeveral : JUSTCALL_COPY.reasonNone;
}

export function unmatchedHeading(total: number): string {
  return `${JUSTCALL_COPY.unmatchedTitle} (${total})`;
}

export function unmatchedView(call: UnmatchedCall): UnmatchedCallView {
  return {
    callSid: call.callSid,
    number: numberWords(call.contactNumber),
    when: londonLabel(call.startedAt),
    direction: directionWord(call.direction),
    result: call.mappedResult === null ? "—" : resultLabel(call.mappedResult),
    duration: durationWords(call.durationSeconds) ?? "—",
    reason: unmatchedReason(call.matchNote),
  };
}
