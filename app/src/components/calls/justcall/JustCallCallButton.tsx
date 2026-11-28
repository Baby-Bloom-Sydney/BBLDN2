"use client";

/**
 * The Call control in brief 05's dialer (plan 05 §5 PR 05b C5; brief §0.2, §3.2). BB-wave2-231126/05-build.
 *
 * Drawn by the wrapper's `renderCallControl`, in each row (table and phone card) and in her drawer. It holds no state:
 * the dialer flow comes from `DialerFlowContext`.
 *   - The dialer signed in and no call live: **Call** — her mobile (E.164) goes into the dialer and her drawer opens.
 *     BAI presses the dialer's green button to place the call.
 *   - On a call: the same button stays (so focus stays on it), unavailable (`aria-disabled`), saying "On a call".
 *   - Loading, signed out or failed: why, then 04's phone link.
 *   - No dialer on this screen (a phone), no flow, or no mobile: 04's control exactly.
 */

import { useId } from "react";
import { Phone } from "lucide-react";
import { defaultCallControl, type CallControlTarget } from "@/app/admin/calls/CallRowParts";
import { Button } from "@/components/ui/button";
import { callControlLabel } from "@/lib/calls/copy";
import { callFallbackReason, DIALER_COPY } from "@/lib/justcall/words";
import { useDialerFlowContext } from "./use-dialer-flow";
import { callIsLive } from "./use-justcall-dialer";

export function JustCallCallButton({ target }: { readonly target: CallControlTarget }) {
  const flow = useDialerFlowContext();
  const reasonId = useId();
  const mobile = target.contact.mobile;
  if (flow === null || mobile === null || flow.dialer.state.status === "off") return <>{defaultCallControl(target)}</>;
  const live = callIsLive(flow.dialer.state.call);
  const reason = callFallbackReason(flow.dialer.state.status, live);
  if (reason !== null && !live) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500">{reason}</span>
        {defaultCallControl(target)}
      </span>
    );
  }
  const e164 = mobile.href.replace(/^tel:/, "");
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        aria-label={callControlLabel(target.contact.name, mobile.text)}
        aria-disabled={live || undefined}
        aria-describedby={live ? reasonId : undefined}
        onClick={() => !live && flow.call({ parentUserId: target.parentUserId, mobile: e164 })}
        className={`gap-1.5 ${live ? "cursor-not-allowed opacity-60" : ""}`}
      >
        <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {DIALER_COPY.call}
      </Button>
      {live && (
        <span id={reasonId} className="text-xs text-slate-500">
          {reason}
        </span>
      )}
    </span>
  );
}

/** The wrapper's `renderCallControl`: one stable function, the control reading the flow itself. */
export const renderJustCallControl = (target: CallControlTarget) => <JustCallCallButton target={target} />;
