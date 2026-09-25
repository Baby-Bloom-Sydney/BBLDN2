/**
 * UK phone-number helpers + address parser shared across the
 * verification flow, onboarding, the apply funnel and settings.
 *
 * Single source of truth so the regex / formatter / parser never
 * drift between surfaces. Every place that accepts a mobile MUST
 * validate with `isUkMobile` after normalising via
 * `normaliseUkMobile`.
 *
 * P-5 (BAI 2026-09-25): a mobile is accepted as `07…` or `+44…`,
 * stored internally in E.164 (`+44…`), and displayed as
 * `+44 (0) 7xxx xxx xxx`.
 */

/** The national (trunk-prefixed) mobile form: `07` + 9 digits. */
export const UK_MOBILE_REGEX = /^07\d{9}$/;

/** Separators a person types into a phone field. */
const PHONE_NOISE = /[\s()\-.]+/g;

/**
 * Reduce any accepted input to the national form `07xxxxxxxxx`.
 * Anything it cannot place is returned cleaned but unchanged, so
 * the caller's regex test fails rather than silently passing.
 */
function toNationalForm(input: string): string {
  const cleaned = input.replace(PHONE_NOISE, "");
  // `+44…`, `0044…` or bare `44…`, with the optional trunk `0` that
  // appears in the display form `+44 (0) 7700 900 123`.
  const international = cleaned.match(/^(?:\+44|0044|44)0?(\d{10})$/);
  if (international) return `0${international[1]}`;
  // A bare national significant number, typed without its leading 0.
  if (/^7\d{9}$/.test(cleaned)) return `0${cleaned}`;
  return cleaned;
}

/**
 * Normalise a typed mobile to the canonical internal form, E.164
 * `+447…` (P-5). Idempotent: normalising an already-normalised
 * value returns it unchanged, which the server gate in
 * `lib/auth/actions.ts` relies on.
 */
export function normaliseUkMobile(input: string): string {
  const national = toNationalForm(input);
  if (!UK_MOBILE_REGEX.test(national)) return national;
  return `+44${national.slice(1)}`;
}

export function isUkMobile(input: string): boolean {
  return UK_MOBILE_REGEX.test(toNationalForm(input));
}

/**
 * Format any accepted mobile into the display form
 * `+44 (0) 7xxx xxx xxx`. Returns the raw input unchanged when it
 * doesn't validate so callers don't have to special-case the
 * partial input a person is still typing.
 */
export function formatUkMobile(input: string): string {
  const national = toNationalForm(input);
  if (!UK_MOBILE_REGEX.test(national)) return input;
  const d = national.slice(1);
  return `+44 (0) ${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
}

// ── Address parsing ─────────────────────────────────────────────

/** Outward code (2–4 chars) + inward code, one optional space. */
export const UK_POSTCODE_REGEX = /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i;

/** The same shape, anchored to the end of a single-line address. */
const TRAILING_POSTCODE_REGEX = /\s([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})$/i;

export interface ParsedAddress {
  line1: string;
  /** Empty when the address has no intermediate locality. */
  line2: string;
  /** The last non-postcode segment — what reaches the `city` column. */
  town: string;
  postcode: string;
}

export function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Collapse the two street lines into the single `address_line`
 * column. UK addresses carry an optional second line that a
 * one-column schema would otherwise drop.
 */
export function formatAddressLine(a: ParsedAddress): string {
  return [a.line1, a.line2].filter((s) => s.length > 0).join(", ");
}

/** `"nw16xe"` / `"NW1  6XE"` → `"NW1 6XE"`. */
function normalisePostcode(raw: string): string {
  const compact = raw.replace(/\s+/g, "").toUpperCase();
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

/**
 * Parse a single-line UK address into structured parts. Accepts the
 * two-segment and three-or-more-segment forms:
 *
 *   "12 BAKER STREET, MARYLEBONE NW1 6XE"
 *   "FLAT 4, 12 BAKER STREET, MARYLEBONE NW1 6XE"
 *
 * Returns null when there is no trailing UK postcode, or no comma
 * before it — including for an address of the shape this parser
 * replaced.
 */
export function parseUkAddress(sla: string): ParsedAddress | null {
  const trimmed = sla.trim();
  const postcodeMatch = trimmed.match(TRAILING_POSTCODE_REGEX);
  if (!postcodeMatch) return null;

  const beforePostcode = trimmed
    .slice(0, trimmed.length - postcodeMatch[0].length)
    .trim()
    .replace(/,\s*$/, "");

  const segments = beforePostcode
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length < 2) return null;

  const hasLine2 = segments.length > 2;
  const town = segments[segments.length - 1];
  const line2 = hasLine2 ? segments[segments.length - 2] : "";
  const line1 = segments.slice(0, hasLine2 ? segments.length - 2 : 1).join(", ");

  return {
    line1: toTitleCase(line1),
    line2: toTitleCase(line2),
    town: toTitleCase(town),
    postcode: normalisePostcode(postcodeMatch[1]),
  };
}
