"use client";

/**
 * "Start call booking" on the Calendar tab (plan §12 R11, §13; brief 14 presses it at switch-on;
 * BB-wave1-041126/04c2-build). Until it is pressed no parent is offered the call (the call slide steps aside, 04b W17
 * item 13) and no "pick a time" email is sent. It sets `enabled_since` once and can't be undone, so the button asks
 * first; "Not yet" changes nothing. Afterwards only the date it started shows — nothing to press again (a second press
 * from elsewhere keeps the first date, `repo.startCallBooking`).
 */

import { useId, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { ADMIN_COPY, startedOnLine } from "@/lib/calls/copy";
import { ACTION_BUTTON, AlertLine, QUIET_BUTTON } from "../cohorts/parts";
import { startCallBookingAction } from "./actions";
import { useCalendarSave } from "./use-calendar-save";

function Confirm({ open, onOpenChange, onStarted }: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly onStarted: (date: string) => void }) {
  const save = useCalendarSave(ADMIN_COPY.errorFailed);
  const yes = async () => {
    const started = await save.run(() => startCallBookingAction());
    if (started !== null) onStarted(started.startedOn);
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !save.saving && onOpenChange(next)}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-md">
        <DialogTitle>{ADMIN_COPY.startQuestion}</DialogTitle>
        <DialogDescription className="text-slate-600">{ADMIN_COPY.startBody}</DialogDescription>
        {save.error && <AlertLine>{save.error}</AlertLine>}
        <DialogFooter className="gap-2">
          <button type="button" className={QUIET_BUTTON} disabled={save.saving} onClick={() => onOpenChange(false)}>
            {ADMIN_COPY.startNotYet}
          </button>
          <button type="button" className={ACTION_BUTTON} disabled={save.saving} onClick={() => void yes()}>
            {save.saving ? ADMIN_COPY.starting : ADMIN_COPY.startConfirm}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StartCallBooking({ startedOn }: { readonly startedOn: string | null }) {
  const id = useId();
  const [asking, setAsking] = useState(false);
  const [started, setStarted] = useState<string | null>(startedOn);
  const date = startedOn ?? started;
  return (
    <section aria-labelledby={id}>
      <Card className={date === null ? "border-violet-200 bg-violet-50/40" : undefined}>
        <CardContent className="space-y-3 p-4 sm:p-5">
          <h2 id={id} className="text-base font-semibold text-slate-900">
            {ADMIN_COPY.startCallBooking}
          </h2>
          {date !== null ? (
            <p className="text-sm font-medium text-emerald-700">{startedOnLine(date)}</p>
          ) : (
            <>
              <p className="text-sm text-slate-600">{ADMIN_COPY.notStarted}</p>
              <button type="button" className={ACTION_BUTTON} onClick={() => setAsking(true)}>
                {ADMIN_COPY.startCallBooking}
              </button>
              <Confirm
                open={asking}
                onOpenChange={setAsking}
                onStarted={(on) => {
                  setStarted(on);
                  setAsking(false);
                }}
              />
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
