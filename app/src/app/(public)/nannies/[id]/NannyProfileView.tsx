// ═══════════════════════════════════════════════════════════════════
// DEPRECATED — This is the OLD nanny profile view.
// The NEW version is: src/app/parent/browse/[id]/ParentNannyProfileView.tsx
// ═══════════════════════════════════════════════════════════════════

"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { PublicNannyProfile } from "@/lib/actions/nanny";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConnectModal } from "@/components/ConnectModal";
import {
  User,
  FileText,
  CheckSquare,
  CalendarDays,
  MapPin,
  ShieldCheck,
  BadgeCheck,
  Pencil,
  Check,
  AlertTriangle,
} from "lucide-react";

// ── Helpers ──

function calculateAge(dob: string | null): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age > 0 && age < 120 ? age : null;
}

function ageMonthsToLabel(months: number | null | undefined): string {
  if (months === null || months === undefined) return "Any";
  if (months === 0) return "Newborn";
  if (months < 12) return `${months} months`;
  const y = Math.floor(months / 12);
  return `${y} year${y > 1 ? "s" : ""}`;
}

function parseBioSummary(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// ── Tab definitions ──

const TABS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "about", label: "About", icon: FileText },
  { id: "checklist", label: "Checklist", icon: CheckSquare },
  { id: "availability", label: "Availability", icon: CalendarDays },
] as const;

type TabId = (typeof TABS)[number]["id"];

// ── Availability Grid ──

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const TIME_SLOTS = ["Morning (6am-10am)", "Midday (10am-2pm)", "Afternoon (2pm-6pm)", "Evening (6pm-10pm)"] as const;
const SLOT_LABELS = ["Morning", "Midday", "Afternoon", "Evening"];
const SLOT_RANGES = [
  { start: 6, end: 10 },
  { start: 10, end: 14 },
  { start: 14, end: 18 },
  { start: 18, end: 22 },
];

function normaliseDaySlots(raw: unknown): boolean[] {
  if (!raw) return [false, false, false, false];
  if (Array.isArray(raw)) {
    return TIME_SLOTS.map((slot) => raw.includes(slot));
  }
  if (typeof raw === "object" && raw !== null && "available" in raw) {
    const obj = raw as { available?: boolean; start?: string | null; end?: string | null };
    if (!obj.available || !obj.start || !obj.end) return [false, false, false, false];
    const startHour = parseInt(obj.start.split(":")[0]);
    const endHour = parseInt(obj.end.split(":")[0]);
    return SLOT_RANGES.map((range) => startHour <= range.start && endHour >= range.end);
  }
  return [false, false, false, false];
}

function AvailabilityGrid({ availability }: { availability: PublicNannyProfile["availability"] }) {
  if (!availability?.days_available || availability.days_available.length === 0) {
    return <p className="text-sm text-slate-500 italic">Availability not set yet.</p>;
  }
  const schedule = availability.schedule || {};
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="py-2 pr-3 text-left text-xs font-medium text-slate-500 uppercase" />
            {SLOT_LABELS.map((label) => (
              <th key={label} className="px-2 py-2 text-center text-xs font-medium text-slate-500 uppercase">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAYS.map((day) => {
            const dayKey = day.toLowerCase();
            const rawEntry = (schedule as Record<string, unknown>)[dayKey];
            const slotActive = normaliseDaySlots(rawEntry);
            const isAvailable = availability.days_available?.includes(day);
            return (
              <tr key={day} className="border-t border-slate-100">
                <td className="py-2.5 pr-3 font-medium text-slate-700 text-sm whitespace-nowrap">{day.slice(0, 3)}</td>
                {SLOT_LABELS.map((_, i) => {
                  const active = isAvailable && slotActive[i];
                  return (
                    <td key={i} className="px-2 py-2.5 text-center">
                      <span className={cn(
                        "inline-flex h-7 w-7 items-center justify-center rounded-full text-xs",
                        active ? "bg-violet-100 text-violet-600" : "bg-slate-50 text-slate-300"
                      )}>
                        {active ? "✓" : "–"}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Section Card ──

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="mb-3 text-sm font-semibold text-slate-500 uppercase tracking-wider">{title}</h3>
      {children}
    </div>
  );
}

// ── Verification Badge ──

function VerificationBadge({ level }: { level: number }) {
  if (level >= 4) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
        <BadgeCheck className="h-3.5 w-3.5" /> Fully Verified
      </span>
    );
  }
  if (level >= 3) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-700">
        <ShieldCheck className="h-3.5 w-3.5" /> ID Verified
      </span>
    );
  }
  return null;
}

// ── Main Component ──

interface NannyProfileViewProps {
  nanny: PublicNannyProfile;
  isOwner?: boolean;
  isParent?: boolean;
  isGuest?: boolean;
  pendingRequestCount?: number;
  existingRequestStatus?: string | null;
  hasActivePlacement?: boolean;
  isActiveNanny?: boolean;
}

export function NannyProfileView({
  nanny,
  isOwner = false,
  isParent = false,
  isGuest = false,
  pendingRequestCount = 0,
  existingRequestStatus = null,
  hasActivePlacement = false,
  isActiveNanny = false,
}: NannyProfileViewProps) {
  const [activeTab, setActiveTab] = useState<TabId>("profile");
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showPlacementBlock, setShowPlacementBlock] = useState(false);

  const age = calculateAge(nanny.date_of_birth);
  const ai = nanny.ai_content as Record<string, unknown> | null;
  const bioSummary = parseBioSummary(typeof ai?.bio_summary === 'string' ? ai.bio_summary : undefined);
  const tagline = (ai?.headline as string) || "";
  const bioContent = (ai?.parent_pitch as string) || "";
  const experienceContent = (ai?.experience_summary as string) || "";
  const checklistContent = (ai?.skills_highlight as string) || "";

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {/* Owner banner */}
      {isOwner && (
        <Link
          href="/nanny/profile"
          className="mb-4 flex items-center justify-between rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 transition-colors hover:bg-violet-100"
        >
          <span className="text-sm text-violet-700">This is your profile as parents see it.</span>
          <span className="flex items-center gap-1.5 text-sm font-medium text-violet-600">
            <Pencil className="h-3.5 w-3.5" />
            Edit Profile
          </span>
        </Link>
      )}

      {/* ── Hero Section ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex gap-5">
          <div className="flex-shrink-0">
            <div className="relative h-24 w-24 overflow-hidden rounded-full border-3 border-violet-200 bg-violet-50">
              {nanny.profile_picture_url ? (
                <Image
                  src={nanny.profile_picture_url}
                  alt={`${nanny.first_name}'s photo`}
                  fill
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-3xl font-bold text-violet-300">
                  {nanny.first_name[0]}
                </div>
              )}
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">
                  {nanny.first_name.charAt(0).toUpperCase() + nanny.first_name.slice(1)}{age ? `, ${age}` : ""}
                </h1>
                <p className="flex items-center gap-1 text-sm text-slate-500 mt-0.5">
                  <MapPin className="h-3.5 w-3.5" />
                  {nanny.suburb}
                </p>
              </div>
              <VerificationBadge level={nanny.verification_level ?? 0} />
            </div>
            {tagline && (
              <div className="mt-3">
                <div
                  className="text-sm text-slate-700 leading-relaxed [&_p]:mb-3 [&_p:last-child]:mb-0"
                  dangerouslySetInnerHTML={{ __html: tagline.replace(/<\/?p>/g, "") }}
                />
              </div>
            )}
            {nanny.hourly_rate_min && (
              <p className="mt-2 text-sm font-medium text-violet-600">
                From £{nanny.hourly_rate_min}/hr
              </p>
            )}
          </div>
        </div>

        {/* CTA */}
        {!isOwner && !isActiveNanny && (
          <div className="mt-5">
            {existingRequestStatus === 'confirmed' ? (
              <Link href="/parent/connections">
                <Button className="w-full bg-green-600 hover:bg-green-700 text-white font-medium">
                  <Check className="mr-2 h-4 w-4" />
                  Connected
                </Button>
              </Link>
            ) : existingRequestStatus === 'pending' || existingRequestStatus === 'accepted' ? (
              <Link href="/parent/connections">
                <Button className="w-full bg-green-600 hover:bg-green-700 text-white font-medium">
                  <Check className="mr-2 h-4 w-4" />
                  Connection Pending
                </Button>
              </Link>
            ) : isParent && hasActivePlacement ? (
              <Button
                className="w-full bg-slate-200 text-slate-500 font-medium"
                onClick={() => setShowPlacementBlock(true)}
              >
                Connect with {nanny.first_name}
              </Button>
            ) : isParent ? (
              <Button
                className="w-full bg-violet-600 hover:bg-violet-700 text-white font-medium"
                onClick={() => setShowConnectModal(true)}
              >
                Connect with {nanny.first_name}
              </Button>
            ) : (
              <Link href="/signup">
                <Button className="w-full bg-violet-600 hover:bg-violet-700 text-white font-medium">
                  Sign Up to Connect with {nanny.first_name}
                </Button>
              </Link>
            )}
          </div>
        )}

        {/* Active Placement Block Popup */}
        {showPlacementBlock && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg space-y-4">
              <div className="flex items-center gap-2 text-amber-600">
                <AlertTriangle className="h-5 w-5" />
                <h3 className="font-semibold text-lg">Position already filled</h3>
              </div>
              <p className="text-sm text-slate-600">
                You already have an active nanny on your position. To connect with {nanny.first_name}, you&apos;ll need to remove your current nanny first.
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

        {/* Connect Modal */}
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
      </div>

      {/* ── Tabs ── */}
      <div className="mt-6 flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-violet-600 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ── Tab Content ── */}
      <div className="mt-6 space-y-4">
        {/* Profile Tab */}
        {activeTab === "profile" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            {bioContent ? (
              <div
                className="text-sm text-slate-700 leading-relaxed [&_p]:mb-3 [&_p:last-child]:mb-0"
                dangerouslySetInnerHTML={{ __html: bioContent }}
              />
            ) : (
              <div className="space-y-4">
                <p className="text-slate-600 leading-relaxed">
                  {nanny.first_name} is a {nanny.nationality || ""} nanny based in {nanny.suburb}
                  {nanny.total_experience_years ? ` with ${nanny.total_experience_years} years of childcare experience` : ""}.
                </p>
                {nanny.strengths_traits && (
                  <p className="text-slate-600 leading-relaxed">{nanny.strengths_traits}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* About Tab */}
        {activeTab === "about" && (
          <>
            {bioSummary.about && (
              <SectionCard title="About Me">
                <div className="text-sm text-slate-700 leading-relaxed [&_p]:mb-3 [&_p:last-child]:mb-0" dangerouslySetInnerHTML={{ __html: bioSummary.about }} />
              </SectionCard>
            )}
            {(experienceContent || nanny.total_experience_years) && (
              <SectionCard title="Experience">
                {experienceContent ? (
                  <div className="text-sm text-slate-700 leading-relaxed [&_p]:mb-3 [&_p:last-child]:mb-0" dangerouslySetInnerHTML={{ __html: experienceContent }} />
                ) : (
                  <div className="space-y-1 text-sm text-slate-700">
                    {nanny.total_experience_years !== null && <p>{nanny.total_experience_years} years total childcare experience</p>}
                    {nanny.nanny_experience_years !== null && <p>{nanny.nanny_experience_years} years as a nanny</p>}
                    {nanny.under_3_experience_years !== null && nanny.under_3_experience_years > 0 && <p>{nanny.under_3_experience_years} years with children under 3</p>}
                    {nanny.newborn_experience_years !== null && nanny.newborn_experience_years > 0 && <p>{nanny.newborn_experience_years} years with newborns</p>}
                  </div>
                )}
              </SectionCard>
            )}
            {bioSummary.traits && (
              <SectionCard title="Strengths">
                <div className="text-sm text-slate-700 leading-relaxed [&_p]:mb-3 [&_p:last-child]:mb-0" dangerouslySetInnerHTML={{ __html: bioSummary.traits }} />
              </SectionCard>
            )}
            {bioSummary.background && (
              <SectionCard title="Background & Skills">
                <div className="text-sm text-slate-700 leading-relaxed [&_p]:mb-3 [&_p:last-child]:mb-0" dangerouslySetInnerHTML={{ __html: bioSummary.background }} />
              </SectionCard>
            )}
            {bioSummary.services && (
              <SectionCard title="Services">
                <div className="text-sm text-slate-700 leading-relaxed [&_p]:mb-3 [&_p:last-child]:mb-0" dangerouslySetInnerHTML={{ __html: bioSummary.services }} />
              </SectionCard>
            )}
            {!bioSummary.about && !bioSummary.traits && (
              <>
                {nanny.strengths_traits && (
                  <SectionCard title="Strengths"><p className="text-sm text-slate-700">{nanny.strengths_traits}</p></SectionCard>
                )}
                {nanny.hobbies_interests && (
                  <SectionCard title="Hobbies & Interests"><p className="text-sm text-slate-700">{nanny.hobbies_interests}</p></SectionCard>
                )}
                {nanny.skills_training && (
                  <SectionCard title="Skills & Training"><p className="text-sm text-slate-700">{nanny.skills_training}</p></SectionCard>
                )}
              </>
            )}
            <SectionCard title="Key Details">
              <div className="grid grid-cols-2 gap-3 text-sm">
                {nanny.nationality && (
                  <div><span className="text-slate-500">Nationality</span><p className="font-medium text-slate-700">{nanny.nationality}</p></div>
                )}
                {nanny.languages && nanny.languages.filter(l => l !== "Foreign Language" && l !== "Multiple").length > 0 && (
                  <div><span className="text-slate-500">Languages</span><p className="font-medium text-slate-700">{nanny.languages.filter(l => l !== "Foreign Language" && l !== "Multiple").join(", ")}</p></div>
                )}
                <div>
                  <span className="text-slate-500">Age Range</span>
                  <p className="font-medium text-slate-700">{ageMonthsToLabel(nanny.min_child_age_months)} – {ageMonthsToLabel(nanny.max_child_age_months)}</p>
                </div>
                {nanny.max_children && (
                  <div><span className="text-slate-500">Max Children</span><p className="font-medium text-slate-700">{nanny.max_children}</p></div>
                )}
                {nanny.hourly_rate_min && (
                  <div><span className="text-slate-500">Hourly Rate</span><p className="font-medium text-slate-700">From £{nanny.hourly_rate_min}</p></div>
                )}
                {nanny.pay_frequency && nanny.pay_frequency.length > 0 && (
                  <div><span className="text-slate-500">Pay Frequency</span><p className="font-medium text-slate-700">{nanny.pay_frequency.join(", ")}</p></div>
                )}
              </div>
            </SectionCard>
          </>
        )}

        {/* Checklist Tab */}
        {activeTab === "checklist" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            {checklistContent ? (
              <div
                className="text-sm text-slate-700 leading-relaxed [&_p]:mb-3 [&_p:last-child]:mb-0 [&_br]:block [&_br]:my-0.5"
                dangerouslySetInnerHTML={{ __html: checklistContent }}
              />
            ) : (
              <div className="space-y-4 text-sm">
                <div>
                  <h4 className="font-semibold text-slate-800 mb-2">Summary</h4>
                  <p className="text-slate-700">✅ Ages {ageMonthsToLabel(nanny.min_child_age_months)} – {ageMonthsToLabel(nanny.max_child_age_months)}</p>
                  {nanny.role_types_preferred?.map((s) => <p key={s} className="text-slate-700">✅ {s}</p>)}
                  {nanny.level_of_support_offered?.map((s) => <p key={s} className="text-slate-700">✅ {s}</p>)}
                </div>
                {(nanny.total_experience_years || nanny.nanny_experience_years) && (
                  <div>
                    <h4 className="font-semibold text-slate-800 mb-2">Experience</h4>
                    {nanny.total_experience_years !== null && <p className="text-slate-700">✅ {nanny.total_experience_years} years childcare experience</p>}
                    {nanny.nanny_experience_years !== null && <p className="text-slate-700">✅ {nanny.nanny_experience_years} years nanny experience</p>}
                    {nanny.under_3_experience_years !== null && nanny.under_3_experience_years > 0 && <p className="text-slate-700">✅ {nanny.under_3_experience_years} years infant experience</p>}
                  </div>
                )}
                <div>
                  <h4 className="font-semibold text-slate-800 mb-2">Transport & Other</h4>
                  {nanny.drivers_license && <p className="text-slate-700">🪪 Drivers License</p>}
                  {nanny.has_car && <p className="text-slate-700">🚗 Car</p>}
                  {nanny.comfortable_with_pets && <p className="text-slate-700">✅ Comfortable with Pets</p>}
                  {nanny.vaccination_status && <p className="text-slate-700">✅ Fully Vaccinated</p>}
                  {nanny.non_smoker && <p className="text-slate-700">✅ Non-Smoker</p>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Availability Tab */}
        {activeTab === "availability" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            {isGuest ? (
              <div className="text-center py-6 space-y-3">
                <CalendarDays className="h-8 w-8 text-slate-300 mx-auto" />
                <p className="text-sm text-slate-500">
                  Sign up to see {nanny.first_name}&apos;s availability
                </p>
                <Link href="/signup">
                  <Button size="sm" className="bg-violet-500 hover:bg-violet-600">
                    Sign Up to See Availability
                  </Button>
                </Link>
              </div>
            ) : (
              <AvailabilityGrid availability={nanny.availability} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
