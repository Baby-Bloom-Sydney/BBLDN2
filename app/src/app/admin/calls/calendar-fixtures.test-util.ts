/**
 * Test-only: one Calendar view for the Calendar tab's UI tests (BB-wave1-041126/04c2-build), built by the real
 * `calendarViewOf` so the cells are the ones the server draws. Thursday 4 February 2027, 10:00 London.
 *
 *   hours    Monday 09:00–12:00 and 13:00–17:00; Friday 09:00–19:00; Saturday 10:00–14:00
 *   blocks   Friday 5 February 09:00–11:00 "dentist" (over Jane's booked call); Mon 15 – Fri 19 February "holiday"
 *   calls    Jane Smith booked Friday 10:00 (blocked over); Ola Brown booked Monday 8 February 14:00;
 *            a live hold on Saturday 6 February 11:00
 */
import { calendarViewOf, type CalendarView } from "@/lib/calls/calendar";
import { bookingRow } from "@/lib/calls/fake-calls-repo.test-util";
import { CALL_SETTINGS_DEFAULTS } from "@/lib/calls/settings";
import type { CallBlock, WeeklyHoursRange } from "@/lib/calls/types";

export const CAL_NOW = new Date("2027-02-04T10:00:00.000Z");
export const JANE_ID = "b0400000-0000-4000-8000-000000000011";
export const OLA_ID = "b0400000-0000-4000-8000-000000000012";
export const DENTIST_ID = "d0400000-0000-4000-8000-000000000001";
export const HOLIDAY_ID = "d0400000-0000-4000-8000-000000000002";

const HOURS: readonly WeeklyHoursRange[] = [
  { weekday: 1, startMinute: 540, endMinute: 720 },
  { weekday: 1, startMinute: 780, endMinute: 1020 },
  { weekday: 5, startMinute: 540, endMinute: 1140 },
  { weekday: 6, startMinute: 600, endMinute: 840 },
];

const BLOCKS: readonly CallBlock[] = [
  { id: DENTIST_ID, startsAt: "2027-02-05T09:00:00.000Z", endsAt: "2027-02-05T11:00:00.000Z", reason: "dentist" },
  { id: HOLIDAY_ID, startsAt: "2027-02-15T09:00:00.000Z", endsAt: "2027-02-19T18:00:00.000Z", reason: "holiday" },
];

const BOOKINGS = [
  bookingRow({ parentUserId: JANE_ID, startsAt: "2027-02-05T10:00:00.000Z" }),
  bookingRow({ parentUserId: OLA_ID, startsAt: "2027-02-08T14:00:00.000Z" }),
  bookingRow({ parentUserId: OLA_ID, startsAt: "2027-02-06T11:00:00.000Z", status: "held", holdExpiresAt: "2027-02-04T10:05:00.000Z", bookedAt: null, purpose: "cohort_prebook" }),
];

const NAMES = new Map([
  [JANE_ID, "Jane Smith"],
  [OLA_ID, "Ola Brown"],
]);

/** Not started yet: Start call booking shows its button. */
export const CALENDAR: CalendarView = calendarViewOf({ settings: CALL_SETTINGS_DEFAULTS, hours: HOURS, blocks: BLOCKS, bookings: BOOKINGS, names: NAMES, now: CAL_NOW });

/** Started on 1 February 2027: only the date. */
export const CALENDAR_STARTED: CalendarView = calendarViewOf({
  settings: { ...CALL_SETTINGS_DEFAULTS, enabledSince: "2027-02-01T09:00:00.000Z", slotMinutes: 45, callerNumber: "+442079460000" },
  hours: HOURS,
  blocks: BLOCKS,
  bookings: BOOKINGS,
  names: NAMES,
  now: CAL_NOW,
});
