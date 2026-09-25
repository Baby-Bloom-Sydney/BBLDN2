"use client";

import Link from "next/link";
import {
  MapPin,
  Clock,
  PoundSterling,
  Baby,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface OpenPosition {
  id: string;
  suburb: string | null;
  schedule_type: string | null;
  hourly_rate: number | null;
  hours_per_week: number | null;
  source: string | null;
  created_at: string;
  children: Array<{ age_months: number; gender: string | null }>;
  weekly_roster: string[];
  roster_by_day: Record<string, string[]>;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const BRACKET_KEYS = ["morning", "midday", "afternoon", "evening"] as const;

const BRACKET_LABEL: Record<string, string> = {
  morning: "Morning",
  midday: "Midday",
  afternoon: "Afternoon",
  evening: "Evening",
};

const DAY_OPTIONS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const DAY_SHORT: Record<string, string> = {
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
  Sunday: "Sun",
};

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function formatAge(ageMonths: number): string {
  if (ageMonths < 12) return `${ageMonths}mo`;
  const years = Math.floor(ageMonths / 12);
  const rem = ageMonths % 12;
  return rem > 0 ? `${years}y ${rem}mo` : `${years}y`;
}

function ageGenderLabel(c: {
  age_months: number;
  gender: string | null;
}): string {
  const g = c.gender?.toLowerCase();
  const label =
    g === "male" || g === "boy"
      ? "Boy"
      : g === "female" || g === "girl"
        ? "Girl"
        : "Child";
  return `${label} (${formatAge(c.age_months)})`;
}

// ═══════════════════════════════════════════════════════════════
// SCHEDULE GRID
// ═══════════════════════════════════════════════════════════════

function ScheduleGrid({
  weeklyRoster,
  rosterByDay,
}: {
  weeklyRoster: string[];
  rosterByDay: Record<string, string[]>;
}) {
  if (weeklyRoster.length === 0) return null;
  const sortedDays = DAY_OPTIONS.filter((d) => weeklyRoster.includes(d));
  if (sortedDays.length === 0) return null;

  return (
    <div className="rounded-lg bg-violet-50 border border-violet-200 p-2.5">
      <div className="grid grid-cols-5 gap-x-1 gap-y-0.5 text-[10px]">
        <div />
        {BRACKET_KEYS.map((b) => (
          <div key={b} className="text-center text-violet-500 font-medium">
            {BRACKET_LABEL[b]}
          </div>
        ))}
        {sortedDays.map((day) => {
          const dayTimes = rosterByDay[day] ?? [];
          return (
            <div key={day} className="contents">
              <div className="text-violet-700 font-medium truncate pr-1 text-[11px]">
                {DAY_SHORT[day]}
              </div>
              {BRACKET_KEYS.map((b) => (
                <div key={b} className="flex items-center justify-center py-0.5">
                  <div
                    className={`h-2.5 w-2.5 rounded-full ${
                      dayTimes.includes(b) ? "bg-violet-400" : "bg-violet-200"
                    }`}
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// POSITION TILE
// ═══════════════════════════════════════════════════════════════

function PositionTile({ position, applied }: { position: OpenPosition; applied?: boolean }) {
  return (
    <Link
      href={`/position/${position.id}`}
      className="block rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden hover:border-violet-200 hover:shadow-md transition-all"
    >
      <div className="px-4 pt-3 pb-2 space-y-1.5">
        {/* Location + posted date / Applied tag */}
        <div className="flex items-start justify-between">
          {position.suburb && (
            <div className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 text-violet-500 flex-shrink-0" />
              <p className="text-sm font-medium text-slate-800">
                {position.suburb}
              </p>
            </div>
          )}
          {applied ? (
            <span className="shrink-0 ml-2 inline-flex items-center gap-1 rounded-full bg-green-50 border border-green-200 px-2 py-0.5 text-[11px] font-semibold text-green-700">
              Applied
            </span>
          ) : (
            <p className="text-[11px] text-slate-400 shrink-0 ml-2">
              {(() => {
                const days = Math.floor(
                  (Date.now() - new Date(position.created_at).getTime()) / 86400000
                );
                if (days === 0) return "Today";
                if (days === 1) return "1 day ago";
                return `${days} days ago`;
              })()}
            </p>
          )}
        </div>

        {/* Children */}
        {position.children.length > 0 && (
          <div className="flex items-center gap-2">
            <Baby className="h-3.5 w-3.5 text-violet-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-slate-800">
                {position.children.length}{" "}
                {position.children.length === 1 ? "child" : "children"}
              </p>
              <p className="text-[11px] text-slate-400">
                {position.children.map((c) => ageGenderLabel(c)).join(", ")}
              </p>
            </div>
          </div>
        )}

        {/* Hours */}
        {position.hours_per_week && (
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-violet-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-slate-800">
                {position.hours_per_week} hrs/wk
              </p>
              <p className="text-[11px] text-slate-400">
                {position.schedule_type === "Fixed" ||
                position.schedule_type === "Yes"
                  ? "Fixed schedule"
                  : "Flexible schedule"}
              </p>
            </div>
          </div>
        )}

        {/* Rate — hidden for AI/admin positions */}
        {position.hourly_rate &&
          (!position.source || position.source === "parent") && (
            <div className="flex items-center gap-2">
              <PoundSterling className="h-3.5 w-3.5 text-violet-500 flex-shrink-0" />
              <p className="text-sm font-medium text-slate-800">
                £{position.hourly_rate}/hr
              </p>
            </div>
          )}
      </div>

      {/* Schedule grid */}
      {position.weekly_roster.length > 0 &&
        Object.keys(position.roster_by_day).length > 0 && (
          <div className="px-4 pb-3">
            <ScheduleGrid
              weeklyRoster={position.weekly_roster}
              rosterByDay={position.roster_by_day}
            />
          </div>
        )}
    </Link>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN EXPORT
// ═══════════════════════════════════════════════════════════════

export function NannyJobsView({
  positions,
  appliedPositionIds,
}: {
  positions: OpenPosition[];
  appliedPositionIds?: Set<string>;
}) {
  if (positions.length === 0) {
    return (
      <div className="text-center py-4">
        <p className="text-sm text-slate-400">No open positions right now</p>
        <p className="text-xs text-slate-400 mt-1">
          New positions are added regularly. Check back soon!
        </p>
      </div>
    );
  }

  const appliedSet = appliedPositionIds ?? new Set<string>();

  return (
    <div className="space-y-3">
      {positions.map((p) => (
        <PositionTile key={p.id} position={p} applied={appliedSet.has(p.id)} />
      ))}
    </div>
  );
}
