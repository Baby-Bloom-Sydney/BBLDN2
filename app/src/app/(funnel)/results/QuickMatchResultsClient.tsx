"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  RotateCcw,
  Sparkles,
  Loader2,
  ShieldCheck,
  CheckCircle,
} from "lucide-react";
import { NannyPreviewCard } from "@/components/landing/NannyPreviewCard";
import type { NannyPreview } from "@/components/landing/NannyPreviewCard";

interface QuickMatchNanny extends NannyPreview {
  logistical_score: number;
  distance_km: number | null;
  schedule_overlap_percent: number;
}

interface QuickMatchResponse {
  totalMatches: number;
  topNannies: QuickMatchNanny[];
}

const BASIC_FACTORS = ["Location", "Schedule"];

const ADVANCED_FACTORS = [
  "Total Experience",
  "Toddler Experience",
  "Newborn Experience",
  "Level of Support",
  "Educational Support",
  "Developmental Support",
  "Language",
  "Driver status",
  "and more",
];

export function QuickMatchResultsClient() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [suburb, setSuburb] = useState("");
  const [results, setResults] = useState<QuickMatchResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem("bb-quick-match");
    if (!raw) {
      router.replace("/");
      return;
    }

    let parsed: {
      suburb: string;
      postcode: string;
      availability: Record<string, string[]>;
    };
    try {
      parsed = JSON.parse(raw);
      if (!parsed.suburb || !parsed.availability) {
        router.replace("/");
        return;
      }
    } catch {
      router.replace("/");
      return;
    }

    setSuburb(parsed.suburb);

    fetch("/api/public/quick-match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        suburb: parsed.suburb,
        availability: parsed.availability,
      }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed");
        return res.json();
      })
      .then((data: QuickMatchResponse) => {
        setResults(data);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-violet-500 mx-auto" />
          <p className="mt-4 text-sm text-slate-500">
            Finding nannies near {suburb || "you"}...
          </p>
        </div>
      </div>
    );
  }

  if (error || !results) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-600">
            Something went wrong. Please try again.
          </p>
          <Button
            className="mt-4 bg-violet-500 hover:bg-violet-600"
            onClick={() => router.push("/")}
          >
            Back to search
          </Button>
        </div>
      </div>
    );
  }

  const { totalMatches, topNannies } = results;

  return (
    <div className="min-h-screen bg-white relative">
      {/* Decorative background */}
      <div className="absolute top-20 right-[10%] w-72 h-72 bg-violet-100 rounded-full blur-3xl opacity-50" />
      <div className="absolute bottom-10 left-[5%] w-48 h-48 bg-violet-200 rounded-full blur-2xl opacity-30" />

      <div className="relative z-10 py-6 md:py-16">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-2xl mx-auto">
            {/* Results header */}
            <div className="text-center mb-4 md:mb-8">
              {totalMatches > 0 ? (
                <>
                  <h2 className="text-2xl md:text-3xl font-bold text-slate-900">
                    {totalMatches} match{totalMatches !== 1 ? "es" : ""} near{" "}
                    {suburb}
                  </h2>
                  <p className="mt-1 md:mt-2 text-slate-500 text-sm">
                    Matched by location and schedule.
                  </p>
                </>
              ) : (
                <>
                  <h2 className="text-2xl md:text-3xl font-bold text-slate-900">
                    No exact matches in {suburb}
                  </h2>
                  <p className="mt-2 text-slate-500 text-sm">
                    Adjust availability or try advanced matchmaking.
                  </p>
                </>
              )}
            </div>

            {/* Top nanny cards */}
            {topNannies.length > 0 && (
              <div className="space-y-2 sm:space-y-3 mb-4 sm:mb-8">
                {topNannies.map((nanny) => (
                  <NannyPreviewCard
                    key={nanny.id}
                    nanny={nanny}
                    linkHref={`/nannies/${nanny.id}?src=std`}
                    distanceKm={nanny.distance_km}
                    matchScore={nanny.logistical_score}
                  />
                ))}
              </div>
            )}

            {/* Advanced matchmaking CTA */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-6 space-y-3 sm:space-y-5">
              <Button
                asChild
                className="w-full bg-violet-500 hover:bg-violet-600 h-10 sm:h-11 text-sm touch-manipulation"
              >
                <Link href="/matchmaking/onboarding">
                  <Sparkles className="mr-2 h-4 w-4" />
                  Try Advanced Matchmaking
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>

              <div className="space-y-2">
                <p className="text-xs text-slate-500 leading-relaxed">
                  Advanced matchmaking includes:
                </p>
                <div className="grid grid-cols-3 gap-x-3 gap-y-1">
                  {ADVANCED_FACTORS.map((item) => (
                    <p key={item} className="text-xs text-slate-500">
                      <span className="font-medium">+</span> {item}
                    </p>
                  ))}
                </div>
              </div>
            </div>

            {/* T-039 Slice C — Connect-with-matches violet tile, BELOW Advanced */}
            {totalMatches > 0 && (
              <div
                aria-labelledby="connect-with-matches-heading"
                className="mt-4 sm:mt-6 rounded-2xl bg-violet-50 border border-violet-100 p-4 text-center"
              >
                <h2 id="connect-with-matches-heading" className="sr-only">
                  Connect with your matches
                </h2>
                <div className="flex items-center justify-center gap-4 mb-2.5">
                  <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                    <ShieldCheck className="w-3.5 h-3.5 text-green-500" /> Enhanced
                    DBS verified
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                    <CheckCircle className="w-3.5 h-3.5 text-violet-500" />{" "}
                    Expertly vetted
                  </span>
                </div>
                <Link
                  href="/signup?src=std"
                  className="group flex items-center justify-center gap-2 h-12 w-full rounded-xl bg-violet-500 hover:bg-violet-600 text-white font-semibold text-sm transition-all active:scale-[0.98] shadow-md shadow-violet-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
                >
                  Connect with matches
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
                <p className="text-xs text-slate-400 mt-2.5">
                  Free to join &middot; Free to match
                </p>
              </div>
            )}

            {/* Search again — utility link */}
            <button
              onClick={() => router.push("/")}
              className="mt-4 sm:mt-6 flex items-center justify-center gap-1.5 w-full text-xs text-slate-400 hover:text-slate-600 transition-colors py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 rounded"
            >
              <RotateCcw className="h-3 w-3" />
              Search again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
