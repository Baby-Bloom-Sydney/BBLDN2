"use client";

/**
 * Call next, at the top of /admin/calls (plan 05 §5 PR 05b C6; brief §0.3, §3.5). BB-wave2-231126/05-build.
 *
 * One press asks the dialer flow for the next family in 04's order (R11) — her drawer opens and, when the dialer can,
 * her mobile goes into it. Busy while it asks; not while a call is live. Its last word ("No one left to call right
 * now.") is announced beside it.
 */

import { PhoneForwarded } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DIALER_COPY } from "@/lib/justcall/words";
import { useDialerFlowContext } from "./use-dialer-flow";

export function CallNextButton() {
  const flow = useDialerFlowContext();
  if (flow === null) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <Button type="button" onClick={() => void flow.callNext()} disabled={flow.nextBusy || flow.live} aria-busy={flow.nextBusy} className="gap-1.5">
        <PhoneForwarded className="h-4 w-4 shrink-0" aria-hidden="true" />
        {DIALER_COPY.callNext}
      </Button>
      <p role="status" className={flow.nextLine ? "text-sm text-slate-600" : "sr-only"}>
        {flow.nextBusy ? DIALER_COPY.finding : flow.nextLine}
      </p>
    </div>
  );
}
