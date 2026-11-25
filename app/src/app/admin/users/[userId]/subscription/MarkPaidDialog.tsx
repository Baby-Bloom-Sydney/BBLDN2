"use client";

/**
 * Mark deposit paid (bank transfer) (plan 03 row B3; brief 03 §0.7, §3 Admin 5; D10): the cohort target (goodwill
 * only when offered), a required note (e.g. "transfer ref JONES", 1–500 once trimmed), Confirm. B2's
 * `markDepositPaid` takes the place in one step; "This cohort is full" / "The deposit is already paid." stay in the
 * dialog with nothing recorded. Shown only while nothing is paid (the block's rule).
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */

import { useId, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { NOTE_MAX, NOTE_MIN } from "@/lib/deposit/constants";
import { PANEL_ACTION_COPY, PANEL_COPY } from "@/lib/deposit/copy";
import type { PanelCohorts } from "@/lib/deposit/panel";
import type { DepositTarget } from "@/lib/deposit/types";
import { markDepositPaid } from "./deposit-actions";
import { AlertLine, BUTTON, goodwillNext, QUIET_BUTTON, TargetChoice, useDialogWrite } from "./DepositParts";

export interface MarkPaidDialogProps {
  readonly parentUserId: string;
  readonly cohorts: PanelCohorts;
  /** The block is busy with another request. */
  readonly disabled: boolean;
}

function useMarkPaid({ parentUserId, cohorts }: MarkPaidDialogProps) {
  const [choice, setChoice] = useState<DepositTarget>("current");
  const [note, setNote] = useState("");
  const write = useDialogWrite(() => {
    setChoice("current");
    setNote("");
  });
  const trimmed = note.trim();
  const valid = trimmed.length >= NOTE_MIN && trimmed.length <= NOTE_MAX;
  const target: DepositTarget = goodwillNext(cohorts) === null ? "current" : choice;
  const confirm = () => write.submit(() => markDepositPaid(parentUserId, { target, note: trimmed }));
  return { ...write, choice, setChoice, note, setNote, valid, confirm };
}

export function MarkPaidDialog(props: MarkPaidDialogProps) {
  const id = useId();
  const m = useMarkPaid(props);
  return (
    <Dialog open={m.open} onOpenChange={m.setOpen}>
      <DialogTrigger asChild>
        <button type="button" disabled={props.disabled} className={BUTTON}>
          {PANEL_COPY.markPaidButton}
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-8">{PANEL_COPY.markPaidButton}</DialogTitle>
          <DialogDescription>{PANEL_ACTION_COPY.markPaidDescription}</DialogDescription>
        </DialogHeader>
        <TargetChoice cohorts={props.cohorts} value={m.choice} onChange={m.setChoice} disabled={m.pending} />
        <div className="space-y-1">
          <label htmlFor={`${id}-note`} className="text-xs text-slate-600">
            {PANEL_ACTION_COPY.noteLabel}
          </label>
          <textarea id={`${id}-note`} value={m.note} onChange={(e) => m.setNote(e.target.value)} required maxLength={NOTE_MAX} rows={3}
            aria-describedby={`${id}-hint`} disabled={m.pending}
            className="block w-full rounded-md border border-slate-200 px-2 py-1 text-base md:text-sm" />
          <p id={`${id}-hint`} className="text-xs text-slate-500">
            {PANEL_ACTION_COPY.noteHint}
          </p>
        </div>
        {m.message && <AlertLine text={m.message} />}
        <DialogFooter className="gap-2 sm:gap-0">
          <button type="button" onClick={() => m.setOpen(false)} disabled={m.pending} className={QUIET_BUTTON}>
            {PANEL_ACTION_COPY.back}
          </button>
          <button type="button" onClick={m.confirm} disabled={!m.valid || m.pending} className={BUTTON}>
            {PANEL_ACTION_COPY.confirm}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
