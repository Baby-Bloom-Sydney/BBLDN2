// ── Data interface ──

export interface TypeformFormData {
  // Children
  num_children: number | null;
  child_a_age: string | null;
  child_a_gender: string | null;
  child_b_age: string | null;
  child_b_gender: string | null;
  child_c_age: string | null;
  child_c_gender: string | null;
  child_needs_yn: string | null;
  child_needs_details: string | null;

  // Ideal Nanny
  minimum_age: string | null;
  years_of_experience: string | null;
  language_preference: string | null;
  language_preference_details: string | null;
  drivers_license_required: string | null;
  car_required: string | null;
  vaccination_required: string | null;
  non_smoker_required: string | null;

  // At Home
  suburb: string | null;
  /** London postcode district prefix, e.g. "SW4" (ADR-188). */
  postcode: string | null;
  has_pets: string | null;
  has_pets_details: string | null;
  reason_for_nanny: string | null;
  hours_per_week: string | null;
  schedule_type: string | null;
  weekly_roster: string[];
  monday_roster: string[];
  tuesday_roster: string[];
  wednesday_roster: string[];
  thursday_roster: string[];
  friday_roster: string[];
  saturday_roster: string[];
  sunday_roster: string[];

  // Dream
  placement_length: string | null;
  placement_duration: string | null;
  focus_type: string | null;
  support_type: string | null;
  urgency: string | null;
  start_date: string | null;

  // Dietary
  dietary_restrictions_yn: string | null;
  dietary_restrictions_details: string | null;

  // Notes (post-submission only)
  notes: string | null;
}

export const INITIAL_FORM_DATA: Partial<TypeformFormData> = {
  weekly_roster: [],
  monday_roster: [],
  tuesday_roster: [],
  wednesday_roster: [],
  thursday_roster: [],
  friday_roster: [],
  saturday_roster: [],
  sunday_roster: [],
};

// ── Option constants ──

export const AGE_OPTIONS = [
  "0–3 months",
  "3–6 months",
  "6–12 months",
  "1–2 years",
  "2–3 years",
  "3–4 years",
  "4–5 years",
  "5–10 years",
  "10–13 years",
  "13–16 years",
  "16+",
];

export const GENDER_OPTIONS = ["Female", "Male", "Rather Not Say"];

export const CHILD_NEEDS_OPTIONS = ["Yes", "No", "Rather Not Say"];

export const MIN_AGE_OPTIONS = [
  { value: "18", label: "18+" },
  { value: "21", label: "21+" },
  { value: "25", label: "25+" },
  { value: "28", label: "28+" },
  { value: "35", label: "35+" },
];

export const EXPERIENCE_OPTIONS = [
  { value: "1", label: "1+" },
  { value: "2", label: "2+" },
  { value: "3", label: "3+" },
  { value: "5+", label: "5+" },
];

export const LANGUAGE_OPTIONS = ["English", "Foreign language", "Multiple"];

export const REASON_OPTIONS = [
  "Mother's Help",
  "Returning to work",
  "Pick Up & Drop Off",
  "Household Support",
  "Education & Development",
];

export const HOURS_OPTIONS = ["Under 10", "10–20", "20–30", "30–40", "40+"];

export const DAY_OPTIONS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const DAY_SHORT: Record<string, string> = {
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
  Sunday: "Sun",
};

export const TIME_BLOCK_OPTIONS = [
  { key: "morning", label: "Morning", sublabel: "6am – 10am" },
  { key: "midday", label: "Midday", sublabel: "10am – 2pm" },
  { key: "afternoon", label: "Afternoon", sublabel: "2pm – 6pm" },
  { key: "evening", label: "Evening", sublabel: "6pm – 10pm" },
];

export const DAY_ROSTER_FIELD: Record<string, keyof TypeformFormData> = {
  Monday: "monday_roster",
  Tuesday: "tuesday_roster",
  Wednesday: "wednesday_roster",
  Thursday: "thursday_roster",
  Friday: "friday_roster",
  Saturday: "saturday_roster",
  Sunday: "sunday_roster",
};

export const PLACEMENT_DURATION_OPTIONS = [
  "1–3 months",
  "3–6 months",
  "6–9 months",
  "9–12 months",
];

// ── Question config ──

export type QuestionType =
  | "single-select"
  | "boolean"
  | "multi-select"
  | "compound-children"
  | "compound-days-times"
  | "suburb-autocomplete"
  | "interstitial"
  | "review";

export interface SelectOption {
  value: string;
  label: string;
}

export interface QuestionConfig {
  id: string;
  type: QuestionType;
  question: string;
  subtitle?: string;
  field: keyof TypeformFormData | null;
  options?: SelectOption[];
  // For conditional sub-questions that expand on the same screen
  conditional?: {
    showWhen: (data: Partial<TypeformFormData>) => boolean;
    subField: keyof TypeformFormData;
    subType: "text-input" | "date-input" | "grid-select" | "textarea";
    subLabel?: string;
    subPlaceholder?: string;
    subOptions?: SelectOption[];
    subOptOut?: { value: string; label: string };
  };
  // Skip this question entirely
  skip?: (data: Partial<TypeformFormData>) => boolean;
  // For interstitials
  interstitialText?: string;
  interstitialDuration?: number;
  // Layout hint: how many columns for options
  columns?: number;
}

export const QUESTIONS: QuestionConfig[] = [
  // 1 — Children compound
  {
    id: "children",
    type: "compound-children",
    question: "How many children will be in your nanny's care?",
    field: null,
  },

  // 2 — Minimum age
  {
    id: "min_age",
    type: "single-select",
    question: "How old should the nanny caring for your family be?",
    field: "minimum_age",
    options: MIN_AGE_OPTIONS,
    columns: 2,
  },

  // 3 — Experience
  {
    id: "experience",
    type: "single-select",
    question: "How many years of childcare experience should they have?",
    field: "years_of_experience",
    options: EXPERIENCE_OPTIONS,
    columns: 2,
  },

  // 4 — Language
  {
    id: "language",
    type: "single-select",
    question: "Do you have a language preference for your nanny?",
    field: "language_preference",
    options: LANGUAGE_OPTIONS.map((v) => ({ value: v, label: v })),
    conditional: {
      showWhen: (data) =>
        data.language_preference === "Foreign language" ||
        data.language_preference === "Multiple",
      subField: "language_preference_details",
      subType: "text-input",
      subLabel: "Which languages?",
      subPlaceholder: "e.g. Mandarin, Spanish",
    },
  },

  // 5 — Driver's licence
  {
    id: "drivers_license",
    type: "boolean",
    question: "Should your nanny have a driver's licence?",
    field: "drivers_license_required",
    options: [
      { value: "Yes", label: "Yes, they should" },
      { value: "No", label: "It's not essential" },
    ],
    columns: 2,
  },

  // 6 — Own car — skip if no driver's licence
  {
    id: "car",
    type: "boolean",
    question: "Should they have their own car?",
    field: "car_required",
    options: [
      { value: "Yes", label: "Yes, they should" },
      { value: "No", label: "It's not essential" },
    ],
    columns: 2,
    skip: (data) => data.drivers_license_required === "No",
  },

  // 7 — Suburb
  {
    id: "suburb",
    type: "suburb-autocomplete",
    question: "Where will your nanny primarily be working?",
    field: "suburb",
  },

  // 8 — Hours
  {
    id: "hours",
    type: "single-select",
    question:
      "Roughly, how many hours per week would you like your nanny's support?",
    field: "hours_per_week",
    options: HOURS_OPTIONS.map((v) => ({ value: v, label: v })),
    columns: 2,
  },

  // 9 — Schedule type
  {
    id: "schedule_type",
    type: "single-select",
    question: "Would this be a fixed or flexible arrangement?",
    field: "schedule_type",
    options: [
      { value: "Fixed", label: "Fixed" },
      { value: "Flexible", label: "Flexible" },
    ],
    columns: 2,
  },

  // 10 — Days/Times compound
  {
    id: "days_times",
    type: "compound-days-times",
    question: "On what days would you like your nanny?",
    field: null,
  },

  // 11 — Placement length
  {
    id: "placement_length",
    type: "single-select",
    question: "How long will your nanny be supporting your family?",
    field: "placement_length",
    options: [
      { value: "Ongoing", label: "Ongoing" },
      { value: "Temporarily", label: "Temporarily" },
    ],
    columns: 2,
    conditional: {
      showWhen: (data) => data.placement_length === "Temporarily",
      subField: "placement_duration",
      subType: "grid-select",
      subLabel: "How long for?",
      subOptions: PLACEMENT_DURATION_OPTIONS.map((v) => ({
        value: v,
        label: v,
      })),
    },
  },

  // 12 — Reason
  {
    id: "reason",
    type: "single-select",
    question: "What will your nanny primarily be helping you with?",
    field: "reason_for_nanny",
    options: REASON_OPTIONS.map((v) => ({ value: v, label: v })),
  },

  // 13 — Developmental conditions
  {
    id: "child_needs",
    type: "boolean",
    question:
      "Should your nanny have experience working with children who have developmental conditions?",
    field: "child_needs_yn",
    options: [
      { value: "No", label: "No" },
      { value: "Yes", label: "Yes" },
    ],
    conditional: {
      showWhen: (data) => data.child_needs_yn === "Yes",
      subField: "child_needs_details",
      subType: "textarea",
      subLabel:
        "What developmental conditions would you prefer your nanny to have experience with?",
      subPlaceholder:
        "e.g. autism spectrum, sensory sensitivities, speech delay, ADHD...",
      subOptOut: { value: "Rather Not Say", label: "Rather not say" },
    },
  },

  // 14 — Focus type
  {
    id: "focus_type",
    type: "single-select",
    question:
      "Whilst your nanny is supporting your children, what should they focus on?",
    field: "focus_type",
    options: [
      { value: "Educational play", label: "Educational play" },
      { value: "Just supervision", label: "Just supervision" },
    ],
    columns: 2,
  },

  // 15 — Support type
  {
    id: "support_type",
    type: "single-select",
    question:
      "What type of ongoing support should your nanny focus on providing?",
    field: "support_type",
    options: [
      {
        value: "Tailored developmental support",
        label: "Tailored developmental support",
      },
      {
        value: "Just standard routines",
        label: "Just standard routines",
      },
    ],
    columns: 2,
  },

  // 16 — "And lastly..." interstitial
  {
    id: "and_lastly",
    type: "interstitial",
    question: "",
    field: null,
    interstitialText: "And lastly...",
    interstitialDuration: 2000,
  },

  // 17 — Urgency
  {
    id: "urgency",
    type: "single-select",
    question: "When would you like your nanny to start supporting your family?",
    field: "urgency",
    options: [
      { value: "As soon as possible", label: "As soon as possible" },
      { value: "At a later date", label: "At a later date" },
    ],
    columns: 2,
    conditional: {
      showWhen: (data) => data.urgency === "At a later date",
      subField: "start_date",
      subType: "date-input",
      subLabel: "Start date",
    },
  },

];
