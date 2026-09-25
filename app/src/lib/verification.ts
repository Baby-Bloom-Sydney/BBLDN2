import { SENDERS } from "@/lib/constants";
// ── Verification Data Systems Constants ──
// Reference: verification_pipeline/verification-data-systems.md
//
// Shared between server actions and client components.
// NOT a 'use server' file — plain module.
//
// IMPORTANT: OCG (Office of the Children's Guardian) is the AUTHORITATIVE
// source for WWCC verification. Only OCG CLEARED → FULLY_VERIFIED (40).

// ── Legacy integer status (kept for admin UI backward compat) ──

export const VERIFICATION_STATUS = {
  NOT_STARTED: 0,
  PENDING_ID_AUTO: 10,
  PENDING_ID_REVIEW: 11,
  ID_REJECTED: 12,
  PENDING_WWCC_AUTO: 20,
  WWCC_SUBMITTED: 29,
  WWCC_PROCESSING: 25,
  PENDING_WWCC_REVIEW: 21,
  WWCC_REJECTED: 22,           // Also used for BARRED / INTERIM BAR (account suspended)
  WWCC_EXPIRED: 23,            // OCG confirmed expired OR auto-detected by cron
  WWCC_DOCUMENT_FAILED: 24,
  WWCC_OCG_NOT_FOUND: 26,      // OCG has no record of this WWCC
  WWCC_CLOSED: 27,             // OCG says WWCC application was closed
  WWCC_APPLICATION_PENDING: 28, // OCG says WWCC application still in progress
  PROVISIONALLY_VERIFIED: 30,   // AI checks passed, awaiting OCG confirmation
  FULLY_VERIFIED: 40,           // OCG CLEARED — only path to this status
} as const;

export const VERIFICATION_LEVEL = {
  SIGNED_UP: 0,
  REGISTERED: 1,
  ID_VERIFIED: 2,
  PROVISIONALLY_VERIFIED: 3,
  FULLY_VERIFIED: 4,
} as const;

export const STATUS_LABELS: Record<number, string> = {
  0: 'Not Started (0)',
  10: 'Pending ID Auto (10)',
  11: 'Pending ID Review (11)',
  12: 'ID Rejected (12)',
  20: 'ID Verified (20)',
  25: 'WWCC Processing (25)',
  21: 'Pending WWCC Review (21)',
  22: 'WWCC Rejected (22)',
  23: 'WWCC Expired (23)',
  24: 'WWCC Document Failed (24)',
  26: 'WWCC OCG Not Found (26)',
  27: 'WWCC Closed (27)',
  28: 'WWCC Application Pending (28)',
  29: 'WWCC Submitted (29)',
  30: 'Provisionally Verified (30)',
  40: 'Fully Verified (40)',
};

export const LEVEL_LABELS: Record<number, string> = {
  0: 'Signed Up (0)',
  1: 'Registered (1)',
  2: 'ID Verified (2)',
  3: 'Provisionally Verified (3)',
  4: 'Fully Verified (4)',
};

// ── Per-section status constants ──

export const IDENTITY_STATUS = {
  NOT_STARTED: 'not_started',
  PENDING: 'pending',
  PROCESSING: 'processing',
  VERIFIED: 'verified',
  REVIEW: 'review',
  REJECTED: 'rejected',
  FAILED: 'failed',
} as const;
export type IdentityStatus = typeof IDENTITY_STATUS[keyof typeof IDENTITY_STATUS];

export const WWCC_STATUS = {
  NOT_STARTED: 'not_started',
  PENDING: 'pending',
  PROCESSING: 'processing',
  DOC_VERIFIED: 'doc_verified',
  REVIEW: 'review',
  REJECTED: 'rejected',
  FAILED: 'failed',
  EXPIRED: 'expired',
  OCG_NOT_FOUND: 'ocg_not_found',
  CLOSED: 'closed',
  APPLICATION_PENDING: 'application_pending',
  BARRED: 'barred',             // BARRED or INTERIM BAR — account suspended, no retry
} as const;
export type WwccStatus = typeof WWCC_STATUS[keyof typeof WWCC_STATUS];

export const CONTACT_STATUS = {
  NOT_STARTED: 'not_started',
  SAVED: 'saved',
} as const;
export type ContactStatus = typeof CONTACT_STATUS[keyof typeof CONTACT_STATUS];

export const CROSS_CHECK_STATUS = {
  NOT_STARTED: 'not_started',
  PENDING: 'pending',
  PROCESSING: 'processing',
  PASSED: 'passed',
  REVIEW: 'review',
} as const;
export type CrossCheckStatus = typeof CROSS_CHECK_STATUS[keyof typeof CROSS_CHECK_STATUS];

// ── User guidance type (for AI-generated or hardcoded failure messages) ──

export interface UserGuidance {
  title: string;
  explanation: string;
  steps_to_fix: readonly string[] | string[];
}

// ── Hardcoded guidance messages for technical/parser failures ──

export const GUIDANCE_MESSAGES = {
  TECHNICAL_RETRY: {
    title: 'Verification is taking longer than expected',
    explanation: 'We experienced a temporary technical issue while processing your documents.',
    steps_to_fix: [
      'Click "Retry" below to try again',
      'If the problem persists, you can submit for manual review instead',
    ],
  },
  TECHNICAL_STALE: {
    title: "We're experiencing technical difficulties",
    explanation: 'Your documents have been saved safely. You can try again now or come back later.',
    steps_to_fix: [
      'Click "Try Again" to retry verification',
      'Or submit for manual review (usually 1-3 business days)',
    ],
  },
  PDF_UNREADABLE: {
    title: "We couldn't read your WWCC Grant Email PDF",
    explanation: 'The PDF you uploaded may not be the correct file, or may not have been saved correctly.',
    steps_to_fix: [
      'Find the original email from WWCCNotification@ocg.nsw.gov.au',
      'Open the email and click Print',
      'Choose "Save as PDF" (not screenshot)',
      'Upload the saved PDF file',
    ],
  },
  PDF_NAME_MISMATCH: {
    title: "The name on this document doesn't match your identity details",
    explanation: 'The name extracted from your WWCC grant email is different from the name you provided.',
    steps_to_fix: [
      'Check you uploaded the correct WWCC grant email',
      'If your WWCC is under a different name, you can enter your details manually instead',
    ],
  },
  WWCC_EXPIRED: {
    title: 'Your WWCC has expired',
    explanation: 'The Working With Children Check on this document has passed its expiry date.',
    steps_to_fix: [
      'Apply for a new WWCC at the Office of the Children\'s Guardian website',
      'Once you receive your new grant email, come back and upload it here',
    ],
  },
  WWCC_OCG_NOT_FOUND: {
    title: 'Your WWCC could not be found',
    explanation: 'We have been notified by the Office of the Children\'s Guardian that the WWCC number accompanied with your Surname and Date of Birth could not be found. In order for us to keep supporting you as a childcare professional you must first re-submit your WWCC verification.',
    steps_to_fix: [
      'Double-check your WWCC number is correct (e.g. WWC1234567E)',
      'Ensure your surname matches exactly what is on your WWCC',
      'If you recently applied, your WWCC may still be processing — try again in a few days',
      'If you continue having trouble, contact the Office of the Children\'s Guardian to confirm your WWCC details',
    ],
  },
  WWCC_EXPIRED_OCG: {
    title: 'Your WWCC has expired',
    explanation: 'The Office of the Children\'s Guardian has confirmed that your Working With Children Check has expired. You will need to apply for a new WWCC before you can continue working with children.',
    steps_to_fix: [
      'Apply for a new WWCC at https://www.ocg.nsw.gov.au/working-with-children-check',
      'Once you receive your new clearance, come back and resubmit your WWCC verification',
    ],
  },
  WWCC_CLOSED_OCG: {
    title: 'Your WWCC application has been closed',
    explanation: 'The Office of the Children\'s Guardian has indicated that your WWCC application has been closed. You will need to submit a new application to obtain a valid Working With Children Check.',
    steps_to_fix: [
      'Apply for a new WWCC at https://www.ocg.nsw.gov.au/working-with-children-check',
      'Once you receive your new clearance, come back and resubmit your WWCC verification',
    ],
  },
  WWCC_APPLICATION_PENDING: {
    title: 'Your WWCC application is still being processed',
    explanation: 'The Office of the Children\'s Guardian has confirmed that your WWCC application is still in progress and has not yet been decided. You cannot be fully verified until your WWCC application has been approved.',
    steps_to_fix: [
      'Wait for the Office of the Children\'s Guardian to process your application',
      'Once you receive your clearance notification, come back and resubmit your WWCC verification',
      'If you believe your application should already be approved, contact the Office of the Children\'s Guardian directly',
    ],
  },
  WWCC_BARRED: {
    title: 'Your account has been restricted',
    explanation: 'The Office of the Children\'s Guardian has indicated that you are not eligible to hold a Working With Children Check. Your Baby Bloom account has been suspended and you are unable to use our services.',
    steps_to_fix: [
      'If you believe this is an error, please contact the Office of the Children\'s Guardian directly',
      `For questions about your Baby Bloom account, contact us at ${SENDERS.support}`,
    ],
  },
} as const;

// ── Derive legacy integer status from per-section statuses ──

// ── Parent Verification Constants ──

export const PARENT_VERIFICATION_LEVEL = { UNVERIFIED: 0, VERIFIED: 1 } as const;

export const PARENT_VERIFICATION_STATUS = {
  NOT_STARTED: 0,
  PENDING_ID_AUTO: 10,
  PENDING_ID_REVIEW: 11,
  ID_FAILED_AI: 12,
  ID_REJECTED_ADMIN: 13,
  VERIFIED: 20,
} as const;

export const PARENT_IDENTITY_STATUS = {
  NOT_STARTED: 'not_started',
  PENDING: 'pending',
  PROCESSING: 'processing',
  VERIFIED: 'verified',
  REVIEW: 'review',
  REJECTED: 'rejected',
  FAILED: 'failed',
} as const;
export type ParentIdentityStatus = typeof PARENT_IDENTITY_STATUS[keyof typeof PARENT_IDENTITY_STATUS];

export const PARENT_DOCUMENT_TYPE = {
  PASSPORT: 'passport',
  DRIVERS_LICENSE: 'drivers_license',
} as const;

export function isParentVerified(level: number): boolean {
  return level >= 1;
}

export const PARENT_GUIDANCE_MESSAGES = {
  NAME_MISMATCH: {
    title: 'Your details don\'t match your ID document',
    explanation: 'The information you entered doesn\'t match what\'s printed on your document.',
    steps_to_fix: [
      'Check your surname and given names match your document exactly',
      'Check your date of birth matches your document exactly',
      'Re-enter your details and try again',
    ],
  },
  DOB_MISMATCH: {
    title: 'Date of birth doesn\'t match',
    explanation: 'The date of birth you entered doesn\'t match what\'s on your document.',
    steps_to_fix: [
      'Check your date of birth matches your document exactly',
      'Re-enter your details and try again',
    ],
  },
  EXPIRED_DOCUMENT: {
    title: 'Your document has expired',
    explanation: 'We can only accept a current, non-expired identity document.',
    steps_to_fix: [
      'Upload a valid, non-expired passport or driver\'s license',
    ],
  },
  INVALID_DOCUMENT: {
    title: 'We couldn\'t read your document',
    explanation: 'The document image wasn\'t clear enough to verify.',
    steps_to_fix: [
      'Take a clear photo of your document in good lighting',
      'Make sure all text is sharp and readable',
      'Avoid glare — tilt the document slightly if needed',
    ],
  },
  SELFIE_INVALID: {
    title: 'We were unable to verify your ID',
    explanation: 'We were not able to match your ID to your selfie with high confidence. To be verified successfully, please try again with the tips below.',
    steps_to_fix: [
      'Face the camera directly with your whole face clearly visible',
      'Remove any sunglasses, hats, or face coverings',
      'Use good, even lighting — natural light works best',
      'Keep a neutral expression and ensure the photo is in focus',
      'A plain background helps improve accuracy',
      'If you continue having trouble, you can submit for manual review instead',
    ],
  },
  SELFIE_LOW_CONFIDENCE: {
    title: 'We were unable to verify your ID',
    explanation: 'We were not able to match your ID to your selfie with high confidence.',
    steps_to_fix: [
      'Face the camera directly with your whole face clearly visible',
      'Use good, even lighting — natural light works best',
      'Keep a neutral expression',
      'If you continue having trouble, you can submit for manual review instead',
    ],
  },
  TECHNICAL_RETRY: {
    title: 'Verification is taking longer than expected',
    explanation: 'We experienced a temporary technical issue while processing your documents.',
    steps_to_fix: [
      'Click "Retry" below to try again',
      'If the problem persists, you can submit for manual review instead',
    ],
  },
  TECHNICAL_STALE: {
    title: "We're experiencing technical difficulties",
    explanation: 'Your documents have been saved safely. You can try again now or come back later.',
    steps_to_fix: [
      'Click "Try Again" to retry verification',
      'Or submit for manual review (usually 1-3 business days)',
    ],
  },
} as const;

// ── Derive legacy integer status from per-section statuses (nanny) ──

export function deriveOverallStatus(
  identityStatus: IdentityStatus,
  wwccStatus: WwccStatus,
  crossCheckStatus: CrossCheckStatus
): number {
  // ── 1. Safety: BARRED is absolute priority ──
  if (wwccStatus === 'barred') return VERIFICATION_STATUS.WWCC_REJECTED;

  // ── 2. Identity not yet verified — these MUST take priority over WWCC ──
  if (identityStatus === 'not_started') return VERIFICATION_STATUS.NOT_STARTED;
  if (identityStatus === 'pending')    return VERIFICATION_STATUS.PENDING_ID_AUTO;
  if (identityStatus === 'processing') return VERIFICATION_STATUS.PENDING_ID_AUTO;
  if (identityStatus === 'review')     return VERIFICATION_STATUS.PENDING_ID_REVIEW;
  if (identityStatus === 'rejected')   return VERIFICATION_STATUS.ID_REJECTED;
  if (identityStatus === 'failed')     return VERIFICATION_STATUS.PENDING_ID_REVIEW;

  // ── 3. Identity is verified — now cross-check results matter ──
  if (crossCheckStatus === 'passed') return VERIFICATION_STATUS.PROVISIONALLY_VERIFIED;
  if (crossCheckStatus === 'review') return VERIFICATION_STATUS.PROVISIONALLY_VERIFIED;

  // ── 4. WWCC statuses (only reachable when identity = verified) ──
  if (wwccStatus === 'doc_verified')        return VERIFICATION_STATUS.PENDING_WWCC_AUTO;
  if (wwccStatus === 'processing')          return VERIFICATION_STATUS.WWCC_PROCESSING;
  if (wwccStatus === 'pending')             return VERIFICATION_STATUS.WWCC_SUBMITTED;
  if (wwccStatus === 'review')              return VERIFICATION_STATUS.PENDING_WWCC_REVIEW;
  if (wwccStatus === 'rejected')            return VERIFICATION_STATUS.WWCC_REJECTED;
  if (wwccStatus === 'failed')              return VERIFICATION_STATUS.WWCC_DOCUMENT_FAILED;
  if (wwccStatus === 'expired')             return VERIFICATION_STATUS.WWCC_EXPIRED;
  if (wwccStatus === 'ocg_not_found')       return VERIFICATION_STATUS.WWCC_OCG_NOT_FOUND;
  if (wwccStatus === 'closed')              return VERIFICATION_STATUS.WWCC_CLOSED;
  if (wwccStatus === 'application_pending') return VERIFICATION_STATUS.WWCC_APPLICATION_PENDING;

  // ── 5. Identity verified, no WWCC submitted yet ──
  if (identityStatus === 'verified') return VERIFICATION_STATUS.PENDING_WWCC_AUTO;

  return VERIFICATION_STATUS.NOT_STARTED;
}
