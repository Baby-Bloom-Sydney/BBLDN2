"use client";

import { Check } from "lucide-react";
import { getDbsStateForSection, type DbsDisplayState } from "@/lib/dbs/nanny-display";

type StepState = "completed" | "current" | "future";

interface VerificationStep {
  label: string;
  status: string; // section status: not_started, pending, processing, verified, saved, failed, etc.
}

interface VerificationProgressProps {
  steps: VerificationStep[];
}

function getStepState(step: VerificationStep, index: number, steps: VerificationStep[]): StepState {
  const s = step.status;

  // Completed states
  if (["verified", "saved", "doc_verified", "passed"].includes(s)) {
    return "completed";
  }

  // If not completed, check if all previous steps are completed
  const allPreviousComplete = steps.slice(0, index).every((prev) =>
    ["verified", "saved", "doc_verified", "passed"].includes(prev.status)
  );

  if (allPreviousComplete && s !== "not_started") {
    return "current"; // Active / in-progress / needs action
  }

  if (allPreviousComplete && s === "not_started") {
    return "current"; // Ready to start
  }

  return "future"; // Locked — previous steps not done
}

/** Katie's stepper passes DBS display-state names (3b); the other steps pass their own section values. */
const DISPLAY_STATE_NAMES: ReadonlySet<string> = new Set<DbsDisplayState>(["new_info", "no_match", "barred"]);

/** Sub-text per step (copy deck §5.4): one decoder for the DBS states; identity/residence share the same words. */
const SUBTEXT: Partial<Record<DbsDisplayState, string>> = {
  reading: "Verifying...",
  checking: "Verifying...",
  with_team: "Pending manual review",
  manual_review: "Pending manual review",
  failed: "Action needed",
  rejected: "Action needed",
  technical_retry: "Action needed",
  new_info: "New certificate needed",
  no_match: "Not on Update Service — action needed",
  // barred: no action line (ruling #13)
};

function getSubtext(step: VerificationStep): string {
  const s = step.status;
  const state = DISPLAY_STATE_NAMES.has(s) ? (s as DbsDisplayState) : getDbsStateForSection(s);
  return SUBTEXT[state] ?? "";
}

export function VerificationProgress({ steps }: VerificationProgressProps) {
  return (
    <div>
      {steps.map((step, i) => {
        const state = getStepState(step, i, steps);
        const isLast = i === steps.length - 1;
        const isCurrent = state === "current";
        const isCompleted = state === "completed";

        const subtext = isCurrent ? getSubtext(step) : "";

        const lineColor = isCompleted
          ? "bg-green-300"
          : isCurrent
          ? "bg-violet-200"
          : "bg-slate-100";

        const circleSize = isCurrent ? "h-7 w-7" : "h-5 w-5";
        const iconSize = isCurrent ? "h-4 w-4" : "h-3 w-3";
        const dotSize = "h-2.5 w-2.5";
        const labelClass = isCompleted
          ? "text-xs leading-5 font-medium text-green-700"
          : isCurrent
          ? "text-sm leading-7 font-semibold text-violet-700"
          : "text-xs leading-5 text-slate-300";

        return (
          <div key={step.label} className="flex gap-3">
            {/* Left: circle + connector line */}
            <div className="flex w-7 shrink-0 flex-col items-center">
              <div
                className={`flex ${circleSize} shrink-0 items-center justify-center rounded-full border-2 ${
                  isCompleted
                    ? "border-green-500 bg-green-500"
                    : isCurrent
                    ? "border-violet-500 bg-violet-50 ring-2 ring-violet-200"
                    : "border-slate-200 bg-white"
                }`}
              >
                {isCompleted && <Check className={`${iconSize} text-white`} />}
                {isCurrent && (
                  <div className={`${dotSize} rounded-full bg-violet-500`} />
                )}
              </div>
              {!isLast && <div className={`w-0.5 flex-1 ${lineColor}`} />}
            </div>

            {/* Right: label + subtext */}
            <div className={isLast ? "pb-0" : isCurrent ? "pb-1" : "pb-0.5"}>
              <p className={labelClass}>{step.label}</p>

              {subtext && (
                <div className="py-1">
                  <p className="text-xs leading-relaxed text-violet-600/80">{subtext}</p>
                </div>
              )}

              {!subtext && !isLast && <div className={isCurrent ? "h-5" : "h-2"} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}
