/**
 * Free slots grouped by London day, in order, for the picker (plan A4; port of LDN1 `group-slots-by-day.ts`
 * on 24-hour words). Each day's `legend` is its full date; each option's `name` is its accessible name, full date
 * + time + "(London time)" (brief §2 picker semantics). A day with no free slot is simply absent. Pure.
 *
 * BB-wave1-041126/04a-core, 2026-11-04.
 */

import { slotWords } from "./slot-words";
import type { Slot } from "./types";

export interface SlotOption extends Slot {
  /** "14:00" */
  readonly time: string;
  /** "Tuesday 9 February, 14:00 (London time)" */
  readonly name: string;
}

export interface SlotDay {
  readonly londonDate: string;
  /** "Tuesday 9 February" */
  readonly legend: string;
  readonly slots: readonly SlotOption[];
}

export function groupSlotsByDay(slots: readonly Slot[]): readonly SlotDay[] {
  const sorted = [...slots].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const days = sorted.reduce<readonly SlotDay[]>((acc, slot) => {
    const words = slotWords(slot.startsAt);
    const option: SlotOption = Object.freeze({ ...slot, time: words.time, name: words.full });
    const last = acc.at(-1);
    if (last !== undefined && last.londonDate === words.londonDate) {
      return [...acc.slice(0, -1), { ...last, slots: [...last.slots, option] }];
    }
    return [...acc, { londonDate: words.londonDate, legend: words.day, slots: [option] }];
  }, []);
  return Object.freeze(days.map((day) => Object.freeze({ ...day, slots: Object.freeze([...day.slots]) })));
}
