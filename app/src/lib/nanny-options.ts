/**
 * London's nanny option lists — the one place each list and its order lives (unit 3a, BB-LDN-3a-061026).
 *
 * 3a owns these constants and the database CHECKs written from them (amendment 07 transitional, 08 UK-only);
 * 3e and the profile edit only import them. Array order = display order. A change to any list after 3a merges is a
 * new amendment, never an edit of 07 / 08.
 *
 * Sources: E-2 (labels + scores), P-6 (higher qualification = Level 5 and 6), D-5 / E-1 / E-3 (right to work,
 * no "Not sure"), P-2 (certificates and assurances, ascending value/difficulty, BAI 2026-10-06).
 */

export const QUALIFICATION_LADDER = [
  { value: "No Qualifications", short: "None", score: 0, rank: 0 }, // kept from the profile edit list; not a funnel option
  { value: "Other childcare qualification", short: "Other qualification", score: 10, rank: 0 },
  { value: "Level 2 early years", short: "Level 2 Early Years", score: 30, rank: 1 },
  { value: "Level 3 early years educator (incl. NNEB / CACHE diploma)", short: "Level 3 Early Years", score: 50, rank: 2 },
  { value: "Level 5 / foundation degree in early years", short: "Level 5 Early Years", score: 75, rank: 3 },
  { value: "Level 6 — degree in early years, EYTS or QTS", short: "Degree / EYTS / QTS", score: 100, rank: 4 },
] as const; // values: ADR-149 via 3e-funnel-review §2; short: LDN1 config/matching.ts:67-90; scores: E-2;
// rank keeps the existing rank-map scale (first certificate 1 … degree 4; unknown / Other 0 — BrowseMatchesClient.tsx:17-22)

export type QualificationValue = (typeof QUALIFICATION_LADDER)[number]["value"];

/** P-6: the higher-qualification matching bonus goes to Level 5 and Level 6. */
export const HIGHER_QUALIFICATION_MIN_RANK = 3;

const findQualification = (label: string | null | undefined) =>
  QUALIFICATION_LADDER.find((q) => q.value === label);

/** Matching score for a stored qualification label; unknown → 0. */
export function qualificationScore(label: string | null | undefined): number {
  return findQualification(label)?.score ?? 0;
}

/** Rank on the shared rank-map scale; unknown → 0. */
export function qualificationRank(label: string | null | undefined): number {
  return findQualification(label)?.rank ?? 0;
}

/** Short display label; unknown → the label itself (empty for none). */
export function qualificationShort(label: string | null | undefined): string {
  return findQualification(label)?.short ?? label ?? "";
}

export function isHigherQualification(label: string | null | undefined): boolean {
  return qualificationRank(label) >= HIGHER_QUALIFICATION_MIN_RANK;
}

export const RIGHT_TO_WORK_OPTIONS = [
  { key: "citizen", label: "British or Irish citizen", rightToWork: true },
  { key: "settled", label: "Settled or pre-settled status, or indefinite leave", rightToWork: true },
  { key: "visa_with_rtw", label: "A visa that lets me work in the UK", rightToWork: true },
  { key: "no_rtw", label: "I don't currently have the right to work in the UK", rightToWork: false },
] as const; // D-5, E-1, E-3 (no "Not sure"); labels verbatim from LDN1 funnel-options.ts:16-27

export type RightToWorkKey = (typeof RIGHT_TO_WORK_OPTIONS)[number]["key"];

/** Whether a stored right-to-work key means she may work — read from the table, never a literal. */
export function rightToWorkFor(key: RightToWorkKey): boolean {
  return RIGHT_TO_WORK_OPTIONS.find((o) => o.key === key)?.rightToWork ?? false;
}

/** E-1: these nationalities skip the right-to-work question and are stored as `citizen`. */
export const RTW_AUTO_NATIONALITIES = ["British", "Irish"] as const;

/** P-2 (BAI 2026-10-06): first aid / basic medical only; ascending value/difficulty; replaces every `CERT_ORDER`. */
export const CERTIFICATE_OPTIONS = [
  "CPR",
  "First Aid",
  "Emergency Paediatric First Aid (6-hour)",
  "Paediatric First Aid (12-hour)",
] as const;
export type CertificateOption = (typeof CERTIFICATE_OPTIONS)[number];

/** P-2: `nanny_assurances.assurance_type` (the profile's "other desirable" question); ascending. */
export const ASSURANCE_OPTIONS = [
  "References",
  "Food Hygiene (Level 2)",
  "Safeguarding / Child Protection training",
  "Common Core Skills",
  "Ofsted Childcare Register",
] as const;
export type AssuranceOption = (typeof ASSURANCE_OPTIONS)[number];

/**
 * Comparator that sorts stored values into the constant's order. Unknown values go last and keep their stored order
 * (`Array.prototype.sort` is stable). Use on a copy: `[...stored].sort(byOptionOrder(CERTIFICATE_OPTIONS))`.
 */
export function byOptionOrder(options: readonly string[]): (a: string, b: string) => number {
  const position = (value: string) => {
    const index = options.indexOf(value);
    return index === -1 ? options.length : index;
  };
  return (a, b) => position(a) - position(b);
}
