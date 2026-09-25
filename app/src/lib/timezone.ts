/**
 * Sydney timezone utilities.
 * All datetimes on Baby Bloom are in Australia/Sydney time — no local conversions.
 */

const SYDNEY_TZ = 'Australia/Sydney';

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
 * Format an ISO date string for display in Sydney time.
 * e.g. "Mon, 3 Mar, 5:45 pm"
 */
export function formatSydneyDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-GB', {
    timeZone: SYDNEY_TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Format just the date part in Sydney time. e.g. "3 Mar 2026"
 */
export function formatSydneyDateOnly(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-GB', {
    timeZone: SYDNEY_TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Convert a Sydney date + time to a UTC ISO string.
 * This is the core timezone conversion — all other conversions go through here.
 *
 * @param date - Sydney date string "YYYY-MM-DD"
 * @param hour - Sydney hour (0-23)
 * @param minute - Sydney minute (0-59)
 * @returns UTC ISO string e.g. "2026-03-04T06:45:00.000Z"
 */
export function sydneyToUTC(date: string, hour: number, minute: number): string {
  // Parse the date parts
  const [year, month, day] = date.split('-').map(Number);

  // Create a UTC date with the Sydney time values (as if they were UTC)
  const asUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));

  // Get Sydney's UTC offset at roughly this time by comparing formatted outputs
  const utcParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).formatToParts(asUtc);

  const sydParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SYDNEY_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).formatToParts(asUtc);

  const get = (parts: Intl.DateTimeFormatPart[], type: string) => {
    const val = parts.find(p => p.type === type)?.value || '0';
    return parseInt(val === '24' ? '0' : val, 10);
  };

  // Calculate the difference in minutes between Sydney and UTC formatted values
  const utcTotalMins =
    get(utcParts, 'year') * 525960 +
    get(utcParts, 'month') * 43800 +
    get(utcParts, 'day') * 1440 +
    get(utcParts, 'hour') * 60 +
    get(utcParts, 'minute');

  const sydTotalMins =
    get(sydParts, 'year') * 525960 +
    get(sydParts, 'month') * 43800 +
    get(sydParts, 'day') * 1440 +
    get(sydParts, 'hour') * 60 +
    get(sydParts, 'minute');

  const offsetMinutes = sydTotalMins - utcTotalMins;

  // The user meant this time in Sydney, so subtract Sydney's offset to get UTC
  const utcMs = asUtc.getTime() - (offsetMinutes * 60 * 1000);

  return new Date(utcMs).toISOString();
}

/**
 * Get the next 7 days starting from tomorrow in Sydney time.
 * Returns array of { date: "YYYY-MM-DD", label: "Tue 4 Mar" }
 */
export function getNext7Days(): { date: string; dayLabel: string; dateLabel: string }[] {
  const days: { date: string; dayLabel: string; dateLabel: string }[] = [];
  const now = new Date();

  for (let i = 1; i <= 7; i++) {
    const future = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);

    // Format in Sydney timezone
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: SYDNEY_TZ,
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
      timeZone: SYDNEY_TZ,
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
