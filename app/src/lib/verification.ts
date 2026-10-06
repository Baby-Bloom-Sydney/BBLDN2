import { DBS_LINKS, SENDERS } from "@/lib/constants";
// ── Verification Data Systems Constants ──
// Shared between server actions and client components.
// NOT a 'use server' file — plain module.
//
// DBS: AI reads page 1 → cross-check (surname + DOB) → Update Service API → 30 (fake pass, level 3) →
// admin Approve → 40 (level 4). 40 is written only by the admin's Approve (`adminVerifyWWCC`, 3d).
// See LDN2 NANNY-DBS-Research/03-status-mapping.md. Every code, label, tone and DBS constant lives here
// (unit 3a); other units import the meanings and never redefine them.

// ── Legacy integer status (kept for admin UI backward compat) ──

export const VERIFICATION_STATUS = {
  NOT_STARTED: 0,
  PENDING_ID_AUTO: 10,
  PENDING_ID_REVIEW: 11,
  ID_REJECTED: 12,
  PENDING_WWCC_AUTO: 20,        // ID verified; certificate not submitted or accepted (incl. API unreachable, #30)
  WWCC_SUBMITTED: 29,
  WWCC_PROCESSING: 25,
  PENDING_WWCC_REVIEW: 21,      // DBS needs a person: AI unsure, cross-check mismatch, or manual review asked
  WWCC_REJECTED: 22,            // admin rejected only; no longer barred (#13, #26)
  DBS_NEW_INFO: 23,             // Update Service NEW_INFO: new certificate needed
  WWCC_DOCUMENT_FAILED: 24,
  DBS_NO_MATCH: 26,             // Update Service NO_MATCH_FOUND
  DBS_BARRED: 27,               // admin Bar; level 0, suspended (#23)
  PROVISIONALLY_VERIFIED: 30,   // fake pass: API passed, awaiting admin Approve (#10)
  FULLY_VERIFIED: 40,           // admin Approve after an API pass, the only path (#11, P-1)
} as const;

export const VERIFICATION_LEVEL = {
  SIGNED_UP: 0,
  REGISTERED: 1,
  ID_VERIFIED: 2,
  PROVISIONALLY_VERIFIED: 3,
  FULLY_VERIFIED: 4,
} as const;

// ── The single decoder: every code's DBS meaning (no entry for 28 — deleted, D-3) ──

export type StatusTone = 'unattempted' | 'pending' | 'failed' | 'verified' | 'active' | 'info';

export interface StatusMeta {
  label: string;
  short: string;
  group: string;
  tone: StatusTone;
  description: string;
}

export const STATUS_META: Readonly<Record<number, StatusMeta>> = {
  0: { label: 'Not Started (0)', short: 'Not started', group: 'Pre-verification', tone: 'unattempted',
    description: 'She has not submitted the verification form' },
  10: { label: 'Pending ID Auto (10)', short: 'ID checking', group: 'ID stage', tone: 'pending',
    description: 'Form submitted; the AI is checking passport and selfie' },
  11: { label: 'Pending ID Review (11)', short: 'ID review', group: 'ID stage', tone: 'pending',
    description: 'The AI flagged the ID; it is in the admin review queue' },
  12: { label: 'ID Rejected (12)', short: 'ID rejected', group: 'ID stage', tone: 'failed',
    description: 'Admin rejected the ID; she must resubmit passport and selfie' },
  20: { label: 'ID Verified (20)', short: 'ID verified', group: 'DBS stage', tone: 'info',
    description: 'ID verified; certificate not submitted or not yet accepted (includes the Update Service being unreachable)' },
  21: { label: 'DBS Needs Review (21)', short: 'Needs review', group: 'DBS stage', tone: 'pending',
    description: 'DBS needs a person: the AI was unsure, the cross-check did not match, or she asked for manual review' },
  22: { label: 'DBS Rejected (22)', short: 'Rejected', group: 'DBS stage', tone: 'failed',
    description: 'Admin rejected the certificate; she can resubmit' },
  23: { label: 'DBS New Information (23)', short: 'New information', group: 'DBS stage', tone: 'failed',
    description: 'The Update Service reports new information since issue: a new certificate is needed' },
  24: { label: 'DBS Document Failed (24)', short: 'Document failed', group: 'DBS stage', tone: 'failed',
    description: "The certificate failed the AI check (unreadable, not Enhanced, children's barred list not checked, wrong page)" },
  25: { label: 'DBS Processing (25)', short: 'Processing', group: 'DBS stage', tone: 'pending',
    description: 'The AI is reading the certificate' },
  26: { label: 'No Update Service Match (26)', short: 'No Update Service match', group: 'DBS stage', tone: 'failed',
    description: 'No Update Service match: not subscribed, or the details read do not match what DBS holds' },
  27: { label: 'DBS Barred (27)', short: 'Barred', group: 'DBS stage', tone: 'failed',
    description: 'Barred by an admin; level 0, account suspended' },
  29: { label: 'DBS Submitted (29)', short: 'Submitted', group: 'DBS stage', tone: 'pending',
    description: 'Certificate page 1 uploaded; waiting for the AI' },
  30: { label: 'Awaiting Approval (30)', short: 'Awaiting approval', group: 'Verified', tone: 'active',
    description: 'Fake pass: the Update Service passed; she looks verified and her accepts are held until an admin approves' },
  40: { label: 'Fully Verified (40)', short: 'Fully verified', group: 'Verified', tone: 'verified',
    description: 'Admin approved after an Update Service pass; the only path to level 4' },
};

export const STATUS_LABELS: Record<number, string> = Object.fromEntries(
  Object.entries(STATUS_META).map(([code, meta]) => [code, meta.label]),
);

/** Badge tone for a status code. `null`/`undefined` = never attempted; an unknown code reads as pending. */
export function statusTone(code: number | null | undefined): StatusTone {
  if (code === null || code === undefined) return 'unattempted';
  return STATUS_META[code]?.tone ?? 'pending';
}

// ── Shared code sets (the decoders import these; none keeps a local copy) ──

export const ID_FAILED_CODES: ReadonlySet<number> = new Set([VERIFICATION_STATUS.ID_REJECTED]);
export const ID_REVIEW_CODES: ReadonlySet<number> = new Set([VERIFICATION_STATUS.PENDING_ID_REVIEW]);
export const DBS_FAILED_CODES: ReadonlySet<number> = new Set([
  VERIFICATION_STATUS.WWCC_REJECTED,
  VERIFICATION_STATUS.DBS_NEW_INFO,
  VERIFICATION_STATUS.WWCC_DOCUMENT_FAILED,
  VERIFICATION_STATUS.DBS_NO_MATCH,
  VERIFICATION_STATUS.DBS_BARRED,
]);
export const DBS_REVIEW_CODES: ReadonlySet<number> = new Set([VERIFICATION_STATUS.PENDING_WWCC_REVIEW]);
/** Admin "Pending" (spec §1.3): the ID queue plus DBS lists A and B. 3d points the tab, dashboard and analytics at it. */
export const ADMIN_PENDING_CODES = [10, 11, 21, 30] as const;

export const LEVEL_LABELS: Record<number, string> = {
  0: 'Signed Up (0)',
  1: 'Registered (1)',
  2: 'ID Verified (2)',
  3: 'Provisional: awaiting approval (3)',
  4: 'Fully Verified: admin approved (4)',
};

// ── DBS constants ──

/** D-8: the certificate number is 12 digits, stored as a string. The one place the format lives. */
export const DBS_CERTIFICATE_NUMBER_PATTERN = /^\d{12}$/;
/** #34 (G5): the only verification method. */
export const DBS_VERIFICATION_METHOD = 'dbs_certificate' as const;
/** The stored Update Service result vocabulary (the result column keeps its old name, D-4). */
export const DBS_API_RESULT = {
  BLANK: 'BLANK_NO_NEW_INFO',
  NON_BLANK: 'NON_BLANK_NO_NEW_INFO',
  NEW_INFO: 'NEW_INFO',
  NO_MATCH: 'NO_MATCH_FOUND',
} as const;
export type DbsApiResult = typeof DBS_API_RESULT[keyof typeof DBS_API_RESULT];

/** True only for an Update Service pass (BLANK / NON_BLANK). Everything else, including null, is not a pass. */
export function isDbsApiPass(result: string | null | undefined): boolean {
  return result === DBS_API_RESULT.BLANK || result === DBS_API_RESULT.NON_BLANK;
}

/** #33 (G4): the two DBS `activity_logs.action_type` values. */
export const DBS_ACTIVITY = {
  STATUS_CHECK: 'dbs_status_check',
  PAGE2_REQUESTED: 'dbs_page2_requested',
} as const;

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
  NEW_INFO: 'expired',          // value kept (D-4): Update Service NEW_INFO → 23
  NO_MATCH: 'ocg_not_found',    // value kept (D-4): Update Service NO_MATCH_FOUND → 26
  BARRED: 'barred',             // admin Bar (27) — account suspended, no retry
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

export interface GuidanceLink {
  label: string;
  href: string;
}

export interface UserGuidance {
  title: string;
  explanation: string;
  steps_to_fix: readonly string[] | string[];
  /** The `verify-dbs` reason code, or DBS_NEW_INFO / DBS_NO_MATCH / DBS_BARRED / TECHNICAL_RETRY (#24). 3b picks its card by it. */
  reason_code?: string;
  /** AI confidence (#24). */
  confidence?: 'high' | 'medium' | 'low';
  /** One short explainer line under the steps (#22). */
  explainer?: string;
  /** Up to two links (#22). */
  links?: readonly [GuidanceLink] | readonly [GuidanceLink, GuidanceLink];
}

// ── Hardcoded guidance messages for technical / Update Service outcomes ──
// Seed text from 02-copy-deck.md §4; 3b owns the wording (applied as written — deck §4.1–§4.4). 3b removed the two
// emailed-PDF keys with their last importer. Links / explainer here are read through `lib/dbs/nanny-display.ts`.

export const GUIDANCE_MESSAGES = {
  TECHNICAL_RETRY: {
    reason_code: 'TECHNICAL_RETRY',
    title: 'Verification is taking longer than expected',
    explanation: "We had a temporary technical problem reading your certificate. It's saved safely.",
    steps_to_fix: [
      'Click "Edit & Resubmit" to try again',
      'If it keeps happening, click "Request manual review"',
    ],
  },
  TECHNICAL_STALE: {
    title: "We're experiencing technical difficulties",
    explanation: 'Your documents have been saved safely. You can try again now or come back later.',
    steps_to_fix: [
      'Click "Edit & Resubmit" to try again',
      'Or click "Request manual review" (usually 1-3 business days)',
    ],
  },
  DBS_NEW_INFO: {
    reason_code: 'DBS_NEW_INFO',
    title: "You'll need a new DBS certificate",
    explanation: "The DBS Update Service shows there's new information since your certificate was issued, so we can't use this one any more. It doesn't tell us what the information is.",
    steps_to_fix: [
      'Apply for a new enhanced DBS.',
      'Join the Update Service when it arrives (within 30 days of the issue date).',
      'Upload page 1 of your new certificate here.',
    ],
    links: [{ label: 'Get an enhanced DBS', href: DBS_LINKS.getEnhanced }],
  },
  DBS_NO_MATCH: {
    reason_code: 'DBS_NO_MATCH',
    title: "We couldn't find your certificate on the DBS Update Service",
    explanation: "This usually means the certificate isn't on the Update Service, or the details we read don't match what DBS holds.",
    steps_to_fix: [
      "Check you've joined the Update Service and your subscription is active (£16 a year).",
      "You can only add a certificate within 30 days of its issue date — if that's passed, you'll need a new enhanced DBS and to join when you apply.",
      'Make sure the photo is sharp, so we read your certificate number, name and date of birth correctly.',
      'Then upload page 1 again.',
    ],
    explainer: "What is the Update Service? It's the DBS's own service that keeps your certificate up to date. Once you've joined, we can check online that your certificate is still current — so you never need a new check for each family, and families know your check is live.",
    links: [
      { label: 'Join the Update Service', href: DBS_LINKS.joinUpdateService },
      { label: 'Get an enhanced DBS', href: DBS_LINKS.getEnhanced },
    ],
  },
  // [LEGAL] wording pending legal chat (02-copy-deck.md §4.4)
  DBS_BARRED: {
    reason_code: 'DBS_BARRED',
    title: 'Your account has been restricted',
    explanation: "Following a review of your DBS certificate, your Baby Bloom account has been suspended and you can't use our services.",
    steps_to_fix: [
      `For questions about your Baby Bloom account, contact us at ${SENDERS.support}`,
    ],
  },
} as const satisfies Record<string, UserGuidance>;

// ── Derive legacy integer status from per-section statuses (nanny) ──
// A DBS outcome that needs her or a person beats a stale cross-check. Never returns 28 (deleted) or 40
// (an explicit admin write, 3d). 3c writes cross-check `passed` only after an Update Service pass (#30).

export function deriveOverallStatus(
  identityStatus: IdentityStatus,
  dbsStatus: WwccStatus,
  crossCheckStatus: CrossCheckStatus
): number {
  // ── 1. Safety: barred is absolute priority ──
  if (dbsStatus === WWCC_STATUS.BARRED) return VERIFICATION_STATUS.DBS_BARRED;

  // ── 2. Identity not yet verified — these MUST take priority over the DBS section ──
  if (identityStatus === 'not_started') return VERIFICATION_STATUS.NOT_STARTED;
  if (identityStatus === 'pending')    return VERIFICATION_STATUS.PENDING_ID_AUTO;
  if (identityStatus === 'processing') return VERIFICATION_STATUS.PENDING_ID_AUTO;
  if (identityStatus === 'review')     return VERIFICATION_STATUS.PENDING_ID_REVIEW;
  if (identityStatus === 'rejected')   return VERIFICATION_STATUS.ID_REJECTED;
  if (identityStatus === 'failed')     return VERIFICATION_STATUS.PENDING_ID_REVIEW;
  if (identityStatus !== 'verified')   return VERIFICATION_STATUS.NOT_STARTED;   // unknown value: fail closed

  // ── 3. A DBS outcome that needs her or a person ──
  if (dbsStatus === WWCC_STATUS.NEW_INFO) return VERIFICATION_STATUS.DBS_NEW_INFO;
  if (dbsStatus === WWCC_STATUS.NO_MATCH) return VERIFICATION_STATUS.DBS_NO_MATCH;
  if (dbsStatus === WWCC_STATUS.REJECTED) return VERIFICATION_STATUS.WWCC_REJECTED;
  if (dbsStatus === WWCC_STATUS.FAILED)   return VERIFICATION_STATUS.WWCC_DOCUMENT_FAILED;
  if (dbsStatus === WWCC_STATUS.REVIEW)   return VERIFICATION_STATUS.PENDING_WWCC_REVIEW;

  // ── 4. Cross-check (identity verified) ──
  if (crossCheckStatus === 'review') return VERIFICATION_STATUS.PENDING_WWCC_REVIEW;   // was 30 — the dead end, 01-status-ladder §6
  if (crossCheckStatus === 'passed') return VERIFICATION_STATUS.PROVISIONALLY_VERIFIED;

  // ── 5. DBS in flight ──
  if (dbsStatus === WWCC_STATUS.PROCESSING)   return VERIFICATION_STATUS.WWCC_PROCESSING;
  if (dbsStatus === WWCC_STATUS.PENDING)      return VERIFICATION_STATUS.WWCC_SUBMITTED;
  if (dbsStatus === WWCC_STATUS.DOC_VERIFIED) return VERIFICATION_STATUS.PENDING_WWCC_AUTO;

  // ── 6. Identity verified, no certificate submitted yet ──
  return VERIFICATION_STATUS.PENDING_WWCC_AUTO;
}
