"use client";

/**
 * The Calendar tab of /admin/calls (plan C5, §13; brief §0.12, §3 admin 5; BB-wave1-041126/04c2-build), top to
 * bottom: Start call booking (until pressed, the one thing to do; afterwards just its date), the 7-day grid, the call
 * settings and the blocks side by side on wide screens, then the weekly hours. Everything was read once on the server
 * (`calendarWeek`); each form writes through its own action and refreshes the page. A failed read says so.
 */

import { ADMIN_COPY } from "@/lib/calls/copy";
import type { CalendarView } from "@/lib/calls/calendar";
import { AlertLine } from "../cohorts/parts";
import { BlocksForm } from "./BlocksForm";
import { CallSettingsForm } from "./CallSettingsForm";
import { StartCallBooking } from "./StartCallBooking";
import { WeekGrid } from "./WeekGrid";
import { WeeklyHoursForm } from "./WeeklyHoursForm";

export function CalendarTab({ calendar }: { readonly calendar: CalendarView | null }) {
  if (calendar === null) return <AlertLine>{ADMIN_COPY.calendarFailed}</AlertLine>;
  const today = calendar.days[0]?.londonDate ?? "";
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">{ADMIN_COPY.calendarIntro}</p>
      <StartCallBooking startedOn={calendar.startedOn} />
      <WeekGrid days={calendar.days} />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <CallSettingsForm settings={calendar.settings} />
        <BlocksForm blocks={calendar.blocks} defaultDate={today} />
      </div>
      <WeeklyHoursForm hours={calendar.hours} />
    </div>
  );
}
