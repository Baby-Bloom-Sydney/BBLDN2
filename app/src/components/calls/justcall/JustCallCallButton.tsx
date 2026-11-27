"use client";

/**
 * The Call control in brief 05's dialer (plan 05 §5 PR 05b C5; brief §0.2, §3.2). BB-wave2-231126/05-build.
 *
 * Drawn by the wrapper's `renderCallControl`, in each row (table and phone card) and in her drawer. It holds no state:
 * the dialer flow comes from `DialerFlowContext`.
 *   - The dialer signed in and no call live: **Call** — her mobile (E.164) goes into the dialer and her drawer opens.
 *     BAI presses the dialer's green button to place the call.
 *   - Loading, signed out, failed, or on a call: why, then 04's phone link.
 *   - No dialer on this screen (a phone), no flow, or no mobile: 04's control exactly.
 */

import { Phone } from "lucide-react";
import { defaultCallControl, type CallControlTarget } from "@/app/admin/calls/CallRowParts";
import { Button } from "@/components/ui/button";
import { callControlLabel } from "@/lib/calls/copy";
import { callFallbackReason, DIALER_COPY } from "@/lib/justcall/words";
import { useDialerFlowContext } from "./use-dialer-flow";
import { callIsLive } from "./use-justcall-dialer";

export function JustCallCallButton({ target }: { readonly target: CallControlTarget }) {
  const flow = useDialerFlowContext();
  const mobile = target.contact.mobile;
  if (flow === null || mobile === null || flow.dialer.state.status === "off") return <>{defaultCallControl(target)}</>;
  const reason = callFallbackReason(flow.dialer.state.status, callIsLive(flow.dialer.state.call));
  if (reason !== null) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500">{reason}</span>
        {defaultCallControl(target)}
      </span>
    );
  }
  const e164 = mobile.href.replace(/^tel:/, "");
  return (
    <Button
      type="button"
      size="sm"
      aria-label={callControlLabel(target.contact.name, mobile.text)}
      onClick={() => flow.call({ parentUserId: target.parentUserId, mobile: e164 })}
      className="gap-1.5"
    >
      <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {DIALER_COPY.call}
    </Button>
  );
}

/** The wrapper's `renderCallControl`: one stable function, the control reading the flow itself. */
export const renderJustCallControl = (target: CallControlTarget) => <JustCallCallButton target={target} />;
