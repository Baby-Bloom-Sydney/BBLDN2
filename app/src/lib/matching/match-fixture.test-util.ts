/**
 * Test-only: one full match result as the engine builds it server-side (her whole profile row and nanny row), plus
 * stray contact fields, for the tests that check what reaches the browser. BB-wave1-041126, 2026-11-09.
 */
import type { MatchResult } from "./types";

export const FULL_MATCH = {
  nannyId: "n-1",
  nanny: {
    id: "n-1", user_id: "u-private-1", total_experience_years: 6, nanny_experience_years: 4, under_3_experience_years: 3,
    newborn_experience_years: 1, max_children: 2, min_child_age_months: 0, max_child_age_months: 60, additional_needs_ok: true,
    drivers_license: true, has_car: false, vaccination_status: true, non_smoker: true, comfortable_with_pets: true,
    hourly_rate_min: 18, nationality: "Polish", languages: ["English"], role_types_preferred: ["Full-time"],
    level_of_support_offered: ["Sole charge"], immediate_start_available: true,
    ai_content: { headline: "Calm and playful", bio_summary: { about: "x" } },
    verification_level: 4, stripe_connect_account_id: "acct_private",
  },
  profile: {
    user_id: "u-private-1", first_name: "nina", last_name: "Walkerton", suburb: "Islington", postcode: "N1 1AA",
    date_of_birth: "1993-03-03", profile_picture_url: null, email: "nina.private@example.test", mobile_number: "+447700900999",
  },
  qualityBase: 80, requirementMultiplier: 1, overQualifiedMultiplier: 1, rawScore: 80, finalScore: 88,
  breakdown: { experience: 90, schedule: 80, location: 70, roleFit: 60, qualifications: 50, supportFit: 40 },
  internalNote: "server-side only",
  distanceKm: 3, scheduleOverlapPercent: 80, highestQualification: "Level 3", certifications: ["Paediatric First Aid"],
  nannySchedule: { monday: ["morning"] }, unmetRequirements: [], overQualifiedBonuses: ["Driver"],
} as unknown as MatchResult;

/** Anything in a payload that only the server may hold. */
export const PRIVATE = /u-private-1|Walkerton|1993-03-03|nina\.private|7700900999|N1 1AA|acct_private|Polish|server-side only|date_of_birth|user_id|mobile|email/;
