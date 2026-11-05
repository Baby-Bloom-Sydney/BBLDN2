"use client";

/**
 * The call inside the app: a popup, not a page (04b rework W12; BAI 2026-11-05: "the version from inside the app
 * should be a popup (without a close button, they would tap outside of the rounded rectangle pop up to close the pop
 * up) not a seperate page or slide").
 *
 * The app's popup style (`ConnectionDetailPopup`: a `rounded-2xl` dialog), `max-h-[90dvh]` and scrolling so it fits a
 * 390px phone, and no close (X) button (`hideClose`). A tap outside or Escape closes it; Radix keeps focus trapped
 * inside while it is open. Her view is loaded when it opens (a skeleton meanwhile), then the shared
 * `CallBookingPanel` draws it — the primary button alone, no onward button.
 *
 * BB-wave1-041126/04b-rework, 2026-11-05.
 */

import { useEffect, useState } from "react";
import { reloadMyCallSlots } from "@/app/(funnel)/matchmaking/call/actions";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { PARENT_COPY } from "@/lib/calls/copy";
import type { MyCallView } from "@/lib/calls/parent-view";
import { CallBookingPanel } from "./CallBookingPanel";

export interface CallPopupProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Open straight into changing her booking (the card's Change time). */
  readonly startChanging: boolean;
  /** Open with the taken notice for this time, in words (`call=gone`). */
  readonly notice: string | null;
  /** Open with this inline line (a booking that failed for any reason but taken). */
  readonly message: string | null;
}

/** Her view, read fresh each time the popup opens; a refusal or a throw → load failed (Retry inside). */
function useViewWhenOpen(open: boolean): MyCallView | null {
  const [view, setView] = useState<MyCallView | null>(null);
  useEffect(() => {
    if (!open) return; // kept while the dialog animates out; cleared when it opens again (react review MEDIUM)
    setView(null);
    let live = true;
    reloadMyCallSlots()
      .then((result) => live && setView(result.ok ? result.value : { kind: "load_failed" }))
      .catch(() => live && setView({ kind: "load_failed" }));
    return () => {
      live = false;
    };
  }, [open]);
  return view;
}

function Loading() {
  return (
    <div data-testid="call-popup-loading" className="space-y-3">
      <DialogTitle className="sr-only">{PARENT_COPY.pageHeading}</DialogTitle>
      <DialogDescription className="sr-only">{PARENT_COPY.pageIntro}</DialogDescription>
      <Skeleton className="mx-auto h-6 w-3/4 motion-reduce:animate-none" />
      <Skeleton className="h-64 w-full motion-reduce:animate-none" />
    </div>
  );
}

export function CallPopup({ open, onClose, startChanging, notice, message }: CallPopupProps) {
  const view = useViewWhenOpen(open);
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        hideClose
        className="max-w-md max-h-[90dvh] overflow-y-auto overflow-x-hidden rounded-2xl p-5 sm:p-6 motion-reduce:animate-none motion-reduce:transition-none"
      >
        {view === null ? <Loading /> : <CallBookingPanel initial={view} inPopup startChanging={startChanging} notice={notice} message={message} />}
      </DialogContent>
    </Dialog>
  );
}
