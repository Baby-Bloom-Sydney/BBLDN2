"use client";

/**
 * The next 8 cohorts (brief §0.2, §3.5): date, places (editable inline), taken and left, the families.
 * BB-wave1-041126/02-build.
 */

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { rowLine } from "@/lib/cohorts/copy";
import { formatCohortDate } from "@/lib/cohorts/dates";
import type { CohortEntry } from "@/lib/cohorts/types";
import { FamiliesButton, OverByBadge } from "./CohortCard";
import { PlacesEditor } from "./PlacesEditor";

export function UpcomingTable({ entries, onOpenFamilies }: { readonly entries: readonly CohortEntry[]; readonly onOpenFamilies: (start: string) => void }) {
  return (
    <section aria-labelledby="cohorts-upcoming" className="space-y-2">
      <h2 id="cohorts-upcoming" className="text-sm font-semibold text-slate-900">
        Next {entries.length} cohorts
      </h2>
      <Table aria-label="Upcoming cohorts">
        <TableHeader>
          <TableRow>
            <TableHead>Starts</TableHead>
            <TableHead>Places</TableHead>
            <TableHead>Taken · left</TableHead>
            <TableHead>
              <span className="sr-only">Families</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((e) => (
            <TableRow key={e.view.start}>
              <TableCell className="whitespace-nowrap font-medium text-slate-900">{formatCohortDate(e.view.start)}</TableCell>
              <TableCell>
                <PlacesEditor key={`${e.view.start}:${e.view.places}`} startDate={e.view.start} places={e.view.places} />
              </TableCell>
              <TableCell className="text-slate-700">
                <span className="mr-2 whitespace-nowrap">{rowLine(e.view)}</span>
                <OverByBadge overBy={e.view.overBy} />
              </TableCell>
              <TableCell className="text-right">
                <FamiliesButton entry={e} onOpen={onOpenFamilies} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
