/**
 * The call card on her Childcare tab, at the top of "My childcare" (brief 04 §0a.4; plan B7 → 04b rework W9). The
 * page shows it only while no nanny is hired or connected. In the app's card style (mock D):
 *
 *   not booked        "Your Complimentary matchmaker call" · 04b's intro · [Book a time]
 *   after no-answer   "Your Complimentary matchmaker call" · "We tried to call you — pick another time" · [Book a time]
 *   booked            "Your Complimentary matchmaker call" · "Tue 9 Feb, 14:00 (London time)" · [Change time]
 *
 * Change time moves her booking (the database moves one booking, never adds a second). Lines arrive in London words
 * from `parent-view.ts`. Nothing renders without a card.
 *
 * BB-wave1-041126/04b-build, 2026-11-04; BB-wave1-041126/04b-rework, 2026-11-05.
 */

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PARENT_COPY } from "@/lib/calls/copy";
import { callPagePath, CHILDCARE_TAB } from "@/lib/calls/next-path";
import type { HubCallCard } from "@/lib/calls/parent-view";

const PRIMARY = "w-full h-11 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-medium text-sm";
const SECONDARY = "w-full h-11 rounded-lg border-violet-200 text-violet-700 hover:bg-violet-50 font-medium text-sm";

function lineOf(card: HubCallCard): string {
  if (card.kind === "booked") return card.line;
  return card.afterNoAnswer ? PARENT_COPY.afterNoAnswer : PARENT_COPY.pageIntro;
}

export function CallHubCard({ card }: { readonly card: HubCallCard | null }) {
  if (card === null) return null;
  return (
    <section aria-labelledby="call-card-heading" className="rounded-xl border border-violet-100 bg-violet-50/40 p-4 sm:p-5">
      <h3 id="call-card-heading" className="text-sm font-semibold text-slate-900">
        {PARENT_COPY.pageHeading}
      </h3>
      <p className="mt-1 text-xs text-slate-500">{lineOf(card)}</p>
      {card.kind === "not_booked" && (
        <Button asChild className={`mt-4 ${PRIMARY}`}>
          <Link href={callPagePath(CHILDCARE_TAB)}>{PARENT_COPY.bookATime}</Link>
        </Button>
      )}
      {card.kind === "booked" && card.changeable && (
        <Button asChild variant="outline" className={`mt-4 ${SECONDARY}`}>
          <Link href={callPagePath(CHILDCARE_TAB, { change: true })}>{PARENT_COPY.changeTime}</Link>
        </Button>
      )}
    </section>
  );
}
