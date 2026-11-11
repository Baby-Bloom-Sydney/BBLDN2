/**
 * The family's days to book a meet and greet once she has accepted (stage 10). Days only, rounded up, so the last day
 * reads "1 day" and never 0; nothing once the time has passed.
 *
 * The time ends at the earlier of the row's own expiry and her last offered time less the 12 hours a booking needs
 * (`scheduleConnectionTime`). Her last offered time is the latest slot she gave, at its bracket's last start time on the
 * London clock (`getBracketTimeOptions`: every 15 minutes up to the bracket's end).
 * Pure: the same answer on the server, in the browser and in an email.
 */
import { CONNECTION_STAGE } from "@/lib/position/constants";
import { BRACKET_KEYS, localToUTC, TIME_BRACKETS, type BracketKey } from "@/lib/timezone";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const BOOKING_LEAD_MS = 12 * HOUR_MS;
const MAX_DAYS = 7;
const LAST_START_MINUTE = 45;

export interface BookingWindowRow {
  readonly connectionStage: number | null;
  readonly expiresAt: string | null;
  readonly proposedTimes: readonly string[] | null;
}

/** The last moment a slot can start ("YYYY-MM-DD_bracket"), or null for a malformed slot. */
function lastStartOf(slot: string): number | null {
  const [date, bracket] = slot.split("_");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !BRACKET_KEYS.includes(bracket as BracketKey)) return null;
  const { endHour } = TIME_BRACKETS[bracket as BracketKey];
  const at = Date.parse(localToUTC(date, endHour - 1, LAST_START_MINUTE));
  return Number.isNaN(at) ? null : at;
}

/** The last moment she can still be booked: the expiry, or earlier when her last time (less 12 hours) is sooner. */
function bookingDeadline(row: BookingWindowRow): number | null {
  const expiry = row.expiresAt === null ? NaN : Date.parse(row.expiresAt);
  if (Number.isNaN(expiry)) return null;
  const starts = (row.proposedTimes ?? []).map(lastStartOf).filter((at): at is number => at !== null);
  if (starts.length === 0) return expiry;
  return Math.min(expiry, Math.max(...starts) - BOOKING_LEAD_MS);
}

export function bookingDaysLeft(row: BookingWindowRow, now: number = Date.now()): number | null {
  if (row.connectionStage !== CONNECTION_STAGE.ACCEPTED) return null;
  const deadline = bookingDeadline(row);
  if (deadline === null || deadline <= now) return null;
  return Math.min(MAX_DAYS, Math.max(1, Math.ceil((deadline - now) / DAY_MS)));
}

export function daysLeftLine(name: string, days: number): string {
  return `${days} ${days === 1 ? "day" : "days"} left to book your meet and greet with ${name}`;
}

export function bookingDaysLeftLine(row: BookingWindowRow, name: string, now: number = Date.now()): string | null {
  const days = bookingDaysLeft(row, now);
  return days === null ? null : daysLeftLine(name, days);
}
