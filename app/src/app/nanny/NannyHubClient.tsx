"use client";

/**
 * Nanny hub — hero card, verification banner, tabs, profile accordion and verification tile.
 * Unit 3b (BB-LDN-3b-061026, brief change 10; copy deck §5.1; P-7): the banner, the tile's DBS step and the
 * "Enhanced DBS" glance read `lib/dbs/nanny-display.ts` — banners for 23 (new certificate needed) and 26 (not on the
 * Update Service), "Verify DBS" tile, glance only at level ≥ 3 (`showsEnhancedDbsBadge`). Never: shows the glance or a
 * verified state at level 2 (23/26 drop her to level 2, P-7). Option lists / certificate ordering here are 3e's.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { ExpandablePhoto } from "@/components/ui/expandable-photo";
import {
  User,
  ChevronUp,
  ChevronDown,
  Pencil,
  MapPin,
  ShieldCheck,
  ShieldAlert,
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
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  NannyPositionsClient,
  type Placement,
} from "./positions/NannyPositionsClient";
import { NannyJobsView, type OpenPosition } from "./jobs/NannyJobsView";
import { NannyBabysittingClient } from "./babysitting/NannyBabysittingClient";
import type { NannyBabysittingJob } from "@/lib/actions/babysitting";
import type { UpcomingIntro } from "@/lib/actions/position-funnel";
import type { DfyNotification } from "@/lib/actions/matching";
import { ChildCardGrid } from "@/components/bapp/ChildCardGrid";
import { PendingInvitesSection } from "@/components/bapp/PendingInvitesSection";
import type { ChildClient, PendingInviteCard } from "@/types/bapp";
import { Button } from "@/components/ui/button";
import { VerificationRequiredModal } from "@/components/verification/VerificationRequiredModal";
import type { VerificationData } from "@/lib/actions/verification";
import { getDbsDisplayState, isDbsFailState, showsEnhancedDbsBadge } from "@/lib/dbs/nanny-display";

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
import { CERTIFICATE_OPTIONS, byOptionOrder } from "@/lib/nanny-options";

const KNOWN_CERTIFICATES: readonly string[] = CERTIFICATE_OPTIONS;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NannyProfileAccordionData {
  suburb: string;
  date_of_birth: string | null;
  nationality: string | null;
  total_experience_years: number | null;
  nanny_experience_years: number | null;
  under_3_experience_years: number | null;
  newborn_experience_years: number | null;
  role_types_preferred: string[] | null;
  level_of_support_offered: string[] | null;
  hourly_rate_min: number | null;
  max_children: number | null;
  min_child_age_months: number | null;
  max_child_age_months: number | null;
  drivers_license: boolean | null;
  has_car: boolean | null;
  comfortable_with_pets: boolean | null;
  vaccination_status: boolean | null;
  non_smoker: boolean | null;
  languages: string[] | null;
  hobbies_interests: string | null;
  strengths_traits: string | null;
  skills_training: string | null;
  ai_content: Record<string, unknown> | null;
  availability: {
    days_available: string[] | null;
    schedule: Record<string, string[]> | null;
  } | null;
  highest_qualification: string | null;
  certificates: string[];
  motivation: string | null;
  personality_traits: string[] | null;
  professional_values: string[] | null;
  childcare_roles: { role: string; duration: number }[] | null;
  additional_photos: string[];
  immediate_start: boolean;
  additional_needs: boolean;
}

export interface NannyApplication {
  id: string;
  positionId: string;
  familyName: string;
  suburb: string | null;
  createdAt: string;
}

interface NannyHubClientProps {
  firstName: string;
  lastName: string;
  profilePictureUrl: string | null;
  verificationLevel: number;
  verificationData: VerificationData | null;
  nannyProfile: NannyProfileAccordionData | null;
  placements: Placement[];
  upcomingIntros: UpcomingIntro[];
  dfyNotifications: DfyNotification[];
  openPositions: OpenPosition[];
  nannyApplications: NannyApplication[];
  babysittingJobs: NannyBabysittingJob[];
  bsrBanned: boolean;
  bsrBanUntil: string | null;
  shareUnlocked: boolean;
  educationChildren: ChildClient[];
  /** Subscribed-family tick state per child — DSS §8 Q8. */
  subscribedChildIds?: string[];
  pendingInvites?: PendingInviteCard[];
}

// ── Tab definitions ──────────────────────────────────────────────────────────

// `"children"` was previously named `"education"` (amendment A-02). The
// tab shows the children the nanny is connected with — not educational
// content — so "Children" is the user-visible label and the internal id
// matches. Old `?t=education` URL-aliasing happens at the parse site
// (ParentHubClient — the nanny hub doesn't currently read ?t= for tab).
type MainTabId = "verification" | "nannying" | "babysitting" | "children";

const PROFILE_TABS = [
  { id: "about" as const, label: "About" },
  { id: "experience" as const, label: "Experience" },
  { id: "availability" as const, label: "Availability" },
];
type ProfileTabId = (typeof PROFILE_TABS)[number]["id"];

// ══════════════════════════════════════════════════════════════════════════════
//  COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

export function NannyHubClient({
  firstName,
  profilePictureUrl,
  verificationLevel,
  verificationData,
  nannyProfile,
  placements,
  upcomingIntros,
  dfyNotifications,
  openPositions,
  nannyApplications,
  babysittingJobs,
  bsrBanned,
  bsrBanUntil,
  shareUnlocked,
  educationChildren,
  subscribedChildIds,
  pendingInvites = [],
}: NannyHubClientProps) {
  const subscribedChildIdSet = subscribedChildIds
    ? new Set(subscribedChildIds)
    : undefined;
  // ── Verification locking ──
  const isTabsLocked = verificationLevel < 3;

  const [activeTab, setActiveTab] = useState<MainTabId>(
    isTabsLocked ? "verification" : "nannying",
  );
  // Default sub-tab is Connections (leftmost) per user spec
  // 2026-05-07. Connections show first because most active nannies
  // already have placements they want to glance at; Jobs is the
  // secondary "what else is out there" surface.
  const [nannySubTab, setNannySubTab] = useState<"jobs" | "connections">(
    "connections",
  );
  const [profileExpanded, setProfileExpanded] = useState(false);
  const [profileTab, setProfileTab] = useState<ProfileTabId>("about");
  const [showTabLockedModal, setShowTabLockedModal] = useState(false);
  const [photoViewerOpen, setPhotoViewerOpen] = useState(false);
  const [photoViewerIndex, setPhotoViewerIndex] = useState(0);

  // If `isTabsLocked` flips to false mid-session (verification level ticks
  // from 2→3, e.g. after a real-time level refresh), the Verification tab
  // disappears from the rendered array. Without this guard the user is
  // stuck on an orphan activeTab='verification' with no rendered content.
  // Reset to the natural default. code-reviewer 2026-05-19.
  useEffect(() => {
    if (!isTabsLocked && activeTab === "verification") {
      setActiveTab("nannying");
    }
  }, [isTabsLocked, activeTab]);

  const p = nannyProfile;
  const ai = p?.ai_content;
  const age = computeAge(p?.date_of_birth ?? null);

  // Verification — numeric level (1-4), badge shows at 3+
  const isVerified = verificationLevel >= 3;

  // Dynamic verification banner — only shows when action is required (not during processing/review)
  const verificationBanner = (() => {
    if (isVerified) return null;

    // No verifications row at all — hasn't started
    if (!verificationData)
      return "Verify your account to connect with families";

    const { identity_status, contact_status } = verificationData;
    const dbsState = getDbsDisplayState(verificationData);

    // Failed/rejected states — action required
    if (["failed", "rejected"].includes(identity_status))
      return "Your ID verification needs attention — review and resubmit";
    // 23 / 26 — first check or the daily re-check (copy deck §5.1)
    if (dbsState === "new_info")
      return "You'll need a new DBS certificate to keep connecting with families";
    if (dbsState === "no_match")
      return "We couldn't confirm your DBS on the Update Service — check your subscription";
    if (isDbsFailState(dbsState))
      return "Your DBS check needs attention — review and resubmit";

    // Not started states — prompt to begin
    if (contact_status !== "saved" && contact_status !== "verified")
      return "Verify your address to start connecting with families";
    if (["not_started"].includes(identity_status))
      return "Upload your ID to get verified and connect with families";
    if (dbsState === "not_started")
      return "Upload your DBS certificate to complete verification";

    // Processing/pending/review — no banner (waiting on us, not them)
    return null;
  })();

  // ── AI content extraction (new V2 field paths) ──
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

  // ── Badge pills (experience stats + qualification only) ──
  const traitBadges: { icon: string; label: string; primary?: boolean }[] = [];
  if (p) {
    if (p.total_experience_years && p.total_experience_years > 0)
      traitBadges.push({
        icon: "Clock",
        label: `${p.total_experience_years}${p.total_experience_years === 1 ? "yr" : "yrs"} experience`,
        primary: true,
      });
    if (p.under_3_experience_years && p.under_3_experience_years > 0)
      traitBadges.push({
        icon: "Baby",
        label: `Toddlers, ${p.under_3_experience_years}${p.under_3_experience_years === 1 ? "yr" : "yrs"}`,
        primary: true,
      });
    if (p.newborn_experience_years && p.newborn_experience_years > 0)
      traitBadges.push({
        icon: "Baby",
        label: `Babies, ${p.newborn_experience_years}${p.newborn_experience_years === 1 ? "yr" : "yrs"}`,
        primary: true,
      });
  }

  // ── Stat boxes for experience tab ──
  const statBoxes: { value: number; label: string }[] = [];
  if (p) {
    if (p.total_experience_years && p.total_experience_years > 0)
      statBoxes.push({
        value: p.total_experience_years,
        label: "Years Childcare",
      });
    if (p.under_3_experience_years && p.under_3_experience_years > 0)
      statBoxes.push({
        value: p.under_3_experience_years,
        label: "Years Under 3s",
      });
    if (p.newborn_experience_years && p.newborn_experience_years > 0)
      statBoxes.push({
        value: p.newborn_experience_years,
        label: "Years Newborns",
      });
  }

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════════════
          VERIFICATION BANNER
         ═══════════════════════════════════════════════════════════════════ */}
      {verificationBanner && (
        <Link
          href="/nanny/verification"
          className="flex items-center justify-between rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 group hover:bg-amber-100 transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0">
            <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0" />
            <p className="text-sm text-amber-800 font-medium line-clamp-2">
              {verificationBanner}
            </p>
          </div>
          <span className="text-xs font-semibold text-amber-700 bg-amber-200/60 px-3 py-1 rounded-full shrink-0 ml-3 group-hover:bg-amber-200 transition-colors">
            Verify Now
          </span>
        </Link>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          HERO CARD
         ═══════════════════════════════════════════════════════════════════ */}
      <div className="relative rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {isVerified ? (
          <span className="absolute top-3 right-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-green-50 border border-green-200 px-3 py-1 text-xs font-semibold text-green-700">
            <ShieldCheck className="h-3.5 w-3.5" /> Verified
          </span>
        ) : (
          <a
            href="/nanny/verification"
            className="absolute top-3 right-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-slate-100 border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-200 transition-colors"
          >
            <ShieldAlert className="h-3.5 w-3.5" /> Unverified
          </a>
        )}
        <div className="h-12 bg-gradient-to-br from-violet-50 to-violet-100/50" />

        <div className="relative px-5 pb-5">
          <Link
            href="/nanny/profile"
            className="absolute top-14 right-4 flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 hover:text-violet-600 hover:bg-slate-50 transition-colors z-10"
            title="Edit Profile"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Link>
          <div className="flex items-end gap-4 -mt-10">
            <div className="relative shrink-0">
              {profilePictureUrl ? (
                <ExpandablePhoto
                  src={profilePictureUrl}
                  alt={`${firstName}'s photo`}
                >
                  <div className="relative h-32 w-32 overflow-hidden rounded-full border-4 border-white bg-violet-50 shadow-md">
                    <img
                      src={profilePictureUrl}
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
              {/* Details block with photo fan absolutely positioned to the right */}
              <div className="relative mt-0.5">
                <div>
                  {p?.nationality && (
                    <p className="flex items-center gap-1 text-sm text-slate-500 mt-0.5">
                      <Globe className="h-3.5 w-3.5" /> {p.nationality}
                    </p>
                  )}
                  {p?.languages &&
                    p.languages.filter(
                      (l) => l !== "Foreign Language" && l !== "Multiple",
                    ).length > 0 && (
                      <p className="flex items-center gap-1 text-xs text-slate-400 mt-0.5">
                        <Languages className="h-3 w-3" />
                        {p.languages
                          .filter(
                            (l) => l !== "Foreign Language" && l !== "Multiple",
                          )
                          .join(", ")}
                      </p>
                    )}
                  {p?.suburb && (
                    <p className="flex items-center gap-1 text-sm text-slate-500 mt-0.5">
                      <MapPin className="h-3.5 w-3.5" /> {p.suburb}
                    </p>
                  )}
                </div>

                {/* Additional photos — fanned stack */}
                {p?.additional_photos && p.additional_photos.length > 0 && (
                  <button
                    onClick={() => {
                      setPhotoViewerIndex(0);
                      setPhotoViewerOpen(true);
                    }}
                    className="absolute top-0 right-0 bottom-0 w-16 cursor-pointer group"
                  >
                    {p.additional_photos.slice(0, 3).map((url, i) => {
                      const rotations = [
                        "-rotate-[20deg]",
                        "rotate-0",
                        "rotate-[20deg]",
                      ];
                      const offsets = ["left-0", "left-3", "left-6"];
                      const zIndexes = ["z-[3]", "z-[2]", "z-[1]"];
                      return (
                        <div
                          key={i}
                          className={cn(
                            "absolute top-1/2 -translate-y-1/2 h-[85%] aspect-square overflow-hidden rounded-lg border-2 border-white shadow-md transition-transform group-hover:scale-105",
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

          {/* ai_content.headline */}
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

          {/* "Childcare Profile" accordion toggle */}
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setProfileExpanded((prev) => !prev)}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-700 px-4 py-2.5 text-white font-medium text-sm transition-colors h-10"
            >
              <User className="h-4 w-4" />
              Childcare Profile
              {profileExpanded ? (
                <ChevronUp className="h-4 w-4 ml-1" />
              ) : (
                <ChevronDown className="h-4 w-4 ml-1" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          ACCORDION — Profile sub-tabs (About | Experience | Availability)
         ═══════════════════════════════════════════════════════════════════ */}
      {profileExpanded && p && (
        <>
          {/* Sub-tab bar */}
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
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
            <div className="space-y-3">
              {/* 1. About {firstName} */}
              {(aiAbout || p.motivation) && (
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
                  {p.motivation && (
                    <div className="mt-3 flex items-center gap-2 rounded-lg bg-violet-50/50 border border-violet-100 px-3 py-2">
                      <Heart className="h-3.5 w-3.5 text-violet-400 shrink-0" />
                      <p className="text-xs text-violet-600">
                        <span className="font-medium">What drives me:</span>{" "}
                        {p.motivation}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* 2. Personality */}
              {(aiPersonality ||
                (p.personality_traits && p.personality_traits.length > 0)) && (
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
                  {p.personality_traits && p.personality_traits.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {p.personality_traits.map((trait) => (
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
                (p.professional_values &&
                  p.professional_values.length > 0)) && (
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
                  {p.professional_values &&
                    p.professional_values.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {p.professional_values.map((value) => (
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
                (p.role_types_preferred &&
                  p.role_types_preferred.length > 0)) && (
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
                    {p.role_types_preferred?.map((tag) => (
                      <Tag key={tag} variant="violet">
                        {tag}
                      </Tag>
                    ))}
                    {p.level_of_support_offered?.map((support) => (
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
            <div className="space-y-3">
              {/* 1. Experience */}
              <div className="relative rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <Link
                  href="/nanny/profile"
                  className="absolute top-4 right-4 flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 hover:text-violet-600 hover:bg-slate-50 transition-colors"
                  title="Edit Profile"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Link>
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
                  (p.total_experience_years || p.nanny_experience_years) && (
                    <div className="space-y-1 text-sm text-slate-600 mb-4">
                      {p.total_experience_years != null && (
                        <p>
                          {p.total_experience_years} years total childcare
                          experience
                        </p>
                      )}
                      {p.nanny_experience_years != null && (
                        <p>{p.nanny_experience_years} years as a nanny</p>
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
                p.highest_qualification ||
                (p.childcare_roles && p.childcare_roles.length > 0)) && (
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
                  {p.highest_qualification && (
                    <div className="flex items-start gap-2.5 rounded-lg bg-violet-50 border border-violet-100 px-3 py-2.5 mb-3">
                      <GraduationCap className="h-4 w-4 text-violet-500 mt-0.5 shrink-0" />
                      <span className="text-sm font-medium text-violet-700">
                        {p.highest_qualification}
                      </span>
                    </div>
                  )}
                  {p.childcare_roles && p.childcare_roles.length > 0 && (
                    <div className="space-y-2">
                      {p.childcare_roles.map((role) => (
                        <div
                          key={role.role}
                          className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5"
                        >
                          <span className="text-sm font-medium text-slate-700">
                            {role.role}
                          </span>
                          <span className="text-xs text-slate-500">
                            {role.duration}{" "}
                            {role.duration === 1 ? "year" : "years"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 3. Safety & Assurance */}
              {(() => {
                // P-2: CERTIFICATE_OPTIONS order; values not on the list follow in stored order
                const sortedCerts = [...p.certificates].sort(
                  byOptionOrder(CERTIFICATE_OPTIONS),
                );
                const orderedCerts = sortedCerts.filter((c) =>
                  KNOWN_CERTIFICATES.includes(c),
                );
                const otherCerts = sortedCerts.filter(
                  (c) => !KNOWN_CERTIFICATES.includes(c),
                );
                const showDbsGlance = showsEnhancedDbsBadge(verificationLevel);
                const hasItems =
                  showDbsGlance ||
                  orderedCerts.length > 0 ||
                  otherCerts.length > 0 ||
                  p.vaccination_status ||
                  p.non_smoker;
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
                      {showDbsGlance && (
                        <GlanceItem
                          icon={ShieldCheck}
                          label="Enhanced DBS"
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
                      {p.vaccination_status && (
                        <GlanceItem
                          icon={Stethoscope}
                          label="Fully Vaccinated"
                          variant="green"
                        />
                      )}
                      {p.non_smoker && (
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

                {/* Best with supporting */}
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  Best with supporting
                </h4>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {p.min_child_age_months != null &&
                    p.max_child_age_months != null && (
                      <GlanceItem
                        icon={Baby}
                        label={ageRangeToFriendly(
                          p.min_child_age_months,
                          p.max_child_age_months,
                        )}
                      />
                    )}
                  {p.max_children != null && (
                    <GlanceItem
                      icon={Users}
                      label={childrenCountLabel(p.max_children)}
                    />
                  )}
                </div>

                {/* Can support */}
                {(p.additional_needs || p.comfortable_with_pets) && (
                  <>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                      Can support
                    </h4>
                    <div className="grid grid-cols-2 gap-2 mb-4">
                      {p.additional_needs && (
                        <GlanceItem
                          icon={Accessibility}
                          label="Children with additional needs"
                        />
                      )}
                      {p.comfortable_with_pets && (
                        <GlanceItem
                          icon={PawPrint}
                          label="Families with pets"
                        />
                      )}
                    </div>
                  </>
                )}

                {/* Additionally */}
                {(p.drivers_license || p.has_car) && (
                  <>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                      Additionally
                    </h4>
                    <div className="grid grid-cols-2 gap-2">
                      {p.drivers_license && (
                        <GlanceItem
                          icon={Car}
                          label="I have my driver's license"
                        />
                      )}
                      {p.has_car && (
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
            <div className="space-y-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-violet-400" />
                    <h3 className="text-sm font-semibold text-slate-900">
                      Availability
                    </h3>
                  </div>
                  {p.immediate_start && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 border border-green-200 px-2.5 py-1 text-xs font-medium text-green-700">
                      <CalendarCheck className="h-3 w-3" /> Can start
                      immediately
                    </span>
                  )}
                </div>
                {p.availability?.schedule &&
                Object.keys(p.availability.schedule).length > 0 ? (
                  <AvailabilityGrid
                    schedule={p.availability.schedule}
                    firstName={firstName}
                  />
                ) : (
                  <p className="text-sm text-slate-400 italic">
                    Availability not set yet.
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {profileExpanded && !p && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm text-center">
          <p className="text-sm text-slate-500">
            Complete your profile to see it here.
          </p>
          <Link
            href="/nanny/profile"
            className="inline-flex items-center gap-1 mt-2 text-sm font-medium text-violet-600 hover:text-violet-700"
          >
            <Pencil className="h-3.5 w-3.5" />
            Set up profile
          </Link>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          MAIN TAB BAR — Verification (only at level<3) + Nannying +
          Children + Babysitting. Bailey 2026-05-19 amendments 1 + 3:
            • Children tab is ALWAYS visible (was hidden when locked) — was
              dropping unverified users out of a discoverable surface.
            • Nannying tab is ALWAYS unlocked (was locked at level<3) —
              backend gates every state-changing action server-side, so
              there's no safety value in the UI lock. Lets unverified
              nannies browse Jobs + see their existing placements.
            • Babysitting stays locked at level<3 (separate gate — needs
              level>=4 + babysitter_eligible).
            • Verification tab appears only at level<3 as the primary CTA.
         ═══════════════════════════════════════════════════════════════════ */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
        {[
          ...(isTabsLocked
            ? [
                {
                  id: "verification" as MainTabId,
                  label: "Verification",
                  locked: false,
                },
              ]
            : []),
          { id: "nannying" as MainTabId, label: "Nannying", locked: false },
          { id: "children" as MainTabId, label: "Children", locked: false },
          {
            id: "babysitting" as MainTabId,
            label: "Babysitting",
            locked: isTabsLocked,
          },
        ].map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              // `aria-disabled` (not `disabled`) — the button still handles the
              // click to open the modal; we just announce the locked state to
              // assistive tech. `aria-haspopup="dialog"` cues SR users that
              // activation opens a Dialog. a11y-architect 2026-05-19.
              aria-disabled={tab.locked || undefined}
              aria-haspopup={tab.locked ? "dialog" : undefined}
              onClick={() =>
                tab.locked ? setShowTabLockedModal(true) : setActiveTab(tab.id)
              }
              className={cn(
                "flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all",
                tab.locked
                  ? "opacity-50 cursor-not-allowed text-slate-400"
                  : isActive
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700",
              )}
            >
              <span className="flex items-center justify-center gap-1.5">
                {tab.label}
                {tab.locked && <Lock className="h-3 w-3" aria-hidden="true" />}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Tab Content ── */}
      {activeTab === "verification" && isTabsLocked && (
        <VerificationSummaryTile verificationData={verificationData} />
      )}
      {activeTab === "nannying" && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {/* Sub-tab toggle */}
          <div className="px-4 pt-3 pb-0">
            <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
              {[
                // Sub-tab order — Connections leftmost per user spec
                // 2026-05-07.
                { id: "connections" as const, label: "Connections" },
                { id: "jobs" as const, label: "Jobs" },
              ].map((tab) => {
                const isActive = nannySubTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setNannySubTab(tab.id)}
                    className={cn(
                      "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                      isActive
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-400 hover:text-slate-600",
                    )}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Subtab content */}
          {nannySubTab === "jobs" && (
            <div className="p-4">
              <NannyJobsView
                positions={openPositions}
                appliedPositionIds={
                  new Set(nannyApplications.map((a) => a.positionId))
                }
              />
            </div>
          )}
          {nannySubTab === "connections" && (
            <NannyPositionsClient
              placements={placements}
              upcomingIntros={upcomingIntros}
              dfyNotificationsInitial={dfyNotifications}
              shareUnlocked={shareUnlocked}
              embedded
            />
          )}
        </div>
      )}
      {activeTab === "babysitting" && (
        <NannyBabysittingClient
          jobs={babysittingJobs}
          banned={bsrBanned}
          banUntil={bsrBanUntil}
          hideHeader
          shareUnlocked={shareUnlocked}
        />
      )}
      {activeTab === "children" && (
        <>
          <PendingInvitesSection initialInvites={pendingInvites} />
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <ChildCardGrid
              // eslint-disable-next-line react/no-children-prop -- `children` here is the data prop name of ChildCardGrid, not React children
              children={educationChildren}
              role="nanny"
              subscribedChildIds={subscribedChildIdSet}
            />
          </div>
        </>
      )}

      {/* Tab-locked modal (shared component, lifted from inline Dialog) */}
      <VerificationRequiredModal
        open={showTabLockedModal}
        onOpenChange={setShowTabLockedModal}
      />

      {/* Photo viewer modal */}
      <ProfilePhotoViewer
        photos={p?.additional_photos || []}
        open={photoViewerOpen}
        index={photoViewerIndex}
        firstName={firstName}
        onClose={() => setPhotoViewerOpen(false)}
        onIndexChange={setPhotoViewerIndex}
      />
    </>
  );
}

// ── Verification Summary Tile (for hub verification tab) ──────────────────────

type VerificationStepState =
  | "completed"
  | "current"
  | "action_required"
  | "future";

function VerificationSummaryTile({
  verificationData,
}: {
  verificationData: VerificationData | null;
}) {
  const identityStatus = verificationData?.identity_status ?? "not_started";
  const dbsState = getDbsDisplayState(verificationData);
  // The tile's status line reads the same decoder: running → "Processing", with the team → "Pending Review".
  const dbsStatus =
    dbsState === "reading" || dbsState === "checking"
      ? "processing"
      : dbsState === "with_team" || dbsState === "manual_review"
        ? "review"
        : dbsState;
  const contactStatus = verificationData?.contact_status ?? "not_started";

  function deriveIdentityStep(): VerificationStepState {
    if (!verificationData?.address_line) return "future"; // residence not done yet
    if (identityStatus === "verified") return "completed";
    if (identityStatus === "rejected" || identityStatus === "failed")
      return "action_required";
    if (identityStatus === "not_started") return "current";
    return "current"; // processing, pending, review
  }

  function deriveDbsStep(): VerificationStepState {
    const vStatus = verificationData?.verification_status ?? 0;
    if (vStatus < 20) return "future"; // identity not yet verified — the DBS step waits
    if (dbsState === "clear") return "completed";
    if (isDbsFailState(dbsState) || dbsState === "barred") return "action_required";
    return "current"; // not started, reading, checking, with the team
  }

  function deriveContactStep(): VerificationStepState {
    if (contactStatus === "saved") return "completed";
    return "current";
  }

  const identityStep = deriveIdentityStep();
  const dbsStep = deriveDbsStep();
  const contactStep = deriveContactStep();
  const allComplete =
    identityStep === "completed" &&
    dbsStep === "completed" &&
    contactStep === "completed";
  const goalStep: VerificationStepState = allComplete ? "completed" : "future";

  function stepStatusText(
    step: VerificationStepState,
    statusCode: string,
  ): string | null {
    if (step === "completed") return "Completed";
    if (step === "action_required") return "Action Required";
    if (step === "future") return null;
    if (statusCode === "processing" || statusCode === "pending")
      return "Processing";
    if (statusCode === "review") return "Pending Review";
    if (statusCode === "not_started") return "Not Started";
    return "In Progress";
  }

  function stepColor(step: VerificationStepState): {
    circle: string;
    text: string;
  } {
    switch (step) {
      case "completed":
        return {
          circle: "border-green-500 bg-green-500",
          text: "text-green-600",
        };
      case "current":
        return {
          circle: "border-violet-500 bg-violet-50",
          text: "text-violet-600",
        };
      case "action_required":
        return { circle: "border-red-500 bg-red-50", text: "text-red-600" };
      case "future":
        return { circle: "border-slate-200 bg-white", text: "text-slate-400" };
    }
  }

  const steps = [
    { label: "Verify Residence", step: contactStep, status: contactStatus },
    { label: "Verify ID", step: identityStep, status: identityStatus },
    { label: "Verify DBS", step: dbsStep, status: dbsStatus },
    { label: "Connect with Families", step: goalStep, status: "" },
  ];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <ShieldCheck className="h-5 w-5 text-violet-600" />
        <p className="text-base font-semibold text-slate-800">
          Verification Progress
        </p>
      </div>

      <div className="space-y-0">
        {steps.map((s, i) => {
          const colors = stepColor(s.step);
          const isLast = i === steps.length - 1;
          return (
            <div key={s.label} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2",
                    colors.circle,
                  )}
                >
                  {s.step === "completed" && (
                    <Check className="h-4 w-4 text-white" />
                  )}
                  {s.step === "current" && (
                    <div className="h-2.5 w-2.5 rounded-full bg-violet-500" />
                  )}
                  {s.step === "action_required" && (
                    <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
                  )}
                </div>
                {!isLast && (
                  <div
                    className={cn(
                      "w-0.5 h-6",
                      s.step === "completed" &&
                        steps[i + 1]?.step === "completed"
                        ? "bg-green-300"
                        : "bg-slate-200",
                    )}
                  />
                )}
              </div>
              <div className="pb-4 pt-1">
                <p
                  className={cn(
                    "text-sm font-medium",
                    s.step === "future" ? "text-slate-400" : "text-slate-800",
                  )}
                >
                  {s.label}
                </p>
                {!isLast && stepStatusText(s.step, s.status) && (
                  <p className={cn("text-xs", colors.text)}>
                    {stepStatusText(s.step, s.status)}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Link
        href="/nanny/verification"
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-700 px-4 py-2.5 text-white font-medium text-sm transition-colors"
      >
        Continue Verification
      </Link>
    </div>
  );
}
