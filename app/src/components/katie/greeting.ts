/**
 * Katie's empty-state greeting topics, by role (W6-D7, unit 3w6fix, BB-LDN-3w6fix-141026).
 *
 * Parents have no verification since 3h (QUESTIONS D-7; 3h walk flagged the greeting for 3g), so only a nanny is
 * offered "verification". The nanny line is the existing greeting; the parent line is the same list without it — no
 * new copy (3g wording rules: parent-facing text carries no verification wording).
 * Input: the auth role string. Output: the comma-separated topic list shown after "I can help you across all of Baby
 * Bloom —". Never: offers verification to any role but "nanny".
 */
const NANNY_TOPICS = "child development, jobs, babysitting, verification, your profile";
const OTHER_TOPICS = "child development, jobs, babysitting, your profile";

export function katieGreetingTopics(role: string): string {
  return role === "nanny" ? NANNY_TOPICS : OTHER_TOPICS;
}
