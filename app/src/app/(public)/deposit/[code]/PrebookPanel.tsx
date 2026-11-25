"use client";

/**
 * "Pre-book next available cohort" (plan 03 §3 "Pre-book", row C1; brief 03 §0.5, §3 parent 5–6). Shown only in the
 * full and being-paid states (the action refuses any other). The button records her one open pre-booking through
 * `prebookNext(code)`, then shows what the server answers:
 * - **picker**: 04's `SlotPicker` for that cohort's opening day — one day, one row (04 W4) — with its hold, confirm
 *   and reload wired to 03's actions with the code (the server sets the parent, actor and day); once confirmed, "We'll
 *   call you on Monday 8 February at 10:00 to confirm your place.";
 * - **call on**: "We'll call you on Monday 8 February to confirm your place." (04 off, or no free time that day);
 * - **in touch**: "We'll be in touch to arrange your place." (no next cohort set up).
 * No place is held (02 Q6). Already pre-booked (she came back, e.g. from the call email's button, D8) → it opens at
 * once. Test ids: `deposit-prebook` (the button), `deposit-prebook-picker`, `deposit-prebook-line`,
 * `deposit-prebook-booked`.
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CalendarClock, CheckCircle2, Loader2 } from "lucide-react";
import { SlotPicker, type PickerResult, type SlotPickerActions } from "@/components/calls/SlotPicker";
import { Button } from "@/components/ui/button";
import type { SlotDay } from "@/lib/calls/group-slots-by-day";
import { PAGE_COPY, prebookCallLine, prebookPickHeading } from "@/lib/deposit/copy";
import {
  confirmPrebookTime,
  holdPrebookTime,
  prebookNext,
  reloadPrebookTimes,
  type PrebookBooked,
  type PrebookCallResult,
  type PrebookNextResult,
  type PrebookView,
} from "./actions";

export interface PrebookPanelProps {
  readonly code: string;
  readonly prebooked: boolean;
  /** The link stopped working meanwhile (cancelled, or the switch went off): the page becomes the invalid page. */
  readonly onInvalid: () => void;
}

/** The switch going off mid-pick is, for the picker, a plain failure (its own codes have no such case). */
async function forPicker<T>(run: () => Promise<PrebookCallResult<T>>): Promise<PickerResult<T>> {
  const result = await run();
  if (result.ok) return result;
  return { ok: false, error: result.error === "deposit_disabled" ? "error" : result.error };
}

async function settledNext(code: string): Promise<PrebookNextResult> {
  try {
    return await prebookNext(code);
  } catch {
    return { ok: false, error: "error" };
  }
}

function Line({ text, testId }: { readonly text: string; readonly testId: string }) {
  return (
    <div role="status" data-testid={testId} className="flex items-start gap-3 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3">
      <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" aria-hidden="true" />
      <p className="text-sm text-violet-900">{text}</p>
    </div>
  );
}

function Booked({ line }: { readonly line: string }) {
  return (
    <div role="status" data-testid="deposit-prebook-booked" className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
      <p className="text-sm font-medium text-green-800">{line}</p>
    </div>
  );
}

/** 04's picker for her one pre-booked day, wired to 03's actions with the code. */
function DayPicker({ code, londonDate, initialDays }: { readonly code: string; readonly londonDate: string; readonly initialDays: readonly SlotDay[] }) {
  const [days, setDays] = useState<readonly SlotDay[] | null>(initialDays);
  const [booked, setBooked] = useState<string | null>(null);
  if (booked !== null) return <Booked line={booked} />;
  const actions: SlotPickerActions<PrebookBooked> = {
    hold: (startsAt) => forPicker(() => holdPrebookTime(code, startsAt)),
    // The hold id is the idempotency key (the server's): a double press of Confirm replays the first answer.
    confirm: (hold) => forPicker(() => confirmPrebookTime(code, hold.holdId)),
    reload: async () => {
      const fresh = await reloadPrebookTimes(code);
      setDays(fresh.ok ? fresh.value : null);
      return fresh.ok ? fresh.value : null;
    },
  };
  const callOn = prebookCallLine(londonDate);
  return (
    <div data-testid="deposit-prebook-picker">
      <SlotPicker
        days={days}
        actions={actions}
        onConfirmed={(value) => setBooked(value.line)}
        copy={{ heading: prebookPickHeading(londonDate), noTimes: callOn, loadFailed: callOn }}
      />
    </div>
  );
}

function ViewOf({ code, view }: { readonly code: string; readonly view: PrebookView }) {
  if (view.kind === "picker") return <DayPicker code={code} londonDate={view.londonDate} initialDays={view.days} />;
  if (view.kind === "call_on") return <Line text={prebookCallLine(view.date)} testId="deposit-prebook-line" />;
  return <Line text={PAGE_COPY.prebookNoCohort} testId="deposit-prebook-line" />;
}

/** The button's press: records, then hands back the view; a refusal moves the page on or shows "Try again." */
function usePrebook(code: string, onInvalid: () => void) {
  const router = useRouter();
  const [view, setView] = useState<PrebookView | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const record = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setMessage(null);
    const result = await settledNext(code);
    inFlight.current = false;
    setPending(false);
    if (result.ok) return setView(result.value);
    if (result.error === "invalid" || result.error === "deposit_disabled") return onInvalid();
    if (result.error === "not_offered") return router.refresh(); // the state moved on: the page shows the new one
    setMessage(PAGE_COPY.tryAgain);
  };
  return { view, pending, message, record };
}

export function PrebookPanel({ code, prebooked, onInvalid }: PrebookPanelProps) {
  const { view, pending, message, record } = usePrebook(code, onInvalid);
  const recordRef = useRef(record);
  recordRef.current = record;
  const opened = useRef(false);
  useEffect(() => {
    if (!prebooked || opened.current) return;
    opened.current = true;
    void recordRef.current();
  }, [prebooked]);
  if (view !== null) return <ViewOf code={code} view={view} />;
  return (
    <div className="flex flex-col gap-4">
      {message !== null && (
        <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {message}
        </p>
      )}
      <Button
        type="button"
        size="lg"
        data-testid="deposit-prebook"
        className="w-full bg-violet-600 text-base hover:bg-violet-700"
        disabled={pending}
        aria-busy={pending}
        onClick={record}
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
        {PAGE_COPY.prebookButton}
      </Button>
    </div>
  );
}
