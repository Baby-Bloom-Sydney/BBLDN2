"use client";

import { useState } from "react";
import { MatchCard } from "@/components/MatchCard";
import type { MatchResult } from "@/lib/matching/types";
import { Users, MapPin, Briefcase, Sparkles, CheckCircle, Clock, PartyPopper } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { legacyTierCheckoutEnabled } from "@/lib/features/flags";

type SortKey = "score" | "distance" | "experience";

const SORT_OPTIONS: { key: SortKey; label: string; icon: typeof Users }[] = [
  { key: "score", label: "Best Match", icon: Users },
  { key: "distance", label: "Closest", icon: MapPin },
  { key: "experience", label: "Most Experienced", icon: Briefcase },
];

interface DfyStatusData {
  activated: boolean;
  activatedAt: string | null;
  expiresAt: string | null;
  expired: boolean;
  notifiedCount: number;
  interestedCount: number;
  connectedCount: number;
  tier: 'standard' | 'priority' | null;
  maxRespondents: number;
  positionId: string | null;
}

interface MatchResultsClientProps {
  matches: MatchResult[];
  stats: { totalEligible: number; returned: number };
  dfyStatus?: DfyStatusData;
}

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
    default:
      return sorted;
  }
}

export function MatchResultsClient({
  matches,
  stats,
  dfyStatus,
}: MatchResultsClientProps) {
  const [sortBy, setSortBy] = useState<SortKey>("score");
  const dfyTriggered = dfyStatus?.activated ?? false;

  const sorted = sortMatches(matches, sortBy);

  // Determine DFY banner state
  const isExpired = dfyTriggered && (dfyStatus?.expired ?? false);
  const isActive = dfyTriggered && !isExpired;

  // Calculate time remaining for active DFY
  const timeRemaining = (() => {
    if (!dfyStatus?.expiresAt) return null;
    const now = Date.now();
    const expires = new Date(dfyStatus.expiresAt).getTime();
    const diff = expires - now;
    if (diff <= 0) return null;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days > 0) return `${days}d ${hours}h remaining`;
    if (hours > 0) return `${hours}h remaining`;
    return 'Less than 1h remaining';
  })();

  return (
    <>
      {/* DFY banner — 3 states */}
      {!dfyTriggered ? (
        /* State 1: Not triggered — link to checkout */
        <div className="bg-gradient-to-r from-violet-50 to-purple-50 border border-violet-200 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-violet-900 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-violet-600" />
              Let us find your nanny
            </h3>
            <p className="text-sm text-violet-700 mt-1">
              We&apos;ll contact your top matches and let interested nannies come to you.
            </p>
          </div>
          {/* 5g (P-23): the tier checkout is hidden unless LEGACY_TIER_CHECKOUT_ENABLED. */}
          {legacyTierCheckoutEnabled() && (
            <Link href="/parent/matches/checkout">
              <Button className="bg-violet-600 hover:bg-violet-700 shrink-0">
                <Sparkles className="w-4 h-4 mr-1.5" />
                Find me a nanny
              </Button>
            </Link>
          )}
        </div>
      ) : isActive ? (
        /* State 2: Active — celebration banner */
        <div className="relative overflow-hidden bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 border border-green-200 rounded-xl p-5 sm:p-6">
          {/* Subtle sparkle background */}
          <div className="absolute top-2 right-3 text-green-200 opacity-50"><Sparkles className="w-8 h-8" /></div>
          <div className="absolute bottom-2 left-4 text-emerald-200 opacity-30"><Sparkles className="w-5 h-5" /></div>

          <div className="relative flex flex-col gap-3">
            {/* Header row with tier badge + countdown */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <PartyPopper className="w-5 h-5 text-green-600" />
                {dfyStatus?.tier === 'priority' ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide bg-gradient-to-r from-violet-600 to-purple-600 text-white shadow-sm">
                    <Sparkles className="w-3 h-3" />
                    Priority Matchmaking
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800">
                    <CheckCircle className="w-3 h-3" />
                    Matchmaking Active
                  </span>
                )}
              </div>
              {timeRemaining && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100/80 px-2.5 py-1 rounded-full">
                  <Clock className="w-3 h-3" />
                  {timeRemaining}
                </span>
              )}
            </div>

            {/* Main message */}
            <p className="text-base font-semibold text-green-900">
              We are reaching out to the nannies that best match your position!
            </p>
            <p className="text-sm text-green-700">
              You will be notified as they start to respond.
            </p>

            {/* Interested count */}
            {dfyStatus?.interestedCount ? (
              <div className="flex items-center gap-2 mt-1">
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-800">
                  <Users className="w-4 h-4" />
                  {dfyStatus.interestedCount} nann{dfyStatus.interestedCount !== 1 ? "ies" : "y"} interested
                </span>
                <a href="/parent" className="text-sm text-violet-600 hover:text-violet-700 underline font-medium">
                  View responses
                </a>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        /* State 3: Expired — link to checkout */
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-amber-900 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-amber-600" />
              Your search has completed
            </h3>
            <p className="text-sm text-amber-700 mt-1">
              {dfyStatus?.interestedCount
                ? <>{dfyStatus.interestedCount} nann{dfyStatus.interestedCount !== 1 ? "ies" : "y"} still interested &mdash; <a href="/parent" className="underline font-medium">view interested nannies</a></>
                : <>All matched nannies have been notified. Boost again to reach more nannies.</>}
            </p>
          </div>
          {legacyTierCheckoutEnabled() && (
            <Link href="/parent/matches/checkout">
              <Button className="bg-violet-600 hover:bg-violet-700 shrink-0">
                <Sparkles className="w-4 h-4 mr-1.5" />
                Boost again
              </Button>
            </Link>
          )}
        </div>
      )}

      {/* Sort + stats bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-sm text-slate-500">
          {stats.returned} match{stats.returned !== 1 ? "es" : ""} found
          {stats.totalEligible > stats.returned &&
            ` out of ${stats.totalEligible} verified nannies`}
        </p>
        <div className="flex gap-2">
          {SORT_OPTIONS.map((option) => {
            const isActive = option.key === sortBy;
            const Icon = option.icon;
            return (
              <button
                key={option.key}
                onClick={() => setSortBy(option.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-violet-100 border-violet-300 text-violet-700"
                    : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Match grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {sorted.map((match) => (
          <MatchCard
            key={match.nannyId}
            match={match}
          />
        ))}
      </div>
    </>
  );
}
