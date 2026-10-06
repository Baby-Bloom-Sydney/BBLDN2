/**
 * The nanny's card for each `verify-dbs` reason code — copy deck §3 (LDN2 06-build-drafts/02-copy-deck.md). This copy
 * overrides the model's free text by `reason_code`; the model's text is the fallback only for an unknown code.
 * 3b renders it (GuidanceCard) and may refine the wording; 3g owns final copy.
 *
 * Contract
 * - Rulings: #6 (reason → guidance card), #22 (links), #24 (reason_code + confidence ride inside the guidance JSON —
 *   added by verify-dbs / the pipeline, not stored here).
 * - Output: constant cards only. Never: decides an outcome, accuses the nanny of forgery, or names a level/status code.
 */
import { DBS_LINKS } from "@/lib/constants";
import type { UserGuidance } from "@/lib/verification";

export type DbsFailReason =
  | "not_a_dbs_certificate"
  | "wrong_page"
  | "not_enhanced"
  | "no_childrens_barred_list"
  | "adult_workforce_only"
  | "unreadable"
  | "altered_document";

const GET_ENHANCED = [{ label: "Get an enhanced DBS", href: DBS_LINKS.getEnhanced }] as const;

export const DBS_REASON_GUIDANCE: Readonly<Record<DbsFailReason, UserGuidance>> = {
  not_enhanced: {
    title: "This isn't an enhanced DBS certificate",
    explanation: "Your certificate shows a basic or standard check. To work with children we need an enhanced one.",
    steps_to_fix: [
      'Check the title at the top of page 1 — it should say "Enhanced Certificate"',
      "If you have an enhanced certificate, upload page 1 of that one",
      "If you don't, you'll need to apply for an enhanced DBS",
    ],
    links: GET_ENHANCED,
  },
  no_childrens_barred_list: {
    title: "This certificate doesn't include the children's barred list",
    explanation: 'On page 1, the Children\'s Barred List line says "Not requested". For work with children, it needs to have been checked.',
    steps_to_fix: [
      "Check the Children's Barred List line on page 1",
      "If you have another enhanced certificate where it was checked, upload that one",
      "If not, you'll need a new enhanced DBS that includes the children's barred list",
    ],
    links: GET_ENHANCED,
  },
  adult_workforce_only: {
    title: "This certificate is for work with adults",
    explanation: "Your certificate was issued for the adult workforce. We need one issued for work with children.",
    steps_to_fix: [
      "Check the workforce shown on page 1",
      "If you have a certificate for the child workforce, upload page 1 of that one",
      "If not, you'll need a new enhanced DBS for work with children",
    ],
    links: GET_ENHANCED,
  },
  wrong_page: {
    title: "We need page 1 of your certificate",
    explanation: "This looks like a different page, or part of page 1 is cut off.",
    steps_to_fix: [
      "Use page 1 — it shows your name, certificate number and the barred list checks",
      "Get all four corners in the photo",
      "Upload it again",
    ],
  },
  unreadable: {
    title: "We couldn't read your certificate",
    explanation: "The photo may be blurry, too dark, or have glare on it.",
    steps_to_fix: [
      "Lay page 1 flat in good light, without flash",
      "Get all four corners in and make sure the text is sharp",
      "Or upload a PDF scan instead",
    ],
  },
  not_a_dbs_certificate: {
    title: "This doesn't look like a DBS certificate",
    explanation: "We couldn't find the details we'd expect on a DBS certificate.",
    steps_to_fix: [
      "Upload page 1 of the paper certificate DBS posted to you",
      "Letters, emails and screenshots of the Update Service can't be used",
      "If you haven't had an enhanced DBS yet, you'll need to apply for one",
    ],
    links: GET_ENHANCED,
  },
  altered_document: {
    title: "We couldn't check this certificate",
    explanation: "Something on this document didn't look the way we'd expect, so we can't check it automatically.",
    steps_to_fix: [
      "Upload a clear photo or scan of your original certificate",
      "Don't use filters, edits or cropping",
      "If you think this is a mistake, request a manual review and our team will look at it",
    ],
  },
};

/** Fallback when the code is unknown and the model gave no usable text. */
export const DBS_FALLBACK_GUIDANCE: UserGuidance = {
  title: "We couldn't verify your DBS certificate",
  explanation: "Something went wrong reading your certificate.",
  steps_to_fix: ["Upload page 1 again", "If it keeps happening, request a manual review"],
};

/** Review (21): neutral, never says why (copy deck §2.4). */
export const DBS_REVIEW_GUIDANCE: UserGuidance = {
  title: "We're taking a closer look",
  explanation: "Our team checks some certificates by hand. You don't need to do anything — we'll email you.",
  steps_to_fix: [],
};
