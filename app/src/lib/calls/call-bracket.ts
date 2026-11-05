/**
 * The time-of-day column a call slot sits in (04b rework W4), on the meet-and-greet picker's four `TIME_BRACKETS`
 * through the existing `getBracketForHour` (`lib/timezone.ts`). Call hours are BAI's to set and can run outside
 * 08:00–20:00: a slot before 08:00 folds into Morning and one from 20:00 into Evening, so no free time is dropped.
 * Takes the London hour (the caller reads it off the London clock). Pure.
 *
 * BB-wave1-041126/04b-rework, 2026-11-05.
 */

import { getBracketForHour, TIME_BRACKETS, type BracketKey } from "@/lib/timezone";

export function callBracketOf(londonHour: number): BracketKey {
  return getBracketForHour(londonHour) ?? (londonHour < TIME_BRACKETS.morning.startHour ? "morning" : "evening");
}
