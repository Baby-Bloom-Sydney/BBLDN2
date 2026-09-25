"use client";

import { Check } from "lucide-react";
import { CONNECTION_STAGE } from "@/lib/position/constants";

interface Checkpoint {
  label: string;
  reachedAt: number;
}

const CHECKPOINTS: Checkpoint[] = [
  { label: "Matchmaking", reachedAt: -1 },
  { label: "Connect", reachedAt: CONNECTION_STAGE.REQUEST_SENT },
  { label: "Meet", reachedAt: CONNECTION_STAGE.INTRO_SCHEDULED },
  { label: "Trial", reachedAt: CONNECTION_STAGE.TRIAL_ARRANGED },
  { label: "Matched!", reachedAt: CONNECTION_STAGE.OFFERED },
];

function isTrialElapsed(trialDate?: string | null): boolean {
  if (!trialDate) return false;
  const today = new Date().toISOString().split('T')[0];
  return trialDate < today;
}

function getIntermediaryText(
  stage: number,
  role: "parent" | "nanny",
  checkpoint: string,
  fillInitiatedBy?: string | null,
  trialDate?: string | null,
): string {
  if (checkpoint === "Connect") {
    if (stage === CONNECTION_STAGE.NANNY_APPLIED || stage === CONNECTION_STAGE.NANNY_APPLIED_PENDING)
      return role === "nanny"
        ? "Applied"
        : "A nanny has applied to your position";
    if (stage === CONNECTION_STAGE.REQUEST_SENT)
      return role === "parent"
        ? "We're reaching out to your potential nanny"
        : "A family has sent you a connection request";
    if (stage === CONNECTION_STAGE.ACCEPTED || stage === CONNECTION_STAGE.ACCEPTED_PENDING)
      return role === "parent"
        ? "They accepted! Pick a time for your meet and greet"
        : "Accepted! The family will arrange a meet and greet";
  }

  if (checkpoint === "Meet") {
    if (stage === CONNECTION_STAGE.INTRO_SCHEDULED)
      return "Your meet and greet is booked — good luck!";
    if (stage === CONNECTION_STAGE.INTRO_COMPLETE)
      return "How did the meet and greet go? Let us know below";
    if (stage === CONNECTION_STAGE.AWAITING_RESPONSE)
      return role === "nanny"
        ? "Let us know when you have an update"
        : "We're waiting for an update";
  }

  if (checkpoint === "Trial") {
    if (stage === CONNECTION_STAGE.TRIAL_ARRANGED) {
      if (fillInitiatedBy === "nanny")
        return role === "nanny"
          ? "Waiting for the family to confirm the trial"
          : "Please confirm the trial arrangement below";
      if (isTrialElapsed(trialDate))
        return "How did the trial go? Let us know below";
      return role === "nanny"
        ? "Your trial shift is coming up — you've got this!"
        : "A trial shift is arranged — exciting!";
    }
    if (stage === CONNECTION_STAGE.TRIAL_COMPLETE)
      return "How did the trial go? Let us know below";
  }

  if (checkpoint === "Matched!") {
    if (stage === CONNECTION_STAGE.OFFERED) {
      if (fillInitiatedBy === "parent")
        return role === "nanny"
          ? "The family has selected you! Confirm below"
          : "Waiting for the nanny to confirm";
      return role === "nanny"
        ? "Waiting for the family to confirm"
        : "Your nanny says they've been selected — confirm below";
    }
    if (stage === CONNECTION_STAGE.CONFIRMED)
      return "Confirmed! Congratulations!";
    if (stage >= CONNECTION_STAGE.ACTIVE)
      return "Your placement is active";
  }

  return "";
}

interface ConnectionProgressProps {
  currentStage: number;
  role: "parent" | "nanny";
  fillInitiatedBy?: string | null;
  trialDate?: string | null;
  confirmedTime?: string | null;
  hideMatchmaking?: boolean;
}

export function ConnectionProgress({
  currentStage,
  role,
  fillInitiatedBy,
  trialDate,
  confirmedTime,
  hideMatchmaking = false,
}: ConnectionProgressProps) {
  const visible = hideMatchmaking
    ? CHECKPOINTS.filter(cp => cp.label !== "Matchmaking")
    : CHECKPOINTS;

  const getState = (i: number): "completed" | "current" | "future" => {
    const cp = visible[i];
    if (cp.reachedAt < 0) return "completed";
    if (currentStage < cp.reachedAt) return "future";

    const nextReal = visible[i + 1];
    if (!nextReal) {
      return currentStage >= CONNECTION_STAGE.CONFIRMED ? "completed" : "current";
    }
    return currentStage >= nextReal.reachedAt ? "completed" : "current";
  };

  return (
    <div>
      {visible.map((cp, i) => {
        const state = getState(i);
        const isLast = i === visible.length - 1;
        const isCurrent = state === "current";
        const isCompleted = state === "completed";

        // Get intermediary text for current step, or for the last step when completed
        const text = (isCurrent || (isLast && isCompleted))
          ? getIntermediaryText(currentStage, role, cp.label, fillInitiatedBy, trialDate)
          : "";

        // Date context for intro time or trial date
        let dateText: string | null = null;
        if (text && confirmedTime && currentStage === CONNECTION_STAGE.INTRO_SCHEDULED)
          dateText = new Date(confirmedTime).toLocaleDateString("en-GB", {
            weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
          });
        if (text && trialDate && currentStage === CONNECTION_STAGE.TRIAL_ARRANGED)
          dateText = new Date(trialDate + "T00:00:00").toLocaleDateString("en-GB", {
            weekday: "short", day: "numeric", month: "short",
          });

        const lineColor = isCompleted
          ? "bg-green-300"
          : isCurrent
          ? "bg-violet-200"
          : "bg-slate-100";

        // Completed and future steps are condensed; current step is full size
        const circleSize = isCurrent
          ? "h-7 w-7"
          : "h-5 w-5";
        const iconSize = isCurrent ? "h-4 w-4" : "h-3 w-3";
        const dotSize = "h-2.5 w-2.5";
        const labelClass = isCompleted
          ? "text-xs leading-5 font-medium text-green-700"
          : isCurrent
          ? "text-sm leading-7 font-semibold text-violet-700"
          : "text-xs leading-5 text-slate-300";

        return (
          <div key={cp.label} className="flex gap-3">
            {/* Left: circle + connector line (fixed w-7 so lines always align) */}
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

            {/* Right: label + content */}
            <div className={isLast ? "pb-0" : isCurrent ? "pb-1" : "pb-0.5"}>
              <p className={labelClass}>
                {cp.label}
              </p>

              {/* Intermediary/status text (only for current or last-completed) */}
              {text && (
                <div className={isCurrent ? "py-2" : "py-1"}>
                  <p
                    className={`text-xs leading-relaxed ${
                      isCompleted ? "text-green-600" : "text-violet-600/80"
                    }`}
                  >
                    {text}
                  </p>
                  {dateText && (
                    <p className="text-xs text-violet-500 font-medium mt-1">
                      {dateText}
                    </p>
                  )}
                </div>
              )}

              {/* Small spacer for steps without text */}
              {!text && !isLast && <div className={isCurrent ? "h-5" : "h-2"} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}
