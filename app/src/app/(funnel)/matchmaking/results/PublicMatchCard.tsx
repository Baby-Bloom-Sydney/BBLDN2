"use client";

import {
  MapPin,
  ShieldCheck,
  GraduationCap,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { calcAge, getScoreBadgeStyle } from "@/components/match/match-helpers";
import { BADGE_ICONS } from "@/components/profile/profile-helpers";
import type { MatchResult } from "@/lib/matching/types";
import { qualificationBadgeLabel } from "@/lib/matching/qualification-display";

interface PublicMatchCardProps {
  match: MatchResult;
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="flex items-center gap-3">
      <span className="w-[85px] text-sm text-slate-400 shrink-0">{label}</span>
      <div className="flex-1 h-3 rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-violet-500 transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function PublicMatchCard({ match }: PublicMatchCardProps) {
  const { nanny, profile, breakdown } = match;
  const firstName = profile.first_name.charAt(0).toUpperCase() + profile.first_name.slice(1);
  const age = calcAge(profile.date_of_birth);
  const aiContent = nanny.ai_content as Record<string, unknown> | null;
  const headline = (aiContent?.headline as string) || null;

  // ── Badge pills — same logic as ParentNannyProfileView ──
  const traitBadges: { icon: string; label: string; primary?: boolean }[] = [];
  if (nanny.nanny_experience_years && nanny.nanny_experience_years > 0)
    traitBadges.push({ icon: "Clock", label: `${nanny.nanny_experience_years}${nanny.nanny_experience_years === 1 ? 'yr' : 'yrs'} experience`, primary: true });
  if (nanny.under_3_experience_years && nanny.under_3_experience_years > 0)
    traitBadges.push({ icon: "Baby", label: `Toddlers, ${nanny.under_3_experience_years}${nanny.under_3_experience_years === 1 ? 'yr' : 'yrs'}`, primary: true });
  if (nanny.newborn_experience_years && nanny.newborn_experience_years > 0)
    traitBadges.push({ icon: "Baby", label: `Babies, ${nanny.newborn_experience_years}${nanny.newborn_experience_years === 1 ? 'yr' : 'yrs'}`, primary: true });
  const qualLabel: string | null = qualificationBadgeLabel(match.highestQualification) || null;

  return (
    <div className="relative h-full rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col @container">
        <span className={`absolute top-3 right-3 z-10 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold shrink-0 border ${getScoreBadgeStyle(match.finalScore)}`}>
          {match.finalScore}% Match
        </span>
        <div className="h-16 bg-gradient-to-br from-violet-50 to-violet-100/50" />

        <div className="relative px-5 pb-5 flex-1 flex flex-col">
          <div className="flex items-end gap-4 -mt-10">
            <div className="relative shrink-0 self-start mt-[-0.5rem]">
              <div className="relative h-28 w-28 overflow-hidden rounded-full border-4 border-white bg-violet-50 shadow-md">
                {profile.profile_picture_url ? (
                  <img
                    src={profile.profile_picture_url}
                    alt={`${firstName}'s photo`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-3xl font-bold text-violet-300">
                    {firstName[0]}
                  </div>
                )}
              </div>
              <div className="absolute bottom-2 right-0 flex h-7 w-7 items-center justify-center rounded-full bg-green-50 border border-green-200 ring-2 ring-white">
                <ShieldCheck className="h-4 w-4 text-green-700" />
              </div>
            </div>

            <div className="flex-1 min-w-0 pb-1 pt-4">
              <h1 className="text-2xl font-bold text-slate-900">
                {firstName}{age ? <span className="text-base font-medium text-slate-400">, {age}</span> : ""}
              </h1>
              <div className="mt-0.5 flex items-center justify-between gap-2">
                <div className="min-w-0 pr-2">
                  {profile.suburb && (
                    <p className="flex items-center gap-1 text-sm text-slate-500 mt-0.5">
                      <MapPin className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{profile.suburb}</span>
                      {match.distanceKm != null && (
                        <span className="text-xs text-slate-400">{match.distanceKm < 1 ? "<1km" : `${match.distanceKm}km`}</span>
                      )}
                    </p>
                  )}
                  {qualLabel && (
                    <p className="flex items-center gap-1 text-sm text-slate-500 mt-0.5">
                      <GraduationCap className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{qualLabel}</span>
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Headline — capped at 3 lines */}
          {headline && (
            <div
              className="mt-3 text-sm text-slate-600 leading-relaxed [&_p]:mb-0 overflow-hidden"
              style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}
              dangerouslySetInnerHTML={{ __html: headline }}
            />
          )}

          {/* Trait badges — always 1 line, shrink to fit */}
          {traitBadges.length > 0 && (
            <div className="mt-3 flex flex-nowrap gap-1 overflow-hidden">
              {traitBadges.map((badge, i) => {
                const Icon = BADGE_ICONS[badge.icon] || Check;
                return (
                  <span
                    key={i}
                    className={cn(
                      "inline-flex items-center justify-center tracking-tight whitespace-nowrap shrink gap-1 rounded-lg px-2.5 py-1 text-[clamp(7px,2.8cqw,12px)] font-medium min-w-0",
                      badge.primary
                        ? "bg-violet-100 text-violet-700"
                        : "bg-slate-100 text-slate-600"
                    )}
                  >
                    <Icon className="h-2.5 w-2.5 shrink-0" /> {badge.label}
                  </span>
                );
              })}
            </div>
          )}

          {/* Score bars */}
          <div className="mt-4 pt-3 border-t border-slate-100 space-y-2.5">
            <ScoreBar label="Experience" value={breakdown.experience} />
            <ScoreBar label="Schedule" value={breakdown.schedule} />
            <ScoreBar label="Location" value={breakdown.location} />
          </div>

          {/* Breakdown — bonuses & unmet requirements, fills remaining space */}
          {(match.overQualifiedBonuses.length > 0 || match.unmetRequirements.length > 0) && (
            <div className="mt-3 pt-3 border-t border-slate-100 flex-1 overflow-hidden text-[clamp(8px,3cqw,13px)]">
              <div className="columns-2 gap-x-2 h-full max-h-[9lh]" style={{ columnFill: "auto" }}>
                {match.overQualifiedBonuses.map((b) => (
                  <p key={b} className="text-green-600 leading-tight truncate break-inside-avoid">+ {b}</p>
                ))}
                {match.unmetRequirements.map((r) => (
                  <p key={r} className="text-amber-600 leading-tight truncate break-inside-avoid">- {r}</p>
                ))}
              </div>
            </div>
          )}
        </div>
    </div>
  );
}
