"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GuidanceLink, UserGuidance } from "@/lib/verification";

/** At most two links under the steps (ruling #22). */
const MAX_LINKS = 2;

interface GuidanceCardProps {
  guidance: UserGuidance;
  primaryAction?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
  /** Optional explainer under the steps (3b, ruling #22). Identity passes none and renders as before. */
  explainer?: { heading: string; body: string };
  /** Optional external links under the steps — only the first two render (3b, ruling #22). */
  links?: ReadonlyArray<GuidanceLink>;
}

export function GuidanceCard({ guidance, primaryAction, secondaryAction, explainer, links }: GuidanceCardProps) {
  const shownLinks = (links ?? []).slice(0, MAX_LINKS);
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-800">{guidance.title}</p>
          <p className="text-sm text-amber-700 mt-1">{guidance.explanation}</p>
        </div>
      </div>

      {guidance.steps_to_fix.length > 0 && (
        <div className="ml-7">
          <p className="text-xs font-medium text-amber-800 mb-1">To fix this:</p>
          <ol className="list-decimal list-inside text-sm text-amber-700 space-y-0.5">
            {guidance.steps_to_fix.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      )}

      {explainer && (
        <div className="ml-7 rounded-md bg-white/60 border border-amber-100 px-3 py-2">
          <p className="text-xs font-semibold text-amber-800">{explainer.heading}</p>
          <p className="text-xs text-amber-700 mt-0.5">{explainer.body}</p>
        </div>
      )}

      {shownLinks.length > 0 && (
        <div className="ml-7 flex flex-wrap gap-x-4 gap-y-1">
          {shownLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-amber-800 underline underline-offset-2 hover:text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded-sm"
            >
              {link.label} &rarr;
            </a>
          ))}
        </div>
      )}

      {(primaryAction || secondaryAction) && (
        <div className="flex gap-2 ml-7 pt-1">
          {primaryAction && (
            <Button
              type="button"
              onClick={primaryAction.onClick}
              className="bg-violet-600 hover:bg-violet-700 text-white text-sm"
              size="sm"
            >
              {primaryAction.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              type="button"
              variant="outline"
              onClick={secondaryAction.onClick}
              size="sm"
              className="text-sm"
            >
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
