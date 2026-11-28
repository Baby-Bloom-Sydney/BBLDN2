"use client";

/**
 * Call next, at the top of /admin/calls (plan 05 §5 PR 05b C6; brief §0.3, §3.5). BB-wave2-231126/05-build.
 *
 * One press asks the dialer flow for the next family in 04's order (R11) — her drawer opens and, when the dialer can,
 * her mobile goes into it. Busy while it asks; not while a call is live — unavailable then (`aria-disabled`, so focus
 * stays on it), saying why. Its last word ("No one left to call right now.") shows beside it; what it opened is
 * announced.
 */

import { useId } from "react";
import { PhoneForwarded } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DIALER_COPY } from "@/lib/justcall/words";
import { useDialerFlowContext } from "./use-dialer-flow";

export function CallNextButton() {
  const flow = useDialerFlowContext();
  const whyId = useId();
  if (flow === null) return null;
  const unavailable = flow.nextBusy || flow.live;
  const said = flow.nextBusy ? DIALER_COPY.finding : flow.nextLine || flow.announce;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <Button
        type="button"
        onClick={() => !unavailable && void flow.callNext()}
        aria-disabled={unavailable || undefined}
        aria-busy={flow.nextBusy}
        aria-describedby={flow.live ? whyId : undefined}
        className={`gap-1.5 ${unavailable ? "cursor-not-allowed opacity-60" : ""}`}
      >
        <PhoneForwarded className="h-4 w-4 shrink-0" aria-hidden="true" />
        {DIALER_COPY.callNext}
      </Button>
      {flow.live && (
        <span id={whyId} className="text-xs text-slate-500">
          {DIALER_COPY.onACall}
        </span>
      )}
      <p role="status" className={flow.nextLine ? "text-sm text-slate-600" : "sr-only"}>
        {said}
      </p>
    </div>
  );
}
