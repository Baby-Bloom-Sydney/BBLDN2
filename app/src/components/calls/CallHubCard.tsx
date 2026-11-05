"use client";

/**
 * The call card on her Childcare tab, at the top of "My childcare" (brief 04 §0a.4; plan B7 → 04b rework W9, W12).
 * The page shows it only while no nanny is hired or connected. In the app's card style (mock D):
 *
 *   not booked        "Your Complimentary matchmaker call" · 04b's intro · [Book a time]
 *   after no-answer   "Your Complimentary matchmaker call" · "We tried to call you — pick another time" · [Book a time]
 *   booked            "Your Complimentary matchmaker call" · "Tue 9 Feb, 14:00" · [Change time]   (W14: no "London time")
 *
 * Both buttons open the call popup in place (W12; no navigation); Change time opens it changing her booking (the
 * database moves one booking, never adds a second). Lines arrive in London words from `parent-view.ts`.
 *
 * BB-wave1-041126/04b-build, 2026-11-04; BB-wave1-041126/04b-rework, 2026-11-05.
 */

import { Button } from "@/components/ui/button";
import { PARENT_COPY } from "@/lib/calls/copy";
import type { HubCallCard } from "@/lib/calls/parent-view";

const PRIMARY = "mt-4 w-full h-11 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-medium text-sm";
const SECONDARY = "mt-4 w-full h-11 rounded-lg border-violet-200 text-violet-700 hover:bg-violet-50 font-medium text-sm";

export interface CallHubCardProps {
  readonly card: HubCallCard | null;
  readonly onBook: () => void;
  readonly onChange: () => void;
}

function lineOf(card: HubCallCard): string {
  if (card.kind === "booked") return card.line;
  return card.afterNoAnswer ? PARENT_COPY.afterNoAnswer : PARENT_COPY.pageIntro;
}

export function CallHubCard({ card, onBook, onChange }: CallHubCardProps) {
  if (card === null) return null;
  return (
    <section aria-labelledby="call-card-heading" className="rounded-xl border border-violet-100 bg-violet-50/40 p-4 sm:p-5">
      <h3 id="call-card-heading" className="text-sm font-semibold text-slate-900">
        {PARENT_COPY.pageHeading}
      </h3>
      <p className="mt-1 text-xs text-slate-500">{lineOf(card)}</p>
      {card.kind === "not_booked" && (
        <Button type="button" className={PRIMARY} onClick={onBook}>
          {PARENT_COPY.bookATime}
        </Button>
      )}
      {card.kind === "booked" && card.changeable && (
        <Button type="button" variant="outline" className={SECONDARY} onClick={onChange}>
          {PARENT_COPY.changeTime}
        </Button>
      )}
    </section>
  );
}
