/**
 * Surname / forename / date matching for the DBS cross-check (00-RULINGS #21): the existing case-insensitive + trimmed
 * compare, plus common sense — accents ignored; hyphen, space and apostrophe treated as equal.
 *
 * Contract
 * - Ruling: #21. Used by the pipeline cross-check (passport vs certificate) and by the API-mismatch check.
 * - Input: nullable strings. Output: booleans; any missing / empty / invalid value is NOT a match (fail closed → review).
 * - Never: fuzzy-matches beyond the ruled normalisation (no partial double-barrelled match, no edit distance).
 */

/** trim → strip accents (NFD) → lower-case → hyphen / apostrophes / whitespace runs → one space → trim. */
export function normaliseSurname(s: string): string {
  return s
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[-'’‘`\s]+/g, " ")
    .trim();
}

/** Equal after `normaliseSurname`; both must be non-empty. */
export function surnamesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = normaliseSurname(a);
  return x !== "" && x === normaliseSurname(b);
}

/**
 * API forename vs the certificate's forenames. Whether the API returns all forenames or only the first is live
 * test T11; until then either form matches. Anything else (or a missing name) does not.
 */
export function forenamesMatch(api: string | null | undefined, certificate: string | null | undefined): boolean {
  if (!api || !certificate) return false;
  const a = normaliseSurname(api);
  const c = normaliseSurname(certificate);
  if (!a || !c) return false;
  return a === c || a === c.split(" ")[0];
}

/** The calendar date of a `YYYY-MM-DD…` string, or null when it is not a real date. */
function calendarDate(s: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? "");
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return m[0];
}

/** True when the string starts with a real `YYYY-MM-DD` calendar date. */
export function isCalendarDate(s: string | null | undefined): boolean {
  return calendarDate(s) !== null;
}

/** Same calendar day (time part ignored); null or impossible dates (e.g. 1990-02-30) never match. */
export function datesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = calendarDate(a);
  return x !== null && x === calendarDate(b);
}
