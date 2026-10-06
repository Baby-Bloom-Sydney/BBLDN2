/**
 * The one nanny-side DBS decoder (unit 3b, BB-LDN-3b-061026; brief `3b-nanny-dbs-screens.md` changes 1, 8, 10).
 *
 * Every nanny screen that shows the DBS step (onboarding, /nanny/verification, hub, settings, Katie's tile stepper)
 * reads its state from `getDbsDisplayState`, its fail card from `dbsCardFor`, its links from `dbsCardExtras` and its
 * "Enhanced DBS" glance from `showsEnhancedDbsBadge`. Codes and meanings are 3a's (`lib/verification.ts`); this module
 * only turns them into what she sees. Copy: LDN2 `06-build-drafts/02-copy-deck.md` §3–§4.
 *
 * In: verification-row fields (or a poll body), a reason code, a level. Out: a display state, a card, links, a
 * badge decision, formatted values. Pure — never fetches, writes, logs personal data, or returns a link that is not
 * a `DBS_LINKS` value (#14). Unknown or deleted values (28, the old regulator states) decode to `not_started`.
 */
import { format, isValid, parseISO } from "date-fns";
import { DBS_LINKS } from "@/lib/constants";
import {
  CROSS_CHECK_STATUS,
  GUIDANCE_MESSAGES,
  VERIFICATION_LEVEL,
  VERIFICATION_STATUS,
  WWCC_STATUS,
  type GuidanceLink,
  type UserGuidance,
} from "@/lib/verification";

export type DbsDisplayState =
  | "not_started"
  | "reading"
  | "checking"
  | "technical_retry"
  | "clear"
  | "with_team"
  | "manual_review"
  | "new_info"
  | "no_match"
  | "failed"
  | "rejected"
  | "barred";

/** The four fields the decoder reads; every field is optional so partial rows (poll bodies, Katie) decode too. */
export interface DbsDisplayInput {
  verification_status?: number | null;
  wwcc_status?: string | null;
  cross_check_status?: string | null;
  wwcc_user_guidance?: UserGuidance | null;
}

const V = VERIFICATION_STATUS;

/** A section outcome that needs her or a person, by stored section value. Beats any stale code. */
const SECTION_OUTCOME: Readonly<Record<string, DbsDisplayState>> = {
  [WWCC_STATUS.BARRED]: "barred",
  [WWCC_STATUS.REJECTED]: "rejected",
  [WWCC_STATUS.NEW_INFO]: "new_info",
  [WWCC_STATUS.NO_MATCH]: "no_match",
  [WWCC_STATUS.FAILED]: "failed",
};

/** The same outcomes by code, for rows that carry only the code. 28 is deleted (D-3) and has no entry. */
const CODE_OUTCOME: Readonly<Record<number, DbsDisplayState>> = {
  [V.DBS_BARRED]: "barred",
  [V.WWCC_REJECTED]: "rejected",
  [V.DBS_NEW_INFO]: "new_info",
  [V.DBS_NO_MATCH]: "no_match",
  [V.WWCC_DOCUMENT_FAILED]: "failed",
  [V.PENDING_WWCC_REVIEW]: "with_team",
  [V.PROVISIONALLY_VERIFIED]: "clear",
  [V.FULLY_VERIFIED]: "clear",
  [V.WWCC_SUBMITTED]: "reading",
  [V.WWCC_PROCESSING]: "reading",
};

function isTechnicalRetry(g: UserGuidance | null | undefined): boolean {
  if (!g) return false;
  // 3c writes the reason code (#24); the title is the fallback if a row carries none.
  return g.reason_code === GUIDANCE_MESSAGES.TECHNICAL_RETRY.reason_code || g.title === GUIDANCE_MESSAGES.TECHNICAL_RETRY.title;
}

/** Brief change 1. Unknown or deleted values (28, the old regulator states) fall back to `not_started`, fail closed. */
export function getDbsDisplayState(v: DbsDisplayInput | null | undefined): DbsDisplayState {
  if (!v) return "not_started";
  const section = v.wwcc_status ?? "";
  const code = v.verification_status ?? -1;

  const outcome = SECTION_OUTCOME[section];
  if (outcome) return outcome;
  // `review` + no guidance is 3c's `submitDbsForManualReview` write — she asked. With guidance it is the AI's call.
  if (section === WWCC_STATUS.REVIEW) return v.wwcc_user_guidance ? "with_team" : "manual_review";
  if (code === V.PROVISIONALLY_VERIFIED || code === V.FULLY_VERIFIED) return "clear";
  if (section === WWCC_STATUS.PENDING || section === WWCC_STATUS.PROCESSING) return "reading";
  if (section === WWCC_STATUS.DOC_VERIFIED) {
    if (v.cross_check_status === CROSS_CHECK_STATUS.PASSED) return "clear";
    if (v.cross_check_status === CROSS_CHECK_STATUS.REVIEW) return "with_team";
    // Ruling #30: API down holds her at 20 / level 2 with TECHNICAL_RETRY — never 30.
    return isTechnicalRetry(v.wwcc_user_guidance) ? "technical_retry" : "checking";
  }
  if (section && section !== WWCC_STATUS.NOT_STARTED) return "not_started";
  return CODE_OUTCOME[code] ?? "not_started";
}

/** A `/api/verification-status` poll body → the decoder's input (the poll keeps the row's column names, D-4). */
export function dbsInputFromPoll(body: Record<string, unknown> | null | undefined): DbsDisplayInput | null {
  if (!body) return null;
  return {
    verification_status: typeof body.status === "number" ? body.status : null,
    wwcc_status: typeof body.wwcc_status === "string" ? body.wwcc_status : null,
    cross_check_status: typeof body.cross_check_status === "string" ? body.cross_check_status : null,
    wwcc_user_guidance: (body.wwcc_user_guidance as UserGuidance | null | undefined) ?? null,
  };
}

/** Decode a bare section value (Katie's stepper passes only the section). */
export function getDbsStateForSection(section: string | null | undefined): DbsDisplayState {
  return getDbsDisplayState({ wwcc_status: section });
}

/** States that show the two buttons, Edit & Resubmit · Request manual review (ruling #7). Barred shows none (#13). */
const FAIL_STATES: ReadonlySet<DbsDisplayState> = new Set(["failed", "new_info", "no_match", "rejected", "technical_retry"]);

export function isDbsFailState(state: DbsDisplayState): boolean {
  return FAIL_STATES.has(state);
}

/** Brief change 10: one trigger for the hub and profile glance. Level 3 visibility is intentional (ruling #10). */
export function showsEnhancedDbsBadge(level: number | null | undefined): boolean {
  return (level ?? 0) >= VERIFICATION_LEVEL.PROVISIONALLY_VERIFIED;
}

// ── Cards (copy deck §3, §4) ──

const GET_ENHANCED: GuidanceLink = { label: "Get an enhanced DBS", href: DBS_LINKS.getEnhanced };
const JOIN_UPDATE_SERVICE: GuidanceLink = { label: "Join the Update Service", href: DBS_LINKS.joinUpdateService };

/** Deck §4.2 explainer (#22), split into the card's heading + body. Kept equal to 3a's `DBS_NO_MATCH.explainer`. */
export const DBS_NO_MATCH_EXPLAINER = {
  heading: "What is the Update Service?",
  body: "It's the DBS's own service that keeps your certificate up to date. Once you've joined, we can check online that your certificate is still current — so you never need a new check for each family, and families know your check is live.",
} as const;

/** Deck §3 — one card per `verify-dbs` reason code. Overrides the model's free text by `reason_code`. */
const AI_REASON_CARDS: Readonly<Record<string, UserGuidance>> = {
  not_enhanced: {
    title: "This isn't an enhanced DBS certificate",
    explanation: "Your certificate shows a basic or standard check. To work with children we need an enhanced one.",
    steps_to_fix: [
      'Check the title at the top of page 1 — it should say "Enhanced Certificate".',
      "If you have an enhanced certificate, upload page 1 of that one.",
      "If you don't, you'll need to apply for an enhanced DBS.",
    ],
  },
  no_childrens_barred_list: {
    title: "This certificate doesn't include the children's barred list",
    explanation: 'On page 1, the Children\'s Barred List line says "Not requested". For work with children, it needs to have been checked.',
    steps_to_fix: [
      "Check the Children's Barred List line on page 1.",
      "If you have another enhanced certificate where it was checked, upload that one.",
      "If not, you'll need a new enhanced DBS that includes the children's barred list.",
    ],
  },
  adult_workforce_only: {
    title: "This certificate is for work with adults",
    explanation: "Your certificate was issued for the adult workforce. We need one issued for work with children.",
    steps_to_fix: [
      "Check the workforce shown on page 1.",
      "If you have a certificate for the child workforce, upload page 1 of that one.",
      "If not, you'll need a new enhanced DBS for work with children.",
    ],
  },
  wrong_page: {
    title: "We need page 1 of your certificate",
    explanation: "This looks like a different page, or part of page 1 is cut off.",
    steps_to_fix: [
      "Use page 1 — it shows your name, certificate number and the barred list checks.",
      "Get all four corners in the photo.",
      "Upload it again.",
    ],
  },
  unreadable: {
    title: "We couldn't read your certificate",
    explanation: "The photo may be blurry, too dark, or have glare on it.",
    steps_to_fix: [
      "Lay page 1 flat in good light, without flash.",
      "Get all four corners in and make sure the text is sharp.",
      "Or upload a PDF scan instead.",
    ],
  },
  not_a_dbs_certificate: {
    title: "This doesn't look like a DBS certificate",
    explanation: "We couldn't find the details we'd expect on a DBS certificate.",
    steps_to_fix: [
      "Upload page 1 of the paper certificate DBS posted to you.",
      "Letters, emails and screenshots of the Update Service can't be used.",
      "If you haven't had an enhanced DBS yet, you'll need to apply for one.",
    ],
  },
  altered_document: {
    title: "We couldn't check this certificate",
    explanation: "Something on this document didn't look the way we'd expect, so we can't check it automatically.",
    steps_to_fix: [
      "Upload a clear photo or scan of your original certificate.",
      "Don't use filters, edits or cropping.",
      "If you think this is a mistake, request a manual review and our team will look at it.",
    ],
  },
};

/** Deck §4 cards live in `GUIDANCE_MESSAGES` (3a's keys, 3b's wording), keyed by their own reason code. */
const OUTCOME_CARDS: Readonly<Record<string, UserGuidance>> = {
  DBS_NEW_INFO: GUIDANCE_MESSAGES.DBS_NEW_INFO,
  DBS_NO_MATCH: GUIDANCE_MESSAGES.DBS_NO_MATCH,
  DBS_BARRED: GUIDANCE_MESSAGES.DBS_BARRED,
  TECHNICAL_RETRY: GUIDANCE_MESSAGES.TECHNICAL_RETRY,
};

/** Deck §3 last row — unknown code and nothing stored. */
export const DBS_FALLBACK_CARD: UserGuidance = {
  title: "We couldn't verify your DBS certificate",
  explanation: "Something went wrong reading your certificate.",
  steps_to_fix: ["Upload page 1 again.", "If it keeps happening, request a manual review."],
};

/** The card she sees: the deck card for a known code, else the stored model text, else the deck fallback. */
export function dbsCardFor(reasonCode: string | null | undefined, stored: UserGuidance | null | undefined): UserGuidance {
  const known = reasonCode ? (AI_REASON_CARDS[reasonCode] ?? OUTCOME_CARDS[reasonCode]) : undefined;
  return known ?? stored ?? DBS_FALLBACK_CARD;
}

export interface DbsCardExtras {
  explainer?: { heading: string; body: string };
  links: GuidanceLink[];
}

const GET_ENHANCED_CODES: ReadonlySet<string> = new Set([
  "not_enhanced",
  "no_childrens_barred_list",
  "adult_workforce_only",
  "not_a_dbs_certificate",
  "DBS_NEW_INFO",
]);

/** Brief change 8. Every href is a `DBS_LINKS` value (ruling #14). */
export function dbsCardExtras(reasonCode: string | null | undefined): DbsCardExtras {
  if (reasonCode === "DBS_NO_MATCH") {
    return { explainer: { ...DBS_NO_MATCH_EXPLAINER }, links: [JOIN_UPDATE_SERVICE, GET_ENHANCED] };
  }
  if (reasonCode && GET_ENHANCED_CODES.has(reasonCode)) return { links: [GET_ENHANCED] };
  return { links: [] };
}

// ── Formatting ──

const DBS_NUMBER = /^\d{12}$/;

/** "001234567890" → "0012 3456 7890"; anything else is shown as stored. */
export function formatDbsNumber(n: string | null | undefined): string {
  if (!n) return "";
  return DBS_NUMBER.test(n) ? n.replace(/(\d{4})(?=\d)/g, "$1 ") : n;
}

/** ISO date or timestamp → "d MMM yyyy" (deck §2.4, §5.2); "" when absent or unreadable. */
export function formatDbsDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = parseISO(iso);
  return isValid(d) ? format(d, "d MMM yyyy") : "";
}
