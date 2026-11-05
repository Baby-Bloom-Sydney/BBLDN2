"use client";

/**
 * The call-time picker (brief 04 §2 picker semantics, §3 parent 2–3; plan B6; 04b rework W4). BAI 2026-11-05: "use
 * the same date/time selector style as is already in our system … for arranging a call/meetup with their nanny" —
 * so it is `components/position/ScheduleTimeGrid.tsx` (`/ui` CMP-033), copied near-identically and left unchanged:
 * the Calendar header, the dates × time-of-day grid, "Select a time", the green panel, the two-button row.
 *
 * - Greyed, never hidden (BAI 2026-11-05): every date in the window is a row and every slot in a cell is listed; what
 *   isn't free is greyed and can't be chosen by mouse or keyboard. Only with no free time at all does the no-times line
 *   (with Retry) stand in for the grid; the load-failed line likewise.
 * - Tapping a free time holds it at once; the green panel names it ("Thursday 5 November at 10:00") with the hold line,
 *   and Confirm takes focus once it is enabled (never while busy). Confirm writes with the hold.
 * - Taken (by someone else, or a held time that ran out and was taken) → the "This time has just been booked" notice,
 *   and the list refreshes under it. Ran-out-but-free, invalid and failed → 04b's inline alert, which takes focus.
 * - The left button: "Skip for now" (a link), or "Keep my time" while changing; none in the in-app popup.
 * - No position yet (W11): a tap selects without a hold; the panel says "Complete your childcare position so that we
 *   can confirm your call with your matchmaker." and the right button still reads "Confirm time" (W15, BAI
 *   2026-11-05), a link to her position form carrying the time.
 * - Every label arrives preformatted from the server (`SlotDay`), so the device's zone can't matter. Motion stops under
 *   `prefers-reduced-motion`. Two pickers on one page share no ids (`useId`). 04c and 03 reuse it.
 *
 * BB-wave1-041126/04b-build, 2026-11-04; BB-wave1-041126/04b-rework, 2026-11-05.
 */

import Link from "next/link";
import { useEffect, useId, useRef, type RefObject } from "react";
import { Calendar, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PARENT_COPY } from "@/lib/calls/copy";
import type { SlotDay } from "@/lib/calls/group-slots-by-day";
import { BracketStep, DayStep, isOpenSlot, prefersReducedMotion, Reveal, slotsIn, TimeStep } from "./SlotPickerSteps";
import { TakenNotice } from "./TakenNotice";
import { findSlot, useSlotPicker, type SlotPickerActions, type SlotPickerState } from "./use-slot-picker";

export { pickerMessage, type PickerHold, type PickerResult, type SlotPickerActions } from "./use-slot-picker";

export interface SlotPickerCopy {
  readonly heading: string;
  readonly noTimes: string;
  readonly loadFailed: string;
}

export interface SlotPickerProps<T> {
  /** Every date in the window with every slot, free or not; null = they couldn't be loaded. */
  readonly days: readonly SlotDay[] | null;
  readonly actions: SlotPickerActions<T>;
  readonly onConfirmed: (value: T) => void;
  /** The left button while changing an existing booking ("Keep my time"). */
  readonly onKeepTime?: () => void;
  /** The left button otherwise ("Skip for now"), a link onward. Neither → the primary button alone, full width. */
  readonly skipHref?: string;
  /** Her booked time while she changes it: marked as hers (and shown chosen) when she reaches it, until she picks another. */
  readonly current?: string | null;
  /** Open with the taken notice for this time, in words (a time chosen elsewhere has just gone). */
  readonly initialNotice?: string | null;
  /** Open with this inline line (a booking made elsewhere failed for any reason but taken). */
  readonly initialMessage?: string | null;
  /**
   * No position yet (W11, BAI 2026-11-05): a tap selects without holding; the green panel asks her to complete her
   * position, and the right button goes there carrying the time (`href`). Nothing is held until her position is saved.
   */
  readonly gate?: PickerGate;
  readonly copy?: Partial<SlotPickerCopy>;
}

export interface PickerGate {
  readonly href: (startsAt: string) => string;
}

const DEFAULT_COPY: SlotPickerCopy = {
  heading: PARENT_COPY.availability,
  noTimes: PARENT_COPY.noTimes,
  loadFailed: PARENT_COPY.loadFailed,
};

function Loading() {
  return (
    <div data-testid="slot-picker-loading" className="space-y-2" aria-hidden="true">
      {[0, 1, 2, 3].map((n) => (
        <Skeleton key={n} className="h-10 w-full motion-reduce:animate-none" />
      ))}
    </div>
  );
}

function Empty({ line, busy, onRetry }: { readonly line: string; readonly busy: boolean; readonly onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm text-slate-700">{line}</p>
      <Button type="button" variant="link" data-retry onClick={onRetry} disabled={busy} className="mt-1 h-auto px-0 text-violet-700">
        {PARENT_COPY.retry}
      </Button>
    </div>
  );
}

/**
 * The green panel: the chosen time, then the hold line (or, with no position yet, BAI's line). The line's status
 * region is mounted for the picker's life and only its words change (W17), so each new line is announced; with
 * nothing chosen it is empty, visually hidden, and takes no room (`contents`, in the action area's flex column).
 */
function HeldPanel({ panel }: { readonly panel: { readonly when: string; readonly line: string } | null }) {
  return (
    <div className={panel ? "rounded-lg border border-green-200 bg-green-50 p-3" : "contents"}>
      {panel && <p className="text-sm font-medium text-green-800">{panel.when}</p>}
      <p role="status" className={panel ? "mt-1 text-xs text-green-700" : "sr-only"}>
        {panel?.line ?? ""}
      </p>
    </div>
  );
}

const PRIMARY = "flex-1 min-w-[7rem] bg-violet-500 hover:bg-violet-600";

/** No position yet: "Confirm time" too (W15), a link to her position form with the time; nothing is held. */
function GateButton({ gate, selected }: { readonly gate: PickerGate; readonly selected: string | null }) {
  if (selected === null) {
    return (
      <Button type="button" className={PRIMARY} disabled>
        {PARENT_COPY.confirmTimeButton}
      </Button>
    );
  }
  return (
    <Button asChild className={PRIMARY}>
      <Link href={gate.href(selected)}>{PARENT_COPY.confirmTimeButton}</Link>
    </Button>
  );
}

interface ButtonRowProps {
  readonly picker: SlotPickerState;
  readonly onKeepTime?: () => void;
  readonly skipHref?: string;
  readonly gate?: PickerGate;
}

function ButtonRow({ picker, onKeepTime, skipHref, gate }: ButtonRowProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Focus Confirm once a hold is in and nothing is in flight (never while busy), unless a refusal's alert is showing:
  // that keeps focus (W17). The action area scrolls itself.
  useEffect(() => {
    if (picker.hold !== null && !picker.busy && picker.message === null) confirmRef.current?.focus({ preventScroll: true });
  }, [picker.hold, picker.busy, picker.message]);
  return (
    <div className="flex flex-wrap gap-3">
      {onKeepTime ? (
        <Button type="button" variant="outline" className="flex-1 min-w-[7rem]" onClick={onKeepTime} disabled={picker.busy}>
          {PARENT_COPY.keepTime}
        </Button>
      ) : skipHref ? (
        <Button asChild variant="outline" className="flex-1 min-w-[7rem]">
          <Link href={skipHref}>{PARENT_COPY.skipForNow}</Link>
        </Button>
      ) : null}
      {gate ? (
        <GateButton gate={gate} selected={picker.selected} />
      ) : (
        <Button ref={confirmRef} type="button" className={PRIMARY} disabled={picker.hold === null || picker.busy} onClick={picker.confirm}>
          {picker.confirming ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              {PARENT_COPY.confirming}
            </>
          ) : (
            PARENT_COPY.confirmTimeButton
          )}
        </Button>
      )}
    </div>
  );
}

interface BodyProps {
  readonly uid: string;
  readonly picker: SlotPickerState;
  readonly days: readonly SlotDay[] | null;
  readonly current: string | null;
  readonly words: SlotPickerCopy;
  readonly gridRef: RefObject<HTMLDivElement>;
}

/** The green panel's two lines, or null: a hold's, or (no position yet) the chosen time with BAI's line. */
function panelOf(picker: SlotPickerState, days: readonly SlotDay[], gated: boolean): { when: string; line: string } | null {
  if (gated) {
    const chosen = picker.selected ? findSlot(days, picker.selected) : null;
    return chosen ? { when: chosen.when, line: PARENT_COPY.completePositionLine } : null;
  }
  const held = picker.hold ? findSlot(days, picker.hold.startsAt) : null;
  return picker.hold && held ? { when: held.when, line: picker.hold.line } : null;
}

/**
 * Loading, failed, no free time, or the steps (W14): the days; once a day is chosen, its times of day; once a time of
 * day is chosen, its times. Each later step appears under the last, and goes again when an earlier one is unselected.
 */
function PickerBody({ uid, picker, days, current, words, gridRef }: BodyProps) {
  if (picker.loading) return <Loading />;
  if (days === null) return <Empty line={words.loadFailed} busy={picker.busy} onRetry={picker.reload} />;
  const anyOpen = days.some((d) => d.slots.some((s) => isOpenSlot(s, picker.gone)));
  if (!anyOpen && current === null) return <Empty line={words.noTimes} busy={picker.busy} onRetry={picker.reload} />;
  const day = picker.day ? days.find((d) => d.londonDate === picker.day) : undefined;
  const step = { uid, gone: picker.gone, current, busy: picker.busy };
  return (
    <div ref={gridRef} className="space-y-4">
      <DayStep {...step} days={days} chosen={day?.londonDate ?? null} onPick={picker.pickDay} />
      {day && (
        <Reveal key={day.londonDate}>
          <BracketStep {...step} day={day} chosen={picker.bracket} onPick={picker.pickBracket} />
        </Reveal>
      )}
      {day && picker.bracket && (
        <Reveal key={`${day.londonDate}-${picker.bracket}`}>
          <TimeStep {...step} slots={slotsIn(day, picker.bracket)} chosen={picker.selected ?? current} onTap={picker.tapTime} />
        </Reveal>
      )}
    </div>
  );
}

/**
 * Once a time is picked (held, or chosen with no position yet), bring the green panel and the button row into view
 * — smoothly, or at once under prefers-reduced-motion (coordinator review: on a 390×844 phone they were below the
 * fold). Works in the page and inside the popup's own scroll area (the nearest scrolling ancestor).
 */
function useScrollActionsIntoView(trigger: string | null) {
  const area = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (trigger === null) return;
    area.current?.scrollIntoView?.({ block: "end", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [trigger]);
  return area;
}

function lastOf(root: HTMLElement | null, selector: string): HTMLElement | null {
  const all = root?.querySelectorAll<HTMLElement>(selector);
  return all && all.length > 0 ? all[all.length - 1] : null;
}

/**
 * Where focus goes back to (after the notice closes, or a reload): her chosen tile in the deepest step, else that
 * step's first open tile, else Retry, else the heading — never the page body (React re-review LOW).
 */
function focusBack(section: HTMLElement | null, steps: HTMLElement | null, heading: HTMLElement | null) {
  const target =
    lastOf(steps, '[aria-pressed="true"]:not([disabled])') ??
    lastOf(steps, '[role="group"]')?.querySelector<HTMLElement>("button:not([disabled])") ??
    section?.querySelector<HTMLElement>("[data-retry]") ??
    heading;
  target?.focus();
}

/** A reload swaps the steps for a skeleton; if that dropped focus to the page, put it back once the list is in. */
function useFocusAfterReload(loading: boolean, back: () => void) {
  const was = useRef(loading);
  const backRef = useRef(back);
  backRef.current = back;
  useEffect(() => {
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (was.current && !loading && lost) backRef.current();
    was.current = loading;
  }, [loading]);
}

export function SlotPicker<T>(props: SlotPickerProps<T>) {
  const { days, actions, onConfirmed, onKeepTime, skipHref, current = null, initialNotice = null, initialMessage = null, gate, copy } = props;
  const words = { ...DEFAULT_COPY, ...copy };
  const picker = useSlotPicker({ days, actions, onConfirmed, current, initialNotice, initialMessage, gated: gate !== undefined });
  const uid = useId();
  const alertRef = useRef<HTMLParagraphElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (picker.message !== null) alertRef.current?.focus();
  }, [picker.message]);
  const sectionRef = useRef<HTMLElement>(null);
  const backToGrid = () => focusBack(sectionRef.current, gridRef.current, headingRef.current);
  useFocusAfterReload(picker.loading, backToGrid);
  const gated = gate !== undefined;
  const shown = picker.reloadFailed ? null : days;
  const panel = shown && !picker.loading ? panelOf(picker, shown, gated) : null;
  const actionArea = useScrollActionsIntoView(gated ? picker.selected : picker.hold?.holdId ?? null);

  return (
    <section ref={sectionRef} aria-labelledby={`${uid}-heading`} className="space-y-4">
      <h2 ref={headingRef} id={`${uid}-heading`} tabIndex={-1} className="text-sm font-medium text-slate-700 flex items-center gap-1.5 focus:outline-none">
        <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{words.heading}</span>
      </h2>
      {picker.message !== null && (
        <p
          ref={alertRef}
          tabIndex={-1}
          role="alert"
          className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        >
          {picker.message}
        </p>
      )}
      {/* aria-busy on the grid only, so the alert and status lines are never held back (react review MEDIUM). */}
      <div data-testid="slot-picker-body" aria-busy={picker.busy || picker.loading} className="space-y-4">
        <PickerBody uid={uid} picker={picker} days={shown} current={current} words={words} gridRef={gridRef} />
      </div>
      <div ref={actionArea} data-testid="slot-picker-actions" className="flex flex-col gap-4">
        <HeldPanel panel={panel} />
        <ButtonRow picker={picker} onKeepTime={onKeepTime} skipHref={skipHref} gate={gate} />
      </div>
      <TakenNotice when={picker.notice} onClose={picker.closeNotice} onClosed={backToGrid} />
    </section>
  );
}
