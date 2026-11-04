/**
 * The one weekday convention for calls: **ISO, 1 = Monday … 7 = Sunday** (plan A4; `call_weekly_hours.weekday`,
 * amendment 19). Pinned here so no module can quietly use JavaScript's 0 = Sunday (LDN1 README gap 5).
 *
 * BB-wave1-041126/04a-core, 2026-11-04.
 */

export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const ISO_WEEKDAYS: readonly IsoWeekday[] = Object.freeze([1, 2, 3, 4, 5, 6, 7] as const);

const NAMES: Readonly<Record<IsoWeekday, string>> = Object.freeze({
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
});

export function isIsoWeekday(value: unknown): value is IsoWeekday {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 7;
}

/** The ISO weekday of a London calendar date ("YYYY-MM-DD"). Calendar arithmetic only, so the host zone can't matter. */
export function isoWeekdayOf(londonDate: string): IsoWeekday {
  const [year, month, day] = londonDate.split("-").map(Number);
  const sundayZero = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return (((sundayZero + 6) % 7) + 1) as IsoWeekday;
}

export function weekdayName(weekday: IsoWeekday): string {
  return NAMES[weekday];
}
