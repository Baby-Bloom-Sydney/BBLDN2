/**
 * Timezone utilities for the app's home zone.
 * All datetimes on BabyBloom are in `APP_TZ` — no per-user conversions.
 */

import { APP_TZ } from '@/lib/constants';

// ── Time Brackets ──

export const TIME_BRACKETS = {
  morning: { label: 'Morning', sublabel: '8am – 11am', startHour: 8, endHour: 11 },
  midday: { label: 'Midday', sublabel: '11am – 2pm', startHour: 11, endHour: 14 },
  afternoon: { label: 'Afternoon', sublabel: '2pm – 5pm', startHour: 14, endHour: 17 },
  evening: { label: 'Evening', sublabel: '5pm – 8pm', startHour: 17, endHour: 20 },
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

/**
 * Convert a local (`APP_TZ`) date + time to a UTC ISO string.
 * This is the core timezone conversion — all other conversions go through here.
 *
 * @param date - local date string "YYYY-MM-DD"
 * @param hour - local hour (0-23)
 * @param minute - local minute (0-59)
 * @returns UTC ISO string e.g. "2026-03-04T06:45:00.000Z"
 */
export function localToUTC(date: string, hour: number, minute: number): string {
  // Parse the date parts
  const [year, month, day] = date.split('-').map(Number);

  // Create a UTC date with the local time values (as if they were UTC)
  const asUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));

  // Get the home zone's UTC offset at roughly this time by comparing formatted outputs
  const utcParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).formatToParts(asUtc);

  const localParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).formatToParts(asUtc);

  const get = (parts: Intl.DateTimeFormatPart[], type: string) => {
    const val = parts.find(p => p.type === type)?.value || '0';
    return parseInt(val === '24' ? '0' : val, 10);
  };

  // Calculate the difference in minutes between local and UTC formatted values
  const utcTotalMins =
    get(utcParts, 'year') * 525960 +
    get(utcParts, 'month') * 43800 +
    get(utcParts, 'day') * 1440 +
    get(utcParts, 'hour') * 60 +
    get(utcParts, 'minute');

  const localTotalMins =
    get(localParts, 'year') * 525960 +
    get(localParts, 'month') * 43800 +
    get(localParts, 'day') * 1440 +
    get(localParts, 'hour') * 60 +
    get(localParts, 'minute');

  const offsetMinutes = localTotalMins - utcTotalMins;

  // The user meant this time locally, so subtract the local offset to get UTC
  const utcMs = asUtc.getTime() - (offsetMinutes * 60 * 1000);

  return new Date(utcMs).toISOString();
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
 * Returns array of { hour, minute, label } e.g. { hour: 14, minute: 30, label: "2:30 PM" }
 */
export function getBracketTimeOptions(bracket: BracketKey): { hour: number; minute: number; label: string }[] {
  const { startHour, endHour } = TIME_BRACKETS[bracket];
  const options: { hour: number; minute: number; label: string }[] = [];

  for (let h = startHour; h < endHour; h++) {
    for (let m = 0; m < 60; m += 15) {
      const period = h >= 12 ? 'PM' : 'AM';
      const displayHour = h > 12 ? h - 12 : (h as number) === 0 ? 12 : h;
      const displayMin = m.toString().padStart(2, '0');
      options.push({
        hour: h,
        minute: m,
        label: `${displayHour}:${displayMin} ${period}`,
      });
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
