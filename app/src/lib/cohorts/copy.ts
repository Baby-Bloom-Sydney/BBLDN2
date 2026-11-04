/**
 * Every word brief 02 puts on a screen (§0.1–§0.12, §3), in one place so the tests pin them. Pure, client-safe.
 * Lines for states the brief doesn't word (a failed read, a refusal code) say plainly what happened.
 *
 * BB-wave1-041126/02-build, 2026-11-04.
 */

import { formatCohortDate, formatCohortShort, formatDayMonth } from "./dates";
import type { CallsFigure, CohortView, CohortWarning, CurrentCohortSummary, FamilyRow, PaidBy, PreBookedFigure } from "./types";

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export const EMPTY_STATE = "No cohorts yet. Set the first start date to begin.";
export const INVALID_DATE = "Enter the first start date.";
export const INVALID_REPEAT = "Repeat every 1 to 12 weeks.";
export const INVALID_PLACES = "Places must be a whole number from 0 to 99.";
export const INVALID_REASON = "A short reason is required (3 to 500 characters).";
export const ALREADY_REOPENED = "Already re-opened";

export const firstAheadLine = (first: string): string => `No current cohort. The first cohort opens ${formatCohortDate(first)}.`;

export const rowLine = (v: CohortView): string => `${plural(v.places, "place", "places")} · ${v.taken} taken · ${v.left} left`;

export const cardHeadline = (v: CohortView): string => `Cohort starting ${formatCohortDate(v.start)} · ${rowLine(v)}`;

export const beingPaidLine = (n: number): string => `${n} being paid now`;

export const overByLine = (n: number): string => `Over by ${n}`;

export const goodwillLine = (n: number): string => `${plural(n, "goodwill place", "goodwill places")} taken`;

/** The sentence BAI reads on the call (§0.3); "not connected yet" until 04's counts are known (§0.12). */
export function callsSentence(left: number, calls: CallsFigure): string {
  if (calls.kind === "not_connected") return "Calls: not connected yet";
  if (calls.kind === "unavailable") return "Calls: could not be read";
  const { booked, notBooked } = calls.counts;
  const families = plural(booked + notBooked, "more family", "more families");
  return `${plural(left, "place", "places")} left and ${families} to call this week (${booked} booked · ${notBooked} not booked).`;
}

export function preBookedLine(figure: PreBookedFigure): string {
  if (figure.kind === "not_connected") return "Pre-booked calls: not connected yet";
  if (figure.kind === "unavailable") return "Pre-booked calls: could not be read";
  return plural(figure.count, "pre-booked call", "pre-booked calls");
}

/** §0.4: "3 places are already taken or being paid for. Set at least 3." */
export const belowTakenMessage = (n: number): string =>
  `${n === 1 ? "1 place is" : `${n} places are`} already taken or being paid for. Set at least ${n}.`;

/** 04's call page (plan §8): "Current cohort: 2 of 5 places left". */
export const placesLeftLine = (v: CohortView): string => `Current cohort: ${v.left} of ${v.places} places left`;

/** The family's Done-for-you panel (§3 "Admin, elsewhere"); null renders no line (flag off). */
export function panelLine(summary: CurrentCohortSummary): string | null {
  switch (summary.kind) {
    case "current":
      return `Current cohort: starts ${formatCohortShort(summary.view.start)} · ${summary.view.left} of ${summary.view.places} left`;
    case "first_ahead":
      return `Current cohort: none yet · the first starts ${formatCohortShort(summary.first)}`;
    case "not_set_up":
      return "Current cohort: not set up yet";
    case "error":
      return "Current cohort: could not be read";
    case "off":
      return null;
  }
}

export function paidByLabel(paidBy: PaidBy | null): string {
  if (paidBy === "card") return "Card";
  if (paidBy === "bank_transfer") return "Bank transfer";
  return "—";
}

/** §0.8: "Re-opened 3 Feb — moved abroad". */
export function familyStateLine(row: FamilyRow): string {
  if (row.state === "held") return "Being paid now";
  if (row.state === "taken") return "Taken";
  return `Re-opened ${row.reopenedAt ? formatDayMonth(row.reopenedAt) : "—"} — ${row.reopenReason ?? ""}`.trimEnd();
}

export function warningLine(w: CohortWarning): string {
  if (w.kind === "refunded_but_held") return `Deposit refunded but place still held: ${w.name}`;
  if (w.kind === "paid_without_place") return `Deposit paid but no place: ${w.name}`;
  return `Over by ${w.overBy}: cohort starting ${formatCohortDate(w.cohortStartDate)}`;
}

const ACTION_ERRORS: Readonly<Record<string, string>> = {
  already_reopened: ALREADY_REOPENED,
  cohorts_disabled: "Cohorts are switched off.",
  not_authorized: "Admins only.",
  past_cohort: "A past cohort can't be changed.",
  not_a_cohort: "That date isn't a cohort.",
  not_taken: "Only a taken place can be re-opened.",
  not_found: "That place no longer exists.",
};

/** The amber line for a refusal code with no message of its own. */
export function actionErrorMessage(code: string): string {
  return ACTION_ERRORS[code] ?? "That didn't save — try again.";
}
