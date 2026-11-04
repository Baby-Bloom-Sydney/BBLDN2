/**
 * Shared fixtures for the call picker's tests (04b rework W4). Tue 9 Feb: Morning 09:00 free; Afternoon 14:00 and
 * 14:30 free, 15:00 not free; Midday and Evening empty. Wed 10 Feb: Morning 09:00 free. Thu 11 Feb: one slot, not free
 * (a day with no free slot — greyed, never hidden).
 */
import { vi } from "vitest";
import { groupSlotGridByDay, type SlotDay } from "@/lib/calls/group-slots-by-day";
import type { PickerHold, SlotPickerActions } from "./use-slot-picker";

export const TUE_09 = "2027-02-09T09:00:00.000Z";
export const TUE_14 = "2027-02-09T14:00:00.000Z";
export const TUE_1430 = "2027-02-09T14:30:00.000Z";
export const TUE_15 = "2027-02-09T15:00:00.000Z";
export const WED_09 = "2027-02-10T09:00:00.000Z";
export const THU_10 = "2027-02-11T10:00:00.000Z";

const at = (startsAt: string, free: boolean) => ({ startsAt, endsAt: new Date(Date.parse(startsAt) + 30 * 60 * 1000).toISOString(), free });

export function gridDays(over: Partial<Record<string, boolean>> = {}): readonly SlotDay[] {
  const free = { [TUE_09]: true, [TUE_14]: true, [TUE_1430]: true, [TUE_15]: false, [WED_09]: true, [THU_10]: false, ...over };
  return groupSlotGridByDay({
    dates: ["2027-02-09", "2027-02-10", "2027-02-11"],
    slots: Object.entries(free).map(([startsAt, isFree]) => at(startsAt, isFree === true)),
  });
}

export const DAYS = gridDays();

export const HOLD: PickerHold = { holdId: "h-1", startsAt: TUE_14, line: "We're holding Tuesday 9 February, 14:00 (London time) for you until 10:05." };

export function actionsWith(over: Partial<SlotPickerActions<string>> = {}): SlotPickerActions<string> {
  return {
    hold: vi.fn(async (startsAt: string) => ({ ok: true as const, value: { ...HOLD, holdId: `h-${startsAt}`, startsAt } })),
    confirm: vi.fn(async () => ({ ok: true as const, value: "booked" })),
    reload: vi.fn(async () => {}),
    ...over,
  };
}
