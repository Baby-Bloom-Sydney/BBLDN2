/**
 * A call time as the words people read (plan A3 → §12 R24: call-specific wrappers only, on the one London clock;
 * R20's short form for the hub card).
 *
 * Always London (`APP_TZ`), always the 24-hour clock (`hourCycle: "h23"`; `one-clock.test.ts`). Each label is
 * assembled from `formatToParts`, because ICU versions disagree about en-GB's comma (plan R6).
 *
 *   day   "Tuesday 9 February"     time  "14:00"
 *   short "Tue 9 Feb, 14:00"       full  "Tuesday 9 February, 14:00 (London time)"
 *
 * BB-wave1-041126/04a-core, 2026-11-04.
 */

import { APP_LOCALE, APP_TZ } from "@/lib/constants";
import { londonDateOf, londonWallClockOf } from "@/lib/timezone";
import { LONDON_TIME_SUFFIX } from "./copy";

export interface SlotWords {
  readonly londonDate: string;
  readonly weekday: string;
  readonly date: string;
  readonly day: string;
  readonly time: string;
  readonly short: string;
  readonly full: string;
}

const LONG = new Intl.DateTimeFormat(APP_LOCALE, { timeZone: APP_TZ, weekday: "long", day: "numeric", month: "long" });
const SHORT = new Intl.DateTimeFormat(APP_LOCALE, { timeZone: APP_TZ, weekday: "short", day: "numeric", month: "short" });
const CLOCK = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function partsOf(format: Intl.DateTimeFormat, at: Date): (type: Intl.DateTimeFormatPartTypes) => string {
  const parts = format.formatToParts(at);
  return (type) => parts.find((p) => p.type === type)?.value ?? "";
}

export function slotWords(startsAt: string): SlotWords {
  const at = new Date(startsAt);
  const long = partsOf(LONG, at);
  const short = partsOf(SHORT, at);
  const clock = partsOf(CLOCK, at);
  const time = `${clock("hour")}:${clock("minute")}`;
  const date = `${long("day")} ${long("month")}`;
  const day = `${long("weekday")} ${date}`;
  return Object.freeze({
    londonDate: londonDateOf(at),
    weekday: long("weekday"),
    date,
    day,
    time,
    short: `${short("weekday")} ${short("day")} ${short("month")}, ${time}`,
    full: `${day}, ${time} ${LONDON_TIME_SUFFIX}`,
  });
}

/** A London date's words for the picker's row (04b rework W4): "Tue" over "9 Feb", and its full "Tuesday 9 February". */
export interface DayWords {
  readonly weekday: string;
  readonly date: string;
  readonly legend: string;
}

export function dayWords(londonDate: string): DayWords {
  // Midday UTC is the same calendar date in London in every season.
  const at = new Date(`${londonDate}T12:00:00.000Z`);
  const long = partsOf(LONG, at);
  const short = partsOf(SHORT, at);
  return Object.freeze({
    weekday: short("weekday"),
    date: `${short("day")} ${short("month")}`,
    legend: `${long("weekday")} ${long("day")} ${long("month")}`,
  });
}

/** A slot's hour on the London 24-hour clock (for its time-of-day column). */
export function slotHour(startsAt: string): number {
  return londonWallClockOf(startsAt).hour;
}
