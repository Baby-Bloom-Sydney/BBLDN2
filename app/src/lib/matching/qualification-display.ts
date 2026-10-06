/**
 * Display helpers over 3a's lists (unit 3e, BB-LDN-3e-061026): the short qualification label for chips and match
 * bonuses (E-2), and the certificate list as cards show it (P-2 order, E-7 paediatric collapse). Used by matching
 * (`scoring.ts`, `engine.ts`), the card badges (`NannyPreviewCard`, `PublicMatchCard`, `ExpandableBadges`) and
 * `NannyMyProfile`.
 * Never: declares a list or an order of its own — every value and order is read from `lib/nanny-options.ts`; shows a
 * label for a value not on the ladder (stale data shows nothing rather than a long or foreign label).
 */
import { QUALIFICATION_LADDER, CERTIFICATE_OPTIONS, byOptionOrder, qualificationScore } from "@/lib/nanny-options";

/** Ladder short label for a stored qualification; a value not on the ladder (stale data) shows nothing. */
export function ladderShortLabel(label: string | null | undefined): string {
  return QUALIFICATION_LADDER.find((q) => q.value === label)?.short ?? "";
}

/** Badge text for a card: the short label, or nothing for "No Qualifications" and any off-ladder value. */
export function qualificationBadgeLabel(label: string | null | undefined): string {
  return qualificationScore(label) > 0 ? ladderShortLabel(label) : "";
}

const PAEDIATRIC_FIRST_AID = "Paediatric First Aid";
const PAEDIATRIC_COURSES: readonly string[] = CERTIFICATE_OPTIONS.filter((c) => c.includes(PAEDIATRIC_FIRST_AID));
const PLAIN_FIRST_AID = "First Aid";

/**
 * Certificates for a card or a match bonus, in P-2 order (unknown values last). Either paediatric course collapses to
 * one "Paediatric First Aid" chip, and plain "First Aid" is hidden when a paediatric course is held (E-7).
 */
export function displayCertificates(certs: readonly string[]): string[] {
  const ordered = [...certs].sort(byOptionOrder(CERTIFICATE_OPTIONS));
  const hasPaediatric = ordered.some((c) => PAEDIATRIC_COURSES.includes(c));
  const shown = ordered
    .filter((c) => !(hasPaediatric && c === PLAIN_FIRST_AID))
    .map((c) => (PAEDIATRIC_COURSES.includes(c) ? PAEDIATRIC_FIRST_AID : c));
  return shown.filter((c, i) => shown.indexOf(c) === i);
}
