/**
 * Timezone utilities for the app's home zone.
 * All datetimes on BabyBloom are in `APP_TZ` — no per-user conversions.
 */

import { APP_LOCALE, APP_TZ } from '@/lib/constants';

// ── Time Brackets ──

// Sublabels read on the same 24-hour clock as the options inside them
// (`getBracketTimeOptions`): `ParentConnectionsClient` renders the sublabel as
// the header directly above that grid, so a 12-hour header over 24-hour options
// would put two clocks in one control. Display only — what is stored for a
// chosen slot is the bracket *key*, never this string.
export const TIME_BRACKETS = {
  morning: { label: 'Morning', sublabel: '08:00 – 11:00', startHour: 8, endHour: 11 },
  midday: { label: 'Midday', sublabel: '11:00 – 14:00', startHour: 11, endHour: 14 },
  afternoon: { label: 'Afternoon', sublabel: '14:00 – 17:00', startHour: 14, endHour: 17 },
  evening: { label: 'Evening', sublabel: '17:00 – 20:00', startHour: 17, endHour: 20 },
} as const;

export type BracketKey = keyof typeof TIME_BRACKETS;

export const BRACKET_KEYS: BracketKey[] = ['morning', 'midday', 'afternoon', 'evening'];

/**
 * Format an ISO date string for display in the app's home zone.
 * e.g. "Mon, 3 Mar, 17:45"
 */
export function formatLondonDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-GB', {
    timeZone: APP_TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ── The one London clock (BUILD/README § Wave 1 alignment, item 2) ──
//
// Every date and time rule in the app (cohort weeks, call slots, invoice weeks, the first week off the bill)
// reads these helpers, so they can never disagree about which Monday a week starts on. Each answer depends
// only on `APP_TZ`, never on the host's zone: CI runs UTC and a developer's machine may not.

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** `APP_TZ` wall-clock parts of an instant, on a 24-hour clock. */
const WALL_CLOCK = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
});

function wallClockOf(at: Date): { date: string; hour: number; minute: number; second: number } {
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    WALL_CLOCK.formatToParts(at).find((p) => p.type === type)?.value ?? '00';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    hour: Number(part('hour')),
    minute: Number(part('minute')),
    second: Number(part('second')),
  };
}

/** Minutes `APP_TZ` is ahead of UTC at an instant (London: 0 in GMT, 60 in BST). */
function zoneOffsetMinutes(at: Date): number {
  const wall = wallClockOf(at);
  const [year, month, day] = wall.date.split('-').map(Number);
  const wallAsUtc = Date.UTC(year, month - 1, day, wall.hour, wall.minute, wall.second);
  const wholeSeconds = Math.floor(at.getTime() / 1000) * 1000;
  return Math.round((wallAsUtc - wholeSeconds) / MINUTE_MS);
}

/**
 * Convert a local (`APP_TZ`) date + time to a UTC ISO string.
 * This is the core timezone conversion — all other conversions go through here.
 *
 * Two passes, because the offset that applies is the one *at* the instant, not at the naive guess: the second
 * pass catches a guess that landed on the far side of a clock change. A wall time the clocks skip (01:00–01:59
 * on the spring change) comes out an hour later, so check it with `wallClockExists` first. A repeated wall time
 * (the autumn change) gives the later of its two instants. Hardened 2026-11-04 (brief 04, LEDGER/B04): the
 * old version compared months as a fixed number of minutes and was hours out across a month end in BST.
 *
 * @param date - local date string "YYYY-MM-DD"
 * @param hour - local hour (0-23)
 * @param minute - local minute (0-59)
 * @returns UTC ISO string e.g. "2026-03-04T06:45:00.000Z"
 */
export function localToUTC(date: string, hour: number, minute: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const firstGuess = naive - zoneOffsetMinutes(new Date(naive)) * MINUTE_MS;
  const instant = naive - zoneOffsetMinutes(new Date(firstGuess)) * MINUTE_MS;
  return new Date(instant).toISOString();
}

/** Does this London wall-clock time happen at all? False only inside the hour the clocks skip in spring. */
export function wallClockExists(date: string, hour: number, minute: number): boolean {
  const back = wallClockOf(new Date(localToUTC(date, hour, minute)));
  return back.date === date && back.hour === hour && back.minute === minute;
}

/** The London calendar date ("YYYY-MM-DD") of an instant. */
export function londonDateOf(instant: Date | string): string {
  return wallClockOf(typeof instant === 'string' ? new Date(instant) : instant).date;
}

/** Today's London date. */
export function londonToday(now: Date = new Date()): string {
  return londonDateOf(now);
}

/** A London calendar date `days` later (negative for earlier). Calendar arithmetic, so clock changes don't matter. */
export function addLondonDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The Monday on or before a London date: every week in the app starts on it. */
export function londonMondayOf(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const daysSinceMonday = (new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay() + 6) % 7;
  return addLondonDays(date, -daysSinceMonday);
}

/** A half-open UTC range `[fromUtc, toUtc)`. */
export interface UtcRange {
  readonly fromUtc: string;
  readonly toUtc: string;
}

/** The London week holding `now`: Monday 00:00 to the next Monday 00:00, London time. */
export function londonWeekRange(now: Date = new Date()): UtcRange {
  const monday = londonMondayOf(londonDateOf(now));
  return { fromUtc: localToUTC(monday, 0, 0), toUtc: localToUTC(addLondonDays(monday, 7), 0, 0) };
}

/**
 * Get the next 7 days starting from tomorrow in the app's home zone.
 * Returns array of { date: "YYYY-MM-DD", label: "Tue 4 Mar" }
 */
export function getNext7Days(): { date: string; dayLabel: string; dateLabel: string }[] {
  const days: { date: string; dayLabel: string; dateLabel: string }[] = [];
  const now = new Date();

  for (let i = 1; i <= 7; i++) {
    const future = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);

    // Format in the app's home timezone
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: APP_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    }).formatToParts(future);

    const get = (type: string) => parts.find(p => p.type === type)?.value || '';

    const year = get('year');
    const month = get('month');
    const day = get('day');
    const weekday = get('weekday');

    // Month name for display
    const monthName = new Intl.DateTimeFormat('en-GB', {
      timeZone: APP_TZ,
      month: 'short',
    }).format(future);

    days.push({
      date: `${year}-${month}-${day}`,
      dayLabel: weekday,
      dateLabel: `${parseInt(day)} ${monthName}`,
    });
  }

  return days;
}

/**
 * Generate 15-minute interval time options within a bracket.
 * Returns array of { hour, minute, label } e.g. { hour: 14, minute: 30, label: "14:30" }
 */
export function getBracketTimeOptions(bracket: BracketKey): { hour: number; minute: number; label: string }[] {
  const { startHour, endHour } = TIME_BRACKETS[bracket];
  const options: { hour: number; minute: number; label: string }[] = [];

  for (let h = startHour; h < endHour; h++) {
    for (let m = 0; m < 60; m += 15) {
      options.push({ hour: h, minute: m, label: formatClockHourMinute(h, m) });
    }
  }

  return options;
}

/**
 * Determine which bracket a given hour falls into.
 */
export function getBracketForHour(hour: number): BracketKey | null {
  for (const [key, bracket] of Object.entries(TIME_BRACKETS)) {
    if (hour >= bracket.startHour && hour < bracket.endHour) {
      return key as BracketKey;
    }
  }
  return null;
}

// ── The one clock ──

/**
 * Render a **wall-clock** hour and minute on the locale's clock.
 *
 * `APP_LOCALE` is `en-GB`, so this is 24-hour: `19:47`, `06:00`, `00:15`. Every
 * time label in the app goes through here or through `formatClockTime` below,
 * so the nanny, the parent, the public share page, the outbound post and the
 * emails all read one job the same way (LDN2 W-12).
 *
 * `timeZone: 'UTC'` over a UTC-constructed date is deliberate and is **not** a
 * missing `APP_TZ`. The inputs here are already London wall-clock values — the
 * `start_time`/`end_time` `"HH:MM"` columns, or an hour a user picked out of a
 * grid. Formatting them through `APP_TZ` would apply the London offset a second
 * time and move every slot by an hour under BST. `APP_TZ` belongs on
 * **instants** (`formatLondonDate` above); this pair is for wall clocks.
 */
export function formatClockHourMinute(hour: number, minute: number): string {
  return new Date(Date.UTC(2000, 0, 1, hour, minute)).toLocaleTimeString(APP_LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

/**
 * Render an `"HH:MM"` wall-clock string on the locale's clock.
 * Anything that is not a time is returned unchanged, so a malformed column
 * value surfaces as itself rather than as `NaN:NaN`.
 */
export function formatClockTime(time: string): string {
  const [hRaw, mRaw] = time.split(':');
  const hour = Number(hRaw);
  const minute = Number(mRaw);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return time;
  return formatClockHourMinute(hour, minute);
}
