"use client";

/**
 * Her booked Complimentary matchmaker call (brief 04 §0.3, §0a.1, §3 parent 4; plan B6; 04b rework W5, W12).
 *
 * - `BookedWords`: the time and "We'll call you on <her mobile>" — the booked slide's lines (W14: no "London time").
 * - `YourCallPanel`: "Your call: Thursday 5 November at 10:00" in the picker's green panel, at the top
 *   while she changes it (and always in the in-app popup).
 * - `BookedLinks`: **Change time** and **Cancel** as text links while the start is still ahead (at or after it, none).
 *   Cancel asks once ("Yes, cancel it"); a refused cancel is an alert that takes focus, and the booking stays.
 *
 * Every line arrives preformatted from the server.
 *
 * BB-wave1-041126/04b-build, 2026-11-04; BB-wave1-041126/04b-rework, 2026-11-05.
 */

import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { callOnLine, PARENT_COPY } from "@/lib/calls/copy";
import type { BookedCallView } from "@/lib/calls/parent-view";

const TEXT_LINK =
  "text-sm font-medium text-slate-500 underline-offset-4 hover:text-slate-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 rounded-sm disabled:opacity-50";

/** The booked tick (mock C). */
export function BookedTick() {
  return (
    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-violet-50" aria-hidden="true">
      <Check className="h-7 w-7 text-violet-600" />
    </div>
  );
}

export function BookedWords({ booking, mobile }: { readonly booking: BookedCallView; readonly mobile: string | null }) {
  return (
    <div className="mt-3 space-y-1">
      <p className="text-base font-medium text-slate-800">{booking.when}</p>
      {mobile !== null && <p className="pt-2">{callOnLine(mobile)}</p>}
    </div>
  );
}

export function YourCallPanel({ booking }: { readonly booking: BookedCallView }) {
  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-3">
      <p className="text-sm font-medium text-green-800">{booking.yourCall}</p>
    </div>
  );
}

function CancelQuestion({ busy, onYes, onNo }: { readonly busy: boolean; readonly onYes: () => void; readonly onNo: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <p className="text-sm font-medium text-slate-800">{PARENT_COPY.cancelQuestion}</p>
      <Button type="button" variant="outline" onClick={onYes} disabled={busy} className="border-slate-300">
        {PARENT_COPY.confirmCancel}
      </Button>
      <Button type="button" variant="ghost" onClick={onNo} disabled={busy}>
        {PARENT_COPY.keepCall}
      </Button>
    </div>
  );
}

export interface BookedLinksProps {
  readonly booking: BookedCallView;
  readonly busy: boolean;
  /** A refused cancel's line, or null. */
  readonly message: string | null;
  readonly onChange: () => void;
  readonly onCancel: () => void;
}

export function BookedLinks({ booking, busy, message, onChange, onCancel }: BookedLinksProps) {
  const [asking, setAsking] = useState(false);
  const alertRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (message !== null) alertRef.current?.focus();
  }, [message]);

  return (
    <div className="space-y-3">
      {message !== null && (
        <p ref={alertRef} tabIndex={-1} role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 focus:outline-none">
          {message}
        </p>
      )}
      {booking.changeable && asking && (
        <CancelQuestion
          busy={busy}
          onYes={() => {
            setAsking(false);
            onCancel();
          }}
          onNo={() => setAsking(false)}
        />
      )}
      {booking.changeable && !asking && (
        <div className="flex justify-center gap-6">
          <button type="button" onClick={onChange} disabled={busy} className={TEXT_LINK}>
            {PARENT_COPY.changeTime}
          </button>
          <button type="button" onClick={() => setAsking(true)} disabled={busy} className={TEXT_LINK}>
            {PARENT_COPY.cancel}
          </button>
        </div>
      )}
    </div>
  );
}
