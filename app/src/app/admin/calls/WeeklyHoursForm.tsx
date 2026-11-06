"use client";

/**
 * Weekly hours on the Calendar tab (plan C5; brief §3 admin 5, §9.12; BB-wave1-041126/04c2-build): every weekday,
 * Monday first, with several ranges allowed — native time inputs on the London clock (the server reads them as
 * London). Add and remove ranges here; Save sends the whole week at once (`replaceWeeklyHours`, one atomic replace).
 * Overlapping ranges are refused by the server in their own words; touching ranges (09:00–12:00, 12:00–14:00) are
 * fine. Removing every range is allowed: no calls that week. Parents' pickers show the change the next time they load.
 */

import { useId, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { HoursRow } from "@/lib/calls/calendar";
import { ADMIN_COPY } from "@/lib/calls/copy";
import { ISO_WEEKDAYS, weekdayName, type IsoWeekday } from "@/lib/calls/weekday";
import { ACTION_BUTTON, AlertLine, QUIET_BUTTON } from "../cohorts/parts";
import { saveWeeklyHoursAction } from "./actions";
import { useCalendarSave } from "./use-calendar-save";

interface Range {
  readonly key: number;
  readonly weekday: IsoWeekday;
  readonly start: string;
  readonly end: string;
}

const FIRST_RANGE = Object.freeze({ start: "09:00", end: "17:00" });
const TIME = "w-[7.5rem]";

interface DayProps {
  readonly weekday: IsoWeekday;
  readonly ranges: readonly Range[];
  readonly disabled: boolean;
  readonly onChange: (key: number, field: "start" | "end", value: string) => void;
  readonly onRemove: (key: number) => void;
  readonly onAdd: (weekday: IsoWeekday) => void;
}

function DayRanges({ weekday, ranges, disabled, onChange, onRemove, onAdd }: DayProps) {
  const day = weekdayName(weekday);
  return (
    <fieldset className="space-y-2 border-t border-slate-100 py-3 first:border-t-0">
      <legend className="text-sm font-semibold text-slate-900">{day}</legend>
      {ranges.length === 0 && <p className="text-xs text-slate-500">{ADMIN_COPY.noHours}</p>}
      {ranges.map((range, i) => (
        <div key={range.key} className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <span aria-hidden="true">{ADMIN_COPY.fromLabel}</span>
          <Input type="time" step={60} className={TIME} aria-label={`${day} ${i + 1} from`} value={range.start} disabled={disabled} onChange={(e) => onChange(range.key, "start", e.target.value)} />
          <span aria-hidden="true">{ADMIN_COPY.toLabel}</span>
          <Input type="time" step={60} className={TIME} aria-label={`${day} ${i + 1} to`} value={range.end} disabled={disabled} onChange={(e) => onChange(range.key, "end", e.target.value)} />
          <button type="button" className={QUIET_BUTTON} aria-label={`${ADMIN_COPY.removeHours} ${day} ${i + 1}`} disabled={disabled} onClick={() => onRemove(range.key)}>
            {ADMIN_COPY.removeHours}
          </button>
        </div>
      ))}
      <button type="button" className={QUIET_BUTTON} aria-label={`${ADMIN_COPY.addHours} on ${day}`} disabled={disabled} onClick={() => onAdd(weekday)}>
        {ADMIN_COPY.addHours}
      </button>
    </fieldset>
  );
}

/** The form's ranges: immutable updates; a new range starts where the day's last one ends. */
function useRanges(hours: readonly HoursRow[]) {
  const next = useRef(hours.length);
  const [ranges, setRanges] = useState<readonly Range[]>(() => hours.map((h, i) => ({ key: i, weekday: h.weekday, start: h.start, end: h.end })));
  const change = (key: number, field: "start" | "end", value: string) => setRanges((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  const remove = (key: number) => setRanges((prev) => prev.filter((r) => r.key !== key));
  const add = (weekday: IsoWeekday) => {
    next.current += 1;
    const key = next.current;
    setRanges((prev) => {
      const last = prev.filter((r) => r.weekday === weekday).at(-1);
      return [...prev, { key, weekday, ...(last ? { start: last.end, end: "" } : FIRST_RANGE) }];
    });
  };
  /** The whole week, Monday first, each day's ranges in the order they were made. */
  const week = () => [...ranges].sort((a, b) => a.weekday - b.weekday).map(({ weekday, start, end }) => ({ weekday, start, end }));
  return { ranges, change, remove, add, week };
}

export function WeeklyHoursForm({ hours }: { readonly hours: readonly HoursRow[] }) {
  const id = useId();
  const save = useCalendarSave(ADMIN_COPY.hoursInvalid);
  const form = useRanges(hours);
  return (
    <section aria-labelledby={id}>
      <Card>
        <CardContent className="space-y-3 p-4 sm:p-5">
          <h2 id={id} className="text-base font-semibold text-slate-900">
            {ADMIN_COPY.hoursHeading}
          </h2>
          <p className="text-xs text-slate-500">{ADMIN_COPY.hoursHint}</p>
          <div className="grid gap-x-6 md:grid-cols-2">
            {ISO_WEEKDAYS.map((weekday) => (
              <DayRanges
                key={weekday}
                weekday={weekday}
                ranges={form.ranges.filter((r) => r.weekday === weekday)}
                disabled={save.saving}
                onChange={form.change}
                onRemove={form.remove}
                onAdd={form.add}
              />
            ))}
          </div>
          <button type="button" className={ACTION_BUTTON} disabled={save.saving} onClick={() => void save.run(() => saveWeeklyHoursAction(form.week()))}>
            {save.saving ? ADMIN_COPY.saving : ADMIN_COPY.saveHours}
          </button>
          {save.error && <AlertLine>{save.error}</AlertLine>}
          <p role="status" className="text-sm text-slate-600">
            {save.status}
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
