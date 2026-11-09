"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { MapPin, ShieldCheck, Clock, Baby, GraduationCap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { PublicMatchResult } from "@/lib/matching/public-match";
import { ExpandableBadges, abbreviateQualification, type TraitBadge } from "./ExpandableBadges";

interface NannyMatchCardBKProps {
  match: PublicMatchResult;
  linkBase?: string;
}

function buildBadges(match: PublicMatchResult): TraitBadge[] {
  const badges: TraitBadge[] = [];
  const n = match.nanny;
  if (n.total_experience_years && n.total_experience_years > 0) {
    badges.push({ icon: Clock, label: `${n.total_experience_years}${n.total_experience_years === 1 ? 'yr' : 'yrs'} experience`, variant: "violet" });
  }
  if (n.under_3_experience_years && n.under_3_experience_years > 0) {
    badges.push({ icon: Baby, label: `Toddlers, ${n.under_3_experience_years}${n.under_3_experience_years === 1 ? 'yr' : 'yrs'}`, variant: "violet" });
  }
  if (n.newborn_experience_years && n.newborn_experience_years > 0) {
    badges.push({ icon: Baby, label: `Babies, ${n.newborn_experience_years}${n.newborn_experience_years === 1 ? 'yr' : 'yrs'}`, variant: "violet" });
  }
  if (match.highestQualification) {
    const abbr = abbreviateQualification(match.highestQualification);
    if (abbr) badges.push({ icon: GraduationCap, label: abbr, variant: "slate", className: "hidden md:inline-flex" });
  }
  return badges;
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const percent = Math.min(100, Math.max(0, value));
  return (
    <div className="flex items-center gap-3">
      <span className="w-[80px] text-xs text-slate-500 shrink-0">{label}</span>
      <div className="flex-1 h-2.5 rounded-full bg-violet-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-violet-500 transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function getMatchBadgeStyle(score: number) {
  if (score >= 80) return "bg-green-100 text-green-700 border-green-200";
  if (score >= 60) return "bg-violet-100 text-violet-700 border-violet-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

export function NannyMatchCardBK({ match, linkBase = "/parent/browse" }: NannyMatchCardBKProps) {
  const { nanny, profile, breakdown } = match;
  const initials = `${profile.first_name[0]}${profile.last_name[0]}`;
  const age = profile.age;
  const headline = (nanny.ai_content?.headline as string) || null;
  const isVerified = true; // matching engine filters verification_level >= 3

  return (
    <Link href={`${linkBase}/${nanny.id}`} className="block group">
      <Card className="overflow-hidden transition-all hover:shadow-lg hover:border-violet-200 relative">
        {/* Match % badge — top right corner */}
        <Badge
          variant="outline"
          className={`absolute top-3 right-3 text-[11px] font-semibold px-2 py-0.5 ${getMatchBadgeStyle(match.finalScore)}`}
        >
          {Math.round(match.finalScore)}% Match
        </Badge>

        <div className="p-5">
          <div className="flex items-center gap-4">
            {/* Profile picture */}
            <div className="relative shrink-0">
              {profile.profile_picture_url ? (
                <img
                  src={profile.profile_picture_url}
                  alt={profile.first_name}
                  className="w-20 h-20 rounded-full object-cover"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-violet-100 flex items-center justify-center">
                  <span className="text-2xl font-semibold text-violet-500">
                    {initials}
                  </span>
                </div>
              )}
              {isVerified && (
                <div className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center w-6 h-6 rounded-full bg-green-500 ring-2 ring-white">
                  <ShieldCheck className="w-3.5 h-3.5 text-white" />
                </div>
              )}
            </div>

            {/* Name, location */}
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-lg text-slate-900 truncate group-hover:text-violet-600 transition-colors">
                {profile.first_name.charAt(0).toUpperCase() + profile.first_name.slice(1)}{age ? <span className="text-sm font-medium text-slate-400">, {age}</span> : ""}
              </h3>
              <div className="flex items-center gap-1.5 text-sm text-slate-500 mt-0.5">
                <MapPin className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  {profile.suburb}
                  {match.distanceKm != null && (
                    <span className="text-xs text-slate-400">, {Math.round(match.distanceKm)}km</span>
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* AI headline — full width below photo row */}
          {headline && (
            <p className="mt-2 text-[11px] text-slate-500 italic line-clamp-3 leading-relaxed">
              {headline.replace(/<[^>]*>/g, "")}
            </p>
          )}

          {/* Experience badges */}
          <ExpandableBadges badges={buildBadges(match)} preventLinkNavigation />

          {/* Score bars */}
          <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
            <ScoreBar label="Experience" value={breakdown.experience} />
            <ScoreBar label="Schedule" value={breakdown.schedule} />
            <ScoreBar label="Location" value={breakdown.location} />
          </div>
        </div>
      </Card>
    </Link>
  );
}
