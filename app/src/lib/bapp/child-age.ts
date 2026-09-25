/**
 * Child-age policy for the in-app development tracking surface.
 *
 * The bapp is scoped to children strictly under 36 months ("under three" —
 * see `src/lib/chat/bot.ts:ageBracket`). New children added via the add-child
 * sheets or the parent path must satisfy this cap. Older children belong on
 * the matching/babysitting surfaces (different product).
 */

export const MAX_CHILD_AGE_MONTHS = 36;

export type DobValidationError =
  | "invalid_date_of_birth"
  | "date_of_birth_in_future"
  | "child_too_old";

export type DobValidationResult =
  | { ok: true }
  | { ok: false; error: DobValidationError };

/**
 * Whole-month age between `dob` and `now`. A child born on the same calendar
 * day three months ago returns 3; one day shy returns 2.
 *
 * Uses UTC accessors throughout — `new Date("YYYY-MM-DD")` parses to UTC
 * midnight per ECMA-262, so anchoring all comparisons to UTC keeps the age
 * count correct regardless of where the server clock is set (London prod,
 * UTC CI, anywhere else).
 */
export function getChildAgeMonths(dob: Date, now: Date): number {
  const years = now.getUTCFullYear() - dob.getUTCFullYear();
  let months = years * 12 + (now.getUTCMonth() - dob.getUTCMonth());
  if (now.getUTCDate() < dob.getUTCDate()) months -= 1;
  return months;
}

/**
 * Validate an ISO date string (YYYY-MM-DD or full ISO) for use as a child
 * `date_of_birth`. Centralised so the three add-child sheets and the
 * `child_client` server actions agree.
 */
export function validateChildDob(
  iso: string,
  now: Date = new Date(),
): DobValidationResult {
  const dob = new Date(iso);
  if (Number.isNaN(dob.getTime())) {
    return { ok: false, error: "invalid_date_of_birth" };
  }
  if (dob > now) {
    return { ok: false, error: "date_of_birth_in_future" };
  }
  if (getChildAgeMonths(dob, now) >= MAX_CHILD_AGE_MONTHS) {
    return { ok: false, error: "child_too_old" };
  }
  return { ok: true };
}

/**
 * Earliest DoB still allowed by the cap, formatted as `YYYY-MM-DD` for use
 * as the `min` attribute on `<input type="date">`. A child born on this
 * date is exactly `MAX_CHILD_AGE_MONTHS - 1` months old today, so still
 * valid. The boundary day itself is the last allowed birthday.
 */
export function earliestAllowedDobIso(now: Date = new Date()): string {
  const earliest = new Date(now);
  earliest.setUTCMonth(earliest.getUTCMonth() - MAX_CHILD_AGE_MONTHS);
  earliest.setUTCDate(earliest.getUTCDate() + 1);
  return toIsoDate(earliest);
}

/**
 * Today as `YYYY-MM-DD`, anchored to UTC — for the `max` attribute on
 * `<input type="date">` to block future DoB selection.
 */
export function todayIso(now: Date = new Date()): string {
  return toIsoDate(now);
}

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
