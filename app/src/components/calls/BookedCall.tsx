"use client";

/**
 * Her booked Complimentary matchmaker call (brief 04 §0.3, §3 parent 4; plan B6): the London time, then **Change
 * time** and **Cancel** while the start is still ahead (at or after it, the booking and no buttons). Cancel asks once
 * before it acts; a refused cancel is an alert that takes focus, and the booking stays. The line arrives
 * preformatted from the server.
 *
 * BB-wave1-041126/04b-build, 2026-11-04.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { PARENT_COPY } from "@/lib/calls/copy";
import type { BookedCallView } from "@/lib/calls/parent-view";

export interface BookedCallProps {
  readonly booking: BookedCallView;
  readonly busy: boolean;
  /** A refused cancel's line, or null. */
  readonly message: string | null;
  /** While she picks a new time the buttons step aside. */
  readonly changing: boolean;
  readonly onChange: () => void;
  readonly onCancel: () => void;
}

function CancelQuestion({ busy, onYes, onNo }: { readonly busy: boolean; readonly onYes: () => void; readonly onNo: () => void }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
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

export function BookedCall({ booking, busy, message, changing, onChange, onCancel }: BookedCallProps) {
  const [asking, setAsking] = useState(false);
  const alertRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (message !== null) alertRef.current?.focus();
  }, [message]);

  const showButtons = booking.changeable && !changing;
  return (
    <div className="rounded-xl border border-green-200 bg-green-50 p-5 text-green-900">
      <p className="text-base font-semibold">{booking.line}</p>
      {message !== null && (
        <p ref={alertRef} tabIndex={-1} role="alert" className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 focus:outline-none">
          {message}
        </p>
      )}
      {showButtons && asking && (
        <CancelQuestion
          busy={busy}
          onYes={() => {
            setAsking(false);
            onCancel();
          }}
          onNo={() => setAsking(false)}
        />
      )}
      {showButtons && !asking && (
        <div className="mt-4 flex flex-wrap gap-3">
          <Button type="button" onClick={onChange} disabled={busy} className="bg-violet-600 text-white hover:bg-violet-700">
            {PARENT_COPY.changeTime}
          </Button>
          <Button type="button" variant="outline" onClick={() => setAsking(true)} disabled={busy}>
            {PARENT_COPY.cancel}
          </Button>
        </div>
      )}
    </div>
  );
}
