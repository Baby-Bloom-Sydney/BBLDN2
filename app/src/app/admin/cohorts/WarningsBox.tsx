"use client";

/**
 * The warnings box (brief §0.9, §3.8): refunded but still held (Re-open), paid but no place (open the family), over
 * capacity (open the cohort). A failed read is flagged, never shown as an empty box; with nothing to warn, no box.
 * BB-wave1-041126/02-build.
 */

import { useState } from "react";
import Link from "next/link";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WARNING_REOPEN_REASON } from "@/lib/cohorts/constants";
import { warningLine } from "@/lib/cohorts/copy";
import { formatCohortDate } from "@/lib/cohorts/dates";
import type { CohortWarning, WarningsFigure } from "@/lib/cohorts/types";
import { AlertLine, NoteLine, QUIET_BUTTON } from "./parts";
import { ReopenConfirm } from "./ReopenConfirm";

interface Target {
  readonly placeId: string;
  readonly name: string;
}

function Fix({ w, onReopen, onOpenCohort }: { readonly w: CohortWarning; readonly onReopen: (t: Target) => void; readonly onOpenCohort: (start: string) => void }) {
  if (w.kind === "refunded_but_held") {
    return (
      <button type="button" className={QUIET_BUTTON} aria-label={`Re-open: ${w.name}`} onClick={() => onReopen({ placeId: w.placeId, name: w.name })}>
        Re-open
      </button>
    );
  }
  if (w.kind === "paid_without_place") {
    return (
      <Link href={`/admin/users/${w.parentUserId}/subscription`} className={QUIET_BUTTON} aria-label={`Open family: ${w.name}`}>
        Open family
      </Link>
    );
  }
  return (
    <button type="button" className={QUIET_BUTTON} aria-label={`Open cohort: ${formatCohortDate(w.cohortStartDate)}`} onClick={() => onOpenCohort(w.cohortStartDate)}>
      Open cohort
    </button>
  );
}

const keyOf = (w: CohortWarning): string => (w.kind === "over_capacity" ? `over-${w.cohortStartDate}` : w.kind === "refunded_but_held" ? `refund-${w.placeId}` : `paid-${w.parentUserId}`);

export function WarningsBox({ warnings, onOpenCohort }: { readonly warnings: WarningsFigure; readonly onOpenCohort: (start: string) => void }) {
  const [target, setTarget] = useState<Target | null>(null);
  if (warnings.kind === "ok" && warnings.list.length === 0) return null;
  return (
    <section aria-labelledby="cohort-warnings" className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-4">
      <h2 id="cohort-warnings" className="text-sm font-semibold text-amber-800">
        Warnings
      </h2>
      {warnings.kind === "unavailable" ? (
        <AlertLine>The warnings could not be read — reload to try again.</AlertLine>
      ) : (
        <ul className="space-y-2">
          {warnings.list.map((w) => (
            <li key={keyOf(w)} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-amber-900">{warningLine(w)}</span>
              <Fix w={w} onReopen={setTarget} onOpenCohort={onOpenCohort} />
            </li>
          ))}
        </ul>
      )}
      {warnings.kind === "ok" && warnings.truncated && <NoteLine>Showing the first 100 of each kind.</NoteLine>}
      <Dialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-open place</DialogTitle>
            <DialogDescription className="sr-only">{target ? `Re-open ${target.name}'s place with a reason.` : "Re-open a place."}</DialogDescription>
          </DialogHeader>
          {target && (
            <ReopenConfirm
              placeId={target.placeId}
              familyName={target.name}
              initialReason={WARNING_REOPEN_REASON}
              onDone={() => setTarget(null)}
              onBack={() => setTarget(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
