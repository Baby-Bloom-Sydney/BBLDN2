"use client";

/**
 * Past cohorts, folded away and read-only (brief §3.6; plan 02 R12): date, places, taken, re-opened.
 * BB-wave1-041126/02-build.
 */

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCohortDate } from "@/lib/cohorts/dates";
import type { CohortEntry } from "@/lib/cohorts/types";
import { FamiliesButton } from "./CohortCard";

export function PastCohorts({ entries, onOpenFamilies }: { readonly entries: readonly CohortEntry[]; readonly onOpenFamilies: (start: string) => void }) {
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="past">
        <AccordionTrigger className="text-sm font-semibold text-slate-900">Past cohorts ({entries.length})</AccordionTrigger>
        <AccordionContent>
          <Table aria-label="Past cohorts">
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Places</TableHead>
                <TableHead>Taken</TableHead>
                <TableHead>Re-opened</TableHead>
                <TableHead>
                  <span className="sr-only">Families</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.view.start}>
                  <TableCell className="whitespace-nowrap">{formatCohortDate(e.view.start)}</TableCell>
                  <TableCell>{e.view.places}</TableCell>
                  <TableCell>{e.view.taken}</TableCell>
                  <TableCell>{`${e.reopened} re-opened`}</TableCell>
                  <TableCell className="text-right">
                    <FamiliesButton entry={e} onOpen={onOpenFamilies} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
