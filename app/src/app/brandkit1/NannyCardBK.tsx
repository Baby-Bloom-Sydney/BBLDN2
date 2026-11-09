"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { MapPin, ShieldCheck, Clock, Baby, GraduationCap } from "lucide-react";
import type { NannyCardData } from "@/components/NannyCard";
import { ExpandableBadges, abbreviateQualification, type TraitBadge } from "./ExpandableBadges";

interface NannyCardBKProps {
  nanny: NannyCardData;
  linkBase?: string;
}

function computeAge(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  const now = new Date();
  let years = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) years--;
  return years > 0 && years < 120 ? years : null;
}

function buildBadges(nanny: NannyCardData): TraitBadge[] {
  const badges: TraitBadge[] = [];
  if (nanny.total_experience_years && nanny.total_experience_years > 0) {
    badges.push({ icon: Clock, label: `${nanny.total_experience_years}${nanny.total_experience_years === 1 ? 'yr' : 'yrs'} experience`, variant: "violet" });
  }
  if (nanny.under_3_experience_years && nanny.under_3_experience_years > 0) {
    badges.push({ icon: Baby, label: `Toddlers, ${nanny.under_3_experience_years}${nanny.under_3_experience_years === 1 ? 'yr' : 'yrs'}`, variant: "violet" });
  }
  if (nanny.newborn_experience_years && nanny.newborn_experience_years > 0) {
    badges.push({ icon: Baby, label: `Babies, ${nanny.newborn_experience_years}${nanny.newborn_experience_years === 1 ? 'yr' : 'yrs'}`, variant: "violet" });
  }
  if (nanny.highest_qualification) {
    const abbr = abbreviateQualification(nanny.highest_qualification);
    if (abbr) badges.push({ icon: GraduationCap, label: abbr, variant: "slate", className: "hidden md:inline-flex" });
  }
  return badges;
}

export function NannyCardBK({ nanny, linkBase = "/nannies" }: NannyCardBKProps) {
  const initials = `${nanny.first_name[0]}${nanny.last_name[0]}`;
  const age = nanny.age !== undefined ? nanny.age : computeAge(nanny.date_of_birth);
  const isVerified = (nanny.verification_level ?? 0) >= 3;

  return (
    <Link href={`${linkBase}/${nanny.id}`} className="block group">
      <Card className="overflow-hidden transition-all hover:shadow-lg hover:border-violet-200">
        <div className="p-5">
          <div className="flex items-start gap-4">
            {/* Profile picture */}
            <div className="relative shrink-0">
              {nanny.profile_picture_url ? (
                <img
                  src={nanny.profile_picture_url}
                  alt={`${nanny.first_name} ${nanny.last_name}`}
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
                {nanny.first_name.charAt(0).toUpperCase() + nanny.first_name.slice(1)}{age ? <span className="text-sm font-medium text-slate-400">, {age}</span> : ""}
              </h3>
              <div className="flex items-center gap-1.5 text-sm text-slate-500 mt-0.5">
                <MapPin className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{nanny.suburb}</span>
              </div>
            </div>
          </div>

          {/* AI headline — full width below photo row */}
          {nanny.ai_headline && (
            <p className="mt-2 text-[11px] text-slate-500 italic line-clamp-3 leading-relaxed">
              {nanny.ai_headline.replace(/<[^>]*>/g, "")}
            </p>
          )}

          <ExpandableBadges badges={buildBadges(nanny)} preventLinkNavigation />
        </div>
      </Card>
    </Link>
  );
}
