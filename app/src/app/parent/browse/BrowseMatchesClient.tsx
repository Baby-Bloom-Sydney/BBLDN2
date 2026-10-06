"use client";

import { useState } from "react";
import { NannyMatchCardBK } from "@/app/brandkit1/NannyMatchCardBK";
import { Sparkles, MapPin, Clock, GraduationCap } from "lucide-react";
import type { MatchResult } from "@/lib/matching/types";
import type { LucideIcon } from "lucide-react";
import { qualificationRank } from "@/lib/nanny-options";

type SortKey = "score" | "distance" | "experience" | "qualification";

const SORT_OPTIONS: { key: SortKey; label: string; icon: LucideIcon }[] = [
  { key: "score", label: "Best Match", icon: Sparkles },
  { key: "distance", label: "Distance", icon: MapPin },
  { key: "experience", label: "Experience", icon: Clock },
  { key: "qualification", label: "Qualifications", icon: GraduationCap },
];

function sortMatches(matches: MatchResult[], sortBy: SortKey): MatchResult[] {
  const sorted = [...matches];
  switch (sortBy) {
    case "score":
      return sorted.sort((a, b) => b.finalScore - a.finalScore);
    case "distance":
      return sorted.sort((a, b) => {
        const da = a.distanceKm ?? 999;
        const db = b.distanceKm ?? 999;
        return da - db;
      });
    case "experience":
      return sorted.sort((a, b) => {
        const ea =
          b.nanny.nanny_experience_years ??
          b.nanny.total_experience_years ??
          0;
        const eb =
          a.nanny.nanny_experience_years ??
          a.nanny.total_experience_years ??
          0;
        return ea - eb;
      });
    case "qualification":
      return sorted.sort((a, b) => {
        const qa = qualificationRank(a.highestQualification);
        const qb = qualificationRank(b.highestQualification);
        return qb - qa;
      });
    default:
      return sorted;
  }
}

interface BrowseMatchesClientProps {
  matches: MatchResult[];
  stats: { totalEligible: number; returned: number };
  children?: React.ReactNode;
}

export function BrowseMatchesClient({ matches, stats, children }: BrowseMatchesClientProps) {
  const [sortBy, setSortBy] = useState<SortKey>("score");
  const sorted = sortMatches(matches, sortBy);

  return (
    <div className="space-y-4">
      {/* Controls row — view toggle (children) + sort toggle */}
      <div className="flex items-center justify-between">
        {children ?? <div />}
        <div className="inline-flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
          {SORT_OPTIONS.map((option) => {
            const isActive = option.key === sortBy;
            const Icon = option.icon;
            return (
              <button
                key={option.key}
                onClick={() => setSortBy(option.key)}
                title={option.label}
                className={`rounded-md px-2 sm:px-3 py-1.5 text-xs font-medium transition-all flex items-center gap-1 ${
                  isActive
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-400 hover:text-slate-600"
                }`}
              >
                <Icon className="w-3.5 h-3.5 sm:hidden" />
                <span className="hidden sm:inline">{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Match list */}
      <div className="space-y-3">
        {sorted.map((match) => (
          <NannyMatchCardBK key={match.nannyId} match={match} />
        ))}
      </div>

      {/* Stats */}
      <p className="text-sm text-slate-400 text-center">
        {stats.returned} match{stats.returned !== 1 ? "es" : ""} found
        {stats.totalEligible > stats.returned &&
          ` out of ${stats.totalEligible} verified nannies`}
      </p>
    </div>
  );
}
