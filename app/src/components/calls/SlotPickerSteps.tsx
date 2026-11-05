"use client";

/**
 * The call picker's three steps, revealed one at a time (04b rework W14; BAI 2026-11-05: "have it as tiles of just
 * the days (with date show up first) > when day is selected, the time of day pops up underneath as just 4 tiles >
 * when selected the timeslots appear underneath to select from … These should also be selectors which can be
 * unselected and make the later selections be hidden again").
 *
 * 1. `DayStep` — the rolling days as tiles ("Thu" over "5 Nov"): four across on a phone, one row from 640px; a short
 *    last row is centred (W15, BAI 2026-11-05: "center the day tiles"), and so is a short last row of times.
 * 2. `BracketStep` — once a day is chosen: Morning / Midday / Afternoon / Evening with their sublabels.
 * 3. `TimeStep` — once a time of day is chosen: "Select a time" and that bracket's call slots.
 *
 * Every step is its own radiogroup in ScheduleTimeGrid's cell styles (`components/position/ScheduleTimeGrid.tsx`): open
 * violet-50, chosen violet-600, closed slate-50 and disabled — greyed, never hidden. Arrow keys move within a step and
 * skip what is closed; they never choose. A step that appears fades and slides in under the last (motion-safe only) and
 * scrolls itself into view. What a tap does (choose, unselect, hold) is the picker's (`use-slot-picker.ts`).
 *
 * BB-wave1-041126/04b-rework, 2026-11-05.
 */

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PARENT_COPY } from "@/lib/calls/copy";
import type { SlotDay, SlotOption } from "@/lib/calls/group-slots-by-day";
import { BRACKET_KEYS, TIME_BRACKETS, type BracketKey } from "@/lib/timezone";
import { isMoveKey, moveInList } from "./picker-keys";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1";
const LOOK = {
  cell: {
    base: "rounded-md border px-1 text-center transition-colors motion-reduce:transition-none",
    chosen: "bg-violet-600 text-white border-violet-600 cursor-pointer",
    open: "bg-violet-50 text-violet-600 border-violet-200 hover:border-violet-400 cursor-pointer",
    closed: "bg-slate-50 text-slate-200 border-slate-100 cursor-not-allowed",
  },
  time: {
    base: "py-2.5 rounded-md border text-sm font-medium transition-colors motion-reduce:transition-none",
    chosen: "bg-violet-600 text-white border-violet-600 cursor-pointer",
    open: "bg-white text-slate-700 border-slate-200 hover:border-violet-400 cursor-pointer",
    closed: "bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed",
  },
} as const;
const LABEL = "text-sm font-medium text-slate-700";
/**
 * Centred rows of fixed-width tiles (W15): each tile is exactly a column's width (a quarter, less the gaps), so full
 * rows line up as the grid did and a short last row sits in the middle rather than at the left.
 */
const CENTRED = "flex flex-wrap justify-center";
const QUARTER_OF_DAYS = "w-[calc((100%-1.5rem)/4)]"; // four across, three gap-2 gaps
const DAYS_FROM_640: Readonly<Record<7 | 8, string>> = {
  7: "sm:w-[calc((100%-3rem)/7)]", // six gaps
  8: "sm:w-[calc((100%-3.5rem)/8)]", // seven gaps: the window's first and last both still have times
};
const QUARTER_OF_TIMES = "w-[calc((100%-1.125rem)/4)]"; // four across, three gap-1.5 gaps

/** Free and not seen taken in this visit. */
export const isOpenSlot = (slot: SlotOption, gone: ReadonlySet<string>): boolean => slot.free && !gone.has(slot.startsAt);

/** Choosable: open, or her own booked time while she changes it (shown as hers). */
const usable = (slot: SlotOption, gone: ReadonlySet<string>, current: string | null): boolean =>
  isOpenSlot(slot, gone) || slot.startsAt === current;

export function slotsIn(day: SlotDay, bracket: BracketKey): readonly SlotOption[] {
  return day.slots.filter((s) => s.bracket === bracket);
}

export const dayIsOpen = (day: SlotDay, gone: ReadonlySet<string>, current: string | null): boolean =>
  day.slots.some((s) => usable(s, gone, current));

const bracketIsOpen = (day: SlotDay, bracket: BracketKey, gone: ReadonlySet<string>, current: string | null): boolean =>
  slotsIn(day, bracket).some((s) => usable(s, gone, current));

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A step that has just appeared: fades and slides in (motion-safe only) and scrolls itself into view. */
export function Reveal({ children }: { readonly children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, []);
  return (
    <div ref={ref} data-reveal className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-300">
      {children}
    </div>
  );
}

export interface Tile {
  readonly key: string;
  readonly content: ReactNode;
  /** Its accessible name, when the visible text isn't enough. */
  readonly name?: string;
  readonly open: boolean;
  readonly chosen: boolean;
  readonly struck?: boolean;
  /** Her own booked time while she changes it: shown chosen though it isn't open to pick. */
  readonly hers?: boolean;
}

interface RadioTilesProps {
  readonly tiles: readonly Tile[];
  readonly look: keyof typeof LOOK;
  readonly gridClass: string;
  readonly tileClass?: string;
  /** Arrow Up/Down move this many tiles (the visual columns); 1 = Up/Down step like Left/Right. */
  readonly columns: number;
  readonly labelledBy: string;
  readonly busy: boolean;
  readonly onPick: (key: string) => void;
}

/** Chosen and still open (or hers) → violet; a chosen tile that has since closed greys out like any closed one. */
function lookOf(tile: Tile, style: (typeof LOOK)[keyof typeof LOOK]): string {
  if (tile.chosen && (tile.open || tile.hers)) return style.chosen;
  return tile.open ? style.open : style.closed;
}

/** One step's radiogroup: one tab stop (the chosen tile while it is open, else the first open one). */
function RadioTiles({ tiles, look, gridClass, tileClass, columns, labelledBy, busy, onPick }: RadioTilesProps) {
  const open = tiles.map((t) => t.open);
  const chosenAt = tiles.findIndex((t) => t.chosen);
  const stop = chosenAt >= 0 && open[chosenAt] ? chosenAt : open.indexOf(true);
  const style = LOOK[look];
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    // Alt/Ctrl/Meta + arrow is the browser's (Alt+Left is Back).
    if (!isMoveKey(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const to = moveInList(event.key, index, open, columns);
    if (to !== null) event.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-tile="${to}"]`)?.focus();
  };
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className={gridClass}>
      {tiles.map((tile, index) => (
        <button
          key={tile.key}
          type="button"
          role="radio"
          aria-checked={tile.chosen}
          aria-disabled={!tile.open}
          aria-label={tile.name}
          data-tile={index}
          tabIndex={index === stop ? 0 : -1}
          disabled={!tile.open || busy}
          onClick={() => onPick(tile.key)}
          onKeyDown={(event) => onKey(event, index)}
          className={cn(style.base, FOCUS, tileClass, lookOf(tile, style), tile.struck && "line-through")}
        >
          {tile.content}
        </button>
      ))}
    </div>
  );
}

interface StepProps {
  readonly uid: string;
  readonly gone: ReadonlySet<string>;
  readonly current: string | null;
  readonly busy: boolean;
}

export function DayStep({ uid, days, chosen, gone, current, busy, onPick }: StepProps & { readonly days: readonly SlotDay[]; readonly chosen: string | null; readonly onPick: (londonDate: string) => void }) {
  const tiles = days.map((day) => ({
    key: day.londonDate,
    open: dayIsOpen(day, gone, current),
    chosen: day.londonDate === chosen,
    content: (
      <>
        <span className="block text-xs font-semibold">{day.rowWeekday}</span>{" "}
        <span className="block text-[11px]">{day.rowDate}</span>
      </>
    ),
  }));
  const wide = DAYS_FROM_640[days.length > 7 ? 8 : 7];
  return <RadioTiles tiles={tiles} look="cell" gridClass={`${CENTRED} gap-2`} tileClass={`h-14 ${QUARTER_OF_DAYS} ${wide}`} columns={1} labelledBy={`${uid}-heading`} busy={busy} onPick={onPick} />;
}

export function BracketStep({ uid, day, chosen, gone, current, busy, onPick }: StepProps & { readonly day: SlotDay; readonly chosen: BracketKey | null; readonly onPick: (bracket: BracketKey) => void }) {
  const tiles = BRACKET_KEYS.map((bracket) => ({
    key: bracket,
    open: bracketIsOpen(day, bracket, gone, current),
    chosen: bracket === chosen,
    content: (
      <>
        <span className="block text-xs font-semibold">{TIME_BRACKETS[bracket].label}</span>{" "}
        <span className="block text-[10px] leading-tight opacity-80">{TIME_BRACKETS[bracket].sublabel}</span>
      </>
    ),
  }));
  return (
    <div className="space-y-2">
      <p id={`${uid}-time-of-day`} className={LABEL}>
        {PARENT_COPY.timeOfDay}
      </p>
      <RadioTiles tiles={tiles} look="cell" gridClass="grid grid-cols-4 gap-2" tileClass="h-14" columns={1} labelledBy={`${uid}-time-of-day`} busy={busy} onPick={(key) => onPick(key as BracketKey)} />
    </div>
  );
}

function timeName(slot: SlotOption, gone: ReadonlySet<string>, current: string | null): string {
  if (gone.has(slot.startsAt)) return `${slot.name} — ${PARENT_COPY.noLongerAvailable}`;
  return slot.startsAt === current ? `${slot.name} — ${PARENT_COPY.yourCurrentTime}` : slot.name;
}

export function TimeStep({ uid, slots, chosen, gone, current, busy, onTap }: StepProps & { readonly slots: readonly SlotOption[]; readonly chosen: string | null; readonly onTap: (startsAt: string) => void }) {
  const tiles = slots.map((slot) => ({
    key: slot.startsAt,
    open: isOpenSlot(slot, gone),
    chosen: slot.startsAt === chosen,
    struck: gone.has(slot.startsAt),
    hers: slot.startsAt === current,
    name: timeName(slot, gone, current),
    content: <time dateTime={slot.startsAt}>{slot.time}</time>,
  }));
  return (
    <div className="space-y-2">
      <p id={`${uid}-select-time`} className={LABEL}>
        {PARENT_COPY.selectTime}
      </p>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <RadioTiles tiles={tiles} look="time" gridClass={`${CENTRED} gap-1.5`} tileClass={QUARTER_OF_TIMES} columns={4} labelledBy={`${uid}-select-time`} busy={busy} onPick={onTap} />
      </div>
    </div>
  );
}
