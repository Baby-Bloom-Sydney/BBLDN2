// ── Matching system types ──

export interface PositionMatchData {
  id: string;
  parent_id: string;
  drivers_license_required: boolean | null;
  car_required: boolean | null;
  vaccination_required: boolean | null;
  non_smoker_required: boolean | null;
  comfortable_with_pets_required: boolean | null;
  minimum_age_requirement: number | null;
  years_of_experience: number | null;
  language_preference: string | null;
  language_preference_details: string | null;
  reason_for_nanny: string[] | null;
  schedule_type: string | null;
  urgency: string | null;
  suburb: string | null;
  postcode: string | null;
  details: {
    child_needs?: boolean;
    focus_type?: string | null;
    support_type?: string | null;
  } | null;
}

export interface PositionChildData {
  age_months: number;
}

export interface NannyMatchData {
  id: string;
  user_id: string;
  total_experience_years: number | null;
  nanny_experience_years: number | null;
  under_3_experience_years: number | null;
  newborn_experience_years: number | null;
  max_children: number | null;
  min_child_age_months: number | null;
  max_child_age_months: number | null;
  additional_needs_ok: boolean | null;
  drivers_license: boolean | null;
  has_car: boolean | null;
  vaccination_status: boolean | null;
  non_smoker: boolean | null;
  comfortable_with_pets: boolean | null;
  hourly_rate_min: number | null;
  nationality: string | null;
  languages: string[] | null;
  role_types_preferred: string[] | null;
  level_of_support_offered: string[] | null;
  immediate_start_available: boolean | null;
  ai_content: { headline?: string } | null;
}

export interface NannyProfileData {
  user_id: string;
  first_name: string;
  last_name: string;
  suburb: string | null;
  postcode: string | null;
  date_of_birth: string | null;
  profile_picture_url: string | null;
}

export interface NannyCredentialData {
  nanny_id: string;
  credential_category: string;
  qualification_type: string | null;
  certification_type: string | null;
}

/**
 * A row of `london_districts` — the served London geography (ADR-188).
 * `district` is the place name a family says ("Clapham"), `prefix` the postcode
 * district ("SW4"), `label` the stored display form ("Clapham, SW4").
 */
export interface LondonDistrict {
  area: string;
  district: string;
  prefix: string;
  label: string;
  latitude: number;
  longitude: number;
}

export interface ScoreBreakdown {
  location: number;
  schedule: number;
  experience: number;
  roleFit: number;
  qualifications: number;
  supportFit: number;
}

export interface MatchResult {
  nannyId: string;
  nanny: NannyMatchData;
  profile: NannyProfileData;

  // Scores
  qualityBase: number;
  requirementMultiplier: number;
  overQualifiedMultiplier: number;
  rawScore: number;
  finalScore: number;
  breakdown: ScoreBreakdown;

  // Display metadata
  distanceKm: number | null;
  scheduleOverlapPercent: number;
  highestQualification: string | null;
  certifications: string[];

  // Schedule
  nannySchedule: Record<string, string[]>;

  // Flags
  unmetRequirements: string[];
  overQualifiedBonuses: string[];
}

export interface MatchingResult {
  matches: MatchResult[];
  totalEligible: number;
}
