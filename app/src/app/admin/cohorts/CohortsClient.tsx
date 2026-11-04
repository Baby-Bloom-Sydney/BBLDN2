"use client";

/**
 * /admin/cohorts client (brief §0, §3; plan 02 step 8). Everything is read once on the server (`loadCohortBoard`);
 * this composes it: the empty state, the warnings box, the current and next cards, the next 8, the past cohorts,
 * the schedule form, and one families dialog. BB-wave1-041126/02-build.
 */

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { EMPTY_STATE, firstAheadLine } from "@/lib/cohorts/copy";
import type { CohortBoard, CohortEntry } from "@/lib/cohorts/types";
import { CohortCard } from "./CohortCard";
import { FamiliesDialog } from "./FamiliesDialog";
import { NoteLine } from "./parts";
import { PastCohorts } from "./PastCohorts";
import { ScheduleForm } from "./ScheduleForm";
import { UpcomingTable } from "./UpcomingTable";
import { WarningsBox } from "./WarningsBox";

function Cards({ board, onOpen }: { readonly board: CohortBoard; readonly onOpen: (start: string) => void }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {board.current ? (
        <CohortCard kind="current" entry={board.current} calls={board.calls} onOpenFamilies={onOpen} />
      ) : (
        board.next && (
          <Card className="border-dashed bg-slate-50/50">
            <CardContent className="p-5">
              <NoteLine>{firstAheadLine(board.next.view.start)}</NoteLine>
            </CardContent>
          </Card>
        )
      )}
      {board.next && <CohortCard kind="next" entry={board.next} preBooked={board.preBooked} onOpenFamilies={onOpen} />}
    </div>
  );
}

export function CohortsClient({ board }: { readonly board: CohortBoard }) {
  const [openStart, setOpenStart] = useState<string | null>(null);
  const all: readonly CohortEntry[] = [...(board.current ? [board.current] : []), ...board.upcoming, ...board.past];
  const open = all.find((e) => e.view.start === openStart) ?? null;
  const isEmpty = board.schedule === null && board.current === null && board.upcoming.length === 0;
  return (
    <div className="mt-6 space-y-6">
      {isEmpty && <p className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">{EMPTY_STATE}</p>}
      <WarningsBox warnings={board.warnings} onOpenCohort={setOpenStart} />
      {!isEmpty && <Cards board={board} onOpen={setOpenStart} />}
      {board.upcoming.length > 0 && <UpcomingTable entries={board.upcoming} onOpenFamilies={setOpenStart} />}
      {board.past.length > 0 && <PastCohorts entries={board.past} onOpenFamilies={setOpenStart} />}
      <ScheduleForm schedule={board.schedule} suggestedFirst={board.suggestedFirst} />
      <FamiliesDialog entry={open} onClose={() => setOpenStart(null)} />
    </div>
  );
}
