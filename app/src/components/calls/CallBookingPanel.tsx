"use client";

/**
 * Her call booking, as one panel (04b rework W5; brief §0a.1, §3 parent 2–4). The funnel slide (`/matchmaking/call`)
 * draws it in the funnel's shell; the in-app popup (W12) reuses its parts. States, all in the shell:
 *
 * - **picking** (not booked; after a no-answer with "We tried to call you — pick another time"; no times; load
 *   failed): the heading and 04b's intro, then the picker with "Skip for now" onward;
 * - **changing** (Change time, or `?change=1`): her booking stays on top ("Your call: …", the green panel) and the
 *   picker shows underneath with her slot chosen, "Keep my time" on the left; confirming moves the same booking;
 * - **booked**: the tick, "You're booked", the time "(London time)", "We'll call you on <her mobile>", one primary
 *   button onward (labelled by `next`), and Change time / Cancel as text links (none at or after the start).
 *
 * BB-wave1-041126/04b-rework, 2026-11-05.
 */

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PARENT_COPY } from "@/lib/calls/copy";
import type { Onward } from "@/lib/calls/next-path";
import type { MyCallView } from "@/lib/calls/parent-view";
import { BookedLinks, BookedTick, BookedWords, YourCallPanel } from "./BookedCall";
import { FUNNEL_PRIMARY, FunnelSlide } from "./FunnelSlide";
import { SlotPicker } from "./SlotPicker";
import { useCallBooking, type CallBooking } from "./use-call-booking";

export interface CallBookingPanelProps {
  readonly initial: MyCallView;
  readonly onward: Onward;
  /** `?change=1`: open straight into picking a new time for her booking. */
  readonly startChanging?: boolean;
}

function Status({ text }: { readonly text: string }) {
  return (
    <p role="status" className="sr-only">
      {text}
    </p>
  );
}

function BookedSlide({ call, onward }: { readonly call: CallBooking; readonly onward: Onward }) {
  const { view } = call;
  if (view.kind !== "booked") return null;
  return (
    <FunnelSlide mark={<BookedTick />} heading={PARENT_COPY.youreBooked} subtitle={<BookedWords booking={view.booking} mobile={view.mobile} />}>
      <Status text={call.status} />
      <div className="space-y-4">
        <Button asChild className={FUNNEL_PRIMARY}>
          <Link href={onward.href}>{onward.label}</Link>
        </Button>
        <BookedLinks
          booking={view.booking}
          busy={call.pending}
          message={call.cancelMessage}
          onChange={call.startChange}
          onCancel={() => call.cancel(view.booking.bookingId)}
        />
      </div>
    </FunnelSlide>
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

function PickSlide({ call, onward }: { readonly call: CallBooking; readonly onward: Onward }) {
  const { view } = call;
  const booked = view.kind === "booked" ? view.booking : null;
  return (
    <FunnelSlide heading={PARENT_COPY.pageHeading} subtitle={<PickSubtitle afterNoAnswer={view.kind === "pick" && view.afterNoAnswer} />}>
      <Status text={call.status} />
      <div className="space-y-4">
        {booked && <YourCallPanel booking={booked} />}
        {call.pending ? (
          <Skeleton data-testid="call-page-loading" className="h-40 w-full motion-reduce:animate-none" />
        ) : (
          <SlotPicker
            days={view.kind === "load_failed" ? null : view.days}
            actions={call.actions}
            onConfirmed={call.onConfirmed}
            onKeepTime={booked ? call.keepTime : undefined}
            skipHref={booked ? undefined : onward.href}
            current={booked?.startsAt ?? null}
          />
        )}
      </div>
    </FunnelSlide>
  );
}

export function CallBookingPanel({ initial, onward, startChanging = false }: CallBookingPanelProps) {
  const call = useCallBooking(initial, startChanging);
  const showBooked = call.view.kind === "booked" && !call.changing;
  return showBooked ? <BookedSlide call={call} onward={onward} /> : <PickSlide call={call} onward={onward} />;
}
