import type { CheckpointConfig, ConsentModalConfig } from "./types";

// ============================================================
// AGR-01: Client Registration (1 checkbox)
// ============================================================
export const AGR01_CHECKPOINTS: CheckpointConfig[] = [
  {
    id: "agr01_terms_acceptance",
    text: "I have read and agree to the [Client Terms of Service] and [Privacy Policy].",
    links: [
      { label: "Client Terms of Service", href: "/legal/client-terms" },
      { label: "Privacy Policy", href: "/legal/privacy-policy" },
    ],
  },
];

// ============================================================
// AGR-02: Professional Registration (1 checkbox)
// ============================================================
export const AGR02_CHECKPOINTS: CheckpointConfig[] = [
  {
    id: "agr02_terms_acceptance",
    text: "I have read and agree to the [Professional Terms of Service] and [Privacy Policy].",
    links: [
      {
        label: "Professional Terms of Service",
        href: "/legal/professional-terms",
      },
      { label: "Privacy Policy", href: "/legal/privacy-policy" },
    ],
  },
];

// ============================================================
// AGR-03: Client Verification (1 checkbox — after biometric notice scroll-to-end)
// ============================================================
export const AGR03_CHECKPOINTS: CheckpointConfig[] = [
  {
    id: "agr03_biometric_consent",
    text: "I have read the Biometric Data Collection Notice and consent to the collection and processing of my biometric data as described.",
  },
];

// ============================================================
// AGR-04: Professional Verification (1 checkbox — after biometric notice scroll-to-end)
// ============================================================
export const AGR04_CHECKPOINTS: CheckpointConfig[] = [
  {
    id: "agr04_biometric_consent",
    text: "I have read the Biometric Data Collection Notice and consent to the collection and processing of my biometric data as described.",
  },
];

// ============================================================
// AGR-14: Nanny child-add — legal guardian permission
//   (invite-link linking redesign, 2026-05-04)
// ============================================================
export const AGR14_CHECKPOINTS: CheckpointConfig[] = [
  {
    id: "agr14_guardian_permission",
    text: "I confirm I have the child's legal guardian's permission to add this child to Baby Bloom.",
  },
];

// ============================================================
// Modal configurations (v3.0 — informed action buttons, no checkboxes)
// ============================================================

export const AGR06_MODAL_CONFIG: ConsentModalConfig = {
  title: "Before We Connect You",
  subtitle: "Please read the following before requesting this introduction.",
  checkpoints: [],
  buttonText: "Request Introduction",
  agreementId: "AGR-06",
  modalContentVersion: "v3.0-2026-03-23",
  reminderTitle: "Reminder: Your Responsibilities",
  reminderItems: [
    "Baby Bloom is a facilitator only. We have verified this Professional's WWCC and identity at onboarding. We have NOT interviewed, reference-checked, or physically vetted them.",
    "You are responsible for assessing this Professional's suitability during the meet and greet and any trial shifts. You alone determine whether this Professional is right for your family.",
    "You should link to this Professional's WWCC via Service NSW for ongoing status alerts.",
    "If you have CCTV or surveillance devices in your home, you must disclose them to the Professional before any visit.",
    "The period between this Connection and any Hire is between you and the Professional. Baby Bloom does not monitor or supervise these interactions.",
    "Any connection fee paid is non-refundable, regardless of hiring outcome.",
  ],
  reminderFooter:
    "These obligations are set out in full in the [Client Terms of Service](/legal/client-terms).",
  footerText:
    "You will receive the Professional's contact information. Please contact them to arrange a meet and greet.",
};

export const AGR07_MODAL_CONFIG: ConsentModalConfig = {
  title: "Before We Connect You for a Babysitting Session",
  subtitle: "Please read the following before confirming this booking.",
  checkpoints: [],
  buttonText: "Approve Sitter & Share Address",
  agreementId: "AGR-07",
  modalContentVersion: "v3.0-2026-03-23",
  reminderTitle: "Reminder: Your Responsibilities",
  reminderItems: [
    "Baby Bloom is a facilitator only. We have verified this Professional's WWCC and identity. We have NOT interviewed, reference-checked, or vetted them. You are responsible for assessing suitability.",
    "You should link to this Professional's WWCC via Service NSW for ongoing status alerts.",
    "If you have CCTV or surveillance devices in your home, you must disclose them to the Professional before the session.",
    "You agree to pay the Professional directly at the end of the session.",
  ],
  reminderFooter:
    "These obligations are set out in full in the [Client Terms of Service](/legal/client-terms). You must provide the Professional with your child's medical conditions, allergies, emergency contacts, and authorised emergency procedures before the session begins.",
  footerText:
    "You will receive the Professional's phone number and the Professional will receive your home address. Contact them to confirm the booking.",
};

export const AGR08_MODAL_CONFIG: ConsentModalConfig = {
  title: "Before You Accept This Introduction",
  subtitle: "Please read the following before accepting this introduction.",
  checkpoints: [],
  buttonText: "Accept & Share My Phone Number",
  agreementId: "AGR-08",
  modalContentVersion: "v3.0-2026-03-23",
  reminderTitle: "Reminder: Your Obligations",
  reminderItems: [
    "You must keep the Client's identity, household details, and location strictly confidential. Do not disclose any information about the Client or their children on social media, messaging apps, or any public platform. This obligation survives termination.",
    "You agree to maintain professional standards as outlined in the [Code of Conduct](/legal/code-of-conduct).",
    "If hired, you may optionally use Baby Bloom's EdTech tools for developmental logging.",
    "If you fail to respond to a Client introduction within 72 hours, Baby Bloom may send a notice of concern.",
    "The period between this Connection and any Hire is between you and the Client. Baby Bloom does not supervise these interactions.",
    "You agree to indemnify Baby Bloom from any claim arising out of your conduct, except where caused by Baby Bloom's gross negligence or willful misconduct.",
  ],
  reminderFooter:
    "These obligations are set out in full in the [Professional Terms of Service](/legal/professional-terms).",
  footerText:
    "The Client will receive your phone number and will contact you to arrange a meet and greet.",
};

export const AGR09_MODAL_CONFIG: ConsentModalConfig = {
  title: "Before You Accept This Babysitting Job",
  subtitle: "Please read the following before accepting this session.",
  checkpoints: [],
  buttonText: "Accept & Share My Phone Number",
  agreementId: "AGR-09",
  modalContentVersion: "v3.0-2026-03-23",
  reminderTitle: "Reminder: Your Obligations",
  reminderItems: [
    "You must keep the Client's identity, household details, and location strictly confidential.",
    "You agree to maintain professional standards as outlined in the [Code of Conduct](/legal/code-of-conduct).",
    "You are responsible for arranging payment directly with the Client. Baby Bloom does not process payments.",
    "Three or more babysitting cancellations with short notice within 12 months may result in temporary suspension, with right to appeal within 14 days.",
    "You agree to indemnify Baby Bloom from any claim arising out of your conduct, except where caused by Baby Bloom's gross negligence or willful misconduct.",
  ],
  reminderFooter:
    "These obligations are set out in full in the [Professional Terms of Service](/legal/professional-terms).",
  footerText:
    "The Client will receive your phone number. You will receive the Client's home address. Ensure you have all relevant child information before the session.",
};
