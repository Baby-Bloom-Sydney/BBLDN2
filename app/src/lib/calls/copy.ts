/**
 * Every call-booking string, as placeholders (plan §3d; brief §0, §3). BAI edits the wording before switch-on
 * (brief §10) — only the call's name is fixed: parents see **"Complimentary matchmaker call"**, admin says
 * "matchmaker call" (BAI 2026-11-04).
 *
 * Rules (pinned by `copy.test.ts`): nothing says "intro" (it means the nanny meet-and-greet); nothing says the
 * placement is free (matchmaking is free, the placement is paid; `BUILD/12-copy-fix.md` §2); parent-facing text
 * never says "tracking".
 *
 * BB-wave1-041126/04a-core, 2026-11-04.
 */

import type { SlotWords } from "./slot-words";

export const CALL_NAME = "Complimentary matchmaker call";
export const LONDON_TIME_SUFFIX = "(London time)";

export const PARENT_COPY = Object.freeze({
  pageHeading: `Your ${CALL_NAME}`,
  signupLine: `Next: your ${CALL_NAME}, to introduce you to your top nannies.`,
  taken: "That time has just gone — pick another",
  holdExpired: "Your hold ran out — pick again",
  afterNoAnswer: "We tried to call you — pick another time",
  noTimes: `No times free right now — we'll still call you for your ${CALL_NAME}.`,
  loadFailed: `We couldn't load the times — we'll still call you for your ${CALL_NAME}`,
  rateLimited: "Too many changes — try again in a while",
  hubNotBooked: `Pick a time for your ${CALL_NAME}`,
  chooseThisTime: "Choose this time",
  changeTime: "Change time",
  cancel: "Cancel",
  change: "Change",
  goToMatches: "Go to my matches",
  retry: "Retry",
});

export const ADMIN_COPY = Object.freeze({
  pageHeading: "Calls",
  calendarTab: "Calendar",
  sectionUpcoming: "Today and upcoming",
  sectionOverdue: "Overdue",
  sectionNotBooked: "Not booked — to call",
  sectionHistory: "History",
  tagBlockedOver: "Blocked over — move or cancel",
  tagOverdue: "Overdue",
  tagCohortPrebook: "Cohort pre-book",
  tagTest: "Test",
  noPosition: "No position yet",
  stopCallingWhileBooked: "Cancel the booked time first",
  bookOnBehalf: "Book a matchmaker call",
  overlappingHours: "Those hours overlap — change one range",
  startCallBooking: "Start call booking",
});

/** "Your Complimentary matchmaker call is on Tuesday 9 February at 14:00 (London time)" */
export function bookedLine(words: Pick<SlotWords, "day" | "time">): string {
  return `Your ${CALL_NAME} is on ${words.day} at ${words.time} ${LONDON_TIME_SUFFIX}`;
}

/** The hub card: "Your Complimentary matchmaker call: Tue 9 Feb, 14:00 (London time)" */
export function hubBookedLine(words: Pick<SlotWords, "short">): string {
  return `Your ${CALL_NAME}: ${words.short} ${LONDON_TIME_SUFFIX}`;
}

/** A full cohort pre-book day (brief §11 Q9): "We'll call you on Monday 8 February" */
export function prebookFullLine(day: string): string {
  return `We'll call you on ${day}`;
}

/** "Calls still to make this week: 12 (8 booked · 4 not booked)" (brief §0.8). */
export function callsToMakeLine(counts: { readonly booked: number; readonly notBooked: number }): string {
  const total = counts.booked + counts.notBooked;
  return `Calls still to make this week: ${total} (${counts.booked} booked · ${counts.notBooked} not booked)`;
}

const days = (n: number): string => `${n} day${n === 1 ? "" : "s"}`;

/** The red banner (brief §0.13): "No free call times in the next 7 days." — the window is a setting. */
export function noFreeTimesLine(windowDays: number): string {
  return `No free call times in the next ${days(windowDays)}.`;
}

/** The amber banner (threshold is 04c's placeholder; OPEN §5a.4 leaves "slots running out" TBD). */
export function fewFreeTimesLine(windowDays: number): string {
  return `Free call times are running low in the next ${days(windowDays)}.`;
}
