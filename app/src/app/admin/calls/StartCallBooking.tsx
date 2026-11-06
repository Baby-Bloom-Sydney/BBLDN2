"use client";

/**
 * "Start call booking" on the Calendar tab (plan §12 R11, §13; brief 14 presses it at switch-on;
 * BB-wave1-041126/04c2-build). Until it is pressed no parent is offered the call (the call slide steps aside, 04b W17
 * item 13) and no "pick a time" email is sent. It sets `enabled_since` once and can't be undone, so the button asks
 * first; "Not yet" changes nothing. Afterwards only the date it started shows — nothing to press again (a second press
 * from elsewhere keeps the first date, `repo.startCallBooking`).
 *
 * Focus (review round 1, React H1): the dialog has no Radix trigger, so closing it puts focus back on the Start button
 * by hand; after a start, the button is gone and focus moves to the started line, a live status. The dialog opens
 * clean (no old error), and its buttons stay focusable while it starts (`aria-disabled`).
 */

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { ADMIN_COPY, startedOnLine } from "@/lib/calls/copy";
import { ACTION_BUTTON, AlertLine, QUIET_BUTTON } from "../cohorts/parts";
import { startCallBookingAction } from "./actions";
import { BUSY_LOOK, useCalendarSave } from "./use-calendar-save";

interface ConfirmProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onStarted: (date: string) => void;
  readonly returnFocusTo: RefObject<HTMLButtonElement>;
}

function Confirm({ open, onClose, onStarted, returnFocusTo }: ConfirmProps) {
  const save = useCalendarSave(ADMIN_COPY.errorFailed);
  const close = () => {
    if (save.saving) return;
    save.reset();
    onClose();
  };
  const yes = async () => {
    const started = await save.run(() => startCallBookingAction());
    if (started !== null) onStarted(started.startedOn);
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        className="w-[calc(100%-2rem)] max-w-md"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusTo.current?.focus();
        }}
      >
        <DialogTitle>{ADMIN_COPY.startQuestion}</DialogTitle>
        <DialogDescription className="text-slate-600">{ADMIN_COPY.startBody}</DialogDescription>
        {save.error && <AlertLine>{save.error}</AlertLine>}
        <DialogFooter className="gap-2">
          <button type="button" className={`${QUIET_BUTTON} ${BUSY_LOOK}`} aria-disabled={save.saving} onClick={close}>
            {ADMIN_COPY.startNotYet}
          </button>
          <button type="button" className={`${ACTION_BUTTON} ${BUSY_LOOK}`} aria-disabled={save.saving} onClick={() => void yes()}>
            {save.saving ? ADMIN_COPY.starting : ADMIN_COPY.startConfirm}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StartCallBooking({ startedOn }: { readonly startedOn: string | null }) {
  const id = useId();
  const startRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const [asking, setAsking] = useState(false);
  const [started, setStarted] = useState<string | null>(startedOn);
  const [justStarted, setJustStarted] = useState(false);
  const date = startedOn ?? started;
  useEffect(() => {
    if (justStarted) statusRef.current?.focus();
  }, [justStarted]);
  return (
    <section aria-labelledby={id}>
      <Card className={date === null ? "border-violet-200 bg-violet-50/40" : undefined}>
        <CardContent className="space-y-3 p-4 sm:p-5">
          <h2 id={id} className="text-base font-semibold text-slate-900">
            {ADMIN_COPY.startCallBooking}
          </h2>
          <p ref={statusRef} tabIndex={-1} role="status" className={date === null ? "sr-only" : "text-sm font-medium text-emerald-700 focus:outline-none"}>
            {date === null ? "" : startedOnLine(date)}
          </p>
          {date === null && (
            <>
              <p className="text-sm text-slate-600">{ADMIN_COPY.notStarted}</p>
              <button ref={startRef} type="button" className={ACTION_BUTTON} onClick={() => setAsking(true)}>
                {ADMIN_COPY.startCallBooking}
              </button>
              <Confirm
                open={asking}
                onClose={() => setAsking(false)}
                returnFocusTo={startRef}
                onStarted={(on) => {
                  setStarted(on);
                  setAsking(false);
                  setJustStarted(true);
                }}
              />
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
