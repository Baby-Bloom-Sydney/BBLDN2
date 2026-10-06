/**
 * `verification` module — read-only view of the user's verification state,
 * translated to plain English before Katie ever sees it.
 *
 * Hard constraints — do not break:
 *   1. Katie never reads from `nannies.verification_tier` (deprecated
 *      legacy column that parallels the current system). This module
 *      does not SELECT it.
 *   2. Katie never sees numeric status or level codes, never sees
 *      internal field names (verification_status, verification_level,
 *      identity_status, wwcc_status, cross_check_status), and never
 *      speaks "Tier 1/2/3" language. The mappers below convert internal
 *      state into plain-English strings before return.
 *   3. This module is READ-ONLY. No document collection, no waiver
 *      signing, no tool that writes to the verification tables. The
 *      traditional form at /nanny/verification remains the source of
 *      truth for submissions + consent.
 *   4. Nanny only. London parents are never verified (LDN2 3h, D-7), so
 *      the module is not offered to parents and has no parent branch.
 *
 * Schema reference:
 *   - system/verification/nanny_verification/nanny_verification-data-systems.md
 *   - src/lib/verification.ts (constants)
 */

import type { BloomBotModule, ToolResult } from "./types";
import { makeSlotPresentPredicate } from "@/lib/chat/preload/predicates";
import type { ChatTile } from "@/lib/chat/tiles";

// ── Internal row shapes (what we query from DB) ────────────────────────────

interface NannyRow {
  verification_level: number | null;
}

interface NannyVerificationRow {
  verification_status: number | null;
  identity_status: string | null;
  wwcc_status: string | null;
  cross_check_status: string | null;
  identity_user_guidance: string | null;
  wwcc_user_guidance: string | null;
  identity_rejection_reason: string | null;
  wwcc_rejection_reason: string | null;
}

// ── Plain-English shapes that Katie sees ───────────────────────────────────

export interface VerificationSummary {
  /** One-line human-readable headline. */
  headline: string;
  /** Completed milestones, phrased as facts. */
  whats_complete: string[];
  /** Currently in progress (waiting on system/admin, not on the user). */
  whats_in_progress: string[];
  /** Actions the user still needs to take. */
  whats_still_needed: string[];
  /** What the user CAN do on the platform right now. */
  can_do_now: string[];
  /** What they can't yet, with a plain-English reason. */
  cannot_do_yet: Array<{ what: string; why: string }>;
  /** Where to go if there's a next action. Null when nothing for the user to do. */
  how_to_continue: { label: string; url: string } | null;
  /** Copy-through of the guidance the verification pipeline has already generated. */
  system_guidance: string | null;
  /**
   * Extra context that must NOT be volunteered. Katie only surfaces these
   * items when the user explicitly asks — e.g. "is anything else happening
   * with my verification?", "why can't I accept interviews?", "is my WWCC
   * fully confirmed?". For level-3 provisional nannies this is where the
   * silent OCG confirmation + interview/babysitting holds live, so the
   * default experience matches the dashboard label of "Verified".
   */
  only_if_asked: string[];
}

export interface VerificationNextStep {
  summary: string;
  url: string;
}

// ── Nanny translator ───────────────────────────────────────────────────────

/**
 * Translate a nanny's internal verification state into plain English.
 * Never outputs codes, level numbers, or internal field names.
 */
export function summariseNannyState(
  nanny: NannyRow | null,
  ver: NannyVerificationRow | null,
): VerificationSummary {
  const level = nanny?.verification_level ?? 0;
  const status = ver?.verification_status ?? 0;
  const identityStatus = ver?.identity_status ?? "not_started";
  const wwccStatus = ver?.wwcc_status ?? "not_started";
  const identityGuidance = ver?.identity_user_guidance?.trim() || null;
  const wwccGuidance = ver?.wwcc_user_guidance?.trim() || null;
  const identityReason = ver?.identity_rejection_reason?.trim() || null;
  const wwccReason = ver?.wwcc_rejection_reason?.trim() || null;

  const url = "/nanny/verification";
  const out: VerificationSummary = {
    headline: "",
    whats_complete: [],
    whats_in_progress: [],
    whats_still_needed: [],
    can_do_now: [],
    cannot_do_yet: [],
    how_to_continue: null,
    system_guidance: null,
    only_if_asked: [],
  };

  // Profile signal — level 1+ means the registration form is done.
  if (level >= 1) {
    out.whats_complete.push("Your nanny profile is complete.");
  } else {
    out.whats_still_needed.push("Finish the registration form.");
  }

  // Verification form submission — status 10+ means they've submitted.
  const hasSubmittedVerification = status >= 10;

  // ── Identity stage ───────────────────────────────────────────────────
  if (level >= 2) {
    out.whats_complete.push(
      "Your identity has been confirmed (passport + selfie).",
    );
  } else if (status === 10 || identityStatus === "processing") {
    out.whats_in_progress.push(
      "We're automatically checking your passport and selfie.",
    );
  } else if (status === 11 || identityStatus === "review") {
    out.whats_in_progress.push("Your ID documents are in our review queue.");
  } else if (
    status === 12 ||
    identityStatus === "rejected" ||
    identityStatus === "failed"
  ) {
    out.whats_still_needed.push(
      identityReason
        ? `Resubmit your ID — previous attempt failed: ${identityReason}.`
        : "Resubmit your ID documents.",
    );
  } else if (!hasSubmittedVerification) {
    out.whats_still_needed.push(
      "Submit your verification form (passport, selfie, WWCC).",
    );
  }

  // ── WWCC stage ───────────────────────────────────────────────────────
  if (level >= 4) {
    out.whats_complete.push(
      "Your Working With Children Check has been fully confirmed.",
    );
  } else if (level === 3) {
    // Provisional — auto-passed, silent admin check in progress.
    // Per product UX, the nanny sees "Verified" on their dashboard and
    // shouldn't be told about the pending final check unless they
    // specifically ask. So the WWCC complete line goes in whats_complete
    // and the final-check-in-progress note is stashed in only_if_asked.
    out.whats_complete.push(
      "Your Working With Children Check has been confirmed.",
    );
    out.only_if_asked.push(
      "A final administrative check on your Working With Children Check is still in progress with our team — you don't need to do anything, and we'll let you know once it's fully confirmed.",
    );
  } else if (level === 2) {
    if (
      status === 20 ||
      wwccStatus === "processing" ||
      wwccStatus === "pending"
    ) {
      out.whats_in_progress.push(
        "We're checking your Working With Children Check.",
      );
    } else if (status === 21 || wwccStatus === "review") {
      out.whats_in_progress.push(
        "Your Working With Children Check is in our review queue.",
      );
    } else if (
      status === 22 ||
      wwccStatus === "rejected" ||
      wwccStatus === "failed"
    ) {
      out.whats_still_needed.push(
        wwccReason
          ? `Resubmit your WWCC — previous attempt failed: ${wwccReason}.`
          : "Resubmit your Working With Children Check.",
      );
    } else if (status === 23) {
      out.whats_still_needed.push(
        "Renew your Working With Children Check — it has expired.",
      );
    }
  }

  // ── Capabilities ──
  if (level >= 3) {
    out.can_do_now.push("Your profile is visible to parents in search.");
  } else {
    out.cannot_do_yet.push({
      what: "Appear in parents' search results",
      why: "your WWCC has not yet passed the initial check",
    });
  }

  if (level >= 4) {
    out.can_do_now.push("You can accept interview requests from parents.");
    out.can_do_now.push(
      "You can accept babysitting jobs (subject to being eligible for babysitting).",
    );
  } else if (level === 3) {
    // Provisional — the holds on interview/babysitting acceptance are
    // deliberately NOT volunteered. Stash them in only_if_asked so Katie
    // can answer if the user specifically raises them, without breaking
    // the "you're verified" UX.
    out.only_if_asked.push(
      "Accepting interview requests and babysitting jobs is held until that final check finishes.",
    );
  } else {
    // Levels 0–2: user is still working toward verification, so the
    // blockers are informative.
    out.cannot_do_yet.push({
      what: "Accept interview requests",
      why: "your Working With Children Check is not yet fully confirmed",
    });
    out.cannot_do_yet.push({
      what: "Accept babysitting jobs",
      why: "your Working With Children Check is not yet fully confirmed",
    });
  }

  // ── Headline + next-step URL ──
  if (level >= 4) {
    out.headline = "You're fully verified.";
    out.how_to_continue = null;
  } else if (level === 3) {
    // Match the nanny's dashboard experience — "Verified". The final
    // admin check is captured in only_if_asked for when they dig in.
    out.headline = "You're verified.";
    out.how_to_continue = null;
  } else if (level === 0) {
    // Brand-new signup — haven't completed the profile form yet.
    out.headline = "Start by finishing your profile to unlock verification.";
    out.how_to_continue = { label: "Start verification", url };
  } else if (level === 1 && !hasSubmittedVerification) {
    out.headline =
      "Start verification to unlock interviews and babysitting jobs.";
    out.how_to_continue = { label: "Start verification", url };
  } else if (out.whats_still_needed.length > 0) {
    out.headline = "There are still a couple of steps for you to finish.";
    out.how_to_continue = { label: "Continue verification", url };
  } else if (out.whats_in_progress.length > 0) {
    out.headline =
      "Your verification is in progress — nothing you need to do right now.";
    out.how_to_continue = null;
  } else {
    out.headline = "Start your verification to unlock interviews and jobs.";
    out.how_to_continue = { label: "Start verification", url };
  }

  // ── System-generated guidance (pass through unchanged — already prose) ──
  const guidanceParts = [identityGuidance, wwccGuidance].filter(
    (g): g is string => Boolean(g),
  );
  out.system_guidance =
    guidanceParts.length > 0 ? guidanceParts.join(" ") : null;

  return out;
}

// ── Handlers ───────────────────────────────────────────────────────────────

/**
 * Derive the step labels + statuses that VerificationProgress expects,
 * from the raw verification state rows. Lives server-side so the
 * browser never sees `verification_level` / `verification_status`
 * codes.
 *
 * Step statuses align with VerificationProgress.getStepState which
 * treats ["verified","saved","doc_verified","passed"] as completed,
 * ["processing","pending","review"] as in progress, and
 * ["failed","rejected","no_match","new_info"] as action-needed;
 * "barred" carries no action (3b: the old regulator-only "closed" /
 * "application_pending" values are gone).
 *
 * Provisional UX rule: for a level-3 nanny, ALL steps are marked
 * `verified` so the tile reads "Verified" visually. The silent
 * OCG-confirmation-pending detail lives in
 * VerificationSummary.only_if_asked and is surfaced only when the
 * user directly asks.
 */
export function deriveNannySteps(
  nanny: NannyRow | null,
  ver: NannyVerificationRow | null,
): Array<{ label: string; status: string }> {
  const level = nanny?.verification_level ?? 0;
  const identityStatus = ver?.identity_status ?? "not_started";
  const wwccStatus = ver?.wwcc_status ?? "not_started";
  const status = ver?.verification_status ?? 0;

  const profileStatus = level >= 1 ? "verified" : "not_started";

  let idStep: string;
  if (level >= 2) {
    idStep = "verified";
  } else if (identityStatus === "processing" || status === 10) {
    idStep = "processing";
  } else if (identityStatus === "review" || status === 11) {
    idStep = "review";
  } else if (
    identityStatus === "rejected" ||
    identityStatus === "failed" ||
    status === 12
  ) {
    idStep = "failed";
  } else {
    idStep = "not_started";
  }

  let wwccStep: string;
  if (level >= 3) {
    // Level 3 = provisional (OCG passed initial check). Main-page UX
    // labels this "Verified", so the stepper shows verified too. The
    // final-admin-check pending story is only surfaced on direct
    // request via VerificationSummary.only_if_asked.
    wwccStep = "verified";
  } else if (
    wwccStatus === "processing" ||
    wwccStatus === "pending" ||
    status === 20
  ) {
    wwccStep = "processing";
  } else if (wwccStatus === "review" || status === 21) {
    wwccStep = "review";
  } else if (
    wwccStatus === "rejected" ||
    wwccStatus === "failed" ||
    status === 22
  ) {
    wwccStep = "failed";
  } else if (status === 23) {
    wwccStep = "new_info";
  } else if (status === 26 || wwccStatus === "ocg_not_found") {
    wwccStep = "no_match";
  } else if (status === 27 || wwccStatus === "barred") {
    wwccStep = "barred";
  } else {
    wwccStep = "not_started";
  }

  return [
    { label: "Profile complete", status: profileStatus },
    { label: "ID verified", status: idStep },
    { label: "Working With Children Check", status: wwccStep },
  ];
}

/**
 * Builds the inline tile that rides with a verification-status tool
 * result. Renders the VerificationProgress stepper (same component
 * the design system uses) plus a headline and an optional one-tap
 * action link to the traditional verification form when the user
 * has a next step. Keeps Katie's voice (narration) and the operator's
 * hand (form) visually co-located.
 *
 * For provisional (level 3), the UX rule still applies: the tile
 * must NOT mention the silent final check. deriveNannySteps marks
 * all steps as `verified` at that level, and summariseNannyState
 * routes the pending-check note into `only_if_asked` so it never
 * appears on the tile.
 */
function tileForVerification(
  summary: VerificationSummary,
  steps: Array<{ label: string; status: string }>,
): ChatTile {
  const action = summary.how_to_continue
    ? {
        label: summary.how_to_continue.label,
        href: summary.how_to_continue.url,
      }
    : undefined;

  return {
    kind: "verification_status",
    data: {
      headline: summary.headline,
      steps,
      action,
    },
  };
}

async function readVerificationStatus(
  _args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  if (ctx.effectiveRole === "nanny") {
    const { data: nanny } = await ctx.supabase
      .from("nannies")
      .select("verification_level")
      .eq("user_id", ctx.userId)
      .maybeSingle();
    const { data: ver } = await ctx.supabase
      .from("verifications")
      .select(
        "verification_status, identity_status, wwcc_status, cross_check_status, identity_user_guidance, wwcc_user_guidance, identity_rejection_reason, wwcc_rejection_reason",
      )
      .eq("user_id", ctx.userId)
      .maybeSingle();
    const nannyRow = nanny as NannyRow | null;
    const verRow = ver as NannyVerificationRow | null;
    const summary = summariseNannyState(nannyRow, verRow);
    const steps = deriveNannySteps(nannyRow, verRow);
    return {
      success: true,
      data: summary,
      tile: tileForVerification(summary, steps),
    };
  }

  return {
    success: false,
    error:
      "Verification is only available for nanny accounts. Admin views use the admin inspection tools.",
  };
}

async function readVerificationNextSteps(
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const r = await readVerificationStatus(args, ctx);
  if (!r.success) return r;
  const summary = r.data as VerificationSummary;

  const steps: VerificationNextStep[] = [];
  const url = "/nanny/verification";
  for (const item of summary.whats_still_needed) {
    steps.push({ summary: item, url });
  }

  return {
    success: true,
    data: {
      count: steps.length,
      steps,
      nothing_to_do: steps.length === 0,
      headline: summary.headline,
    },
  };
}

// ── Module export ──────────────────────────────────────────────────────────

export const verificationModule: BloomBotModule = {
  id: "verification",
  name: "Verification",
  description:
    "Read-only view of the user's verification progress. Translates internal state into plain English so Katie can narrate what's done, what's in progress, what's still needed, and what the user can/can't do on the platform yet.",

  rolesAllowed: ["nanny"],

  tools: [
    {
      name: "read_verification_status",
      description:
        "Get the current verification summary for the signed-in user — what's done, what's in progress, what's still needed, what they can and can't do yet, and a link if there's a next action. All fields are already phrased in natural language; surface them directly to the user without paraphrasing more than necessary.",
      parameters: { type: "object", properties: {}, required: [] },
      isPrefulfilled: makeSlotPresentPredicate("verification_status"),
    },
    {
      name: "read_verification_next_steps",
      description:
        "Get just the ordered list of actions the user still needs to take, each with a link to the verification page. If the list is empty, tell the user they have nothing to do right now.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  ],

  async execute(toolName, args, ctx) {
    if (toolName === "read_verification_status")
      return readVerificationStatus(args, ctx);
    if (toolName === "read_verification_next_steps")
      return readVerificationNextSteps(args, ctx);
    return { success: false, error: `Unknown tool: ${toolName}` };
  },

  systemPromptFragment:
    "For anything about the user's verification, call `read_verification_status` or `read_verification_next_steps`. Hard rules when talking about verification:\n\n" +
    "• NEVER mention 'level 1/2/3/4', 'status 10/11/20/30/40', 'tier 1/2/3', 'verification_level', 'verification_status', 'verification_tier', 'identity_status', 'wwcc_status', or any other internal field or code. Just describe what's happened and what's next in natural English.\n" +
    "• NEVER offer to collect documents, take passport/WWCC numbers, tick the consent/waiver checkbox, or submit anything on the user's behalf. Verification is a legal process — it happens on the traditional form at /nanny/verification. Always redirect there with the `how_to_continue` link when there's something to do.\n" +
    "• If the user asks for a status update, lead with the `headline`, mention what's `in_progress` if anything, then tell them what they can/can't do. If they ask 'what's next', use `read_verification_next_steps`.\n" +
    "• DO NOT narrate anything in the `only_if_asked` list unsolicited. Those items are deliberately hidden to match the product UX (e.g. a provisionally-verified nanny sees 'Verified' on their dashboard and shouldn't be told unprompted that a background check is still pending). Only surface them when the user specifically asks — for example 'is anything else happening with my verification?', 'why can't I accept interviews?', 'is my WWCC fully confirmed?', 'tell me everything'. If they ask a general 'am I verified?' or 'what's my status?', lead with the headline and what they can do; don't volunteer the pending-check note.\n" +
    "• If `system_guidance` is present, the verification pipeline has already chosen the exact wording to show the user — prefer that text over your own paraphrase.",
};
