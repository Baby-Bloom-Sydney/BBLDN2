/**
 * The Calendar tab's 7-day grid (plan C5; brief §3 admin 5, §9.12; BB-wave1-041126/04c2-build): one card per London
 * day, today first; each time free, booked (with the family's name), held or blocked (with the reason), said in words
 * as well as colour; a booked call inside a block keeps its time and is tagged "Blocked over — move or cancel". The
 * cells are `calendar.ts`'s, read once on the server; labels are London (admin keeps "(London time)").
 *
 * Violet / slate / green (brief §7): free green, booked violet, held violet outline, blocked slate.
 */

import { useId } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { CalendarCell, CalendarCellKind, CalendarDay } from "@/lib/calls/calendar";
import { ADMIN_COPY, weekGridHeading } from "@/lib/calls/copy";
import { TagBadges } from "./CallRowParts";

const KIND_LOOK: Readonly<Record<CalendarCellKind, string>> = Object.freeze({
  free: "border-emerald-200 bg-emerald-50 text-emerald-900",
  booked: "border-violet-300 bg-violet-100 text-violet-900",
  held: "border-dashed border-violet-400 bg-white text-violet-800",
  blocked: "border-slate-200 bg-slate-100 text-slate-600",
});

const KIND_WORD: Readonly<Record<CalendarCellKind, string>> = Object.freeze({
  free: ADMIN_COPY.cellFree,
  booked: ADMIN_COPY.cellBooked,
  held: ADMIN_COPY.cellHeld,
  blocked: ADMIN_COPY.cellBlocked,
});

const KEY_ORDER: readonly CalendarCellKind[] = ["free", "booked", "held", "blocked"];

function cellLabel(cell: CalendarCell): string {
  if (cell.kind === "booked" && cell.name) return `${KIND_WORD.booked} · ${cell.name}`;
  if (cell.kind === "blocked" && cell.blockReason) return `${KIND_WORD.blocked} · ${cell.blockReason}`;
  return KIND_WORD[cell.kind];
}

function Cell({ cell }: { readonly cell: CalendarCell }) {
  return (
    <li data-kind={cell.kind} className={`rounded-md border px-2 py-1.5 text-xs ${KIND_LOOK[cell.kind]}`}>
      <time dateTime={cell.startsAt} className="block font-semibold tabular-nums">
        {cell.time}
      </time>
      <span className="block break-words">{cellLabel(cell)}</span>
      {cell.blockedOver && <TagBadges tags={["blocked_over"]} />}
    </li>
  );
}

function Day({ day }: { readonly day: CalendarDay }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
      <h3 id={id} className="text-sm font-semibold text-slate-900">
        {day.heading}
      </h3>
      {day.cells.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">{ADMIN_COPY.noTimesDay}</p>
      ) : (
        <ul className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-1">
          {day.cells.map((cell) => (
            <Cell key={cell.key} cell={cell} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Key() {
  return (
    <ul aria-label="Key" className="flex flex-wrap gap-2 text-xs text-slate-600">
      {KEY_ORDER.map((kind) => (
        <li key={kind} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={`inline-block h-3 w-3 rounded-sm border ${KIND_LOOK[kind]}`} />
          {KIND_WORD[kind]}
        </li>
      ))}
    </ul>
  );
}

export function WeekGrid({ days }: { readonly days: readonly CalendarDay[] }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <Card>
        <CardContent className="space-y-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id={id} className="text-base font-semibold text-slate-900">
              {weekGridHeading(days.length)}
            </h2>
            <Key />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            {days.map((day) => (
              <Day key={day.londonDate} day={day} />
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
