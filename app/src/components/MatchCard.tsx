"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  MapPin,
  ArrowRight,
  ChevronRight,
  ChevronLeft,
  ShieldCheck,
} from "lucide-react";
import type { MatchResult } from "@/lib/matching/types";
import { useState } from "react";
import {
  ScoreBar,
  getScoreBadgeStyle,
  calcAge,
  AvailabilityTable,
  getTranslateClass,
} from "./match/match-helpers";
import type { View } from "./match/match-helpers";

interface MatchCardProps {
  match: MatchResult;
  actions?: React.ReactNode;
}

export function MatchCard({ match, actions }: MatchCardProps) {
  const [view, setView] = useState<View>("overview");
  const { nanny, profile, breakdown } = match;

  const initials = `${profile.first_name[0]}${profile.last_name[0]}`;
  const aiContent = nanny.ai_content as Record<string, unknown> | null;
  const headline = (aiContent?.headline as string) || null;
  const nannyAge = calcAge(profile.date_of_birth);

  const hasBonusOrUnmet =
    match.overQualifiedBonuses.length > 0 || match.unmetRequirements.length > 0;

  return (
    <Card className="group hover:shadow-lg transition-all hover:border-violet-200 overflow-hidden flex flex-col">
      {/* Profile header — pic + info + badge all on same row */}
      <div className="px-5 pt-4 pb-0">
        <div className="flex items-start gap-4">
          {/* Circular profile pic — 112px */}
          <div className="shrink-0">
            {profile.profile_picture_url ? (
              <img
                src={profile.profile_picture_url}
                alt={profile.first_name}
                className="w-28 h-28 rounded-full object-cover"
              />
            ) : (
              <div className="w-28 h-28 rounded-full bg-violet-100 flex items-center justify-center">
                <span className="text-3xl font-semibold text-violet-500">
                  {initials}
                </span>
              </div>
            )}
          </div>

          {/* Badge + name/location/verified stacked */}
          <div className="flex-1 min-w-0">
            <div className="flex justify-end">
              <div
                className={`rounded-lg border px-2.5 py-1 font-semibold text-sm ${getScoreBadgeStyle(
                  match.finalScore
                )}`}
              >
                {match.finalScore}% Match
              </div>
            </div>
            <div className="flex items-baseline gap-2 mt-1.5">
              <h3 className="font-bold text-xl text-slate-900 truncate group-hover:text-violet-600 transition-colors">
                {profile.first_name}
              </h3>
              {nannyAge && (
                <span className="text-base text-slate-400 shrink-0">{nannyAge}</span>
              )}
              {nanny.hourly_rate_min != null && (
                <span className="text-sm text-slate-400 shrink-0 ml-auto">
                  £{nanny.hourly_rate_min}/hr
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-sm text-slate-400 mt-0.5">
              {profile.suburb && (
                <span className="flex items-center gap-1 truncate">
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  {profile.suburb}
                </span>
              )}
              {match.distanceKm != null && (
                <span className="shrink-0">
                  {match.distanceKm < 1 ? "<1 km" : `${match.distanceKm} km`}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 text-green-600 text-xs font-medium mt-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              Verified
            </div>
          </div>
        </div>
      </div>

      {/* Sliding content area — 3 panels */}
      <div className="relative overflow-hidden h-[280px] sm:h-[250px]">
        {/* Availability view (left) */}
        <div
          className={`absolute inset-0 px-5 pt-4 pb-3 flex flex-col transition-transform duration-300 ease-in-out ${getTranslateClass("availability", view)}`}
        >
          <AvailabilityTable schedule={match.nannySchedule} />

          <div className="mt-auto pt-2">
            <div className="flex justify-end">
              <button
                onClick={() => setView("overview")}
                className="inline-flex items-center gap-0.5 text-sm text-slate-400 hover:text-violet-600 transition-colors font-medium"
              >
                overview
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Overview view (center) */}
        <div
          className={`absolute inset-0 px-5 pt-4 pb-3 flex flex-col transition-transform duration-300 ease-in-out ${getTranslateClass("overview", view)}`}
        >
          {headline && (
            <p className="text-sm text-slate-400 italic mb-4 leading-relaxed line-clamp-3">
              {headline.replace(/<[^>]*>/g, "")}
            </p>
          )}

          <div className="space-y-3">
            <ScoreBar label="Experience" value={breakdown.experience} />
            <ScoreBar label="Schedule" value={breakdown.schedule} />
            <ScoreBar label="Location" value={breakdown.location} />
          </div>

          <div className="mt-auto pt-3">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setView("availability")}
                className="inline-flex items-center gap-0.5 text-sm text-slate-400 hover:text-violet-600 transition-colors font-medium"
              >
                <ChevronLeft className="w-4 h-4" />
                availability
              </button>
              {hasBonusOrUnmet && (
                <button
                  onClick={() => setView("breakdown")}
                  className="inline-flex items-center gap-0.5 text-sm text-slate-400 hover:text-violet-600 transition-colors font-medium"
                >
                  breakdown
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Breakdown view (right) */}
        <div
          className={`absolute inset-0 px-5 pt-4 pb-3 flex flex-col transition-transform duration-300 ease-in-out ${getTranslateClass("breakdown", view)}`}
        >
          {(() => {
            const allItems = [
              ...match.overQualifiedBonuses.map((b) => ({ text: `+ ${b}`, color: "text-green-600" })),
              ...match.unmetRequirements.map((r) => ({ text: `- ${r}`, color: "text-amber-600" })),
            ];
            const left = allItems.slice(0, 10);
            const right = allItems.slice(10);
            return (
              <div className="flex gap-3 text-[11px] flex-1 min-h-0">
                <div className="flex-1 min-w-0">
                  {left.map((item) => (
                    <p key={item.text} className={`${item.color} truncate leading-[16px]`}>{item.text}</p>
                  ))}
                </div>
                {right.length > 0 && (
                  <div className="flex-1 min-w-0">
                    {right.map((item) => (
                      <p key={item.text} className={`${item.color} truncate leading-[16px]`}>{item.text}</p>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          <div className="mt-auto pt-2">
            <div className="flex justify-start">
              <button
                onClick={() => setView("overview")}
                className="inline-flex items-center gap-0.5 text-sm text-slate-400 hover:text-violet-600 transition-colors font-medium"
              >
                <ChevronLeft className="w-4 h-4" />
                overview
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Static View Profile button — always visible */}
      <div className="px-5 pb-5 pt-0 space-y-2">
        <Button asChild variant="outline" className="w-full">
          <Link href={`/nannies/${nanny.id}`}>
            View Profile
            <ArrowRight className="ml-1.5 w-4 h-4" />
          </Link>
        </Button>
        {actions}
      </div>
    </Card>
  );
}
