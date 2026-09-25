// Mock data for all 17 page client components rendered on /ui showcase
// Types imported from their source files for type safety

import type { InterviewRequestWithDetails } from "@/lib/actions/interview";
import type { ConnectionRequestWithDetails } from "@/lib/actions/connection";
import type { InboxMessage } from "@/lib/actions/inbox";
import type {
  NannyBabysittingJob,
  BabysittingRequestWithSlots,
  PublicBsrProfile,
} from "@/lib/actions/babysitting";
import type { VerificationData } from "@/lib/actions/verification";
import type { ParentVerificationData } from "@/types/parent";
import type { UpcomingIntro } from "@/lib/actions/position-funnel";
import type { PositionWithChildren } from "@/lib/actions/parent";
import type {
  UserData,
  UserStats,
  VerificationStats,
  PendingIdentityCheck,
  PendingWWCCCheck,
} from "@/app/admin/users/page";
import type { PendingParentIdentityCheck } from "@/app/admin/users/ParentIDCheckModal";

// ── Interview Requests (CMP-050, CMP-057) ──────────────────────────

export const MOCK_INTERVIEW_REQUESTS: InterviewRequestWithDetails[] = [
  {
    id: "mock-ir-001",
    parent_id: "mock-parent-001",
    nanny_id: "mock-nanny-001",
    position_id: "mock-pos-001",
    status: "pending",
    proposed_times: [
      "2026-03-15_morning",
      "2026-03-16_afternoon",
      "2026-03-17_morning",
    ],
    selected_time: null,
    message: "We'd love to chat about our childcare needs for two kids.",
    created_at: "2026-03-10T08:00:00Z",
    updated_at: "2026-03-10T08:00:00Z",
    nanny: {
      id: "mock-nanny-001",
      first_name: "Bailey",
      last_name: "Wright",
      suburb: "Bondi",
      hourly_rate_min: 35,
    },
    parent: {
      id: "mock-parent-001",
      first_name: "Jessica",
      last_name: "Chen",
      suburb: "Coogee",
    },
  },
  {
    id: "mock-ir-002",
    parent_id: "mock-parent-002",
    nanny_id: "mock-nanny-002",
    position_id: "mock-pos-002",
    status: "accepted",
    proposed_times: ["2026-03-18_morning", "2026-03-19_midday"],
    selected_time: "2026-03-18_morning",
    message: "Looking for a nanny for our toddler. Flexible on schedule.",
    created_at: "2026-03-08T10:00:00Z",
    updated_at: "2026-03-09T14:00:00Z",
    nanny: {
      id: "mock-nanny-002",
      first_name: "Sophie",
      last_name: "Chen",
      suburb: "Surry Hills",
      hourly_rate_min: 40,
    },
    parent: {
      id: "mock-parent-002",
      first_name: "Mark",
      last_name: "Thompson",
      suburb: "Paddington",
    },
  },
  {
    id: "mock-ir-003",
    parent_id: "mock-parent-003",
    nanny_id: "mock-nanny-003",
    position_id: null,
    status: "declined",
    proposed_times: ["2026-03-20_afternoon"],
    selected_time: null,
    message: null,
    created_at: "2026-03-07T12:00:00Z",
    updated_at: "2026-03-08T09:00:00Z",
    nanny: {
      id: "mock-nanny-003",
      first_name: "Emma",
      last_name: "Taylor",
      suburb: "Manly",
      hourly_rate_min: 30,
    },
    parent: {
      id: "mock-parent-003",
      first_name: "Sarah",
      last_name: "Williams",
      suburb: "Mosman",
    },
  },
];

// ── Babysitting Jobs (CMP-051) ─────────────────────────────────────

export const MOCK_NANNY_BABYSITTING_JOBS: NannyBabysittingJob[] = [
  {
    id: "mock-bsj-001",
    title: "Saturday evening babysitting",
    special_requirements:
      "Bedtime routine at 7:30pm. Youngest needs white noise machine.",
    suburb: "Bondi Beach",
    postcode: "2026",
    address: null,
    hourly_rate: 35,
    estimated_total: 140,
    status: "open",
    accepted_nanny_id: null,
    created_at: "2026-03-09T10:00:00Z",
    expires_at: "2026-03-14T00:00:00Z",
    slots: [
      {
        id: "slot-001",
        slot_date: "2026-03-15",
        start_time: "18:00",
        end_time: "22:00",
        is_selected: false,
      },
    ],
    notification: {
      distanceKm: 2.1,
      notifiedAt: "2026-03-09T10:05:00Z",
      viewedAt: "2026-03-09T11:00:00Z",
      requestedAt: null,
      acceptedAt: null,
      declinedAt: null,
      notifiedFilled: false,
    },
    children: [
      { age_months: 24, gender: "female" },
      { age_months: 48, gender: "male" },
    ],
    clashSlotIds: [],
  },
  {
    id: "mock-bsj-002",
    title: "Weekday afternoon care",
    special_requirements: null,
    suburb: "Coogee",
    postcode: "2034",
    address: null,
    hourly_rate: 30,
    estimated_total: 90,
    status: "open",
    accepted_nanny_id: null,
    created_at: "2026-03-08T14:00:00Z",
    expires_at: "2026-03-13T00:00:00Z",
    slots: [
      {
        id: "slot-002",
        slot_date: "2026-03-12",
        start_time: "14:00",
        end_time: "17:00",
        is_selected: false,
      },
      {
        id: "slot-003",
        slot_date: "2026-03-13",
        start_time: "14:00",
        end_time: "17:00",
        is_selected: false,
      },
    ],
    notification: {
      distanceKm: 4.5,
      notifiedAt: "2026-03-08T14:05:00Z",
      viewedAt: null,
      requestedAt: null,
      acceptedAt: null,
      declinedAt: null,
      notifiedFilled: false,
    },
    children: [{ age_months: 36, gender: "male" }],
    clashSlotIds: [],
  },
];

// ── Inbox Messages (CMP-052, CMP-058) ──────────────────────────────

export const MOCK_INBOX_MESSAGES: InboxMessage[] = [
  {
    id: "mock-msg-001",
    type: "interview_request",
    title: "New interview request from Jessica Chen",
    body: "Jessica from Coogee would like to schedule an interview with you.",
    action_url: "/nanny/interviews",
    reference_id: "mock-ir-001",
    reference_type: "interview_request",
    is_read: false,
    read_at: null,
    metadata: {},
    created_at: "2026-03-10T08:00:00Z",
  },
  {
    id: "mock-msg-002",
    type: "connection_update",
    title: "Connection confirmed with Bailey Wright",
    body: "Your connection with Bailey has been confirmed. Next step: schedule a meet and greet.",
    action_url: "/parent/connections",
    reference_id: "mock-conn-001",
    reference_type: "connection_request",
    is_read: true,
    read_at: "2026-03-09T16:00:00Z",
    metadata: {},
    created_at: "2026-03-09T14:00:00Z",
  },
  {
    id: "mock-msg-003",
    type: "system",
    title: "Welcome to Baby Bloom!",
    body: "Your account has been created. Complete your profile to start connecting.",
    action_url: null,
    reference_id: null,
    reference_type: null,
    is_read: true,
    read_at: "2026-03-08T10:00:00Z",
    metadata: {},
    created_at: "2026-03-08T09:00:00Z",
  },
  {
    id: "mock-msg-004",
    type: "verification",
    title: "Verification update",
    body: "Your WWCC auto-check passed — your profile is now visible to parents.",
    action_url: "/nanny/verification",
    reference_id: null,
    reference_type: null,
    is_read: false,
    read_at: null,
    metadata: {},
    created_at: "2026-03-11T06:00:00Z",
  },
];

// ── Connection Requests (CMP-052, CMP-067) ─────────────────────────

export const MOCK_CONNECTION_REQUESTS: ConnectionRequestWithDetails[] = [
  {
    id: "mock-conn-001",
    parent_id: "mock-parent-001",
    nanny_id: "mock-nanny-001",
    position_id: "mock-pos-001",
    status: "accepted",
    proposed_times: ["2026-03-15_morning", "2026-03-16_afternoon"],
    confirmed_time: "2026-03-15T10:00:00+11:00",
    confirmed_at: "2026-03-11T09:00:00Z",
    message: "We'd love to meet you!",
    decline_reason: null,
    nanny_phone_shared: null,
    expires_at: "2026-03-20T00:00:00Z",
    created_at: "2026-03-09T10:00:00Z",
    updated_at: "2026-03-11T09:00:00Z",
    connection_stage: 20,
    intro_outcome_reported_at: null,
    fill_initiated_by: null,
    trial_date: null,
    trial_reported_at: null,
    nanny: {
      id: "mock-nanny-001",
      user_id: "mock-nanny-user-001",
      first_name: "Bailey",
      last_name: "Wright",
      suburb: "Bondi",
      hourly_rate_min: 35,
      profile_picture_url: null,
    },
    parent: {
      id: "mock-parent-001",
      user_id: "mock-parent-user-001",
      first_name: "Jessica",
      last_name: "Chen",
      suburb: "Coogee",
    },
  },
  {
    id: "mock-conn-002",
    parent_id: "mock-parent-002",
    nanny_id: "mock-nanny-002",
    position_id: "mock-pos-001",
    status: "pending",
    proposed_times: [
      "2026-03-18_morning",
      "2026-03-19_midday",
      "2026-03-20_morning",
    ],
    confirmed_time: null,
    confirmed_at: null,
    message: "Interested in connecting for our part-time nanny position.",
    decline_reason: null,
    nanny_phone_shared: null,
    expires_at: "2026-03-22T00:00:00Z",
    created_at: "2026-03-10T14:00:00Z",
    updated_at: "2026-03-10T14:00:00Z",
    connection_stage: 5,
    intro_outcome_reported_at: null,
    fill_initiated_by: null,
    trial_date: null,
    trial_reported_at: null,
    nanny: {
      id: "mock-nanny-002",
      user_id: "mock-nanny-user-002",
      first_name: "Sophie",
      last_name: "Chen",
      suburb: "Surry Hills",
      hourly_rate_min: 40,
      profile_picture_url: null,
    },
    parent: {
      id: "mock-parent-002",
      user_id: "mock-parent-user-002",
      first_name: "Mark",
      last_name: "Thompson",
      suburb: "Paddington",
    },
  },
];

// ── Verification Data (CMP-053) ────────────────────────────────────
// CRITICAL: Set statuses to "verified"/"not_started" to avoid polling

export const MOCK_VERIFICATION_DATA: VerificationData = {
  id: "mock-verif-001",
  identity_status: "verified",
  wwcc_status: "verified",
  contact_status: "not_started",
  cross_check_status: "not_started",
  verification_status: 2,
  surname: "Wright",
  given_names: "Bailey Jane",
  date_of_birth: "1998-05-15",
  passport_country: "AU",
  passport_upload_url: null,
  identification_photo_url: null,
  identity_verified: true,
  identity_rejection_reason: null,
  identity_user_guidance: null,
  extracted_passport_number: "PA1234567",
  extracted_nationality: "Australian",
  wwcc_verification_method: "grant_email",
  wwcc_number: "WWC1234567E",
  wwcc_expiry_date: "2031-06-30",
  wwcc_grant_email_url: null,
  wwcc_service_nsw_screenshot_url: null,
  wwcc_doc_verified: true,
  wwcc_verified: true,
  wwcc_rejection_reason: null,
  wwcc_user_guidance: null,
  phone_number: null,
  address_line: null,
  city: null,
  state: null,
  postcode: null,
  country: null,
  cross_check_reasoning: null,
  created_at: "2026-03-01T00:00:00Z",
  updated_at: "2026-03-10T00:00:00Z",
};

// ── Nanny Share Data (CMP-054) ─────────────────────────────────────

export const MOCK_NANNY_SHARE_DATA = {
  nannyId: "mock-nanny-001",
  firstName: "Bailey",
  age: 27,
  profilePicUrl: null as string | null,
  suburb: "Bondi",
  parentPitch:
    "Bailey is a warm, experienced nanny with a genuine passion for helping children learn and grow. With 4 years of dedicated nanny experience and a Certificate III in Early Childhood, she brings both expertise and heart to every family she works with. Book a free interview today!",
  share: null,
};

// ── Nanny Placements (CMP-055) ─────────────────────────────────────

export const MOCK_NANNY_PLACEMENTS = [
  {
    id: "mock-placement-001",
    parentName: "Jessica",
    parentLastName: "Chen",
    parentSuburb: "Coogee",
    parentPhoto: null as string | null,
    parentDateOfBirth: "1990-03-20",
    weeklyHours: 20,
    hourlyRate: 35,
    hiredAt: "2026-02-15T00:00:00Z",
    startDate: "2026-02-20",
    status: "active",
    positionId: "mock-pos-001",
    parentEmail: "jessica@example.com",
    parentPhone: "0412345678",
    positionFormData: {
      scheduleType: "Part-time",
      hoursPerWeek: 20,
      daysRequired: ["Monday", "Wednesday", "Friday"],
    },
    rosterNotes: "Mondays and Wednesdays 8am-1pm, Fridays 1pm-6pm",
    nannyNotes: null as string | null,
  },
];

// ── Nanny Upcoming Intros (CMP-055) ────────────────────────────────

export const MOCK_NANNY_UPCOMING_INTROS: UpcomingIntro[] = [
  {
    connectionId: "mock-conn-001",
    otherPartyName: "Jessica Chen",
    otherPartySuburb: "Coogee",
    otherPartyPhoto: null,
    confirmedTime: "2026-03-15T10:00:00+11:00",
    connectionStage: 20,
    fillInitiatedBy: null,
    trialDate: null,
    startDate: null,
    status: "accepted",
    proposedTimes: ["2026-03-15_morning", "2026-03-16_afternoon"],
    message: "We'd love to meet you to discuss our childcare needs.",
    expiresAt: "2026-03-20T00:00:00Z",
    nannyPhoneShared: null,
    positionId: "mock-pos-001",
    position: null,
    source: null,
    nannyId: null,
  },
];

// ── Position With Children (CMP-059) ───────────────────────────────

// TODO(BAI): mock uses legacy `form_data` shape; Position interface is flattened.
// Casting keeps UI showcase compiling; update when flat shape is adopted by consumers.
export const MOCK_POSITION_WITH_CHILDREN = {
  id: "mock-pos-001",
  parent_id: "mock-parent-001",
  stage: 7,
  status: "active",
  created_at: "2026-03-01T00:00:00Z",
  updated_at: "2026-03-10T00:00:00Z",
  form_data: {
    scheduleType: "Part-time",
    hoursPerWeek: 20,
    daysRequired: ["Monday", "Wednesday", "Friday"],
    schedule: {
      monday: ["morning", "midday"],
      wednesday: ["morning", "midday"],
      friday: ["afternoon"],
    },
    levelOfSupport: ["Sole charge"],
    hourlyRate: 35,
    urgency: "Within 2 weeks",
    startDate: "2026-03-20",
    placementLength: "6 months+",
    reasonForNanny: ["Return to work"],
    languagePreference: "English",
    qualificationRequirement: "Certificate III or higher",
    certificateRequirements: ["First Aid", "CPR"],
    vaccinationRequired: true,
    driversLicenseRequired: true,
    carRequired: false,
    comfortableWithPetsRequired: true,
    nonSmokerRequired: true,
    suburb: "Coogee",
    description: "Looking for a warm, experienced nanny for our two children.",
  },
  position_status: 1,
  end_reason: null,
  closed_at: null,
  filled_at: null,
  filled_by_nanny_id: null,
  children: [
    {
      id: "child-001",
      position_id: "mock-pos-001",
      child_label: "Child 1",
      age_months: 18,
      gender: "female",
      display_order: 0,
    },
    {
      id: "child-002",
      position_id: "mock-pos-001",
      child_label: "Child 2",
      age_months: 42,
      gender: "male",
      display_order: 1,
    },
  ],
} as unknown as PositionWithChildren;

// ── Position Share Data (CMP-063) ──────────────────────────────────

export const MOCK_POSITION_SHARE_DATA = {
  positionId: "mock-pos-001",
  firstName: "Jessica",
  lastName: "Chen" as string | null,
  profilePicUrl: null as string | null,
  suburb: "Coogee",
  sharePost:
    "Looking for an amazing nanny in Coogee! We need someone warm and experienced for our two little ones (18mo and 3yo). Part-time, Mon/Wed/Fri. If you know a great nanny, tag them below! #SydneyNanny #BabyBloom",
  children: [
    { ageMonths: 18, gender: "female" },
    { ageMonths: 42, gender: "male" },
  ],
  daysRequired: ["Monday", "Wednesday", "Friday"] as string[] | null,
  hoursPerWeek: 20 as number | null,
  hourlyRate: 35 as number | null,
  scheduleType: "Part-time" as string | null,
  share: null,
};

// ── Parent Babysitting Requests (CMP-064) ──────────────────────────

export const MOCK_PARENT_BSR_REQUESTS: BabysittingRequestWithSlots[] = [
  {
    id: "mock-bsr-001",
    parent_id: "mock-parent-001",
    title: "Saturday evening babysitter needed",
    description: "Date night! Need someone for 4 hours.",
    special_requirements: "Bedtime at 7:30pm for the youngest.",
    suburb: "Coogee",
    postcode: "2034",
    address: null,
    hourly_rate: 35,
    status: "open",
    accepted_nanny_id: null,
    accepted_at: null,
    nannies_notified_count: 15,
    created_at: "2026-03-09T10:00:00Z",
    expires_at: "2026-03-14T00:00:00Z",
    cancelled_by: null,
    slots: [
      {
        id: "bsr-slot-001",
        slot_date: "2026-03-15",
        start_time: "18:00",
        end_time: "22:00",
        is_selected: false,
      },
    ],
    requestingNannies: [
      {
        nannyId: "mock-nanny-001",
        firstName: "Bailey",
        lastName: "Wright",
        dateOfBirth: "1998-05-15",
        suburb: "Bondi",
        profilePicUrl: null,
        distanceKm: 3.2,
        requestedAt: "2026-03-10T08:00:00Z",
        experienceYears: 4,
        hourlyRateMin: 35,
        verificationTier: "tier2",
        verificationLevel: 3,
        aiHeadline:
          "Experienced nanny with a passion for early childhood development",
        languages: ["English", "French"],
      },
    ],
  },
  {
    id: "mock-bsr-002",
    parent_id: "mock-parent-001",
    title: "After-school care Tuesday",
    description: null,
    special_requirements: null,
    suburb: "Coogee",
    postcode: "2034",
    address: null,
    hourly_rate: 30,
    status: "accepted",
    accepted_nanny_id: "mock-nanny-002",
    accepted_at: "2026-03-07T12:00:00Z",
    nannies_notified_count: 12,
    created_at: "2026-03-05T10:00:00Z",
    expires_at: "2026-03-10T00:00:00Z",
    cancelled_by: null,
    slots: [
      {
        id: "bsr-slot-002",
        slot_date: "2026-03-11",
        start_time: "15:00",
        end_time: "18:00",
        is_selected: true,
      },
    ],
    acceptedNanny: {
      firstName: "Sophie",
      lastName: "Chen",
      dateOfBirth: "1995-08-22",
      suburb: "Surry Hills",
      profilePicUrl: null,
      distanceKm: 5.1,
      phone: "0423456789",
    },
    requestingNannies: [],
  },
];

// Shape re-pointed to `london_districts` by 2a (ADR-188); the VALUES are still
// Sydney's and are owner 2h — `label` is derived so no new literal was typed here.
export const MOCK_DISTRICTS = [
  { district: "Coogee", prefix: "2034" },
  { district: "Bondi", prefix: "2026" },
  { district: "Surry Hills", prefix: "2010" },
  { district: "Paddington", prefix: "2021" },
  { district: "Manly", prefix: "2095" },
].map((d) => ({ ...d, label: `${d.district}, ${d.prefix}` }));

// ── BSR Payment (CMP-065) ──────────────────────────────────────────

export const MOCK_BSR_PROFILE: PublicBsrProfile = {
  id: "mock-bsr-001",
  suburb: "Coogee",
  hourly_rate: 35,
  estimated_hours: 4,
  status: "open",
  special_requirements: "Bedtime at 7:30pm for the youngest.",
  created_at: "2026-03-09T10:00:00Z",
  expires_at: "2026-03-14T00:00:00Z",
  parent_first_name: "Jessica",
  parent_last_name: "Chen",
  parent_profile_pic: null,
  time_slots: [
    { slot_date: "2026-03-15", start_time: "18:00", end_time: "22:00" },
  ],
  children: [
    { ageMonths: 24, gender: "female" },
    { ageMonths: 48, gender: "male" },
  ],
};

// ── BSR Share Data (CMP-066) ───────────────────────────────────────

export const MOCK_BSR_SHARE_DATA = {
  bsrId: "mock-bsr-001",
  firstName: "Jessica",
  lastName: "Chen" as string | null,
  profilePicUrl: null as string | null,
  suburb: "Coogee",
  sharePost:
    "Need a babysitter in Coogee this Saturday evening! 6pm-10pm for two kids (2yo and 4yo). Know someone great? Tag them! #SydneyBabysitter #BabyBloom",
  timeSlots: [
    { slot_date: "2026-03-15", start_time: "18:00", end_time: "22:00" },
  ],
  hourlyRate: 35 as number | null,
  children: [
    { ageMonths: 24, gender: "female" },
    { ageMonths: 48, gender: "male" },
  ],
  bsrStatus: "open",
  share: null,
};

// ── Parent Verification (CMP-068) ──────────────────────────────────
// CRITICAL: Set statuses to "verified"/"not_started" to avoid polling

export const MOCK_PARENT_VERIFICATION_DATA: ParentVerificationData = {
  id: "mock-parent-verif-001",
  document_type: "passport",
  issuing_country: "AU",
  identity_status: "verified",
  contact_status: "not_started",
  cross_check_status: "not_started",
  verification_status: 1,
  surname: "Chen",
  given_names: "Jessica",
  date_of_birth: "1990-03-20",
  document_upload_url: null,
  identification_photo_url: null,
  identity_verified: true,
  identity_rejection_reason: null,
  identity_user_guidance: null,
  selfie_confidence: 0.95,
  extracted_surname: "Chen",
  extracted_given_names: "Jessica",
  extracted_dob: "1990-03-20",
  extracted_nationality: "Australian",
  extracted_passport_number: "PA9876543",
  extracted_passport_expiry: "2031-12-01",
  extracted_license_number: null,
  extracted_license_expiry: null,
  extracted_license_state: null,
  extracted_license_class: null,
  phone_number: null,
  address_line: null,
  city: null,
  state: null,
  postcode: null,
  country: null,
  cross_check_reasoning: null,
  created_at: "2026-03-05T00:00:00Z",
  updated_at: "2026-03-10T00:00:00Z",
};

// ── Admin Data (CMP-069) ───────────────────────────────────────────

export const MOCK_ADMIN_USERS: UserData[] = [
  {
    user_id: "mock-user-001",
    first_name: "Bailey",
    last_name: "Wright",
    email: "bailey@example.com",
    suburb: "Bondi",
    postcode: "2026",
    profile_picture_url: null,
    mobile_number: "0412345678",
    date_of_birth: "1998-05-15",
    created_at: "2026-02-01T00:00:00Z",
    role: "nanny",
    nanny_status: "active",
    verification_level: 2,
    verification_status: 2,
    wwcc_verified: true,
    identity_verified: true,
    parent_status: null,
    babysitter_eligible: true,
    nanny_id: null,
  },
  {
    user_id: "mock-user-002",
    first_name: "Jessica",
    last_name: "Chen",
    email: "jessica@example.com",
    suburb: "Coogee",
    postcode: "2034",
    profile_picture_url: null,
    mobile_number: "0423456789",
    date_of_birth: "1990-03-20",
    created_at: "2026-02-10T00:00:00Z",
    role: "parent",
    nanny_status: null,
    verification_level: 1,
    verification_status: 1,
    wwcc_verified: null,
    identity_verified: true,
    parent_status: "active",
    babysitter_eligible: null,
    nanny_id: null,
  },
  {
    user_id: "mock-user-003",
    first_name: "Sophie",
    last_name: "Chen",
    email: "sophie@example.com",
    suburb: "Surry Hills",
    postcode: "2010",
    profile_picture_url: null,
    mobile_number: "0434567890",
    date_of_birth: "1995-08-22",
    created_at: "2026-02-15T00:00:00Z",
    role: "nanny",
    nanny_status: "active",
    verification_level: 3,
    verification_status: 3,
    wwcc_verified: true,
    identity_verified: true,
    parent_status: null,
    babysitter_eligible: true,
    nanny_id: null,
  },
  {
    user_id: "mock-user-004",
    first_name: "Admin",
    last_name: "User",
    email: "admin@babybloom.com.au",
    suburb: "Sydney",
    postcode: "2000",
    profile_picture_url: null,
    mobile_number: null,
    date_of_birth: null,
    created_at: "2026-01-01T00:00:00Z",
    role: "admin",
    nanny_status: null,
    verification_level: null,
    verification_status: null,
    wwcc_verified: null,
    identity_verified: null,
    parent_status: null,
    babysitter_eligible: null,
    nanny_id: null,
  },
  {
    user_id: "mock-user-005",
    first_name: "Emma",
    last_name: "Taylor",
    email: "emma@example.com",
    suburb: "Manly",
    postcode: "2095",
    profile_picture_url: null,
    mobile_number: "0445678901",
    date_of_birth: "2000-11-03",
    created_at: "2026-03-01T00:00:00Z",
    role: "nanny",
    nanny_status: "pending",
    verification_level: 0,
    verification_status: 0,
    wwcc_verified: false,
    identity_verified: false,
    parent_status: null,
    babysitter_eligible: false,
    nanny_id: null,
  },
];

export const MOCK_ADMIN_USER_STATS: UserStats = {
  total: 127,
  nannies: 82,
  parents: 42,
  admins: 3,
};

export const MOCK_ADMIN_VERIFICATION_STATS: VerificationStats = {
  pending: 8,
  approvedToday: 3,
  rejectedToday: 1,
  totalVerified: 64,
};

export const MOCK_ADMIN_IDENTITY_CHECKS: PendingIdentityCheck[] = [
  {
    id: "mock-id-check-001",
    user_id: "mock-user-005",
    surname: "Taylor",
    given_names: "Emma Louise",
    date_of_birth: "2000-11-03",
    passport_country: "AU",
    passport_upload_url: null,
    identification_photo_url: null,
    identity_verified: false,
    identity_rejection_reason: null,
    verification_status: 0,
    created_at: "2026-03-10T10:00:00Z",
    first_name: "Emma",
    last_name: "Taylor",
    email: "emma@example.com",
    profile_picture_url: null,
    extracted_surname: "Taylor",
    extracted_given_names: "Emma Louise",
    extracted_dob: "2000-11-03",
    extracted_nationality: "Australian",
    extracted_passport_number: "PA5555555",
    extracted_passport_expiry: "2030-01-15",
    identity_ai_reasoning:
      "Name and DOB match. Photo similarity: 92%. Passport is valid and unexpired.",
    identity_ai_issues: null,
  },
];

export const MOCK_ADMIN_WWCC_CHECKS: PendingWWCCCheck[] = [
  {
    id: "mock-wwcc-check-001",
    user_id: "mock-user-005",
    surname: "Taylor",
    given_names: "Emma Louise",
    date_of_birth: "2000-11-03",
    wwcc_number: "WWC9999999E",
    wwcc_verification_method: "service_nsw",
    wwcc_verified: false,
    wwcc_rejection_reason: null,
    verification_status: 0,
    created_at: "2026-03-10T11:00:00Z",
    first_name: "Emma",
    last_name: "Taylor",
    email: "emma@example.com",
    profile_picture_url: null,
    wwcc_ocg_submitted_at: null,
  },
];

export const MOCK_ADMIN_PARENT_VERIFICATION_STATS = {
  pending: 3,
  approvedToday: 1,
  rejectedToday: 0,
};

export const MOCK_ADMIN_PARENT_CHECKS: PendingParentIdentityCheck[] = [
  {
    id: "mock-parent-check-001",
    user_id: "mock-user-002",
    document_type: "passport",
    issuing_country: "AU",
    surname: "Chen",
    given_names: "Jessica",
    date_of_birth: "1990-03-20",
    document_upload_url: null,
    identification_photo_url: null,
    identity_verified: false,
    identity_rejection_reason: null,
    verification_status: 0,
    selfie_confidence: 0.88,
    extracted_surname: "Chen",
    extracted_given_names: "Jessica",
    extracted_dob: "1990-03-20",
    extracted_nationality: "Australian",
    extracted_passport_number: "PA9876543",
    extracted_passport_expiry: "2031-12-01",
    extracted_license_number: null,
    extracted_license_expiry: null,
    extracted_license_state: null,
    extracted_license_class: null,
    identity_ai_reasoning: "All fields match. Selfie confidence 88%.",
    identity_ai_issues: null,
    created_at: "2026-03-09T14:00:00Z",
    first_name: "Jessica",
    last_name: "Chen",
    email: "jessica@example.com",
  },
];
