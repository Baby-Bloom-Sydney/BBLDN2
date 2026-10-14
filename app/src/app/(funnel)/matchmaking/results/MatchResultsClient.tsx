"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { PublicMatchCard } from "./PublicMatchCard";
import {
  Sparkles,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  CheckCircle,
} from "lucide-react";
import type { MatchResult } from "@/lib/matching/types";

/* ── Fixed card width ──
   340px ≈ iPhone SE/mini viewport minus padding.
   Breakpoints: 2 cards @ 752px, 3 cards @ 1100px, 4 cards @ 1448px
   (340 * n + 12 * (n-1) gaps + 48px page padding) */
const CARD_W = 345;

interface MatchResultsClientProps {
  matches: MatchResult[]; // top 4
  totalEligible: number;
  leadId: string;
}

export function MatchResultsClient({
  matches,
  totalEligible,
  leadId,
}: MatchResultsClientProps) {
  const [phase, setPhase] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const visibleMatches = matches.slice(0, 3);
  const blurredMatch = matches.length >= 4 ? matches[3] : null;
  const moreCount = totalEligible - visibleMatches.length;
  const totalSlides = visibleMatches.length + (blurredMatch ? 1 : 0);

  // Staggered entrance
  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 80);
    const t2 = setTimeout(() => setPhase(2), 350);
    const t3 = setTimeout(() => setPhase(3), 650);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  // Scroll tracking (mobile carousel only)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const children = Array.from(el.children) as HTMLElement[];
      if (children.length === 0) return;
      const containerCenter = el.scrollLeft + el.offsetWidth / 2;
      let closest = 0;
      let closestDist = Infinity;
      children.forEach((child, i) => {
        const childCenter = child.offsetLeft + child.offsetWidth / 2;
        const dist = Math.abs(containerCenter - childCenter);
        if (dist < closestDist) {
          closestDist = dist;
          closest = i;
        }
      });
      setActiveIndex(closest);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [totalSlides]);

  const scrollTo = useCallback(
    (idx: number) => {
      const el = scrollRef.current;
      if (!el || idx < 0 || idx >= totalSlides) return;
      const child = el.children[idx] as HTMLElement | undefined;
      if (child) {
        const scrollLeft =
          child.offsetLeft - el.offsetWidth / 2 + child.offsetWidth / 2;
        el.scrollTo({ left: scrollLeft, behavior: "smooth" });
      }
    },
    [totalSlides],
  );

  const signupUrl = `/matchmaking/signup?lead=${leadId}`;

  return (
    <div className="min-h-[100dvh] flex flex-col relative bg-white">
      {/* Decorative blobs — Baby Bloom style */}
      <div className="absolute top-[-60px] right-[-40px] w-64 h-64 bg-violet-100 rounded-full blur-3xl opacity-50 pointer-events-none" />
      <div className="absolute bottom-[10%] left-[-60px] w-48 h-48 bg-violet-200 rounded-full blur-3xl opacity-30 pointer-events-none" />
      <div className="absolute top-[40%] right-[-30px] w-40 h-40 bg-violet-50 rounded-full blur-2xl opacity-40 pointer-events-none" />

      {/* ═══ Zone 1: Header ═══ */}
      <div
        className="relative shrink-0 text-center px-5 pt-10 pb-3 transition-all duration-600 ease-out"
        style={{
          opacity: phase >= 1 ? 1 : 0,
          transform: phase >= 1 ? "translateY(0)" : "translateY(-10px)",
        }}
      >
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-100 text-violet-600 text-xs font-semibold mb-2">
          <Sparkles className="w-3 h-3" />
          {totalEligible} nannies matched
        </div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Your top matches
        </h1>
      </div>

      {/* ═══ Zone 2: Cards ═══ */}
      <div
        className="relative flex-1 flex flex-col min-h-0 transition-all duration-600 ease-out"
        style={{
          opacity: phase >= 2 ? 1 : 0,
          transform: phase >= 2 ? "translateY(0)" : "translateY(12px)",
        }}
      >
        {/* Mobile: horizontal scroll carousel */}
        <div
          ref={scrollRef}
          className="flex-1 flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-smooth items-stretch py-2 hide-scrollbar md:hidden"
          style={{ paddingInline: `max(16px, calc((100% - ${CARD_W}px) / 2))` }}
        >
          {visibleMatches.map((match) => (
            <Link
              key={match.nannyId}
              href={`/nannies/${match.nanny.id}?src=adv&lead=${leadId}`}
              className="block shrink-0 snap-center"
              style={{ width: `${CARD_W}px` }}
            >
              <PublicMatchCard match={match} />
            </Link>
          ))}
          {blurredMatch && (
            <Link
              href={signupUrl}
              className="block shrink-0 snap-center"
              style={{ width: `${CARD_W}px` }}
            >
              <div className="relative h-full">
                <div className="blur-[6px] pointer-events-none select-none h-full">
                  <PublicMatchCard match={blurredMatch} />
                </div>
                <div className="absolute inset-0 bg-white/60 rounded-2xl flex flex-col items-center justify-center">
                  <p className="text-4xl font-bold text-violet-600">
                    +{moreCount}
                  </p>
                  <p className="text-sm font-medium text-slate-700 mt-1">
                    more {moreCount === 1 ? "nanny" : "nannies"} matched
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Sign up to see all your matches
                  </p>
                </div>
              </div>
            </Link>
          )}
        </div>

        {/* Desktop: fixed-width cards in a centered flex row */}
        <div
          className="hidden md:flex flex-1 flex-nowrap justify-center items-stretch gap-3 py-2 overflow-x-auto hide-scrollbar"
          style={{ paddingInline: `max(16px, calc((100% - ${CARD_W}px) / 2))` }}
        >
          {visibleMatches.map((match) => (
            <Link
              key={match.nannyId}
              href={`/nannies/${match.nanny.id}?src=adv&lead=${leadId}`}
              className="block shrink-0"
              style={{ width: `${CARD_W}px` }}
            >
              <PublicMatchCard match={match} />
            </Link>
          ))}
          {blurredMatch && (
            <Link
              href={signupUrl}
              className="block shrink-0"
              style={{ width: `${CARD_W}px` }}
            >
              <div className="relative h-full">
                <div className="blur-[6px] pointer-events-none select-none h-full">
                  <PublicMatchCard match={blurredMatch} />
                </div>
                <div className="absolute inset-0 bg-white/60 rounded-2xl flex flex-col items-center justify-center">
                  <p className="text-4xl font-bold text-violet-600">
                    +{moreCount}
                  </p>
                  <p className="text-sm font-medium text-slate-700 mt-1">
                    more {moreCount === 1 ? "nanny" : "nannies"} matched
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Sign up to see all your matches
                  </p>
                </div>
              </div>
            </Link>
          )}
        </div>

        {/* Mobile carousel arrows */}
        {totalSlides > 1 && (
          <>
            <button
              onClick={() => scrollTo(activeIndex - 1)}
              className={`absolute left-2 top-1/2 -translate-y-1/2 flex md:hidden items-center justify-center w-9 h-9 rounded-full bg-white border border-slate-200 shadow-sm text-slate-400 hover:text-violet-600 hover:border-violet-200 transition-all z-10 ${
                activeIndex === 0
                  ? "opacity-0 pointer-events-none"
                  : "opacity-100"
              }`}
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => scrollTo(activeIndex + 1)}
              className={`absolute right-2 top-1/2 -translate-y-1/2 flex md:hidden items-center justify-center w-9 h-9 rounded-full bg-white border border-slate-200 shadow-sm text-slate-400 hover:text-violet-600 hover:border-violet-200 transition-all z-10 ${
                activeIndex >= totalSlides - 1
                  ? "opacity-0 pointer-events-none"
                  : "opacity-100"
              }`}
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </>
        )}

        {/* Dots — mobile only */}
        <div className="shrink-0 flex md:hidden justify-center gap-1.5 py-2">
          {Array.from({ length: totalSlides }).map((_, i) => (
            <button
              key={i}
              onClick={() => scrollTo(i)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === activeIndex
                  ? "bg-violet-500 w-5"
                  : "bg-slate-200 w-1.5 hover:bg-slate-300"
              }`}
            />
          ))}
        </div>
      </div>

      {/* ═══ Zone 3: CTA ═══ */}
      <div
        className="relative shrink-0 px-4 pb-6 pt-1 transition-all duration-600 ease-out max-w-2xl mx-auto w-full"
        style={{
          opacity: phase >= 3 ? 1 : 0,
          transform: phase >= 3 ? "translateY(0)" : "translateY(16px)",
        }}
      >
        <div className="rounded-2xl bg-violet-50 border border-violet-100 p-4 text-center">
          {/* Trust signals */}
          <div className="flex items-center justify-center gap-4 mb-2.5">
            <span className="inline-flex items-center gap-1 text-xs text-slate-500">
              <ShieldCheck className="w-3.5 h-3.5 text-green-500" />
              DBS checked
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-slate-500">
              <CheckCircle className="w-3.5 h-3.5 text-violet-500" />
              Expertly vetted
            </span>
          </div>

          <Link
            href={signupUrl}
            className="group flex items-center justify-center gap-2 h-12 w-full rounded-xl bg-violet-500 hover:bg-violet-600 text-white font-semibold text-sm transition-all active:scale-[0.98] shadow-md shadow-violet-200"
          >
            Connect with best matches
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
          </Link>

          <p className="text-xs text-slate-400 mt-2.5">
            Free to join &middot; Free to match
          </p>
        </div>
      </div>

      <style jsx>{`
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}
