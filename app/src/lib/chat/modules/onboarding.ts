/**
 * `onboarding` module — parent-side onboarding coach.
 *
 * The position-creation form has 42 fields across 5 sections and is
 * too much for inline chat. This module's job is narrower: tell the
 * parent where they are in the flow, what's missing, and point them
 * to `/parent/request` to fill it in. Katie doesn't inline the form.
 *
 * v1 scope: READ-ONLY. Two tools:
 *   - read_onboarding_progress — high-level snapshot of what's done
 *     and what's missing
 *   - read_next_step — single plain-English next action + deep link
 *
 * Writes are intentionally out of scope — position creation is
 * `saveTypeformPosition` which accepts ≤42 fields and the form UI
 * handles partial saves + validation. Rebuilding that in chat is
 * bad ergonomics.
 */

import type { BloomBotModule, ToolResult } from "./types";
import { getPosition } from "@/lib/actions/parent";
import { asUserFacingRole } from "./utils";

interface ProgressSnapshot {
  stage:
    | "not_started"
    | "basics"
    | "schedule"
    | "children"
    | "requirements"
    | "ready_to_publish"
    | "published";
  headline: string;
  missing: string[];
  cta_href: string;
  cta_label: string;
}

function parentOnlyError(): ToolResult {
  return {
    success: false,
    error:
      "Onboarding is a parent-side flow. Nanny onboarding happens in the signup + verification flow.",
  };
}

function describeProgress(
  position: Awaited<ReturnType<typeof getPosition>>["data"],
): ProgressSnapshot {
  if (!position) {
    return {
      stage: "not_started",
      headline:
        "You haven't started your position yet. Creating one is a 5-section form (timeline, schedule, children, requirements, description).",
      missing: [
        "Timeline — when you need a nanny and for how long",
        "Schedule — which days / hours per week",
        "Children — their ages and any special considerations",
        "Requirements — language, qualifications, driver's license",
        "Description — what you'd like to tell candidates",
      ],
      cta_href: "/parent/request",
      cta_label: "Start your position",
    };
  }

  // Position exists — assess what's set.
  const missing: string[] = [];
  if (!position.suburb) missing.push("Area");
  if (!position.hours_per_week) missing.push("Hours per week");
  if (!position.days_required || position.days_required.length === 0) {
    missing.push("Days required");
  }
  if (!position.hourly_rate) missing.push("Hourly rate");
  if (!position.children || position.children.length === 0) {
    missing.push("Children (at least one)");
  }
  if (!position.urgency) missing.push("Timeline / urgency");

  const isPublished =
    position.status === "active" || position.status === "filled";

  if (isPublished) {
    return {
      stage: "published",
      headline: "Your position is live and matching nannies.",
      missing: [],
      cta_href: "/parent/request",
      cta_label: "Edit your position",
    };
  }

  if (missing.length === 0) {
    return {
      stage: "ready_to_publish",
      headline: "Your position is complete — one more step to publish.",
      missing: [],
      cta_href: "/parent/request",
      cta_label: "Review and publish",
    };
  }

  // Pick the most-advanced-incomplete stage as the current-stage label.
  let stage: ProgressSnapshot["stage"] = "basics";
  if (position.suburb && position.hours_per_week) {
    if (position.children && position.children.length > 0) {
      stage = "requirements";
    } else {
      stage = "children";
    }
  } else if (position.suburb || position.hours_per_week) {
    stage = "schedule";
  }

  return {
    stage,
    headline: `Your position is in draft — ${missing.length} item${
      missing.length === 1 ? "" : "s"
    } left to set.`,
    missing,
    cta_href: "/parent/request",
    cta_label: "Continue your position",
  };
}

// ── Tools ─────────────────────────────────────────────────────────────────

async function readOnboardingProgress(
  _args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const role = asUserFacingRole(ctx.effectiveRole);
  if (role !== "parent") return parentOnlyError();

  const result = await getPosition();
  if (result.error) return { success: false, error: result.error };

  const snapshot = describeProgress(result.data);
  return {
    success: true,
    data: snapshot,
  };
}

async function readNextStep(
  _args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult> {
  const role = asUserFacingRole(ctx.effectiveRole);
  if (role !== "parent") return parentOnlyError();

  const result = await getPosition();
  if (result.error) return { success: false, error: result.error };

  const snapshot = describeProgress(result.data);
  const nextStep =
    snapshot.stage === "published"
      ? "You're all set — wait for nannies to apply or request connections directly."
      : snapshot.missing.length > 0
        ? `Next: ${snapshot.missing[0]}`
        : "Next: review and publish.";

  return {
    success: true,
    data: {
      stage: snapshot.stage,
      next_step: nextStep,
      cta_href: snapshot.cta_href,
      cta_label: snapshot.cta_label,
    },
  };
}

// ── Module export ─────────────────────────────────────────────────────────

export const onboardingModule: BloomBotModule = {
  id: "onboarding",
  name: "Onboarding",
  description:
    "Parent-side onboarding coach. Reads the parent's position-creation progress and tells them the next step + deep-link to the traditional form. Does NOT inline the 42-field form.",

  rolesAllowed: ["parent"],

  tools: [
    {
      name: "read_onboarding_progress",
      description:
        "Return a snapshot of where the parent is in the position-creation flow. Stage (not_started / basics / schedule / children / requirements / ready_to_publish / published), plain-English headline, list of missing fields, and a CTA link to the form.",
      parameters: { type: "object", properties: {}, required: [] },
    },
    {
      name: "read_next_step",
      description:
        "Narrower form of read_onboarding_progress — returns just the single most useful next-step line + deep link. Use for 'what should I do next?' / 'am I done?'.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  ],

  async execute(toolName, args, ctx) {
    if (toolName === "read_onboarding_progress")
      return readOnboardingProgress(args, ctx);
    if (toolName === "read_next_step") return readNextStep(args, ctx);
    return { success: false, error: `Unknown tool: ${toolName}` };
  },

  systemPromptFragment:
    "For parents asking 'how do I start', 'what's left on my position', 'am I done setting up', 'what should I do next' — call `read_onboarding_progress` (full snapshot) or `read_next_step` (just the next action).\n\n" +
    "Hard rules:\n" +
    "• The 42-field position form is too much for inline chat. Always surface the `cta_href` link (e.g. /parent/request) so the user can jump in.\n" +
    "• NEVER try to inline the form by asking field-by-field. The server action needs all fields together and the form UI handles partial save + validation properly.\n" +
    "• NEVER say 'saveTypeformPosition', `position.status`, `days_required`, or any other internal field name. The `missing` and `headline` strings are already user-ready.\n" +
    "• If `stage` is 'published', the user has nothing to start — they should check their connections or browse nannies (route them to `read_my_position` or `read_connection_inbox`).",
};
