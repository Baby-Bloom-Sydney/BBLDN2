"use client";

/**
 * The current and next cohort cards (brief §0.3, §0.6, §0.10–§0.12, §3.3–3.4). Current: places, taken, left, being
 * paid now, over by (amber), the sentence BAI reads on the call, and its places editor (the next cohort's editor is
 * its row in the upcoming list). Next: the same numbers, goodwill places taken, pre-booked calls.
 * BB-wave1-041126/02-build.
 */

import { Card, CardContent } from "@/components/ui/card";
import { beingPaidLine, callsSentence, cardHeadline, goodwillLine, overByLine, preBookedLine } from "@/lib/cohorts/copy";
import { formatCohortDate } from "@/lib/cohorts/dates";
import type { CallsFigure, CohortEntry, PreBookedFigure } from "@/lib/cohorts/types";
import { ACTION_BUTTON, NoteLine, SmallLabel, Tile } from "./parts";
import { PlacesEditor } from "./PlacesEditor";

export function OverByBadge({ overBy }: { readonly overBy: number }) {
  if (overBy <= 0) return null;
  return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{overByLine(overBy)}</span>;
}

export function FamiliesButton({ entry, onOpen }: { readonly entry: CohortEntry; readonly onOpen: (start: string) => void }) {
  const n = entry.families.length;
  return (
    <button type="button" className={ACTION_BUTTON} onClick={() => onOpen(entry.view.start)}>
      Families ({n}) <span className="sr-only">in the cohort starting {formatCohortDate(entry.view.start)}</span>
    </button>
  );
}

type Props =
  | { readonly kind: "current"; readonly entry: CohortEntry; readonly calls: CallsFigure; readonly onOpenFamilies: (start: string) => void }
  | { readonly kind: "next"; readonly entry: CohortEntry; readonly preBooked: PreBookedFigure; readonly onOpenFamilies: (start: string) => void };

export function CohortCard(props: Props) {
  const v = props.entry.view;
  const title = props.kind === "current" ? "Current cohort" : "Next cohort";
  return (
    <section aria-label={title}>
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <SmallLabel>{title}</SmallLabel>
              <h2 className="mt-1 text-base font-semibold text-slate-900">{cardHeadline(v)}</h2>
            </div>
            <OverByBadge overBy={v.overBy} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Tile label="Places" value={v.places} />
            <Tile label="Taken" value={v.taken} tone="info" />
            <Tile label="Left" value={v.left} tone="active" />
          </div>
          {v.beingPaid > 0 && <p className="text-sm font-medium text-violet-700">{beingPaidLine(v.beingPaid)}</p>}
          {props.kind === "current" ? (
            <p className="rounded-md bg-violet-50 px-3 py-2 text-sm text-violet-900">{callsSentence(v.left, props.calls)}</p>
          ) : (
            <div className="space-y-1">
              <NoteLine>{goodwillLine(props.entry.goodwillTaken)}</NoteLine>
              <NoteLine>{preBookedLine(props.preBooked)}</NoteLine>
            </div>
          )}
          <div className="flex flex-wrap items-end justify-between gap-3">
            {props.kind === "current" ? <PlacesEditor key={`${v.start}:${v.places}`} startDate={v.start} places={v.places} /> : <span />}
            <FamiliesButton entry={props.entry} onOpen={props.onOpenFamilies} />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
