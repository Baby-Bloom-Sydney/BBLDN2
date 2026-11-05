"use client";

/**
 * Her call booking, as one panel (04b rework W5, W12; brief §0a.1, §3 parent 2–4), drawn in two frames:
 *
 * - the **funnel slide** (`/matchmaking/call`: the matchmaking and quick-match sign-ups, the email links) — the
 *   funnel's shell, "Skip for now" / "Keep my time" on the left, one button onward when booked;
 * - the **in-app popup** (`inPopup`, W12: BAI 2026-11-05 "the version from inside the app should be a popup") — the
 *   same content inside the dialog, the primary button alone (no Skip, no Keep my time: those would be close buttons;
 *   she taps outside), no onward button.
 *
 * States:
 * - **picking** (not booked; after a no-answer with "We tried to call you — pick another time"; no times; load
 *   failed): the heading and 04b's intro, then the picker;
 * - **changing** (Change time, `?change=1`, or the card's Change time): her booking stays on top ("Your call: …", the
 *   green panel) and the picker shows underneath with her slot chosen; confirming moves the same booking;
 * - **no position yet** (W11): picking a time holds nothing; "Complete my childcare position" takes the time to
 *   `/parent/request?callAt=`;
 * - **booked**: the tick, "You're booked", "We'll call you on <her mobile>"; on the slide the time and
 *   one button onward, in the popup "Your call: …" (BAI 2026-11-05: "this pop up would also display their current
 *   booking for ammendments"); Change time / Cancel as text links (none at or after the start).
 *
 * BB-wave1-041126/04b-rework, 2026-11-05.
 */

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { callOnLine, PARENT_COPY } from "@/lib/calls/copy";
import { positionWithCallPath, type Onward } from "@/lib/calls/next-path";
import type { MyCallView } from "@/lib/calls/parent-view";
import { BookedLinks, BookedTick, BookedWords, YourCallPanel } from "./BookedCall";
import { FUNNEL_PRIMARY, FunnelSlide } from "./FunnelSlide";
import { SlotPicker } from "./SlotPicker";
import { useCallBooking, type CallBooking } from "./use-call-booking";

/** No position yet (W11): a picked time goes with her to her position form, and is booked once it is saved. */
const NO_POSITION_GATE = { href: positionWithCallPath };

export interface CallBookingPanelProps {
  readonly initial: MyCallView;
  /** Open straight into picking a new time for her booking (`?change=1`, or the card's Change time). */
  readonly startChanging?: boolean;
  /** The funnel slide's way on (Skip for now; the button when booked). */
  readonly onward?: Onward;
  /** Drawn inside the in-app popup (W12) instead of the funnel slide. */
  readonly inPopup?: boolean;
  /** Open with the taken notice for this time, in words (the popup's `call=gone`). */
  readonly notice?: string | null;
  /** Open with this inline line (the popup's `call=open&failed=1`). */
  readonly message?: string | null;
}

interface FrameProps {
  readonly inPopup: boolean;
  readonly mark?: ReactNode;
  readonly heading: string;
  readonly subtitle?: ReactNode;
  readonly children: ReactNode;
}

/** The dialog's own heading and description (its accessible name), centred as the slide's. */
function PopupFrame({ mark, heading, subtitle, children }: Omit<FrameProps, "inPopup">) {
  return (
    <div className="space-y-5">
      <DialogHeader className="items-center text-center">
        {mark}
        <DialogTitle data-call-heading tabIndex={-1} className="text-xl font-semibold leading-snug text-slate-800 focus:outline-none">
          {heading}
        </DialogTitle>
        {subtitle ? (
          <DialogDescription asChild>
            <div className="text-sm text-slate-500">{subtitle}</div>
          </DialogDescription>
        ) : (
          <DialogDescription className="sr-only">{heading}</DialogDescription>
        )}
      </DialogHeader>
      {children}
    </div>
  );
}

function Frame({ inPopup, ...rest }: FrameProps) {
  return inPopup ? <PopupFrame {...rest} /> : <FunnelSlide {...rest} />;
}

function Status({ text }: { readonly text: string }) {
  return (
    <p role="status" className="sr-only">
      {text}
    </p>
  );
}

interface StateProps {
  readonly call: CallBooking;
  readonly inPopup: boolean;
  readonly onward?: Onward;
  readonly notice?: string | null;
  readonly message?: string | null;
}

function Booked({ call, inPopup, onward }: StateProps) {
  const { view } = call;
  if (view.kind !== "booked") return null;
  const subtitle = inPopup ? view.mobile && callOnLine(view.mobile) : <BookedWords booking={view.booking} mobile={view.mobile} />;
  return (
    <Frame inPopup={inPopup} mark={<BookedTick />} heading={PARENT_COPY.youreBooked} subtitle={subtitle || undefined}>
      <div className="space-y-4">
        {inPopup && <YourCallPanel booking={view.booking} />}
        {!inPopup && onward && (
          <Button asChild className={FUNNEL_PRIMARY}>
            <Link href={onward.href}>{onward.label}</Link>
          </Button>
        )}
        <BookedLinks booking={view.booking} busy={call.pending} message={call.cancelMessage} onChange={call.startChange} onCancel={() => call.cancel(view.booking.bookingId)} />
      </div>
    </Frame>
  );
}

function PickSubtitle({ afterNoAnswer }: { readonly afterNoAnswer: boolean }) {
  return (
    <>
      <p>{PARENT_COPY.pageIntro}</p>
      {afterNoAnswer && <p className="mt-3 font-medium text-violet-700">{PARENT_COPY.afterNoAnswer}</p>}
    </>
  );
}

function Picking({ call, inPopup, onward, notice, message }: StateProps) {
  const { view } = call;
  const booked = view.kind === "booked" ? view.booking : null;
  return (
    <Frame inPopup={inPopup} heading={PARENT_COPY.pageHeading} subtitle={<PickSubtitle afterNoAnswer={view.kind === "pick" && view.afterNoAnswer} />}>
      <div className="space-y-4">
        {booked && <YourCallPanel booking={booked} />}
        {call.pending ? (
          <Skeleton data-testid="call-page-loading" className="h-40 w-full motion-reduce:animate-none" />
        ) : (
          <SlotPicker
            days={view.kind === "load_failed" ? null : view.days}
            actions={call.actions}
            onConfirmed={call.onConfirmed}
            onKeepTime={booked && !inPopup ? call.keepTime : undefined}
            skipHref={booked || inPopup ? undefined : onward?.href}
            current={booked?.startsAt ?? null}
            gate={view.kind !== "load_failed" && view.needsPosition ? NO_POSITION_GATE : undefined}
            initialNotice={notice ?? null}
            initialMessage={message ?? null}
          />
        )}
      </div>
    </Frame>
  );
}

/** Once she has just booked, focus her new heading ("You're booked"); Confirm has gone (react review MEDIUM). */
function useFocusOnBooked(showBooked: boolean) {
  const root = useRef<HTMLDivElement>(null);
  const was = useRef(showBooked);
  useEffect(() => {
    if (showBooked && !was.current) root.current?.querySelector<HTMLElement>("[data-call-heading]")?.focus();
    was.current = showBooked;
  }, [showBooked]);
  return root;
}

/** Shown once: the first picker gets it, a later one (after booking, Change time) doesn't (React re-review). */
function useOnce(value: string | null): string | null {
  const [pending, setPending] = useState(value);
  useEffect(() => setPending(null), []);
  return pending;
}

export function CallBookingPanel({ initial, startChanging = false, onward, inPopup = false, notice = null, message = null }: CallBookingPanelProps) {
  const call = useCallBooking(initial, startChanging);
  const pendingNotice = useOnce(notice);
  const pendingMessage = useOnce(message);
  const showBooked = call.view.kind === "booked" && !call.changing;
  const root = useFocusOnBooked(showBooked);
  const props = { call, inPopup, onward, notice: pendingNotice, message: pendingMessage };
  // One status region for the panel's life, so booking and cancelling are announced into it (code review MEDIUM).
  return (
    <div ref={root}>
      <Status text={call.status} />
      {showBooked ? <Booked {...props} /> : <Picking {...props} />}
    </div>
  );
}
