"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Users,
  Loader2,
  Clock,
  MapPin,
  GraduationCap,
  CalendarDays,
  User,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { type NannyCardData, EmptyNannyState } from "@/components/NannyCard";
import { NannyCardBK } from "@/app/brandkit1/NannyCardBK";
import { NannyMatchCardBK } from "@/app/brandkit1/NannyMatchCardBK";
import { fetchBrowseNannies } from "@/lib/actions/browse";
import { getMatchesForPosition } from "@/lib/actions/matching";
import { getPosition } from "@/lib/actions/parent";
import { EmptyState } from "@/components/dashboard/EmptyState";
import type { MatchResult } from "@/lib/matching/types";
import { qualificationRank } from "@/lib/nanny-options";

/* ─── Constants ─── */

const PAGE_SIZE = 10;

type AllSortKey = "newest" | "experience" | "qualification";
type MatchSortKey = "score" | "distance" | "experience" | "qualification";

const ALL_SORT_OPTIONS: { key: AllSortKey; label: string; icon: LucideIcon }[] = [
  { key: "newest", label: "Latest", icon: CalendarDays },
  { key: "experience", label: "Experience", icon: Clock },
  { key: "qualification", label: "Qualification", icon: GraduationCap },
];

const MATCH_SORT_OPTIONS: { key: MatchSortKey; label: string; icon: LucideIcon }[] = [
  { key: "score", label: "Best Match", icon: Sparkles },
  { key: "distance", label: "Distance", icon: MapPin },
  { key: "experience", label: "Experience", icon: Clock },
  { key: "qualification", label: "Qualifications", icon: GraduationCap },
];

type ViewType = "all" | "matches";

/* ─── Sort helpers ─── */

function sortNannies(nannies: NannyCardData[], sortBy: AllSortKey): NannyCardData[] {
  if (sortBy === "newest") return nannies;
  const sorted = [...nannies];
  if (sortBy === "experience") {
    sorted.sort((a, b) => {
      const ea = a.total_experience_years ?? 0;
      const eb = b.total_experience_years ?? 0;
      return eb - ea;
    });
  } else if (sortBy === "qualification") {
    sorted.sort((a, b) => {
      const rankA = qualificationRank(a.highest_qualification);
      const rankB = qualificationRank(b.highest_qualification);
      return rankB - rankA;
    });
  }
  return sorted;
}

function sortMatches(matches: MatchResult[], sortBy: MatchSortKey): MatchResult[] {
  const sorted = [...matches];
  switch (sortBy) {
    case "score":
      return sorted.sort((a, b) => b.finalScore - a.finalScore);
    case "distance":
      return sorted.sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
    case "experience":
      return sorted.sort((a, b) => {
        const ea = b.nanny.nanny_experience_years ?? b.nanny.total_experience_years ?? 0;
        const eb = a.nanny.nanny_experience_years ?? a.nanny.total_experience_years ?? 0;
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

/* ─── Component ─── */

interface BrowseNanniesTabProps {
  initialView?: "all" | "matches";
  onViewChange?: (view: "all" | "matches") => void;
}

export function BrowseNanniesTab({ initialView = "all", onViewChange }: BrowseNanniesTabProps) {
  const [view, setViewState] = useState<ViewType>(initialView);

  const setView = (v: ViewType) => {
    setViewState(v);
    onViewChange?.(v);
  };
  const [allSort, setAllSort] = useState<AllSortKey>("newest");
  const [matchSort, setMatchSort] = useState<MatchSortKey>("score");
  const [page, setPage] = useState(1);

  // "Newest" sort: server-side paginated with page cache
  const newestPageCache = useRef<Map<number, NannyCardData[]>>(new Map());
  const [totalNannies, setTotalNannies] = useState(0);

  // "Age" / "Qualification" sort: full dataset fetched once, sorted + paginated client-side
  const allNanniesCache = useRef<NannyCardData[] | null>(null);

  const [displayNannies, setDisplayNannies] = useState<NannyCardData[]>([]);
  const [loadingPage, setLoadingPage] = useState(true);

  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [matchStats, setMatchStats] = useState<{ totalEligible: number; returned: number }>({ totalEligible: 0, returned: 0 });
  const [hasPosition, setHasPosition] = useState(false);

  const [loadingMatches, setLoadingMatches] = useState(false);
  const [matchesLoaded, setMatchesLoaded] = useState(false);

  // Load all nannies (for client-side sorts) — fetched once and cached
  const loadAllNannies = useCallback(async (): Promise<NannyCardData[]> => {
    if (allNanniesCache.current) return allNanniesCache.current;
    // Fetch with a large limit to get all
    const { nannies, total } = await fetchBrowseNannies(1, 1000);
    allNanniesCache.current = nannies;
    setTotalNannies(total);
    return nannies;
  }, []);

  // Load data based on current sort + page
  const loadData = useCallback(async (sort: AllSortKey, pageNum: number) => {
    if (sort === "newest") {
      // Server-side paginated
      const cached = newestPageCache.current.get(pageNum);
      if (cached) {
        setDisplayNannies(cached);
        setLoadingPage(false);
        return;
      }
      setLoadingPage(true);
      const { nannies, total } = await fetchBrowseNannies(pageNum, PAGE_SIZE);
      newestPageCache.current.set(pageNum, nannies);
      setTotalNannies(total);
      setDisplayNannies(nannies);
      setLoadingPage(false);
    } else {
      // Client-side sort: fetch all, sort, then slice for page
      setLoadingPage(true);
      const all = await loadAllNannies();
      const sorted = sortNannies(all, sort);
      const start = (pageNum - 1) * PAGE_SIZE;
      setDisplayNannies(sorted.slice(start, start + PAGE_SIZE));
      setLoadingPage(false);
    }
  }, [loadAllNannies]);

  // Initial load
  const initialLoaded = useRef(false);
  useEffect(() => {
    if (!initialLoaded.current) {
      initialLoaded.current = true;
      loadData(allSort, 1);
    }
  }, [loadData, allSort]);

  // Reload when sort or page changes
  useEffect(() => {
    if (initialLoaded.current) {
      loadData(allSort, page);
    }
  }, [allSort, page, loadData]);

  // Reset page when sort changes
  useEffect(() => { setPage(1); }, [allSort]);

  // Fetch matches when switching to matches view
  const loadMatches = useCallback(async () => {
    if (matchesLoaded) return;
    setLoadingMatches(true);
    const [matchResult, posResult] = await Promise.all([
      getMatchesForPosition(),
      getPosition(),
    ]);
    setHasPosition(!!posResult.data);
    if (matchResult.data) {
      setMatches(matchResult.data.matches);
      setMatchStats(matchResult.data.stats);
    }
    setMatchesLoaded(true);
    setLoadingMatches(false);
  }, [matchesLoaded]);

  useEffect(() => {
    if (view === "matches") loadMatches();
  }, [view, loadMatches]);

  // Computed
  const totalPages = Math.ceil(totalNannies / PAGE_SIZE);
  const sortedMatches = sortMatches(matches, matchSort);

  return (
    <div className="px-5 pb-5 pt-3">
      {/* Controls row */}
      <div className="flex items-center justify-between mb-4">
        {/* View toggle */}
        <div className="inline-flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
          <button
            onClick={() => { setView("all"); }}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
              view === "all"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-400 hover:text-slate-600"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setView("matches")}
            className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
              view === "matches"
                ? "bg-violet-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-600"
            }`}
          >
            <Sparkles className="h-3 w-3" />
            Matches
          </button>
        </div>

        {/* Sort toggle */}
        {view === "all" ? (
          <div className="inline-flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
            {ALL_SORT_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.key}
                  onClick={() => setAllSort(option.key)}
                  title={option.label}
                  className={`rounded-md px-2 sm:px-3 py-1.5 text-xs font-medium transition-all flex items-center gap-1 ${
                    option.key === allSort
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
        ) : (
          <div className="inline-flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
            {MATCH_SORT_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.key}
                  onClick={() => setMatchSort(option.key)}
                  title={option.label}
                  className={`rounded-md px-2 sm:px-3 py-1.5 text-xs font-medium transition-all flex items-center gap-1 ${
                    option.key === matchSort
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
        )}
      </div>

      {/* ═══ Content ═══ */}
      {view === "all" ? (
        <>
          {loadingPage ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
            </div>
          ) : displayNannies.length > 0 ? (
            <div className="space-y-3">
              {displayNannies.map((nanny) => (
                <NannyCardBK key={nanny.id} nanny={nanny} linkBase="/parent/browse" />
              ))}
            </div>
          ) : (
            <EmptyNannyState />
          )}

          {/* Pagination */}
          {totalPages > 1 && !loadingPage && (
            <div className="mt-6 flex items-center justify-center gap-2">
              {page > 1 ? (
                <button
                  onClick={() => setPage(page - 1)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              ) : (
                <div className="h-8 w-8" />
              )}
              <span className="text-sm text-slate-500 px-2">
                Page {page} of {totalPages}
              </span>
              {page < totalPages ? (
                <button
                  onClick={() => setPage(page + 1)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <div className="h-8 w-8" />
              )}
            </div>
          )}

          {/* Count */}
          {displayNannies.length > 0 && !loadingPage && (
            <p className="mt-3 text-center text-xs text-slate-400">
              Showing {(page - 1) * PAGE_SIZE + 1}&ndash;{Math.min(page * PAGE_SIZE, totalNannies)} of {totalNannies} nann{totalNannies === 1 ? "y" : "ies"}
            </p>
          )}

          {/* Bottom CTA */}
          {!loadingPage && (
            <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm text-center space-y-3">
              <h2 className="text-base font-semibold text-slate-900">
                Can&apos;t find the right match?
              </h2>
              <p className="text-sm text-slate-500">
                Let our matchmaker find the perfect nanny for you.
              </p>
              <Button asChild className="bg-violet-600 hover:bg-violet-700">
                <Link href="/parent/matchmaking">
                  Get Matched
                  <ArrowRight className="ml-1.5 w-4 h-4" />
                </Link>
              </Button>
            </div>
          )}
        </>
      ) : (
        /* ═══ Matches View ═══ */
        <>
          {loadingMatches ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
            </div>
          ) : !hasPosition ? (
            <div className="text-center py-8 space-y-3">
              <Button asChild className="bg-violet-600 hover:bg-violet-700">
                <Link href="/parent/request">Create your position</Link>
              </Button>
              <p className="text-sm text-slate-400">
                Create your position to get your best matched nannies
              </p>
            </div>
          ) : sortedMatches.length > 0 ? (
            <>
              <div className="space-y-3">
                {sortedMatches.map((match) => (
                  <NannyMatchCardBK key={match.nannyId} match={match} />
                ))}
              </div>
              <p className="mt-4 text-sm text-slate-400 text-center">
                {matchStats.returned} match{matchStats.returned !== 1 ? "es" : ""} found
                {matchStats.totalEligible > matchStats.returned &&
                  ` out of ${matchStats.totalEligible} verified nannies`}
              </p>
            </>
          ) : (
            <EmptyState
              icon={Users}
              title="No matches yet"
              description="There are no verified nannies available right now. Check back soon as more nannies join our platform."
            />
          )}
        </>
      )}
    </div>
  );
}
