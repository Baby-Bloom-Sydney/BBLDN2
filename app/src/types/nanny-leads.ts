// ── Nanny Leads TypeScript Interfaces ──
// Matches the nanny_leads table schema + V2 form structure

export interface NannyLeadIdentity {
  motivation: string | null;
  motivation_other?: string | null;
  personality_traits: string[];
  level_of_support: string[];
  professional_values: string[];
}

export interface ChildcareRole {
  role: string;
  role_other?: string;
  duration: number; // years
}

export interface NannyLeadExperience {
  date_of_birth: string | null; // ISO date
  total_experience: string | null; // "0"-"10+"
  under_3_experience_yn: boolean | null;
  under_3_experience: number | null; // slider value (years)
  newborn_experience_yn: boolean | null;
  newborn_experience: number | null; // slider value (years)
  childcare_roles: ChildcareRole[];
  no_childcare_experience: boolean;
}

export interface NannyLeadQualifications {
  has_qualifications: boolean | null;
  highest_qualification: string | null;
  has_certificates: boolean | null;
  certificates: string[];
  wwcc: boolean | null;
}

export interface NannyLeadResidency {
  nationality: string | null;
  residency_status: string | null;
  right_to_work: boolean | null;
  sydney_resident: boolean | null;
  suburb: string | null;
  postcode: string | null;
}

export interface NannyLeadPreferences {
  role_types: string[];
  max_children: number | null;
  min_age: string | null;
  max_age: string | null;
  additional_needs: boolean | null;
  comfortable_with_pets: boolean | null;
}

export interface NannyLeadAvailability {
  available_days: string[];
  day_times: Record<string, string[]>; // { monday: ["Morning (6am-10am)"] }
  immediate_start: string | null; // "Yes" | "At a later date"
  start_date: string | null;
  placement_ongoing: string | null; // "Yes" | "Until a certain date"
  end_date: string | null;
}

export interface NannyLeadSalary {
  hourly_rate_min: string | null; // "£40.00" — the symbol should not be in the string; see LEDGER/2d.md §1 Group C
  pay_frequency: string[];
}

export interface NannyLeadMatching {
  languages: string[];
  other_languages: string | null;
  drivers_license: boolean | null;
  has_car: boolean | null;
  vaccination_status: boolean | null;
  non_smoker: boolean | null;
}

export interface NannyLeadAboutYou {
  profile_picture_url: string | null;
  photo_1_url: string | null;
  photo_2_url: string | null;
  photo_3_url: string | null;
}

// ── Backend-only qualifying signals (not user-facing, not in AI prompt) ──
// Lives in nanny_leads.lead_signals JSONB. Schema-flexible: new signals add
// a key here without further migration. Architecturally isolated from
// `experience` (which is read into the AI bio prompt) — never surface to
// nannies, parents, or any model input.

export interface NannyLeadSignals {
  external_u3_position: boolean | null;
}

// ── Full funnel state (client-side) ──

export interface NannyLeadFunnelState {
  // Contact (N1.5) - top-level
  first_name: string;
  last_name: string;
  email: string;
  phone: string;

  // N1 JSONB sections
  identity: NannyLeadIdentity;
  experience: NannyLeadExperience;
  qualifications: NannyLeadQualifications;
  residency: NannyLeadResidency;

  // N3 JSONB sections
  preferences: NannyLeadPreferences;
  availability: NannyLeadAvailability;
  salary: NannyLeadSalary;
  matching: NannyLeadMatching;
  about_you: NannyLeadAboutYou;

  // Backend-only signals (any stage)
  lead_signals: NannyLeadSignals;

  // N4
  ai_bio: string | null;
  ai_content: Record<string, unknown> | null;

  // Tracking
  leadId: string | null;
  currentStage: FunnelStage;
  currentPage: number;
}

export type FunnelStage = "N1" | "N2" | "N3" | "N4" | "N5";

// ── Action types for useReducer ──

export type FunnelAction =
  | { type: "UPDATE_IDENTITY"; payload: Partial<NannyLeadIdentity> }
  | { type: "UPDATE_EXPERIENCE"; payload: Partial<NannyLeadExperience> }
  | { type: "UPDATE_QUALIFICATIONS"; payload: Partial<NannyLeadQualifications> }
  | { type: "UPDATE_RESIDENCY"; payload: Partial<NannyLeadResidency> }
  | {
      type: "UPDATE_CONTACT";
      payload: Partial<
        Pick<
          NannyLeadFunnelState,
          "first_name" | "last_name" | "email" | "phone"
        >
      >;
    }
  | { type: "UPDATE_PREFERENCES"; payload: Partial<NannyLeadPreferences> }
  | { type: "UPDATE_AVAILABILITY"; payload: Partial<NannyLeadAvailability> }
  | { type: "UPDATE_SALARY"; payload: Partial<NannyLeadSalary> }
  | { type: "UPDATE_MATCHING"; payload: Partial<NannyLeadMatching> }
  | { type: "UPDATE_ABOUT_YOU"; payload: Partial<NannyLeadAboutYou> }
  | { type: "UPDATE_LEAD_SIGNALS"; payload: Partial<NannyLeadSignals> }
  | { type: "SET_AI_BIO"; payload: string }
  | { type: "SET_AI_CONTENT"; payload: Record<string, unknown> }
  | { type: "SET_LEAD_ID"; payload: string }
  | { type: "SET_STAGE"; payload: FunnelStage }
  | { type: "SET_PAGE"; payload: number }
  | { type: "RESTORE_STATE"; payload: NannyLeadFunnelState };

// ── Option Constants ──

export const MOTIVATION_OPTIONS = [
  "Supporting families",
  "Developing young minds",
  "Giving children the best possible start",
  "Making a real difference",
  "The flexibility",
  "Other",
];

export const PERSONALITY_TRAIT_OPTIONS = [
  "Patient",
  "Creative",
  "Energetic",
  "Nurturing",
  "Calm",
  "Organised",
  "Warm",
  "Reliable",
  "Adaptable",
  "Empathetic",
  "Playful",
  "Attentive",
];

export const LEVEL_OF_SUPPORT_OPTIONS = [
  "Supervision",
  "Engagement and Play",
  "Educational Support",
  "Developmental Assistance",
];

export const PROFESSIONAL_VALUE_OPTIONS = [
  "Encouraging independence",
  "Being consistent and dependable",
  "Staying calm under pressure",
  "Teaching through play",
  "Taking accountability",
  "Adapting to each family's style",
  "Being in tune with a child's needs",
  "Anticipating needs",
  "Being open and transparent",
  "Understanding child development",
  "Following routines with care",
  "Adapting quickly to change",
];

export const EXPERIENCE_OPTIONS = [
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10+",
];

export const CHILDCARE_ROLE_OPTIONS = [
  "Nanny",
  "Babysitter",
  "Au pair",
  "Daycare",
  "Pre-school",
  "School teacher",
  "After-school care",
  "Other",
];

export const QUALIFICATION_OPTIONS = [
  "Certificate III in Early Childhood Education and Care",
  "Certificate IV in Education Support",
  "Diploma of Early Childhood Education and Care",
  "Bachelor of Early Childhood Education (Or Equivalent)",
];

export const CERTIFICATE_OPTIONS = [
  "CPR",
  "First Aid",
  "First Aid in Education & Care Setting",
  "Child Protection",
];

export const ROLE_TYPE_OPTIONS = [
  "Mothers Help",
  "Back-to-Work Support",
  "Pick Up & Drop Off",
  "Child Development",
  "Home Management",
];

export const MAX_CHILDREN_OPTIONS = [1, 2, 3];

export const MIN_AGE_OPTIONS = [
  "Newborn",
  "3 months",
  "6 months",
  "12 months",
  "18 months",
  "2 years",
  "3 years",
  "5 years",
  "10 years",
];

export const MAX_AGE_OPTIONS = [
  "12 months",
  "3 years",
  "5 years",
  "10 years",
  "13 years",
  "16 years",
];

export const DAY_OPTIONS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export const TIME_OPTIONS = [
  "Morning (6am-10am)",
  "Midday (10am-2pm)",
  "Afternoon (2pm-6pm)",
  "Evening (6pm-10pm)",
];

export const PAY_FREQUENCY_OPTIONS = [
  "Daily",
  "Weekly",
  "Fortnightly",
  "Monthly",
];

export const LANGUAGE_OPTIONS = ["English", "Foreign Language", "Multiple"];

export const RESIDENCY_STATUS_OPTIONS = [
  "Australian Citizen",
  "Permanent Resident",
  "Working Holiday",
  "Other",
];

// ── Default State ──

export const DEFAULT_FUNNEL_STATE: NannyLeadFunnelState = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  identity: {
    motivation: null,
    personality_traits: [],
    level_of_support: [],
    professional_values: [],
  },
  experience: {
    date_of_birth: null,
    total_experience: null,
    under_3_experience_yn: null,
    under_3_experience: null,
    newborn_experience_yn: null,
    newborn_experience: null,
    childcare_roles: [],
    no_childcare_experience: false,
  },
  qualifications: {
    has_qualifications: null,
    highest_qualification: null,
    has_certificates: null,
    certificates: [],
    wwcc: null,
  },
  residency: {
    nationality: null,
    residency_status: null,
    right_to_work: null,
    sydney_resident: null,
    suburb: null,
    postcode: null,
  },
  preferences: {
    role_types: [],
    max_children: null,
    min_age: null,
    max_age: null,
    additional_needs: null,
    comfortable_with_pets: null,
  },
  availability: {
    available_days: [],
    day_times: {},
    immediate_start: null,
    start_date: null,
    placement_ongoing: null,
    end_date: null,
  },
  salary: {
    hourly_rate_min: null,
    pay_frequency: [],
  },
  matching: {
    languages: [],
    other_languages: null,
    drivers_license: null,
    has_car: null,
    vaccination_status: null,
    non_smoker: null,
  },
  about_you: {
    profile_picture_url: null,
    photo_1_url: null,
    photo_2_url: null,
    photo_3_url: null,
  },
  lead_signals: {
    external_u3_position: null,
  },
  ai_bio: null,
  ai_content: null,
  leadId: null,
  currentStage: "N1",
  currentPage: 0,
};
