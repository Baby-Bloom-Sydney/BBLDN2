"use client";

/**
 * The call-time picker (brief 04 §2 picker semantics, §3 parent 2–3; plan B6 + §12 R16, R17). Ported from LDN1
 * `call-layer/components/SlotPicker.tsx` onto LDN2's `Button`, the 24-hour clock, and actions passed as props, so
 * 04c's on-behalf booking and brief 03's pre-book reuse it.
 *
 * - One `fieldset` per London day, its full date as the `legend`; a `radiogroup` inside; every option's accessible
 *   name is the full date and time with "(London time)", the visible time a `<time dateTime>`. Native radios, one
 *   name per day: Tab moves between days, arrow keys within one.
 * - Choosing a radio (by click or arrow key) only selects. **"Choose this time" holds** (R17), so arrow keys never
 *   take holds; then "Confirm this time" writes with that hold.
 * - A taken slot or a run-out hold says so in an alert that takes focus, and the list refreshes (`actions.reload`;
 *   the owner passes the new `days`). The no-times and load-failed states offer Retry; a skeleton shows while the
 *   list reloads. Motion stops under `prefers-reduced-motion`.
 * - Every label arrives preformatted from the server (`SlotDay`), so the device's zone can't matter.
 *
 * BB-wave1-041126/04b-build, 2026-11-04.
 */

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LONDON_TIME_SUFFIX, PARENT_COPY } from "@/lib/calls/copy";
import type { SlotDay } from "@/lib/calls/group-slots-by-day";

/** A held time: what the server holds, and its line ("We're holding … until 10:05."). */
export interface PickerHold {
  readonly holdId: string;
  readonly startsAt: string;
  readonly line: string;
}

export type PickerResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export interface SlotPickerActions<T> {
  /** "Choose this time". */
  hold(startsAt: string): Promise<PickerResult<PickerHold>>;
  /** "Confirm this time": the write. */
  confirm(hold: PickerHold): Promise<PickerResult<T>>;
  /** Refresh the list; the owner passes the new `days`. */
  reload(): Promise<void>;
}

export interface SlotPickerCopy {
  readonly heading: string;
  readonly hint: string;
  readonly noTimes: string;
  readonly loadFailed: string;
}

export interface SlotPickerProps<T> {
  /** The free times by London day; `[]` = none free; null = they couldn't be loaded. */
  readonly days: readonly SlotDay[] | null;
  readonly actions: SlotPickerActions<T>;
  readonly onConfirmed: (value: T) => void;
  /** Offered while changing an existing booking ("Keep my time"). */
  readonly onKeepTime?: () => void;
  readonly copy?: Partial<SlotPickerCopy>;
}

const DEFAULT_COPY: SlotPickerCopy = {
  heading: PARENT_COPY.pickHeading,
  hint: PARENT_COPY.pickHint,
  noTimes: PARENT_COPY.noTimes,
  loadFailed: PARENT_COPY.loadFailed,
};

const OPTION =
  "inline-flex cursor-pointer select-none rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 " +
  "transition-colors motion-reduce:transition-none hover:border-slate-300 peer-checked:border-violet-500 peer-checked:bg-violet-50 " +
  "peer-checked:text-violet-700 peer-focus-visible:ring-2 peer-focus-visible:ring-violet-500 peer-focus-visible:ring-offset-2 " +
  "peer-disabled:cursor-not-allowed peer-disabled:opacity-40 peer-disabled:line-through";

const TAKEN = new Set(["taken", "too_soon", "overlap"]);
const RAN_OUT = new Set(["hold_expired", "not_yours", "not_found"]);

/** The line for a refused hold or confirm. */
export function pickerMessage(error: string): string {
  if (TAKEN.has(error)) return PARENT_COPY.taken;
  if (RAN_OUT.has(error)) return PARENT_COPY.holdExpired;
  if (error === "rate_limited") return PARENT_COPY.rateLimited;
  return PARENT_COPY.notSet;
}

interface DayGroupProps {
  /** This picker's own id prefix, so two pickers on one page never share ids or radio names. */
  readonly uid: string;
  readonly day: SlotDay;
  readonly selected: string | null;
  readonly gone: ReadonlySet<string>;
  readonly disabled: boolean;
  readonly onSelect: (startsAt: string) => void;
}

function DayGroup({ uid, day, selected, gone, disabled, onSelect }: DayGroupProps) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-semibold text-slate-900">{day.legend}</legend>
      <div role="radiogroup" aria-label={`${day.legend} ${LONDON_TIME_SUFFIX}`} className="mt-3 flex flex-wrap gap-2">
        {day.slots.map((slot) => {
          const isGone = gone.has(slot.startsAt);
          const id = `${uid}-slot-${slot.startsAt}`;
          return (
            <span key={slot.startsAt} className="inline-flex">
              <input
                type="radio"
                id={id}
                name={`${uid}-day-${day.londonDate}`}
                value={slot.startsAt}
                className="peer sr-only"
                checked={selected === slot.startsAt}
                disabled={disabled || isGone}
                aria-label={isGone ? `${slot.name} — ${PARENT_COPY.noLongerAvailable}` : slot.name}
                onChange={() => onSelect(slot.startsAt)}
              />
              <label htmlFor={id} className={OPTION}>
                <time dateTime={slot.startsAt}>{slot.time}</time>
              </label>
            </span>
          );
        })}
      </div>
    </fieldset>
  );
}

function HeldPanel({ hold, busy, onConfirm, onPickAnother }: { readonly hold: PickerHold; readonly busy: boolean; readonly onConfirm: () => void; readonly onPickAnother: () => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => confirmRef.current?.focus(), []);
  return (
    <div className="mt-6 rounded-xl border border-violet-200 bg-violet-50 p-5">
      <p role="status" className="text-sm font-medium text-violet-900">
        {hold.line}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button ref={confirmRef} type="button" onClick={onConfirm} disabled={busy} className="bg-violet-600 text-white hover:bg-violet-700">
          {PARENT_COPY.confirmTime}
        </Button>
        <Button type="button" variant="outline" onClick={onPickAnother} disabled={busy}>
          {PARENT_COPY.pickAnother}
        </Button>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div data-testid="slot-picker-loading" className="mt-6 space-y-4" aria-hidden="true">
      {[0, 1, 2].map((n) => (
        <Skeleton key={n} className="h-16 w-full motion-reduce:animate-none" />
      ))}
    </div>
  );
}

function Empty({ line, busy, onRetry }: { readonly line: string; readonly busy: boolean; readonly onRetry: () => void }) {
  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
      <p className="text-sm text-slate-700">{line}</p>
      <Button type="button" variant="link" onClick={onRetry} disabled={busy} className="mt-2 h-auto px-0 text-violet-700">
        {PARENT_COPY.retry}
      </Button>
    </div>
  );
}

/** Selection, hold, alert and reload state, and the three things a person can do. */
function usePicker<T>({ days, actions, onConfirmed }: Pick<SlotPickerProps<T>, "days" | "actions" | "onConfirmed">) {
  const [selected, setSelected] = useState<string | null>(null);
  const [hold, setHold] = useState<PickerHold | null>(null);
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const listed = days?.some((d) => d.slots.some((s) => s.startsAt === selected)) ?? false;
  const choice = listed && selected !== null && !gone.has(selected) ? selected : null;

  const reload = async () => {
    setLoading(true);
    await actions.reload();
    setLoading(false);
  };
  const refuse = async (error: string, startsAt: string) => {
    if (TAKEN.has(error)) setGone((previous) => new Set([...previous, startsAt]));
    setHold(null);
    setSelected(null);
    setMessage(pickerMessage(error));
    if (TAKEN.has(error) || RAN_OUT.has(error)) await reload();
  };
  const chooseTime = async () => {
    if (choice === null) return;
    setMessage(null);
    setBusy(true);
    const held = await actions.hold(choice);
    setBusy(false);
    if (held.ok) setHold(held.value);
    else await refuse(held.error, choice);
  };
  const confirmTime = async () => {
    if (hold === null) return;
    setBusy(true);
    const confirmed = await actions.confirm(hold);
    setBusy(false);
    if (confirmed.ok) onConfirmed(confirmed.value);
    else await refuse(confirmed.error, hold.startsAt);
  };
  return { choice, hold, gone, message, busy, loading, setSelected, setHold, reload, chooseTime, confirmTime };
}

type Picker = ReturnType<typeof usePicker>;

/** Held, loading, empty or failed, or the days and "Choose this time". */
function PickerBody({ uid, picker, days, words }: { readonly uid: string; readonly picker: Picker; readonly days: readonly SlotDay[] | null; readonly words: SlotPickerCopy }) {
  if (picker.hold !== null) {
    return <HeldPanel hold={picker.hold} busy={picker.busy} onConfirm={picker.confirmTime} onPickAnother={() => picker.setHold(null)} />;
  }
  if (picker.loading) return <Loading />;
  if (days === null || days.length === 0) {
    return <Empty line={days === null ? words.loadFailed : words.noTimes} busy={picker.busy} onRetry={picker.reload} />;
  }
  return (
    <>
      <div className="mt-6 space-y-6">
        {days.map((day) => (
          <DayGroup key={day.londonDate} uid={uid} day={day} selected={picker.choice} gone={picker.gone} disabled={picker.busy} onSelect={picker.setSelected} />
        ))}
      </div>
      <div className="mt-8">
        <Button type="button" onClick={picker.chooseTime} disabled={picker.busy || picker.choice === null} className="bg-violet-600 text-white hover:bg-violet-700">
          {PARENT_COPY.chooseThisTime}
        </Button>
      </div>
    </>
  );
}

export function SlotPicker<T>({ days, actions, onConfirmed, onKeepTime, copy }: SlotPickerProps<T>) {
  const words = { ...DEFAULT_COPY, ...copy };
  const picker = usePicker({ days, actions, onConfirmed });
  const uid = useId();
  const alertRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (picker.message !== null) alertRef.current?.focus();
  }, [picker.message]);

  return (
    <section aria-labelledby={`${uid}-heading`} aria-busy={picker.busy || picker.loading}>
      <h2 id={`${uid}-heading`} className="text-lg font-semibold text-slate-900">
        {words.heading}
      </h2>
      <p className="mt-1 text-sm text-slate-600">{words.hint}</p>
      {picker.message !== null && (
        <p
          ref={alertRef}
          tabIndex={-1}
          role="alert"
          className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        >
          {picker.message}
        </p>
      )}
      <PickerBody uid={uid} picker={picker} days={days} words={words} />
      {onKeepTime && (
        <Button type="button" variant="link" onClick={onKeepTime} className="mt-4 h-auto px-0 text-violet-700">
          {PARENT_COPY.keepTime}
        </Button>
      )}
    </section>
  );
}
