"use client";

import { useState } from "react";
import Link from "next/link";
import type { PublicNannyProfile } from "@/lib/actions/nanny";
import { Button } from "@/components/ui/button";
import { ConnectModal } from "@/components/ConnectModal";
import { cn } from "@/lib/utils";
import { ExpandablePhoto } from "@/components/ui/expandable-photo";
import { InlineQuickMatch } from "@/components/landing/InlineQuickMatch";
import {
  User,
  MapPin,
  ShieldCheck,
  Car,
  Baby,
  Globe,
  Clock,
  Heart,
  Check,
  Sparkles,
  Stethoscope,
  CigaretteOff,
  PawPrint,
  Users,
  GraduationCap,
  Award,
  Briefcase,
  HandHeart,
  Smile,
  CalendarCheck,
  Accessibility,
  ThumbsUp,
  Languages,
  Pencil,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";

import { Tag } from "@/components/profile/Tag";
import { GlanceItem } from "@/components/profile/GlanceItem";
import { StatBox } from "@/components/profile/StatBox";
import { AvailabilityGrid } from "@/components/profile/AvailabilityGrid";
import { ProfilePhotoViewer } from "@/components/profile/ProfilePhotoViewer";
import {
  computeAge,
  ageRangeToFriendly,
  childrenCountLabel,
  BADGE_ICONS,
} from "@/components/profile/profile-helpers";
import type { FunnelSource } from "@/lib/funnel/source";
import { CERTIFICATE_OPTIONS, byOptionOrder } from "@/lib/nanny-options";

const KNOWN_CERTIFICATES: readonly string[] = CERTIFICATE_OPTIONS;

// ── Types ─────────────────────────────────────────────────────────

interface ParentNannyProfileViewProps {
  nanny: PublicNannyProfile;
  isOwner?: boolean;
  isParent?: boolean;
  isGuest?: boolean;
  pendingRequestCount?: number;
  existingRequestStatus?: string | null;
  hasActivePlacement?: boolean;
  isActiveNanny?: boolean;
  hidePromoTile?: boolean;
  /**
   * Funnel-source signal from the URL — `'std'` (quick-match), `'adv'`
   * (advanced wizard), or `null` (legacy / no signal). Drives the
   * guest-Connect branch's target route (Slice D). See `lib/funnel/source.ts`.
   */
  funnelSource?: FunnelSource | null;
  /**
   * Lead UUID from the advanced-funnel URL — present iff `funnelSource === 'adv'`
   * AND the user arrived from a `/matchmaking/results?lead=<uuid>` tile.
   */
  funnelLead?: string | null;
}

const PROFILE_TABS = [
  { id: "about" as const, label: "About" },
  { id: "experience" as const, label: "Experience" },
  { id: "availability" as const, label: "Availability" },
];
type ProfileTabId = (typeof PROFILE_TABS)[number]["id"];

// ── Component ─────────────────────────────────────────────────────

export function ParentNannyProfileView({
  nanny,
  isOwner = false,
  isParent = false,
  isGuest = false,
  pendingRequestCount = 0,
  existingRequestStatus = null,
  hasActivePlacement = false,
  isActiveNanny = false,
  hidePromoTile = false,
  funnelSource = null,
  funnelLead = null,
}: ParentNannyProfileViewProps) {
  const [profileTab, setProfileTab] = useState<ProfileTabId>("about");
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showPlacementBlock, setShowPlacementBlock] = useState(false);
  const [photoViewerOpen, setPhotoViewerOpen] = useState(false);
  const [photoViewerIndex, setPhotoViewerIndex] = useState(0);

  const firstName =
    nanny.first_name.charAt(0).toUpperCase() + nanny.first_name.slice(1);
  const age = computeAge(nanny.date_of_birth);
  const isVerified = nanny.verification_level >= 3;

  // ── AI content extraction (V2 field paths) ──
  const ai = nanny.ai_content;
  const bioSummary = ai?.bio_summary;
  const bioObj = (
    typeof bioSummary === "object" && bioSummary !== null ? bioSummary : null
  ) as Record<string, string> | null;
  const headline = (ai?.headline as string) || null;
  const aiAbout = bioObj?.about || null;
  const aiPersonality = bioObj?.personality || null;
  const aiValues = bioObj?.values || null;
  const aiBackground = bioObj?.background || null;
  const aiWhatIOffer = bioObj?.what_i_offer || null;
  const aiExperience = (ai?.experience_summary as string) || null;

  // ── Badge pills ──
  const traitBadges: { icon: string; label: string; primary?: boolean }[] = [];
  if (nanny.total_experience_years && nanny.total_experience_years > 0)
    traitBadges.push({
      icon: "Clock",
      label: `${nanny.total_experience_years}${nanny.total_experience_years === 1 ? "yr" : "yrs"} experience`,
      primary: true,
    });
  if (nanny.under_3_experience_years && nanny.under_3_experience_years > 0)
    traitBadges.push({
      icon: "Baby",
      label: `Toddlers, ${nanny.under_3_experience_years}${nanny.under_3_experience_years === 1 ? "yr" : "yrs"}`,
      primary: true,
    });
  if (nanny.newborn_experience_years && nanny.newborn_experience_years > 0)
    traitBadges.push({
      icon: "Baby",
      label: `Babies, ${nanny.newborn_experience_years}${nanny.newborn_experience_years === 1 ? "yr" : "yrs"}`,
      primary: true,
    });

  // ── Stat boxes ──
  const statBoxes: { value: number; label: string }[] = [];
  if (nanny.total_experience_years && nanny.total_experience_years > 0)
    statBoxes.push({
      value: nanny.total_experience_years,
      label: "Years Childcare",
    });
  if (nanny.under_3_experience_years && nanny.under_3_experience_years > 0)
    statBoxes.push({
      value: nanny.under_3_experience_years,
      label: "Years Under 3s",
    });
  if (nanny.newborn_experience_years && nanny.newborn_experience_years > 0)
    statBoxes.push({
      value: nanny.newborn_experience_years,
      label: "Years Newborns",
    });

  // ── Safety cert ordering — P-2: CERTIFICATE_OPTIONS order; values not on the list follow in stored order ──
  const sortedCerts = [...nanny.certificates].sort(byOptionOrder(CERTIFICATE_OPTIONS));
  const orderedCerts = sortedCerts.filter((c) => KNOWN_CERTIFICATES.includes(c));
  const otherCerts = sortedCerts.filter((c) => !KNOWN_CERTIFICATES.includes(c));

  return (
    <>
      {/* Owner banner */}
      {isOwner && (
        <Link
          href="/nanny/profile"
          className="mb-3 flex items-center justify-between rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 transition-colors hover:bg-violet-100"
        >
          <span className="text-sm text-violet-700">
            This is your profile as parents see it.
          </span>
          <span className="flex items-center gap-1.5 text-sm font-medium text-violet-600">
            <Pencil className="h-3.5 w-3.5" />
            Edit Profile
          </span>
        </Link>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          HERO CARD
         ═══════════════════════════════════════════════════════════════ */}
      <div className="relative rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {isVerified && (
          <span className="absolute top-3 right-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-green-50 border border-green-200 px-3 py-1 text-xs font-semibold text-green-700">
            <ShieldCheck className="h-3.5 w-3.5" /> Verified
          </span>
        )}
        <div className="h-12 bg-gradient-to-br from-violet-50 to-violet-100/50" />

        <div className="relative px-5 pb-5">
          <div className="flex items-end gap-4 -mt-10">
            <div className="relative shrink-0">
              {nanny.profile_picture_url ? (
                <ExpandablePhoto
                  src={nanny.profile_picture_url}
                  alt={`${firstName}'s photo`}
                >
                  <div className="relative h-32 w-32 overflow-hidden rounded-full border-4 border-white bg-violet-50 shadow-md">
                    <img
                      src={nanny.profile_picture_url}
                      alt={`${firstName}'s photo`}
                      className="h-full w-full object-cover"
                    />
                  </div>
                </ExpandablePhoto>
              ) : (
                <div className="relative h-32 w-32 overflow-hidden rounded-full border-4 border-white bg-violet-50 shadow-md">
                  <div className="flex h-full w-full items-center justify-center text-3xl font-bold text-violet-300">
                    {firstName[0]}
                  </div>
                </div>
              )}
              {isVerified && (
                <div className="absolute bottom-2 right-0 flex h-7 w-7 items-center justify-center rounded-full bg-green-50 border border-green-200 ring-2 ring-white">
                  <ShieldCheck className="h-4 w-4 text-green-700" />
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0 pb-1 pt-4">
              <h1 className="text-2xl font-bold text-slate-900">
                {firstName}
                {age ? `, ${age}` : ""}
              </h1>
              <div className="mt-1 flex items-center justify-between gap-2">
                <div className="min-w-0 pr-2">
                  {nanny.nationality && (
                    <p className="flex items-center gap-1 text-sm text-slate-500 mt-0.5">
                      <Globe className="h-3.5 w-3.5 shrink-0" />{" "}
                      <span className="truncate">{nanny.nationality}</span>
                    </p>
                  )}
                  {nanny.languages &&
                    nanny.languages.filter(
                      (l) => l !== "Foreign Language" && l !== "Multiple",
                    ).length > 0 && (
                      <p className="flex items-center gap-1 text-xs text-slate-400 mt-0.5">
                        <Languages className="h-3 w-3 shrink-0" />
                        <span className="truncate">
                          {nanny.languages
                            .filter(
                              (l) =>
                                l !== "Foreign Language" && l !== "Multiple",
                            )
                            .join(", ")}
                        </span>
                      </p>
                    )}
                  {nanny.suburb && (
                    <p className="flex items-center gap-1 text-sm text-slate-500 mt-0.5">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />{" "}
                      <span className="truncate">{nanny.suburb}</span>
                    </p>
                  )}
                </div>

                {/* Additional photos — fanned stack */}
                {nanny.additional_photos &&
                  nanny.additional_photos.length > 0 && (
                    <button
                      onClick={() => {
                        setPhotoViewerIndex(0);
                        setPhotoViewerOpen(true);
                      }}
                      className="relative shrink-0 w-[84px] h-[48px] cursor-pointer group"
                    >
                      {nanny.additional_photos.slice(0, 3).map((url, i) => {
                        const rotations = [
                          "-rotate-[15deg]",
                          "rotate-0",
                          "rotate-[15deg]",
                        ];
                        const offsets = ["left-0", "left-4", "left-8"];
                        const zIndexes = ["z-[3]", "z-[2]", "z-[1]"];
                        return (
                          <div
                            key={i}
                            className={cn(
                              "absolute top-0 h-11 w-11 overflow-hidden rounded-lg border-2 border-white shadow-md transition-transform group-hover:scale-105",
                              rotations[i],
                              offsets[i],
                              zIndexes[i],
                            )}
                          >
                            <img
                              src={url}
                              alt={`Photo ${i + 1}`}
                              className="h-full w-full object-cover"
                            />
                          </div>
                        );
                      })}
                    </button>
                  )}
              </div>
            </div>
          </div>

          {/* Headline */}
          {headline && (
            <div
              className="mt-3 text-sm text-slate-600 leading-relaxed [&_p]:mb-0"
              dangerouslySetInnerHTML={{ __html: headline }}
            />
          )}

          {/* Trait badges */}
          {traitBadges.length > 0 && (
            <div className="mt-3 flex gap-1.5">
              {traitBadges.map((badge, i) => {
                const Icon = BADGE_ICONS[badge.icon] || Check;
                return (
                  <span
                    key={i}
                    className={cn(
                      "flex-1 inline-flex items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-[10px] sm:text-xs font-medium whitespace-nowrap",
                      badge.primary
                        ? "bg-violet-100 text-violet-700"
                        : "bg-slate-100 text-slate-600",
                    )}
                  >
                    <Icon className="h-3 w-3 shrink-0" /> {badge.label}
                  </span>
                );
              })}
            </div>
          )}

          {/* ── Connect CTA ── */}
          {!isOwner && !isActiveNanny && (
            <div className="mt-4">
              {existingRequestStatus === "confirmed" ? (
                <Link href="/parent/connections">
                  <Button className="w-full bg-green-600 hover:bg-green-700 text-white font-medium h-10">
                    <Check className="mr-2 h-4 w-4" />
                    Connected
                  </Button>
                </Link>
              ) : existingRequestStatus === "pending" ||
                existingRequestStatus === "accepted" ? (
                <Link href="/parent/connections">
                  <Button className="w-full bg-green-600 hover:bg-green-700 text-white font-medium h-10">
                    <Check className="mr-2 h-4 w-4" />
                    Connection Pending
                  </Button>
                </Link>
              ) : isParent && hasActivePlacement ? (
                <Button
                  className="w-full bg-slate-200 text-slate-500 font-medium h-10"
                  onClick={() => setShowPlacementBlock(true)}
                >
                  Connect with {firstName}
                </Button>
              ) : isParent ? (
                <Button
                  className="w-full bg-violet-600 hover:bg-violet-700 text-white font-medium h-10"
                  onClick={() => setShowConnectModal(true)}
                >
                  Connect with {firstName}
                </Button>
              ) : (
                <Link
                  href={
                    funnelSource === "adv"
                      ? funnelLead
                        ? `/matchmaking/signup?lead=${funnelLead}`
                        : "/matchmaking/signup"
                      : funnelSource === "std"
                        ? "/signup?src=std"
                        : "/matchmaking/onboarding"
                  }
                >
                  <Button className="w-full bg-violet-600 hover:bg-violet-700 text-white font-medium h-10">
                    Connect with {firstName}
                  </Button>
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Placement block modal */}
      {showPlacementBlock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg space-y-4">
            <div className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              <h3 className="font-semibold text-lg">Position already filled</h3>
            </div>
            <p className="text-sm text-slate-600">
              You already have an active nanny on your position. To connect with{" "}
              {firstName}, you&apos;ll need to remove your current nanny first.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowPlacementBlock(false)}
              >
                Got it
              </Button>
              <Link href="/parent" className="flex-1">
                <Button className="w-full bg-violet-600 hover:bg-violet-700 text-white">
                  Go to My Position
                </Button>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Connect modal */}
      {isParent && (
        <ConnectModal
          isOpen={showConnectModal}
          onClose={() => setShowConnectModal(false)}
          nanny={{
            id: nanny.nanny_id,
            first_name: nanny.first_name,
            last_name: nanny.last_name,
            suburb: nanny.suburb,
            hourly_rate_min: nanny.hourly_rate_min,
            profile_picture_url: nanny.profile_picture_url,
            date_of_birth: nanny.date_of_birth,
          }}
          pendingRequestCount={pendingRequestCount}
        />
      )}

      {/* ═══════════════════════════════════════════════════════════════
          PROFILE SUB-TABS (About | Experience | Availability)
         ═══════════════════════════════════════════════════════════════ */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 mt-3">
        {PROFILE_TABS.map((tab) => {
          const isActive = profileTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setProfileTab(tab.id)}
              className={cn(
                "flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all",
                isActive
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── About sub-tab ── */}
      {profileTab === "about" && (
        <div className="space-y-3 mt-3">
          {/* 1. About */}
          {(aiAbout || nanny.motivation) && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="h-4 w-4 text-violet-400" />
                <h3 className="text-sm font-semibold text-slate-900">
                  About {firstName}
                </h3>
              </div>
              {aiAbout && (
                <div
                  className="text-sm text-slate-600 leading-relaxed [&_p]:mb-2 [&_p:last-child]:mb-0"
                  dangerouslySetInnerHTML={{ __html: aiAbout }}
                />
              )}
              {nanny.motivation && (
                <div className="mt-3 flex items-center gap-2 rounded-lg bg-violet-50/50 border border-violet-100 px-3 py-2">
                  <Heart className="h-3.5 w-3.5 text-violet-400 shrink-0" />
                  <p className="text-xs text-violet-600">
                    <span className="font-medium">What drives me:</span>{" "}
                    {nanny.motivation}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* 2. Personality */}
          {(aiPersonality ||
            (nanny.personality_traits &&
              nanny.personality_traits.length > 0)) && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Smile className="h-4 w-4 text-violet-500" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Personality
                </h3>
              </div>
              {aiPersonality && (
                <div
                  className="text-sm text-slate-600 leading-relaxed mb-3 [&_p]:mb-2 [&_p:last-child]:mb-0"
                  dangerouslySetInnerHTML={{ __html: aiPersonality }}
                />
              )}
              {nanny.personality_traits &&
                nanny.personality_traits.length > 0 && (
                  <div className="flex gap-1.5 overflow-hidden">
                    {nanny.personality_traits.map((trait) => (
                      <Tag key={trait} variant="violet">
                        {trait}
                      </Tag>
                    ))}
                  </div>
                )}
            </div>
          )}

          {/* 3. My Values */}
          {(aiValues ||
            (nanny.professional_values &&
              nanny.professional_values.length > 0)) && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <HandHeart className="h-4 w-4 text-violet-400" />
                <h3 className="text-sm font-semibold text-slate-900">
                  My Values
                </h3>
              </div>
              {aiValues && (
                <div
                  className="text-sm text-slate-600 leading-relaxed mb-3 [&_p]:mb-2 [&_p:last-child]:mb-0"
                  dangerouslySetInnerHTML={{ __html: aiValues }}
                />
              )}
              {nanny.professional_values &&
                nanny.professional_values.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {nanny.professional_values.map((value) => (
                      <Tag key={value} variant="violet">
                        {value}
                      </Tag>
                    ))}
                  </div>
                )}
            </div>
          )}

          {/* 4. What I Offer */}
          {(aiWhatIOffer ||
            (nanny.role_types_preferred &&
              nanny.role_types_preferred.length > 0)) && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Briefcase className="h-4 w-4 text-violet-400" />
                <h3 className="text-sm font-semibold text-slate-900">
                  What I Offer
                </h3>
              </div>
              {aiWhatIOffer && (
                <div
                  className="text-sm text-slate-600 leading-relaxed mb-3 [&_p]:mb-2 [&_p:last-child]:mb-0"
                  dangerouslySetInnerHTML={{ __html: aiWhatIOffer }}
                />
              )}
              <div className="flex flex-wrap gap-1.5">
                {nanny.role_types_preferred?.map((tag) => (
                  <Tag key={tag} variant="violet">
                    {tag}
                  </Tag>
                ))}
                {nanny.level_of_support_offered?.map((support) => (
                  <Tag key={support} variant="violet">
                    {support}
                  </Tag>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Experience sub-tab ── */}
      {profileTab === "experience" && (
        <div className="space-y-3 mt-3">
          {/* 1. Experience */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <Briefcase className="h-4 w-4 text-violet-400" />
              <h3 className="text-sm font-semibold text-slate-900">
                Experience
              </h3>
            </div>
            {aiExperience && (
              <div
                className="text-sm text-slate-600 leading-relaxed mb-4 [&_p]:mb-2 [&_p:last-child]:mb-0"
                dangerouslySetInnerHTML={{ __html: aiExperience }}
              />
            )}
            {!aiExperience &&
              (nanny.total_experience_years ||
                nanny.nanny_experience_years) && (
                <div className="space-y-1 text-sm text-slate-600 mb-4">
                  {nanny.total_experience_years != null && (
                    <p>
                      {nanny.total_experience_years} years total childcare
                      experience
                    </p>
                  )}
                  {nanny.nanny_experience_years != null && (
                    <p>{nanny.nanny_experience_years} years as a nanny</p>
                  )}
                </div>
              )}
            {statBoxes.length > 0 && (
              <div
                className={cn(
                  "grid gap-2.5",
                  statBoxes.length === 1 && "grid-cols-1 max-w-[200px]",
                  statBoxes.length === 2 && "grid-cols-2",
                  statBoxes.length === 3 && "grid-cols-3",
                )}
              >
                {statBoxes.map((s) => (
                  <StatBox key={s.label} value={s.value} label={s.label} />
                ))}
              </div>
            )}
          </div>

          {/* 2. Background */}
          {(aiBackground ||
            nanny.highest_qualification ||
            (nanny.childcare_roles && nanny.childcare_roles.length > 0)) && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <CalendarCheck className="h-4 w-4 text-violet-400" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Background
                </h3>
              </div>
              {aiBackground && (
                <div
                  className="text-sm text-slate-600 leading-relaxed mb-4 [&_p]:mb-2 [&_p:last-child]:mb-0"
                  dangerouslySetInnerHTML={{ __html: aiBackground }}
                />
              )}
              {nanny.highest_qualification && (
                <div className="flex items-start gap-2.5 rounded-lg bg-violet-50 border border-violet-100 px-3 py-2.5 mb-3">
                  <GraduationCap className="h-4 w-4 text-violet-500 mt-0.5 shrink-0" />
                  <span className="text-sm font-medium text-violet-700">
                    {nanny.highest_qualification}
                  </span>
                </div>
              )}
              {nanny.childcare_roles && nanny.childcare_roles.length > 0 && (
                <div className="space-y-2">
                  {nanny.childcare_roles.map((role) => (
                    <div
                      key={role.role}
                      className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5"
                    >
                      <span className="text-sm font-medium text-slate-700">
                        {role.role}
                      </span>
                      <span className="text-xs text-slate-500">
                        {role.duration} {role.duration === 1 ? "year" : "years"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 3. Safety & Assurance */}
          {(() => {
            const hasItems =
              isVerified ||
              orderedCerts.length > 0 ||
              otherCerts.length > 0 ||
              nanny.vaccination_status ||
              nanny.non_smoker;
            if (!hasItems) return null;
            return (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <ShieldCheck className="h-4 w-4 text-violet-400" />
                  <h3 className="text-sm font-semibold text-slate-900">
                    Safety & Assurance
                  </h3>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {isVerified && (
                    <GlanceItem
                      icon={ShieldCheck}
                      label="WWCC"
                      variant="green"
                    />
                  )}
                  {orderedCerts.map((cert) => (
                    <GlanceItem
                      key={cert}
                      icon={Award}
                      label={cert}
                      variant="green"
                    />
                  ))}
                  {otherCerts.map((cert) => (
                    <GlanceItem
                      key={cert}
                      icon={Award}
                      label={cert}
                      variant="green"
                    />
                  ))}
                  {nanny.vaccination_status && (
                    <GlanceItem
                      icon={Stethoscope}
                      label="Fully Vaccinated"
                      variant="green"
                    />
                  )}
                  {nanny.non_smoker && (
                    <GlanceItem
                      icon={CigaretteOff}
                      label="Non-Smoker"
                      variant="green"
                    />
                  )}
                </div>
              </div>
            );
          })()}

          {/* 4. Good to Know */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <ThumbsUp className="h-4 w-4 text-violet-400" />
              <h3 className="text-sm font-semibold text-slate-900">
                Good to Know
              </h3>
            </div>

            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Best with supporting
            </h4>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {nanny.min_child_age_months != null &&
                nanny.max_child_age_months != null && (
                  <GlanceItem
                    icon={Baby}
                    label={ageRangeToFriendly(
                      nanny.min_child_age_months,
                      nanny.max_child_age_months,
                    )}
                  />
                )}
              {nanny.max_children != null && (
                <GlanceItem
                  icon={Users}
                  label={childrenCountLabel(nanny.max_children)}
                />
              )}
            </div>

            {(nanny.additional_needs_ok || nanny.comfortable_with_pets) && (
              <>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  Can support
                </h4>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {nanny.additional_needs_ok && (
                    <GlanceItem
                      icon={Accessibility}
                      label="Children with additional needs"
                    />
                  )}
                  {nanny.comfortable_with_pets && (
                    <GlanceItem icon={PawPrint} label="Families with pets" />
                  )}
                </div>
              </>
            )}

            {(nanny.drivers_license || nanny.has_car) && (
              <>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  Additionally
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  {nanny.drivers_license && (
                    <GlanceItem icon={Car} label="I have my driver's license" />
                  )}
                  {nanny.has_car && (
                    <GlanceItem icon={Car} label="I have my own car" />
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Availability sub-tab ── */}
      {profileTab === "availability" && (
        <div className="space-y-3 mt-3">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-violet-400" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Availability
                </h3>
              </div>
              {nanny.immediate_start && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 border border-green-200 px-2.5 py-1 text-xs font-medium text-green-700">
                  <CalendarCheck className="h-3 w-3" /> Can start immediately
                </span>
              )}
            </div>
            {nanny.availability?.schedule &&
            Object.keys(nanny.availability.schedule).length > 0 ? (
              <AvailabilityGrid
                schedule={nanny.availability.schedule}
                firstName={firstName}
              />
            ) : (
              <p className="text-sm text-slate-400 italic">
                Availability not set yet.
              </p>
            )}

            {/* Inline quickmatch — guests only */}
            {isGuest && (
              <>
                <div className="border-t border-slate-100 my-5" />
                <InlineQuickMatch />
              </>
            )}
          </div>
        </div>
      )}

      {/* Childcare Professional tile — guests only, hidden during onboarding */}
      {isGuest && !hidePromoTile && (
        <Link
          href="/apply"
          className="flex items-center justify-between max-w-sm mx-auto w-full rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow mt-4 px-4 py-3"
          style={{
            background:
              "linear-gradient(135deg, #EDE9FE 0%, #DDD6FE 50%, #C4B5FD 100%)",
          }}
        >
          <div>
            <p className="text-sm font-bold text-violet-900 leading-snug">
              Childcare Professional?
            </p>
            <p className="text-xs text-violet-700 mt-0.5">
              Help us to develop young minds
            </p>
          </div>
          <div className="shrink-0 ml-3 inline-flex items-center gap-1 bg-white text-violet-700 text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm">
            Apply <ArrowRight className="h-3 w-3" />
          </div>
        </Link>
      )}

      {/* Photo viewer modal */}
      <ProfilePhotoViewer
        photos={nanny.additional_photos || []}
        open={photoViewerOpen}
        index={photoViewerIndex}
        firstName={firstName}
        onClose={() => setPhotoViewerOpen(false)}
        onIndexChange={setPhotoViewerIndex}
      />
    </>
  );
}
