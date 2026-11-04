"use client";

/**
 * "This time has just been booked" (04b rework W4; BAI 2026-11-05: "if someone else takes it before them, it has a
 * seemless popup informing them that this time has already been selected, to avoid double booking"). A small
 * `rounded-2xl` dialog with one button, shown when a hold or a confirm comes back taken (or a held time ran out and
 * was taken). The list refreshes underneath at the same moment. Its button takes focus when it opens; on close the
 * picker puts focus back on the grid (`onClosed`). It nests inside the in-app booking popup: Radix layers dismiss the
 * top one only, so closing this never closes that. The database's exclusion constraint is what refuses the double
 * booking; this is only how she hears about it.
 *
 * BB-wave1-041126/04b-rework, 2026-11-05.
 */

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PARENT_COPY, takenNoticeLine } from "@/lib/calls/copy";

export interface TakenNoticeProps {
  /** The taken time in words ("Thursday 5 November at 10:00"), or null when closed. */
  readonly when: string | null;
  readonly onClose: () => void;
  /** After it has closed: where focus goes back to. */
  readonly onClosed: () => void;
}

export function TakenNotice({ when, onClose, onClosed }: TakenNoticeProps) {
  return (
    <Dialog open={when !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        hideClose
        className="max-w-sm rounded-2xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onClosed();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-slate-900">{PARENT_COPY.takenTitle}</DialogTitle>
          <DialogDescription className="text-sm text-slate-600">{takenNoticeLine(when ?? "")}</DialogDescription>
        </DialogHeader>
        <Button type="button" onClick={onClose} className="w-full h-11 bg-violet-500 hover:bg-violet-600 text-white rounded-lg font-medium text-sm">
          {PARENT_COPY.pickAnother}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
