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
  // 04b: the call page (BB-wave1-041126/04b-build)
  // W14 (BAI 2026-11-05): parents are never told "London time" — "this is just a given". Times are still London.
  pageIntro: "Pick a time and we'll call you then.",
  pickHeading: "Pick a time",
  pickHint: "Choose a time, then confirm it. We'll hold it for you while you do.",
  confirmTime: "Confirm this time",
  pickAnother: "Pick another time",
  keepTime: "Keep my time",
  notSet: "We couldn't do that — try again",
  cancelQuestion: "Cancel your call?",
  confirmCancel: "Yes, cancel it",
  keepCall: "Keep it",
  cancelledStatus: "Your call is cancelled — we'll still call you, or pick a new time.",
  noLongerAvailable: "no longer available",
  // 04b rework W4: the picker in the meet-and-greet grid's style (BB-wave1-041126/04b-rework)
  availability: "Your matchmaker's availability",
  selectTime: "Select a time",
  confirmTimeButton: "Confirm time",
  confirming: "Confirming...",
  skipForNow: "Skip for now",
  takenTitle: "This time has just been booked",
  // 04b rework W5: the booked slide (BB-wave1-041126/04b-rework)
  youreBooked: "You're booked",
  goToChildcare: "Go to my childcare",
  goToDashboard: "Go to my dashboard",
  // 04b rework W9: the Childcare tab card (BB-wave1-041126/04b-rework)
  bookATime: "Book a time",
  // 04b rework W11: a parent with no position yet — BAI 2026-11-05, the line verbatim (W15: her button is "Confirm time")
  completePositionLine: "Complete your childcare position so that we can confirm your call with your matchmaker.",
  // 04b rework W12: the taken notice when the time that went isn't known
  thatTime: "that time",
  // 04b rework W15: the position flow's intro on the call path (BAI 2026-11-05, verbatim)
  positionIntro: "Create your childcare position to get your best matches",
  // 04b rework W14: the step-by-step picker
  timeOfDay: "Time of day",
  yourCurrentTime: "your current time",
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

/** Parent-facing (W14: no "London time"): "Your Complimentary matchmaker call is on Tuesday 9 February at 14:00" */
export function bookedLine(words: Pick<SlotWords, "day" | "time">): string {
  return `Your ${CALL_NAME} is on ${words.day} at ${words.time}`;
}

/** The held time (04b; W14 no "London time"): "We're holding Tuesday 9 February, 14:00 for you until 10:05." */
export function heldLine(words: Pick<SlotWords, "day" | "time">, until: string): string {
  return `We're holding ${words.day}, ${words.time} for you until ${until}.`;
}

/** The picker's green panel (04b rework W4): "Tuesday 9 February at 14:00". */
export function slotAtLine(words: Pick<SlotWords, "day" | "time">): string {
  return `${words.day} at ${words.time}`;
}

/** The taken notice (04b rework W4, BAI 2026-11-05): "Someone else booked Tuesday 9 February at 14:00 a moment ago. …" */
export function takenNoticeLine(when: string): string {
  return `Someone else booked ${when} a moment ago. Please pick another time.`;
}

/** The booked slide (04b rework W5): "We'll call you on 07700 900123." */
export function callOnLine(mobile: string): string {
  return `We'll call you on ${mobile}.`;
}

/** Her booking, at the top while she changes it (04b rework W5, W12; W14 no "London time"): "Your call: Thursday 5 November at 10:00". */
export function yourCallLine(at: string): string {
  return `Your call: ${at}`;
}

/** Announced once she has booked (04b): "Done — Your Complimentary matchmaker call is on …." */
export function doneLine(bookedText: string): string {
  return `Done — ${bookedText}.`;
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
