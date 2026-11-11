/**
 * The nanny's countdown to reply to a family's request: whole days, rounded up, from 24 hours up ("7 days", "1 day" at
 * exactly 24 hours); in the last day, whole hours, rounded up and never 0 ("23h", "1h"); red under 6 hours; "Expired"
 * at or past the time.
 */
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const URGENT_MS = 6 * HOUR_MS;

export interface RespondTimeLeft {
  readonly text: string;
  readonly urgent: boolean;
  readonly expired: boolean;
}

export function respondTimeLeft(expiresAt: string, now: number = Date.now()): RespondTimeLeft {
  const diffMs = Date.parse(expiresAt) - now;
  if (!(diffMs > 0)) return { text: "Expired", urgent: true, expired: true };
  const days = Math.ceil(diffMs / DAY_MS);
  const left = diffMs >= DAY_MS ? `${days} ${days === 1 ? "day" : "days"}` : `${Math.max(1, Math.ceil(diffMs / HOUR_MS))}h`;
  return { text: `${left} to respond`, urgent: diffMs < URGENT_MS, expired: false };
}
