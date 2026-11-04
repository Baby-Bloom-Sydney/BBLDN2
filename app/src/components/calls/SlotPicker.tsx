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
 *   can confirm your call with your matchmaker." and the right button reads "Complete my childcare position".
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
import { LONDON_TIME_SUFFIX, PARENT_COPY } from "@/lib/calls/copy";
import type { SlotDay } from "@/lib/calls/group-slots-by-day";
import { AvailabilityGrid, isOpenSlot, slotsIn, TimeBox } from "./SlotPickerGrid";
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
  /** Her booked time while she changes it: shown chosen until she picks another. */
  readonly current?: string | null;
  /** Open with the taken notice for this time, in words (a time chosen elsewhere has just gone). */
  readonly initialNotice?: string | null;
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
      <Button type="button" variant="link" onClick={onRetry} disabled={busy} className="mt-1 h-auto px-0 text-violet-700">
        {PARENT_COPY.retry}
      </Button>
    </div>
  );
}

/** The green panel: the chosen time, then the hold line (or, with no position yet, BAI's line). */
function HeldPanel({ when, line }: { readonly when: string; readonly line: string }) {
  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-3">
      <p className="text-sm font-medium text-green-800">{when}</p>
      <p role="status" className="mt-1 text-xs text-green-700">
        {line}
      </p>
    </div>
  );
}

const PRIMARY = "flex-1 bg-violet-500 hover:bg-violet-600";

function GateButton({ gate, selected }: { readonly gate: PickerGate; readonly selected: string | null }) {
  if (selected === null) {
    return (
      <Button type="button" className={PRIMARY} disabled>
        {PARENT_COPY.completePosition}
      </Button>
    );
  }
  return (
    <Button asChild className={`${PRIMARY} h-auto min-h-9 whitespace-normal`}>
      <Link href={gate.href(selected)}>{PARENT_COPY.completePosition}</Link>
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
  // Focus Confirm once a hold is in and nothing is in flight (never while busy).
  useEffect(() => {
    if (picker.hold !== null && !picker.busy) confirmRef.current?.focus();
  }, [picker.hold, picker.busy]);
  return (
    <div className="flex gap-3">
      {onKeepTime ? (
        <Button type="button" variant="outline" className="flex-1" onClick={onKeepTime} disabled={picker.busy}>
          {PARENT_COPY.keepTime}
        </Button>
      ) : skipHref ? (
        <Button asChild variant="outline" className="flex-1">
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
  readonly gated: boolean;
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

/** Loading, failed, no free time, or the grid with its time box and green panel. */
function PickerBody({ uid, picker, days, current, words, gridRef, gated }: BodyProps) {
  if (picker.loading) return <Loading />;
  if (days === null) return <Empty line={words.loadFailed} busy={picker.busy} onRetry={picker.reload} />;
  const anyOpen = days.some((d) => d.slots.some((s) => isOpenSlot(s, picker.gone)));
  if (!anyOpen && current === null) return <Empty line={words.noTimes} busy={picker.busy} onRetry={picker.reload} />;
  const day = picker.cell ? days.find((d) => d.londonDate === picker.cell?.londonDate) : undefined;
  const cellSlots = day && picker.cell ? slotsIn(day, picker.cell.bracket) : [];
  const panel = panelOf(picker, days, gated);
  return (
    <>
      <AvailabilityGrid days={days} cell={day ? picker.cell : null} gone={picker.gone} current={current} busy={picker.busy} onPick={picker.pickCell} gridRef={gridRef} />
      {cellSlots.length > 0 && (
        <TimeBox uid={uid} slots={cellSlots} chosen={picker.selected ?? current} gone={picker.gone} busy={picker.busy} onTap={picker.tapTime} />
      )}
      {panel && <HeldPanel when={panel.when} line={panel.line} />}
    </>
  );
}

export function SlotPicker<T>({ days, actions, onConfirmed, onKeepTime, skipHref, current = null, initialNotice = null, gate, copy }: SlotPickerProps<T>) {
  const words = { ...DEFAULT_COPY, ...copy };
  const picker = useSlotPicker({ days, actions, onConfirmed, current, initialNotice, gated: gate !== undefined });
  const uid = useId();
  const alertRef = useRef<HTMLParagraphElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (picker.message !== null) alertRef.current?.focus();
  }, [picker.message]);
  const backToGrid = () => (gridRef.current?.querySelector<HTMLElement>('[tabindex="0"]:not([disabled])') ?? headingRef.current)?.focus();

  return (
    <section aria-labelledby={`${uid}-heading`} aria-busy={picker.busy || picker.loading} className="space-y-4">
      <h2 ref={headingRef} id={`${uid}-heading`} tabIndex={-1} className="text-sm font-medium text-slate-700 flex items-center gap-1.5 focus:outline-none">
        <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
        {words.heading} <span className="font-normal text-slate-400">{LONDON_TIME_SUFFIX}</span>
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
      <PickerBody uid={uid} picker={picker} days={picker.reloadFailed ? null : days} current={current} words={words} gridRef={gridRef} gated={gate !== undefined} />
      <ButtonRow picker={picker} onKeepTime={onKeepTime} skipHref={skipHref} gate={gate} />
      <TakenNotice when={picker.notice} onClose={picker.closeNotice} onClosed={backToGrid} />
    </section>
  );
}
