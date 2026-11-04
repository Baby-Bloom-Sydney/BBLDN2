"use client";

/**
 * Her call booking's state, shared by the funnel slide and the in-app popup (04b rework W5, W12; was
 * `/parent/call`'s `useCallPage`, plan B6). Her view (booked / picking / failed), changing, a pending reload, the
 * screen-reader status, a refused cancel's line — and the server actions (`/matchmaking/call/actions.ts`), each
 * settled so a throw is a refusal, never an unhandled rejection (review F1).
 *
 * BB-wave1-041126/04b-build, 2026-11-04; BB-wave1-041126/04b-rework, 2026-11-05.
 */

import { useState } from "react";
import { cancelMyCall, confirmMyCallHold, holdMyCallSlot, reloadMyCallSlots } from "@/app/(funnel)/matchmaking/call/actions";
import { doneLine, PARENT_COPY } from "@/lib/calls/copy";
import type { ConfirmedCallView, MyCallResult, MyCallView } from "@/lib/calls/parent-view";
import type { SlotPickerActions } from "./use-slot-picker";

/** A throw or a rejection is a refusal (review F1): never an unhandled rejection, never stuck pending. */
async function attempt<T>(run: () => Promise<MyCallResult<T>>): Promise<MyCallResult<T>> {
  try {
    return await run();
  } catch {
    return { ok: false, error: "error" };
  }
}

/** Her view when the times couldn't be read (review F2): picking → load failed; booked → kept, no days. */
function withoutDays(view: MyCallView): MyCallView {
  if (view.kind === "pick") return { kind: "load_failed" };
  if (view.kind === "booked") return { ...view, days: null };
  return view;
}

/** Booked now: her new booking, her number kept from what was on screen. */
function bookedNow(current: MyCallView, confirmed: ConfirmedCallView): MyCallView {
  return { kind: "booked", booking: confirmed.booking, days: null, mobile: current.kind === "load_failed" ? null : current.mobile };
}

export function useCallBooking(initial: MyCallView, startChanging = false) {
  const [view, setView] = useState<MyCallView>(initial);
  const [changing, setChanging] = useState(startChanging && initial.kind === "booked");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [cancelMessage, setCancelMessage] = useState<string | null>(null);

  /** Her view again; hands the picker the fresh days too, so a run-out hold can be told from a taken one (W4). */
  const refresh = async () => {
    const next = await attempt(() => reloadMyCallSlots());
    setView((current) => (next.ok ? next.value : withoutDays(current)));
    return next.ok && next.value.kind !== "load_failed" ? next.value.days : null;
  };
  const actions: SlotPickerActions<ConfirmedCallView> = {
    hold: (startsAt) => holdMyCallSlot(startsAt),
    // The hold id is the idempotency key: a double press of Confirm replays the first answer.
    confirm: (hold) => confirmMyCallHold(hold.holdId, hold.holdId),
    reload: refresh,
  };
  const onConfirmed = (confirmed: ConfirmedCallView) => {
    setView((current) => bookedNow(current, confirmed));
    setChanging(false);
    setStatus(doneLine(confirmed.booking.line));
  };
  const whilePending = async <R>(step: () => Promise<R>): Promise<R> => {
    setPending(true);
    try {
      return await step();
    } finally {
      setPending(false);
    }
  };
  const startChange = async () => {
    setChanging(true);
    await whilePending(refresh);
  };
  const cancel = async (bookingId: string) => {
    const result = await whilePending(() => attempt(() => cancelMyCall(bookingId)));
    if (!result.ok) return setCancelMessage(result.error === "rate_limited" ? PARENT_COPY.rateLimited : PARENT_COPY.notSet);
    setCancelMessage(null);
    setChanging(false);
    setView(result.value);
    setStatus(PARENT_COPY.cancelledStatus);
  };
  return { view, changing, pending, status, cancelMessage, actions, onConfirmed, startChange, cancel, keepTime: () => setChanging(false) };
}

export type CallBooking = ReturnType<typeof useCallBooking>;
