"use client";

/**
 * The families in one cohort (brief §0.5, §0.8, §3.7): name (to the family's subscription page), how they paid, the
 * goodwill tag, the date, the state, and Re-open place on a taken place (reason, then confirm).
 * BB-wave1-041126/02-build.
 */

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { familyStateLine, paidByLabel, rowLine } from "@/lib/cohorts/copy";
import { formatCohortDate } from "@/lib/cohorts/dates";
import type { CohortEntry, FamilyRow } from "@/lib/cohorts/types";
import { formatAuDate } from "@/lib/format/date";
import { NoteLine, QUIET_BUTTON } from "./parts";
import { ReopenConfirm } from "./ReopenConfirm";

function FamiliesTable({ families, onReopen }: { readonly families: readonly FamilyRow[]; readonly onReopen: (f: FamilyRow) => void }) {
  if (families.length === 0) return <NoteLine>No families in this cohort yet.</NoteLine>;
  return (
    <Table aria-label="Families">
      <TableHeader>
        <TableRow>
          <TableHead>Family</TableHead>
          <TableHead>Paid by</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>State</TableHead>
          <TableHead>
            <span className="sr-only">Action</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {families.map((f) => (
          <TableRow key={f.placeId}>
            <TableCell>
              <Link href={`/admin/users/${f.parentUserId}/subscription`} className="font-medium text-violet-700 hover:underline">
                {f.name}
              </Link>
              {f.isGoodwill && (
                <Badge variant="outline" className="ml-2 border-violet-200 bg-violet-50 text-violet-700">
                  Goodwill
                </Badge>
              )}
            </TableCell>
            <TableCell>{paidByLabel(f.paidBy)}</TableCell>
            <TableCell className="whitespace-nowrap">{f.takenAt ? formatAuDate(f.takenAt) : "—"}</TableCell>
            <TableCell>{familyStateLine(f)}</TableCell>
            <TableCell className="text-right">
              {f.state === "taken" && (
                <button type="button" className={QUIET_BUTTON} aria-label={`Re-open place: ${f.name}`} onClick={() => onReopen(f)}>
                  Re-open place
                </button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function FamiliesDialog({ entry, onClose }: { readonly entry: CohortEntry | null; readonly onClose: () => void }) {
  const [confirming, setConfirming] = useState<FamilyRow | null>(null);
  const close = (open: boolean) => {
    if (open) return;
    setConfirming(null);
    onClose();
  };
  return (
    <Dialog open={entry !== null} onOpenChange={close}>
      <DialogContent className="max-w-3xl">
        {entry && (
          <>
            <DialogHeader>
              <DialogTitle>Families · {formatCohortDate(entry.view.start)}</DialogTitle>
              <DialogDescription>{rowLine(entry.view)}</DialogDescription>
            </DialogHeader>
            {confirming ? (
              <ReopenConfirm
                placeId={confirming.placeId}
                familyName={confirming.name}
                onDone={() => setConfirming(null)}
                onBack={() => setConfirming(null)}
              />
            ) : (
              <FamiliesTable families={entry.families} onReopen={setConfirming} />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
