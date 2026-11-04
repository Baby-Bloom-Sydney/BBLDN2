"use client";

/**
 * The call picker's two grids, drawn as the meet-and-greet picker draws them (`components/position/ScheduleTimeGrid.tsx`,
 * `/ui` CMP-033; 04b rework W4, BAI 2026-11-05) — same classes, its own rolling dates:
 *
 * - `AvailabilityGrid`: dates as rows ("Tue" over "9 Feb") × the four `TIME_BRACKETS` as columns. A cell is open when
 *   that day has a free slot in the bracket. A closed cell, and a day with no free slot at all, is greyed and disabled
 *   — shown, never hidden (BAI 2026-11-05). Each day row is a radiogroup.
 * - `TimeBox`: "Select a time", then every call slot in the chosen cell — free ones selectable, the rest greyed,
 *   disabled and `aria-disabled`. One radiogroup.
 *
 * Arrow keys move focus between open cells or times only (`picker-keys.ts`); choosing is a tap, Space or Enter.
 *
 * BB-wave1-041126/04b-rework, 2026-11-05.
 */

import type { KeyboardEvent, RefObject } from "react";
import { cn } from "@/lib/utils";
import { LONDON_TIME_SUFFIX, PARENT_COPY } from "@/lib/calls/copy";
import type { SlotDay, SlotOption } from "@/lib/calls/group-slots-by-day";
import { BRACKET_KEYS, TIME_BRACKETS, type BracketKey } from "@/lib/timezone";
import { isMoveKey, moveInGrid, moveInList } from "./picker-keys";
import type { PickerCell } from "./use-slot-picker";

const ROW = "grid grid-cols-[90px_repeat(4,1fr)] gap-1 mb-1";
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1";
const CELL = `h-10 rounded-md border text-xs font-medium transition-colors motion-reduce:transition-none ${FOCUS}`;
const CELL_SELECTED = "bg-violet-600 text-white border-violet-600 cursor-pointer";
const CELL_OPEN = "bg-violet-50 text-violet-600 border-violet-200 hover:border-violet-400 cursor-pointer";
const CELL_CLOSED = "bg-slate-50 text-slate-200 border-slate-100 cursor-not-allowed";
const TIME = `py-2.5 rounded-md border text-sm font-medium transition-colors motion-reduce:transition-none ${FOCUS}`;
const TIME_SELECTED = "bg-violet-600 text-white border-violet-600 cursor-pointer";
const TIME_OPEN = "bg-white text-slate-700 border-slate-200 hover:border-violet-400 cursor-pointer";
const TIME_CLOSED = "bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed";

/** Free and not seen taken in this visit. */
export const isOpenSlot = (slot: SlotOption, gone: ReadonlySet<string>): boolean => slot.free && !gone.has(slot.startsAt);

export function slotsIn(day: SlotDay, bracket: BracketKey): readonly SlotOption[] {
  return day.slots.filter((s) => s.bracket === bracket);
}

/** The open matrix: a cell is open when it has an open slot, or holds her current booking (shown chosen). */
export function openCells(days: readonly SlotDay[], gone: ReadonlySet<string>, current: string | null): boolean[][] {
  return days.map((day) =>
    BRACKET_KEYS.map((b) => slotsIn(day, b).some((s) => isOpenSlot(s, gone) || s.startsAt === current)),
  );
}

function focusWithin(root: RefObject<HTMLElement>, selector: string) {
  root.current?.querySelector<HTMLElement>(selector)?.focus();
}

export interface AvailabilityGridProps {
  readonly days: readonly SlotDay[];
  readonly cell: PickerCell | null;
  readonly gone: ReadonlySet<string>;
  readonly current: string | null;
  readonly busy: boolean;
  readonly onPick: (cell: PickerCell) => void;
  readonly gridRef: RefObject<HTMLDivElement>;
}

function BracketHeads() {
  return (
    <div className={ROW} aria-hidden="true">
      <div />
      {BRACKET_KEYS.map((b) => (
        <div key={b} className="text-center">
          <p className="text-xs font-semibold text-slate-600">{TIME_BRACKETS[b].label}</p>
          <p className="text-[10px] text-slate-400">{TIME_BRACKETS[b].sublabel}</p>
        </div>
      ))}
    </div>
  );
}

function DayLabel({ day, open }: { readonly day: SlotDay; readonly open: boolean }) {
  return (
    <div className="flex items-center" aria-hidden="true">
      <div>
        <p className={cn("text-xs font-semibold", open ? "text-slate-600" : "text-slate-300")}>{day.rowWeekday}</p>
        <p className={cn("text-[10px]", open ? "text-slate-400" : "text-slate-300")}>{day.rowDate}</p>
      </div>
    </div>
  );
}

export function AvailabilityGrid({ days, cell, gone, current, busy, onPick, gridRef }: AvailabilityGridProps) {
  const open = openCells(days, gone, current);
  const onKey = (event: KeyboardEvent, row: number, col: number) => {
    if (!isMoveKey(event.key)) return;
    event.preventDefault();
    const to = moveInGrid(event.key, { row, col }, open);
    if (to !== null) focusWithin(gridRef, `[data-cell="${to.row}-${to.col}"]`);
  };
  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <div ref={gridRef} className="min-w-[340px]">
        <BracketHeads />
        {days.map((day, row) => {
          const chosenCol = cell?.londonDate === day.londonDate ? BRACKET_KEYS.indexOf(cell.bracket) : -1;
          const stop = chosenCol >= 0 ? chosenCol : open[row].indexOf(true);
          return (
            <div key={day.londonDate} role="radiogroup" aria-label={day.legend} className={ROW}>
              <DayLabel day={day} open={open[row].includes(true)} />
              {BRACKET_KEYS.map((bracket, col) => {
                const chosen = col === chosenCol;
                const isOpen = open[row][col];
                return (
                  <button
                    key={bracket}
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    aria-label={`${day.legend}, ${TIME_BRACKETS[bracket].label} ${LONDON_TIME_SUFFIX}`}
                    data-cell={`${row}-${col}`}
                    tabIndex={col === stop ? 0 : -1}
                    disabled={!isOpen || busy}
                    onClick={() => onPick({ londonDate: day.londonDate, bracket })}
                    onKeyDown={(event) => onKey(event, row, col)}
                    className={cn(CELL, chosen ? CELL_SELECTED : isOpen ? CELL_OPEN : CELL_CLOSED)}
                  >
                    {chosen ? "✓" : ""}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface TimeBoxProps {
  readonly uid: string;
  readonly slots: readonly SlotOption[];
  /** The chosen time (held, or picked), or her current booking while she changes it. */
  readonly chosen: string | null;
  readonly gone: ReadonlySet<string>;
  readonly busy: boolean;
  readonly onTap: (startsAt: string) => void;
}

export function TimeBox({ uid, slots, chosen, gone, busy, onTap }: TimeBoxProps) {
  const open = slots.map((s) => isOpenSlot(s, gone));
  const chosenAt = slots.findIndex((s) => s.startsAt === chosen);
  const stop = chosenAt >= 0 && open[chosenAt] ? chosenAt : open.indexOf(true);
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!isMoveKey(event.key)) return;
    event.preventDefault();
    const to = moveInList(event.key, index, open, 4);
    if (to !== null) event.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-time="${to}"]`)?.focus();
  };
  return (
    <div className="space-y-2">
      <p id={`${uid}-select-time`} className="text-sm font-medium text-slate-700">
        {PARENT_COPY.selectTime}
      </p>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div role="radiogroup" aria-labelledby={`${uid}-select-time`} className="grid grid-cols-4 gap-1.5">
          {slots.map((slot, index) => {
            const isChosen = index === chosenAt;
            const isGone = gone.has(slot.startsAt);
            return (
              <button
                key={slot.startsAt}
                type="button"
                role="radio"
                aria-checked={isChosen}
                aria-disabled={!open[index]}
                aria-label={isGone ? `${slot.name} — ${PARENT_COPY.noLongerAvailable}` : slot.name}
                data-time={index}
                tabIndex={index === stop ? 0 : -1}
                disabled={!open[index] || busy}
                onClick={() => onTap(slot.startsAt)}
                onKeyDown={(event) => onKey(event, index)}
                className={cn(TIME, isChosen ? TIME_SELECTED : open[index] ? TIME_OPEN : TIME_CLOSED, isGone && "line-through")}
              >
                <time dateTime={slot.startsAt}>{slot.time}</time>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
