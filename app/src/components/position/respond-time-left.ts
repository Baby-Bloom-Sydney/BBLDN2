/**
 * The nanny's countdown to reply to a family's request: days and hours from 24 hours up ("6d 23h to respond"); below
 * that, hours and minutes ("23h 59m", "59m"), red under 6 hours; "Expired" at or past the time.
 */
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const URGENT_HOURS = 6;

export interface RespondTimeLeft {
  readonly text: string;
  readonly urgent: boolean;
  readonly expired: boolean;
}

export function respondTimeLeft(expiresAt: string, now: number = Date.now()): RespondTimeLeft {
  const diffMs = Date.parse(expiresAt) - now;
  if (!(diffMs > 0)) return { text: "Expired", urgent: true, expired: true };
  const hours = Math.floor(diffMs / HOUR_MS);
  const minutes = Math.floor((diffMs % HOUR_MS) / MINUTE_MS);
  const left = hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return { text: `${left} to respond`, urgent: hours < URGENT_HOURS, expired: false };
}
