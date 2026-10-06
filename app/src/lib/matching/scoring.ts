// ── Matching scoring functions ──
// Three-layer: Quality Base × Requirement Multiplier × Over-qualified Multiplier
// Unit 3e (BB-LDN-3e-061026): qualification scores, the higher-qualification bonus (P-6: Level 5 and 6, via 3a's
// `isHigherQualification` — never a label substring or rank literal), short labels and the certificate collapse all
// read 3a's constants through `qualification-display.ts`.

import type {
  PositionMatchData,
  PositionChildData,
  NannyMatchData,
  NannyCredentialData,
  ScoreBreakdown,
} from './types';
import {
  WEIGHTS,
  ROLE_MAP,
  SUPPORT_MAP,
  SUPPORT_LEVELS,
  QUAL_SCORES,
  DISTANCE_BRACKETS,
  SCHEDULE_CURVE,
  REQUIREMENT_PENALTIES,
  REQUIREMENT_MULTIPLIER_FLOOR,
  OQ_BONUSES,
  OQ_MULTIPLIER_CAP,
  DISPLAY_MIN,
  DISPLAY_MAX,
} from './constants';
import { isHigherQualification, qualificationRank } from '@/lib/nanny-options';
import { ladderShortLabel, displayCertificates } from './qualification-display';

// ── Layer 1: Quality Base (0-100) ──

export function scoreLocation(
  distanceKm: number | null,
  hasCar: boolean
): number {
  if (distanceKm === null) return 50; // unknown distance, neutral score

  let score = 0;
  for (const bracket of DISTANCE_BRACKETS) {
    if (distanceKm <= bracket.maxKm) {
      score = bracket.score;
      break;
    }
  }
  // >30km falls through with score 0

  // Car bonus: nanny can drive, distance matters less
  if (hasCar) {
    score = Math.min(100, Math.round(score * 1.2));
  }

  return score;
}

export function scoreSchedule(
  positionSchedule: Record<string, string[]> | null,
  nannySchedule: Record<string, string[]>,
  isFlexible: boolean
): { score: number; overlapPercent: number } {
  if (!positionSchedule || Object.keys(positionSchedule).length === 0) {
    return { score: 100, overlapPercent: 100 }; // no schedule set = full marks
  }

  let totalBlocks = 0;
  let matchedBlocks = 0;

  for (const [day, blocks] of Object.entries(positionSchedule)) {
    for (const block of blocks) {
      totalBlocks++;
      if (nannySchedule[day]?.includes(block)) {
        matchedBlocks++;
      }
    }
  }

  if (totalBlocks === 0) return { score: 100, overlapPercent: 100 };

  let coverage = matchedBlocks / totalBlocks;

  // Flexible schedule boost
  if (isFlexible) {
    coverage = Math.min(1.0, coverage * 1.3);
  }

  const overlapPercent = Math.round(coverage * 100);

  // Non-linear curve: high coverage rewarded, low coverage punished
  let score = SCHEDULE_CURVE[SCHEDULE_CURVE.length - 1].score; // default to lowest
  for (const bracket of SCHEDULE_CURVE) {
    if (coverage >= bracket.minCoverage) {
      score = bracket.score;
      break;
    }
  }

  return { score, overlapPercent };
}

export function scoreExperience(
  nanny: NannyMatchData,
  requiredYears: number | null,
  children: PositionChildData[]
): number {
  const nannyExp = nanny.nanny_experience_years ?? nanny.total_experience_years ?? 0;
  const required = requiredYears ?? 0;

  // Base general experience (0-50)
  let baseScore: number;
  if (required === 0) {
    // No requirement set — score based on raw experience
    baseScore = Math.min(50, 20 + nannyExp * 5);
  } else if (nannyExp >= required) {
    baseScore = 40 + Math.min(10, (nannyExp - required) * 2);
  } else {
    baseScore = Math.round((nannyExp / required) * 30);
  }

  // Child-age-specific scoring (0-50)
  let ageScore = 30; // default for 3+ children
  if (children.length > 0) {
    const youngestMonths = Math.min(...children.map((c) => c.age_months));

    if (youngestMonths <= 12) {
      // Newborn — newborn experience is critical
      const newbornExp = nanny.newborn_experience_years ?? 0;
      if (newbornExp === 0) {
        ageScore = 0; // strongly docked
      } else {
        ageScore = Math.min(50, newbornExp * 10);
      }
    } else if (youngestMonths <= 36) {
      // Toddler — under-3 experience important
      const under3Exp = nanny.under_3_experience_years ?? 0;
      if (under3Exp === 0) {
        ageScore = 5; // docked but less severe
      } else {
        ageScore = Math.min(45, under3Exp * 10);
      }
    } else {
      // All children 3+ — general experience covers it
      ageScore = 30;
    }
  }

  return Math.min(100, baseScore + ageScore);
}

export function scoreRoleFit(
  parentReasons: string[] | null,
  nannyRoles: string[] | null
): number {
  if (!parentReasons || parentReasons.length === 0) return 100; // no preference
  if (!nannyRoles || nannyRoles.length === 0) return 20;

  const mappedReasons = parentReasons.map((r) => ROLE_MAP[r] || r);
  const matched = mappedReasons.filter((r) => nannyRoles.includes(r)).length;

  if (matched === 0) return 20; // no match but nanny may still be good
  return Math.round((matched / mappedReasons.length) * 100);
}

export function scoreQualifications(credentials: NannyCredentialData[]): number {
  // Find highest qualification
  let highestQualScore = 0;
  let certCount = 0;

  for (const cred of credentials) {
    if (cred.credential_category === 'qualification' && cred.qualification_type) {
      const score = QUAL_SCORES[cred.qualification_type] ?? 0;
      highestQualScore = Math.max(highestQualScore, score);
    }
    if (cred.credential_category === 'certification' && cred.certification_type) {
      certCount++;
    }
  }

  // Cert bonus: up to +20 on top of qual score
  const certBonus = Math.min(20, certCount * 5);

  return Math.min(100, highestQualScore + certBonus);
}

export function scoreSupportFit(
  focusType: string | null | undefined,
  supportType: string | null | undefined,
  nannyLevels: string[] | null
): number {
  if (!focusType || !supportType) return 100; // no preference
  if (!nannyLevels || nannyLevels.length === 0) return 30;

  const key = `${focusType}|${supportType}`;
  const requiredLevel = SUPPORT_MAP[key];
  if (!requiredLevel) return 100; // unknown combination, no penalty

  // Exact match
  if (nannyLevels.includes(requiredLevel)) return 100;

  // Check hierarchy
  const levels = SUPPORT_LEVELS as readonly string[];
  const requiredIdx = levels.indexOf(requiredLevel);
  const nannyMaxIdx = Math.max(
    ...nannyLevels.map((l) => levels.indexOf(l)).filter((i) => i >= 0)
  );

  if (nannyMaxIdx < 0) return 30; // no recognized levels

  // Higher level offered — overqualified (good but not perfect fit)
  if (nannyMaxIdx > requiredIdx) return 70;

  // Lower level — proportional
  return Math.round((nannyMaxIdx / Math.max(1, requiredIdx)) * 60);
}

/**
 * Calculate the full quality base score (0-100) with breakdown.
 */
export function calculateQualityBase(
  position: PositionMatchData,
  children: PositionChildData[],
  nanny: NannyMatchData,
  nannyCredentials: NannyCredentialData[],
  distanceKm: number | null,
  nannySchedule: Record<string, string[]>,
  positionSchedule: Record<string, string[]> | null
): { score: number; breakdown: ScoreBreakdown; scheduleOverlapPercent: number } {
  const details = position.details ?? {};

  const locationScore = scoreLocation(distanceKm, nanny.has_car ?? false);
  const { score: scheduleScore, overlapPercent } = scoreSchedule(
    positionSchedule,
    nannySchedule,
    position.schedule_type === 'Flexible'
  );
  const experienceScore = scoreExperience(nanny, position.years_of_experience, children);
  const roleFitScore = scoreRoleFit(position.reason_for_nanny, nanny.role_types_preferred);
  const qualScore = scoreQualifications(nannyCredentials);
  const supportScore = scoreSupportFit(
    details.focus_type,
    details.support_type,
    nanny.level_of_support_offered
  );

  const breakdown: ScoreBreakdown = {
    location: locationScore,
    schedule: scheduleScore,
    experience: experienceScore,
    roleFit: roleFitScore,
    qualifications: qualScore,
    supportFit: supportScore,
  };

  const score =
    locationScore * WEIGHTS.location +
    scheduleScore * WEIGHTS.schedule +
    experienceScore * WEIGHTS.experience +
    roleFitScore * WEIGHTS.roleFit +
    qualScore * WEIGHTS.qualifications +
    supportScore * WEIGHTS.supportFit;

  return { score, breakdown, scheduleOverlapPercent: overlapPercent };
}

// ── Layer 2: Requirement Multiplier (0.3 - 1.0) ──

export function calculateRequirementMultiplier(
  position: PositionMatchData,
  children: PositionChildData[],
  nanny: NannyMatchData,
  nannyAge: number | null
): { multiplier: number; unmetRequirements: string[] } {
  let multiplier = 1.0;
  const unmet: string[] = [];

  const details = position.details ?? {};

  // Child age range — split into younger and older
  if (children.length > 0 && nanny.min_child_age_months != null && nanny.max_child_age_months != null) {
    const tooYoung = children.some((c) => c.age_months < nanny.min_child_age_months!);
    const tooOld = children.some((c) => c.age_months > nanny.max_child_age_months!);
    if (tooYoung || tooOld) {
      multiplier *= REQUIREMENT_PENALTIES.childAgeRange;
      if (tooYoung) unmet.push('Usually nannies older children');
      if (tooOld) unmet.push('Usually nannies younger children');
    }
  }

  // Capacity
  if (nanny.max_children != null && children.length > nanny.max_children) {
    multiplier *= REQUIREMENT_PENALTIES.capacity;
    unmet.push('Usually nannies for less children');
  }

  // Special needs
  if (details.child_needs && !nanny.additional_needs_ok) {
    multiplier *= REQUIREMENT_PENALTIES.specialNeeds;
    unmet.push('No exp. with specific needs');
  }

  // Driver's licence
  if (position.drivers_license_required && !nanny.drivers_license) {
    multiplier *= REQUIREMENT_PENALTIES.driversLicense;
    unmet.push('No driver\'s licence');
  }

  // Car
  if (position.car_required && !nanny.has_car) {
    multiplier *= REQUIREMENT_PENALTIES.car;
    unmet.push('No car');
  }

  // Vaccination
  if (position.vaccination_required && !nanny.vaccination_status) {
    multiplier *= REQUIREMENT_PENALTIES.vaccination;
    unmet.push('Not fully vaccinated');
  }

  // Non-smoker (hidden — affects score but never shown in results)
  if (position.non_smoker_required && !nanny.non_smoker) {
    multiplier *= REQUIREMENT_PENALTIES.nonSmoker;
  }

  // Pets comfort
  if (position.comfortable_with_pets_required && !nanny.comfortable_with_pets) {
    multiplier *= REQUIREMENT_PENALTIES.petsComfort;
    unmet.push('Not comfortable with pets');
  }

  // Nanny age
  if (position.minimum_age_requirement != null && nannyAge != null) {
    const ageDiff = nannyAge - position.minimum_age_requirement;
    if (ageDiff < -3) {
      multiplier *= REQUIREMENT_PENALTIES.nannyAgeSevere;
      unmet.push(`Not ${position.minimum_age_requirement} yrs or older (${nannyAge})`);
    } else if (ageDiff < 0) {
      multiplier *= REQUIREMENT_PENALTIES.nannyAgeMild;
      unmet.push(`Not ${position.minimum_age_requirement} yrs or older (${nannyAge})`);
    }
  }

  return {
    multiplier: Math.max(REQUIREMENT_MULTIPLIER_FLOOR, multiplier),
    unmetRequirements: unmet,
  };
}

// ── Layer 3: Over-qualified Multiplier (1.0 - 1.25) ──

export function calculateOverQualifiedMultiplier(
  position: PositionMatchData,
  nanny: NannyMatchData,
  nannyCredentials: NannyCredentialData[],
  nannyAge: number | null
): { multiplier: number; bonuses: string[] } {
  let multiplier = 1.0;

  const nannyExp = nanny.nanny_experience_years ?? nanny.total_experience_years ?? 0;
  const required = position.years_of_experience ?? 0;

  // ── Calculate multipliers ──

  // Extra experience
  if (required > 0 && nannyExp > required) {
    const extraYears = nannyExp - required;
    multiplier *= Math.min(
      OQ_BONUSES.extraExperienceCap,
      Math.pow(OQ_BONUSES.extraExperiencePerYear, extraYears)
    );
  }

  // Certifications
  const certs = nannyCredentials
    .filter((c) => c.credential_category === 'certification' && c.certification_type)
    .map((c) => c.certification_type!);
  if (certs.length > 0) {
    multiplier *= Math.min(
      OQ_BONUSES.certificationCap,
      Math.pow(OQ_BONUSES.certificationPer, certs.length)
    );
  }

  // Higher qualification
  let bestQual: string | null = null;
  let bestQualScore = 0;
  for (const c of nannyCredentials) {
    if (c.credential_category === 'qualification' && c.qualification_type) {
      const qs = QUAL_SCORES[c.qualification_type] ?? 0;
      if (qs > bestQualScore) { bestQualScore = qs; bestQual = c.qualification_type; }
    }
  }
  if (isHigherQualification(bestQual)) {
    multiplier *= OQ_BONUSES.higherQualification;
  }

  // Car (even if not required)
  if (!position.car_required && nanny.has_car) {
    multiplier *= OQ_BONUSES.carUnrequired;
  }

  // Immediate start
  if (position.urgency === 'As soon as possible' && nanny.immediate_start_available) {
    multiplier *= OQ_BONUSES.immediateStart;
  }

  // Language match
  const nannyLangs = nanny.languages ?? [];
  const nonEnglishLangs = nannyLangs.filter((l) => l.toLowerCase() !== 'english');
  if (nonEnglishLangs.length > 0 && position.language_preference && position.language_preference !== 'English') {
    const details = (position.language_preference_details ?? '').toLowerCase();
    if (details) {
      const requested = details.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
      const hasMatch = nonEnglishLangs.some((l) =>
        requested.some((r) => l.toLowerCase().includes(r) || r.includes(l.toLowerCase()))
      );
      if (hasMatch) multiplier *= OQ_BONUSES.languageMatch;
    } else {
      multiplier *= OQ_BONUSES.languageMatch;
    }
  }

  // Age over minimum
  let ageOver = 0;
  if (position.minimum_age_requirement != null && nannyAge != null) {
    ageOver = nannyAge - position.minimum_age_requirement;
    if (ageOver > 0) {
      const brackets = Math.floor(ageOver / 2);
      if (brackets > 0) {
        multiplier *= Math.min(OQ_BONUSES.ageOverMinCap, Math.pow(OQ_BONUSES.ageOverMinPerTwo, brackets));
      }
    }
  }

  // ── Build bonuses in display order ──
  // 1: Experience (total > under-3 > newborn)
  // 2: Over min age
  // 3: Qualifications
  // 4: Certifications
  // 5: Foreign/multiple language
  // 6: Vehicle (licence > car)
  // 7: Vaccinated
  // 8: Immediate start

  const bonuses: string[] = [];

  // 1 — Experience
  if (nannyExp > 0) {
    bonuses.push(`${nannyExp} ${nannyExp === 1 ? 'yr' : 'yrs'} in childcare`);
  }
  if (nanny.under_3_experience_years && nanny.under_3_experience_years > 0) {
    const u3 = nanny.under_3_experience_years;
    bonuses.push(`${u3} ${u3 === 1 ? 'yr' : 'yrs'} with toddlers`);
  }
  if (nanny.newborn_experience_years && nanny.newborn_experience_years > 0) {
    const nb = nanny.newborn_experience_years;
    bonuses.push(`${nb} ${nb === 1 ? 'yr' : 'yrs'} with newborns`);
  }

  // 2 — Over min age
  if (ageOver > 0) {
    bonuses.push(`${ageOver} ${ageOver === 1 ? 'yr' : 'yrs'} older`);
  }

  // 3 — Qualifications (ladder short label; rank 0 — none / other / off-ladder — shows nothing)
  if (bestQual && qualificationRank(bestQual) > 0) {
    bonuses.push(ladderShortLabel(bestQual));
  }

  // 4 — Certifications (P-2 order; paediatric collapse)
  for (const cert of displayCertificates(certs)) {
    bonuses.push(cert);
  }

  // 5 — Languages (non-English only)
  if (nonEnglishLangs.length > 0) {
    bonuses.push(`Bilingual (${nonEnglishLangs.join(', ')})`);
  }

  // 6 — Vehicle
  if (nanny.drivers_license) bonuses.push("Driver's licence");
  if (nanny.has_car) bonuses.push('Owns a car');

  // 7 — Vaccinated
  if (nanny.vaccination_status) bonuses.push('Fully vaccinated');

  // 8 — Immediate start
  if (position.urgency === 'As soon as possible' && nanny.immediate_start_available) {
    bonuses.push('Immediate start');
  }

  return {
    multiplier: Math.min(OQ_MULTIPLIER_CAP, multiplier),
    bonuses,
  };
}

// ── Final score ──

export function calculateFinalScore(
  qualityBase: number,
  requirementMultiplier: number,
  overQualifiedMultiplier: number
): { rawScore: number; finalScore: number } {
  const rawScore = qualityBase * requirementMultiplier * overQualifiedMultiplier;

  // Map to display range (50-100%)
  const display = Math.round(
    DISPLAY_MIN + (rawScore / 100) * (DISPLAY_MAX - DISPLAY_MIN)
  );
  const finalScore = Math.min(DISPLAY_MAX, Math.max(DISPLAY_MIN, display));

  return { rawScore, finalScore };
}
