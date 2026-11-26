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
 * once.
 *
 * Accessibility (03c review M3): the changing lines (call on, in touch, booked) live in ONE polite status region that
 * is mounted from the start, so each is announced. After her press, focus goes to the picker's heading (the picker)
 * or to the page heading (a line); once booked, to the page heading — never on a page load. A picker action that
 * throws is a plain failure; `invalid` (the link or the pre-booking gone) turns the page into the invalid page.
 *
 * Test ids: `deposit-prebook` (the button), `deposit-prebook-picker`, `deposit-prebook-status` (the live region),
 * `deposit-prebook-line` / `deposit-prebook-booked` (its box, by what it says). BB-wave2-231126/03-build, 2026-11-25.
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
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
  /** Move focus to the page's heading (after a line, or once booked). */
  readonly onFocusHeading: () => void;
}

/** A picker action's answer as 04's picker takes it: a throw or the switch is a plain failure; `invalid` → the page. */
async function forPicker<T>(run: () => Promise<PrebookCallResult<T>>, onInvalid: () => void): Promise<PickerResult<T>> {
  let result: PrebookCallResult<T>;
  try {
    result = await run();
  } catch {
    return { ok: false, error: "error" };
  }
  if (result.ok) return result;
  if (result.error === "invalid") onInvalid();
  return { ok: false, error: result.error === "deposit_disabled" ? "error" : result.error };
}

async function settledNext(code: string): Promise<PrebookNextResult> {
  try {
    return await prebookNext(code);
  } catch {
    return { ok: false, error: "error" };
  }
}

/** The one live region: always mounted; its words (and its box) change. Empty → visually hidden, no room taken. */
function StatusLine({ text, booked }: { readonly text: string | null; readonly booked: boolean }) {
  const shown = text !== null;
  const box = booked ? "border-green-200 bg-green-50" : "border-violet-200 bg-violet-50";
  const words = booked ? "text-sm font-medium text-green-800" : "text-sm text-violet-900";
  const Icon = booked ? CheckCircle2 : CalendarClock;
  return (
    <div
      data-testid={shown ? (booked ? "deposit-prebook-booked" : "deposit-prebook-line") : undefined}
      className={shown ? `flex items-start gap-3 rounded-lg border px-4 py-3 ${box}` : "contents"}
    >
      {shown && <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${booked ? "text-green-600" : "text-violet-600"}`} aria-hidden="true" />}
      <p role="status" aria-live="polite" data-testid="deposit-prebook-status" className={shown ? words : "sr-only"}>
        {text ?? ""}
      </p>
    </div>
  );
}

interface DayPickerProps {
  readonly code: string;
  readonly londonDate: string;
  readonly initialDays: readonly SlotDay[];
  readonly onBooked: (line: string) => void;
  readonly onInvalid: () => void;
}

/** 04's picker for her one pre-booked day, wired to 03's actions with the code. */
function DayPicker({ code, londonDate, initialDays, onBooked, onInvalid }: DayPickerProps) {
  const [days, setDays] = useState<readonly SlotDay[] | null>(initialDays);
  const actions: SlotPickerActions<PrebookBooked> = {
    hold: (startsAt) => forPicker(() => holdPrebookTime(code, startsAt), onInvalid),
    // The hold id is the idempotency key (the server's): a double press of Confirm replays the first answer.
    confirm: (hold) => forPicker(() => confirmPrebookTime(code, hold.holdId), onInvalid),
    reload: async () => {
      const fresh = await forPicker(() => reloadPrebookTimes(code), onInvalid);
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
        onConfirmed={(value) => onBooked(value.line)}
        copy={{ heading: prebookPickHeading(londonDate), noTimes: callOn, loadFailed: callOn }}
      />
    </div>
  );
}

/** A line view's words; null for the picker (it has its own). */
function lineOf(view: PrebookView | null): string | null {
  if (view === null || view.kind === "picker") return null;
  return view.kind === "call_on" ? prebookCallLine(view.date) : PAGE_COPY.prebookNoCohort;
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

/** Opens at once when she has pre-booked already (once, even under strict mode's double effect). */
function useOpenIfPrebooked(prebooked: boolean, record: () => Promise<void>) {
  const recordRef = useRef(record);
  recordRef.current = record;
  const opened = useRef(false);
  useEffect(() => {
    if (!prebooked || opened.current) return;
    opened.current = true;
    void recordRef.current();
  }, [prebooked]);
}

interface FocusAfter {
  readonly root: RefObject<HTMLDivElement>;
  readonly view: PrebookView | null;
  readonly booked: string | null;
  readonly pressed: MutableRefObject<boolean>;
  readonly onFocusHeading: () => void;
}

/** After her press only: the picker's heading, or the page heading for a line; once booked, the page heading. */
function useFocusAfter({ root, view, booked, pressed, onFocusHeading }: FocusAfter) {
  const focusHeading = useRef(onFocusHeading);
  focusHeading.current = onFocusHeading;
  useEffect(() => {
    if (view === null || !pressed.current) return;
    if (view.kind !== "picker") return focusHeading.current();
    root.current?.querySelector<HTMLElement>("[data-testid='deposit-prebook-picker'] h2")?.focus();
  }, [view, pressed, root]);
  useEffect(() => {
    if (booked !== null) focusHeading.current();
  }, [booked]);
}

export function PrebookPanel({ code, prebooked, onInvalid, onFocusHeading }: PrebookPanelProps) {
  const { view, pending, message, record } = usePrebook(code, onInvalid);
  const [booked, setBooked] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const pressed = useRef(false);
  useOpenIfPrebooked(prebooked, record);
  useFocusAfter({ root, view, booked, pressed, onFocusHeading });
  const press = () => {
    pressed.current = true;
    void record();
  };
  return (
    <div ref={root} className="flex flex-col gap-4">
      <StatusLine text={booked ?? lineOf(view)} booked={booked !== null} />
      {view?.kind === "picker" && booked === null && (
        <DayPicker code={code} londonDate={view.londonDate} initialDays={view.days} onBooked={setBooked} onInvalid={onInvalid} />
      )}
      {view === null && message !== null && (
        <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {message}
        </p>
      )}
      {view === null && (
        <Button
          type="button"
          size="lg"
          data-testid="deposit-prebook"
          className="w-full bg-violet-600 text-base hover:bg-violet-700"
          disabled={pending}
          aria-busy={pending}
          onClick={press}
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          {PAGE_COPY.prebookButton}
        </Button>
      )}
    </div>
  );
}
