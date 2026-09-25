import type { NannyCardData } from "@/components/NannyCard";

// ── Nanny mock data ──────────────────────────────────────────────

export const FALLBACK_NANNY: NannyCardData = {
  id: "mock-nanny-001",
  user_id: "mock-nanny-user-001",
  first_name: "Bailey",
  last_name: "Wright",
  suburb: "Clapham",
  profile_picture_url: null,
  hourly_rate_min: 28,
  nanny_experience_years: 4,
  total_experience_years: 6,
  under_3_experience_years: 3,
  newborn_experience_years: 1,
  highest_qualification: "Certificate III in Early Childhood Education and Care",
  verification_tier: "tier2",
  verification_level: 3,
  drivers_license: true,
  vaccination_status: true,
  languages: ["English", "French"],
  role_types_preferred: ["Nanny", "Babysitter"],
  ai_headline:
    "Experienced and warm nanny with a passion for early childhood development",
};

export const FALLBACK_NANNY_2: NannyCardData = {
  id: "mock-nanny-002",
  user_id: "mock-nanny-user-002",
  first_name: "Sophie",
  last_name: "Chen",
  suburb: "Islington",
  profile_picture_url: null,
  hourly_rate_min: 30,
  nanny_experience_years: 7,
  total_experience_years: 10,
  under_3_experience_years: 5,
  newborn_experience_years: 2,
  highest_qualification: "Diploma of Early Childhood Education and Care",
  verification_tier: "tier3",
  verification_level: 4,
  drivers_license: true,
  vaccination_status: true,
  languages: ["English", "Mandarin"],
  role_types_preferred: ["Nanny"],
  ai_headline: "Qualified early childhood educator with 7 years of dedicated nanny experience",
};

export const FALLBACK_NANNY_3: NannyCardData = {
  id: "mock-nanny-003",
  user_id: "mock-nanny-user-003",
  first_name: "Emma",
  last_name: "Taylor",
  suburb: "Camden Town",
  profile_picture_url: null,
  hourly_rate_min: 22,
  nanny_experience_years: 2,
  total_experience_years: 3,
  under_3_experience_years: null,
  newborn_experience_years: null,
  highest_qualification: null,
  verification_tier: "tier1",
  verification_level: 1,
  drivers_license: false,
  vaccination_status: true,
  languages: ["English"],
  role_types_preferred: ["Babysitter"],
  ai_headline: "Fun and energetic babysitter who loves outdoor activities and creative play",
};

// ── Parent mock data ─────────────────────────────────────────────

export interface MockParentData {
  first_name: string;
  last_name: string;
  suburb: string;
  profile_picture_url: string | null;
}

export const FALLBACK_PARENT: MockParentData = {
  first_name: "Bailey",
  last_name: "Wright",
  suburb: "Hackney",
  profile_picture_url: null,
};

// ── Position / PositionAccordion data ────────────────────────────

export const MOCK_POSITION = {
  scheduleType: "Part-time",
  hoursPerWeek: 20,
  daysRequired: ["Monday", "Wednesday", "Friday"],
  schedule: {
    monday: ["morning", "midday"],
    wednesday: ["morning", "midday"],
    friday: ["afternoon"],
  } as Record<string, string[]>,
  levelOfSupport: ["Sole charge", "Shared care"],
  hourlyRate: 35,
  children: [
    { ageMonths: 18, gender: "female" },
    { ageMonths: 42, gender: "male" },
  ],
  urgency: "Within 2 weeks",
  startDate: "2026-03-20",
  placementLength: "6 months+",
  reasonForNanny: ["Return to work", "Childcare availability"],
  languagePreference: "English",
  qualificationRequirement: "Certificate III or higher",
  certificateRequirements: ["First Aid", "CPR"],
  vaccinationRequired: true,
  driversLicenseRequired: true,
  carRequired: false,
  comfortableWithPetsRequired: true,
  nonSmokerRequired: true,
  otherRequirements: null,
  suburb: "Hackney",
  description: "Looking for a warm, experienced nanny for our two children.",
};

// ── Nanny schedule (for AvailabilityTable) ───────────────────────

export const MOCK_NANNY_SCHEDULE: Record<string, string[]> = {
  monday: ["morning", "midday", "afternoon"],
  tuesday: ["morning", "midday"],
  wednesday: ["morning", "midday", "afternoon", "evening"],
  thursday: [],
  friday: ["morning", "midday"],
  saturday: ["morning"],
  sunday: [],
};

// ── Verification steps ──────────────────────────────────────────

export const MOCK_VERIFICATION_STEPS_PARTIAL = [
  { label: "WWCC Check", status: "verified" },
  { label: "Passport", status: "pending" },
  { label: "Facebook Share", status: "not_started" },
];

export const MOCK_VERIFICATION_STEPS_COMPLETE = [
  { label: "WWCC Check", status: "verified" },
  { label: "Passport", status: "verified" },
  { label: "Facebook Share", status: "verified" },
];

// ── Funnel progress steps ───────────────────────────────────────

export const MOCK_FUNNEL_STEPS = [
  { id: "basics", label: "Basics" },
  { id: "experience", label: "Experience" },
  { id: "qualifications", label: "Qualifications" },
  { id: "availability", label: "Availability" },
  { id: "preferences", label: "Preferences" },
  { id: "about-you", label: "About You" },
  { id: "photos", label: "Photos" },
  { id: "review", label: "Review" },
];

// ── UpcomingIntro (for ConnectionDetailPopup) ────────────────────

export const MOCK_UPCOMING_INTRO = {
  connectionId: "mock-connection-001",
  otherPartyName: "Bailey Wright",
  otherPartySuburb: "Hackney",
  otherPartyPhoto: null as string | null,
  confirmedTime: "2026-03-15T10:00:00+00:00",
  connectionStage: 20, // INTRO_SCHEDULED
  fillInitiatedBy: null as string | null,
  trialDate: null as string | null,
  startDate: null as string | null,
  status: "accepted",
  proposedTimes: [
    "2026-03-15_morning",
    "2026-03-16_afternoon",
    "2026-03-17_morning",
  ],
  message: "Hi! We'd love to meet you to discuss our childcare needs.",
  expiresAt: "2026-03-20T00:00:00+00:00",
  nannyPhoneShared: null as string | null,
  positionId: "mock-position-001",
  position: MOCK_POSITION,
  source: "matchmaking",
  nannyId: null as string | null,
};

// ── Proposed times for ScheduleTimeGrid ──────────────────────────

export const MOCK_PROPOSED_TIMES = [
  "2026-03-15_morning",
  "2026-03-15_afternoon",
  "2026-03-16_morning",
  "2026-03-17_midday",
  "2026-03-18_morning",
  "2026-03-19_afternoon",
];

// ── MatchResult (for MatchCard) ──────────────────────────────────

export const MOCK_MATCH_RESULT = {
  nannyId: "mock-nanny-001",
  nanny: {
    id: "mock-nanny-001",
    user_id: "mock-nanny-user-001",
    total_experience_years: 6,
    nanny_experience_years: 4,
    under_3_experience_years: 3,
    newborn_experience_years: 1,
    max_children: 3,
    min_child_age_months: 6,
    max_child_age_months: 120,
    additional_needs_ok: true,
    drivers_license: true,
    has_car: true,
    vaccination_status: true,
    non_smoker: true,
    comfortable_with_pets: true,
    hourly_rate_min: 28,
    languages: ["English", "French"],
    role_types_preferred: ["Nanny", "Babysitter"],
    level_of_support_offered: ["Sole charge", "Shared care"],
    immediate_start_available: true,
    ai_content: {
      headline: "Experienced and warm nanny with a passion for early childhood development",
    },
  },
  profile: {
    user_id: "mock-nanny-user-001",
    first_name: "Bailey",
    last_name: "Wright",
    suburb: "Clapham",
    postcode: "SW4",
    date_of_birth: "1998-05-15",
    profile_picture_url: null as string | null,
  },
  qualityBase: 82,
  requirementMultiplier: 1.0,
  overQualifiedMultiplier: 1.05,
  rawScore: 86.1,
  finalScore: 86,
  breakdown: {
    location: 90,
    schedule: 85,
    experience: 88,
    roleFit: 80,
    qualifications: 75,
    supportFit: 90,
  },
  distanceKm: 4.2,
  scheduleOverlapPercent: 75,
  highestQualification: "Certificate III in Early Childhood",
  certifications: ["First Aid", "CPR", "Working With Children"],
  nannySchedule: MOCK_NANNY_SCHEDULE,
  unmetRequirements: ["Car not always available"],
  overQualifiedBonuses: ["Additional needs experience", "Newborn specialist"],
};

// ── DFY Status (for MatchResultsClient) ──────────────────────────

export const MOCK_DFY_STATUS = {
  activated: true,
  activatedAt: "2026-03-01T00:00:00Z",
  expiresAt: "2026-03-15T00:00:00Z",
  expired: false,
  notifiedCount: 12,
  interestedCount: 5,
  connectedCount: 2,
  tier: "standard" as const,
  maxRespondents: 20,
  positionId: "mock-position-001",
};

// ── Match data for ConnectionDetailPopup ─────────────────────────

export const MOCK_CONNECTION_MATCH_DATA = {
  matchScore: 86,
  distanceKm: 4.2,
  breakdown: { experience: 88, schedule: 85, location: 90 },
  nannySchedule: MOCK_NANNY_SCHEDULE,
  aiHeadline: "Experienced and warm nanny with a passion for early childhood development",
  tier: "standard" as const,
  nannyId: "mock-nanny-001",
  overQualifiedBonuses: ["Additional needs experience"],
  unmetRequirements: ["Car not always available"],
};
