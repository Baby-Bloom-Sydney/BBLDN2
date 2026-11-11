/**
 * Her age in whole years from a date of birth, as the profile screens show it: null when there is no date, it can't
 * be read, or the result is not plausible (0 or less, 120 or more). Pure: used on the server (the public profile) and in
 * the browser (the funnel's own preview).
 *
 * BB-wave1-041126, 2026-11-09.
 */
export function profileAge(dateOfBirth: string | null | undefined, now: Date = new Date()): number | null {
  if (!dateOfBirth) return null;
  const birth = new Date(dateOfBirth);
  if (Number.isNaN(birth.getTime())) return null;
  let age = now.getFullYear() - birth.getFullYear();
  const months = now.getMonth() - birth.getMonth();
  if (months < 0 || (months === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age > 0 && age < 120 ? age : null;
}
