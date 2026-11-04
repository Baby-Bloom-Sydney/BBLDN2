"use client";

/**
 * `/parent/call`, the client (brief 04 §3 parent 2–4; plan B6). Seven states: loading (a skeleton), times shown,
 * held, booked, after a no-answer, no times, load failed — and "Go to my matches", always, to the checked `next`.
 * Every line arrives preformatted from the server; nothing here formats a time. Actions: `./actions.ts`.
 *
 * BB-wave1-041126/04b-build, 2026-11-04.
 */

import Link from "next/link";
import { useState } from "react";
import { BookedCall } from "@/components/calls/BookedCall";
import { SlotPicker, type SlotPickerActions } from "@/components/calls/SlotPicker";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { doneLine, PARENT_COPY } from "@/lib/calls/copy";
import type { ConfirmedCallView, MyCallView } from "@/lib/calls/parent-view";
import { cancelMyCall, confirmMyCallHold, holdMyCallSlot, reloadMyCallSlots } from "./actions";

export interface CallPageClientProps {
  readonly initial: MyCallView;
  readonly nextHref: string;
}

function useCallPage(initial: MyCallView) {
  const [view, setView] = useState<MyCallView>(initial);
  const [changing, setChanging] = useState(false);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [cancelMessage, setCancelMessage] = useState<string | null>(null);

  const refresh = async () => {
    const next = await reloadMyCallSlots();
    if (next.ok) setView(next.value);
  };
  const actions: SlotPickerActions<ConfirmedCallView> = {
    hold: (startsAt) => holdMyCallSlot(startsAt),
    // The hold id is the idempotency key: a double press of Confirm replays the first answer.
    confirm: (hold) => confirmMyCallHold(hold.holdId, hold.holdId),
    reload: refresh,
  };
  const onConfirmed = (confirmed: ConfirmedCallView) => {
    setView({ kind: "booked", booking: confirmed.booking, days: null });
    setChanging(false);
    setStatus(doneLine(confirmed.booking.line));
  };
  const startChange = async () => {
    setChanging(true);
    setPending(true);
    await refresh();
    setPending(false);
  };
  const cancel = async (bookingId: string) => {
    setPending(true);
    const result = await cancelMyCall(bookingId);
    setPending(false);
    if (!result.ok) return setCancelMessage(result.error === "rate_limited" ? PARENT_COPY.rateLimited : PARENT_COPY.notSet);
    setCancelMessage(null);
    setChanging(false);
    setView(result.value);
    setStatus(PARENT_COPY.cancelledStatus);
  };
  return { view, changing, pending, status, cancelMessage, actions, onConfirmed, startChange, cancel, keepTime: () => setChanging(false) };
}

export function CallPageClient({ initial, nextHref }: CallPageClientProps) {
  const page = useCallPage(initial);
  const { view } = page;
  const days = view.kind === "load_failed" ? null : view.days;
  const picking = view.kind !== "booked" || page.changing;

  return (
    <div className="space-y-6">
      <p role="status" className="sr-only">
        {page.status}
      </p>
      {view.kind === "booked" && (
        <BookedCall
          booking={view.booking}
          busy={page.pending}
          message={page.cancelMessage}
          changing={page.changing}
          onChange={page.startChange}
          onCancel={() => page.cancel(view.booking.bookingId)}
        />
      )}
      {view.kind === "pick" && view.afterNoAnswer && (
        <p className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm font-medium text-violet-900">{PARENT_COPY.afterNoAnswer}</p>
      )}
      {picking && page.pending && <Skeleton data-testid="call-page-loading" className="h-40 w-full motion-reduce:animate-none" />}
      {picking && !page.pending && (
        <SlotPicker days={days} actions={page.actions} onConfirmed={page.onConfirmed} onKeepTime={view.kind === "booked" ? page.keepTime : undefined} />
      )}
      <Button asChild variant="outline">
        <Link href={nextHref}>{PARENT_COPY.goToMatches}</Link>
      </Button>
    </div>
  );
}
