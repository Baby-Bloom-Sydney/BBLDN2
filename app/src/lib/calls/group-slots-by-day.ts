/**
 * Call slots grouped by London day, for the picker (plan A4; port of LDN1 `group-slots-by-day.ts` on 24-hour words).
 * Each day's `legend` is its full date; each option's `name` is its accessible name, full date + time + "(London
 * time)" (brief §2 picker semantics). Pure.
 *
 * 04b rework W4 adds what the meet-and-greet-style grid draws: a day's row label ("Tue" over "9 Feb"), each slot's
 * time-of-day column (`bracket`), its panel line ("Tuesday 9 February at 14:00") and whether it is `free`.
 * `groupSlotGridByDay` takes the whole grid: every date in the window is a row, a day with no free slot (or no slots at
 * all) included, and every slot keeps its free flag — greyed, never hidden (BAI 2026-11-05). (04a's free-only
 * `groupSlotsByDay` had no caller left and is gone, TS review.)
 *
 * BB-wave1-041126/04a-core, 2026-11-04; BB-wave1-041126/04b-rework, 2026-11-05.
 */

import type { BracketKey } from "@/lib/timezone";
import { callBracketOf } from "./call-bracket";
import { slotAtLine } from "./copy";
import type { GridSlot, SlotGrid } from "./slot-grid";
import { dayWords, slotHour, slotWords } from "./slot-words";
import type { Slot } from "./types";

export interface SlotOption extends Slot {
  /** "14:00" */
  readonly time: string;
  /** "Tuesday 9 February, 14:00" — its accessible name (W14: parents aren't told "London time"; it is a given). */
  readonly name: string;
  /** "Tuesday 9 February at 14:00" — the picker's green panel. */
  readonly when: string;
  /** Its time-of-day column (outside 08:00–20:00 folds into the first or last). */
  readonly bracket: BracketKey;
  /** False = greyed and not selectable (taken, blocked, past, inside the notice, held). */
  readonly free: boolean;
}

export interface SlotDay {
  readonly londonDate: string;
  /** "Tuesday 9 February" */
  readonly legend: string;
  /** The row label: "Tue" … */
  readonly rowWeekday: string;
  /** … over "9 Feb". */
  readonly rowDate: string;
  readonly slots: readonly SlotOption[];
}

function optionOf(slot: GridSlot): SlotOption {
  const words = slotWords(slot.startsAt);
  return Object.freeze({
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    time: words.time,
    name: `${words.day}, ${words.time}`,
    when: slotAtLine(words),
    bracket: callBracketOf(slotHour(slot.startsAt)),
    free: slot.free,
  });
}

function dayOf(londonDate: string, slots: readonly SlotOption[]): SlotDay {
  const words = dayWords(londonDate);
  return Object.freeze({ londonDate, legend: words.legend, rowWeekday: words.weekday, rowDate: words.date, slots: Object.freeze([...slots]) });
}

/** The whole grid by day: one row per date in `grid.dates`, every slot on it in time order. */
export function groupSlotGridByDay(grid: SlotGrid): readonly SlotDay[] {
  const sorted = [...grid.slots].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const options = sorted.map((slot) => ({ date: slotWords(slot.startsAt).londonDate, option: optionOf(slot) }));
  return Object.freeze(grid.dates.map((date) => dayOf(date, options.filter((o) => o.date === date).map((o) => o.option))));
}
