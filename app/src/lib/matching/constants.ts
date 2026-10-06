// Unit 3e (BB-LDN-3e-061026): `QUAL_SCORES` is derived from 3a's `QUALIFICATION_LADDER` (E-2 scores Other 10 · L2 30 ·
// L3 50 · L5 75 · L6 100); this file never lists qualification labels itself.
import { QUALIFICATION_LADDER } from "@/lib/nanny-options";

// ── Matching algorithm constants ──

// Quality base weights (must sum to 1.0)
export const WEIGHTS = {
  location: 0.25,
  schedule: 0.30,
  experience: 0.20,
  roleFit: 0.10,
  qualifications: 0.10,
  supportFit: 0.05,
} as const;

// Role mapping: parent form value → nanny form value
export const ROLE_MAP: Record<string, string> = {
  "Mother's Help": "Mothers Help",
  "Returning to work": "Back-to-Work Support",
  "Pick Up & Drop Off": "Pick Up & Drop Off",
  "Household Support": "Home Management",
  "Child Development": "Child Development",
  "Education & Development": "Child Development",
};

// Support mapping: focus_type|support_type → nanny level_of_support_offered value
export const SUPPORT_MAP: Record<string, string> = {
  "Just supervision|Just standard routines": "Supervision",
  "Educational play|Just standard routines": "Engagement and Play",
  "Just supervision|Tailored developmental support": "Educational Support",
  "Educational play|Tailored developmental support": "Developmental Assistance",
};

// Support level hierarchy (index = sophistication)
export const SUPPORT_LEVELS = [
  "Supervision",
  "Engagement and Play",
  "Educational Support",
  "Developmental Assistance",
] as const;

// Availability block normalization: nanny format → parent format
export const NANNY_BLOCK_MAP: Record<string, string> = {
  "Morning (6am-10am)": "morning",
  "Midday (10am-2pm)": "midday",
  "Afternoon (2pm-6pm)": "afternoon",
  "Evening (6pm-10pm)": "evening",
};

// Qualification scoring (highest wins) — derived from 3a's ladder (E-2); never a local list (unit 3e)
export const QUAL_SCORES: Record<string, number> = Object.fromEntries(
  QUALIFICATION_LADDER.map((q) => [q.value, q.score]),
);

// Location distance scoring brackets
export const DISTANCE_BRACKETS: Array<{ maxKm: number; score: number }> = [
  { maxKm: 2, score: 100 },
  { maxKm: 5, score: 85 },
  { maxKm: 10, score: 65 },
  { maxKm: 15, score: 45 },
  { maxKm: 20, score: 25 },
  { maxKm: 30, score: 10 },
];

// Non-linear schedule coverage curve
export const SCHEDULE_CURVE: Array<{ minCoverage: number; score: number }> = [
  { minCoverage: 1.0, score: 100 },
  { minCoverage: 0.9, score: 92 },
  { minCoverage: 0.8, score: 75 },
  { minCoverage: 0.7, score: 55 },
  { minCoverage: 0.5, score: 25 },
  { minCoverage: 0.0, score: 5 },
];

// Requirement penalty multipliers (when unmet)
export const REQUIREMENT_PENALTIES = {
  childAgeRange: 0.5,
  capacity: 0.6,
  specialNeeds: 0.6,
  driversLicense: 0.7,
  car: 0.7,
  vaccination: 0.8,
  nonSmoker: 0.8,
  petsComfort: 0.85,
  nannyAgeMild: 0.85,   // under by 1-3yr
  nannyAgeSevere: 0.7,  // under by 4+yr
} as const;

// Requirement penalty floor (product can't go below this)
export const REQUIREMENT_MULTIPLIER_FLOOR = 0.3;

// Over-qualified bonus multipliers
export const OQ_BONUSES = {
  extraExperiencePerYear: 1.03,    // per extra year over requirement
  extraExperienceCap: 1.15,        // max from experience alone
  certificationPer: 1.04,          // per certification held
  certificationCap: 1.12,          // max from certs alone
  higherQualification: 1.05,       // Level 5 or Level 6 (P-6, isHigherQualification)
  carUnrequired: 1.03,             // has car even if not required
  immediateStart: 1.05,            // ASAP match
  languageMatch: 1.04,             // language alignment
  ageOverMinPerTwo: 1.02,          // per 2yr over minimum age
  ageOverMinCap: 1.06,             // max from age alone
} as const;

// Over-qualified multiplier cap
export const OQ_MULTIPLIER_CAP = 1.25;

// Display score range
export const DISPLAY_MIN = 50;
export const DISPLAY_MAX = 100;

// DFY matchmaker tier configuration
export const DFY_TIERS = {
  standard: {
    totalNannies: 20,
    waves: 1,
    maxRespondents: 5,
    expiryDays: 3,
    followUpReminders: false,
  },
  priority: {
    totalNannies: 50,
    waves: 3,
    maxRespondents: 10,
    expiryDays: 7,
    followUpReminders: true,
  },
} as const;

export type DfyTier = keyof typeof DFY_TIERS;
