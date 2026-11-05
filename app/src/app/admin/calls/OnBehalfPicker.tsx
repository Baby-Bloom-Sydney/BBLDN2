"use client";

/**
 * Book, move or cancel a family's matchmaker call on her behalf, in the row drawer (plan C4, §13; brief §3 admin 4,
 * §0.11; BB-wave1-041126/04c1-build).
 *
 * - Not booked: "Book a matchmaker call" opens the same `SlotPicker` she uses, with the admin actions (`actions.ts`)
 *   and the admin words: the London heading, "Book this time", "Held for N minutes" (the hold action's line).
 * - Booked: her time in London words, with Move ("Move to this time", the same booking moved) and Cancel booking
 *   (asks first). Neither once the call has started — that is an outcome. A cohort pre-book (brief 03's) has Cancel
 *   only: the picker books first calls, so "moving" it would add a second booking instead.
 * - The server emails her as her own booking would; afterwards `onChanged` refreshes the page.
 *
 * The picker speaks the parent's refusal codes, so the admin codes are mapped onto them (`PICKER_REFUSAL`).
 */

import { useEffect, useRef, useState, useTransition, type RefObject } from "react";
import { SlotPicker, type PickerResult, type SlotPickerActions } from "@/components/calls/SlotPicker";
import { Button } from "@/components/ui/button";
import type { AdminCallError, AdminCallResult } from "@/lib/calls/admin-calls";
import { ADMIN_COPY, adminErrorLine } from "@/lib/calls/copy";
import type { PanelBooking } from "@/lib/calls/family-panel";
import type { SlotDay } from "@/lib/calls/group-slots-by-day";
import type { MyCallRefusal } from "@/lib/calls/parent-view";
import { cancelCallForFamily, confirmCallForFamily, holdCallForFamily, reloadFamilySlots } from "./actions";

export interface OnBehalfPickerProps {
  readonly parentUserId: string;
  readonly booking: PanelBooking | null;
  /** Her picker grid; null when it couldn't be read (load-failed with Retry). */
  readonly days: readonly SlotDay[] | null;
  readonly onChanged: () => void;
}

const PICKER_REFUSAL: Readonly<Record<AdminCallError, MyCallRefusal>> = Object.freeze({
  taken: "taken",
  too_soon: "too_soon",
  hold_expired: "hold_expired",
  not_yours: "not_yours",
  not_found: "not_yours",
  rate_limited: "rate_limited",
  invalid: "invalid",
  call_booking_disabled: "call_booking_disabled",
  not_authorized: "error",
  booked_call_exists: "error",
  error: "error",
});

function forPicker<T>(result: AdminCallResult<T>): PickerResult<T> {
  return result.ok ? result : { ok: false, error: PICKER_REFUSAL[result.error] };
}

type Confirmed = { readonly bookingId: string; readonly moved: boolean };
type Mode = "view" | "picking" | "confirm_cancel";

function usePickerActions(parentUserId: string, setDays: (d: readonly SlotDay[]) => void): SlotPickerActions<Confirmed> {
  return {
    hold: async (startsAt) => forPicker(await holdCallForFamily({ parentUserId, startsAt })),
    // The hold id is the idempotency key: a double press replays the first answer.
    confirm: async (hold) => forPicker(await confirmCallForFamily({ parentUserId, holdId: hold.holdId, idempotencyKey: hold.holdId })),
    reload: async () => {
      const fresh = await reloadFamilySlots({ parentUserId });
      if (!fresh.ok) throw new Error(fresh.error); // the picker shows load-failed with Retry
      setDays(fresh.value);
      return fresh.value;
    },
  };
}

interface PanelProps {
  /** A write has landed but the page's fresh props haven't: the buttons wait. */
  readonly busy: boolean;
}

function BookedPanel({ booking, busy, onMove, onCancel }: PanelProps & { readonly booking: PanelBooking; readonly onMove: () => void; readonly onCancel: () => void }) {
  return (
    <div className="space-y-3 rounded-lg border border-green-200 bg-green-50 p-3">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-green-700">
          {booking.purpose === "cohort_prebook" ? ADMIN_COPY.tagCohortPrebook : ADMIN_COPY.bookedLabel}
        </p>
        <p className="text-sm font-medium text-green-900">{booking.when}</p>
      </div>
      {booking.changeable && (
        <div className="flex flex-wrap gap-2">
          {booking.purpose === "first_call" && (
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onMove}>
              {ADMIN_COPY.move}
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" className="text-red-700" disabled={busy} onClick={onCancel}>
            {ADMIN_COPY.cancelBooking}
          </Button>
        </div>
      )}
    </div>
  );
}

function NotBookedPanel({ busy, onBook }: PanelProps & { readonly onBook: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3">
      <p className="text-sm font-medium text-slate-600">{ADMIN_COPY.notBooked}</p>
      <Button type="button" size="sm" className="bg-violet-500 hover:bg-violet-600" disabled={busy} onClick={onBook}>
        {ADMIN_COPY.bookOnBehalf}
      </Button>
    </div>
  );
}

interface CancelQuestionProps {
  readonly busy: boolean;
  readonly onYes: () => void;
  readonly onNo: () => void;
  /** Focus lands on the safe answer when the question opens. */
  readonly keepRef: RefObject<HTMLButtonElement>;
}

function CancelQuestion({ busy, onYes, onNo, keepRef }: CancelQuestionProps) {
  return (
    <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-3">
      <p className="text-sm text-red-900">{ADMIN_COPY.cancelQuestion}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={onYes}>
          {ADMIN_COPY.confirmCancel}
        </Button>
        <Button ref={keepRef} type="button" size="sm" variant="outline" disabled={busy} onClick={onNo}>
          {ADMIN_COPY.keepIt}
        </Button>
      </div>
    </div>
  );
}

function useCancel(parentUserId: string, booking: PanelBooking | null, done: (status: string) => void, setError: (line: string | null) => void) {
  const [busy, startTransition] = useTransition();
  const cancel = () => {
    if (booking === null) return;
    setError(null);
    startTransition(async () => {
      try {
        const cancelled = await cancelCallForFamily({ parentUserId, bookingId: booking.bookingId });
        if (cancelled.ok) done(ADMIN_COPY.cancelled);
        else setError(adminErrorLine(cancelled.error));
      } catch {
        setError(adminErrorLine("error"));
      }
    });
  };
  return { busy, cancel };
}

/** Focus follows the steps: Back on the picker, Keep it on the question (React review). */
function useStepFocus(mode: Mode) {
  const backRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (mode === "picking") backRef.current?.focus();
    if (mode === "confirm_cancel") keepRef.current?.focus();
  }, [mode]);
  return { backRef, keepRef };
}

/**
 * The picker's own state. The page refreshes after a write: fresh days come in and the buttons come back (the
 * component isn't remounted, so the status line stays). If her booking changes under the question or the picker, it's
 * back to the view, so a stale "Yes, cancel it" can't act on it.
 */
function useOnBehalf(booking: PanelBooking | null, days: readonly SlotDay[] | null, onChanged: () => void) {
  const [mode, setMode] = useState<Mode>("view");
  const [shownDays, setShownDays] = useState(days);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    setShownDays(days);
    setSettling(false);
  }, [days]);
  const bookingKey = booking ? `${booking.bookingId}:${booking.startsAt}` : null;
  useEffect(() => {
    setMode("view");
    setError(null);
  }, [bookingKey]);
  const done = (line: string) => {
    setMode("view");
    setStatus(line);
    setSettling(true);
    statusRef.current?.focus();
    onChanged();
  };
  const go = (next: Mode) => {
    setStatus("");
    setError(null);
    setMode(next);
  };
  return { mode, shownDays, setShownDays, status, error, setError, settling, statusRef, done, go };
}

export function OnBehalfPicker({ parentUserId, booking, days, onChanged }: OnBehalfPickerProps) {
  const { mode, shownDays, setShownDays, status, error, setError, settling, statusRef, done, go } = useOnBehalf(booking, days, onChanged);
  const focus = useStepFocus(mode);
  const actions = usePickerActions(parentUserId, setShownDays);
  const cancel = useCancel(parentUserId, booking, done, setError);
  return (
    <div className="space-y-3">
      <p ref={statusRef} tabIndex={-1} role="status" className={status ? "text-sm text-green-700 focus:outline-none" : "sr-only"}>
        {status}
      </p>
      {mode === "view" &&
        (booking ? (
          <BookedPanel booking={booking} busy={settling} onMove={() => go("picking")} onCancel={() => go("confirm_cancel")} />
        ) : (
          <NotBookedPanel busy={settling} onBook={() => go("picking")} />
        ))}
      {mode === "confirm_cancel" && <CancelQuestion busy={cancel.busy} onYes={cancel.cancel} onNo={() => go("view")} keepRef={focus.keepRef} />}
      {error && (
        <p role="alert" className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">
          {error}
        </p>
      )}
      {mode === "picking" && (
        <div className="space-y-3">
          <Button ref={focus.backRef} type="button" variant="outline" size="sm" onClick={() => go("view")}>
            {ADMIN_COPY.back}
          </Button>
          <SlotPicker
            days={shownDays}
            actions={actions}
            onConfirmed={(c) => done(c.moved ? ADMIN_COPY.movedStatus : ADMIN_COPY.bookedStatus)}
            current={booking?.startsAt ?? null}
            copy={{ heading: ADMIN_COPY.availability, confirm: booking ? ADMIN_COPY.moveToThisTime : ADMIN_COPY.bookThisTime }}
          />
        </div>
      )}
    </div>
  );
}
