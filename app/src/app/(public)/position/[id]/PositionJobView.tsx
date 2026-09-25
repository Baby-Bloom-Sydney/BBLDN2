"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  MapPin,
  Clock,
  DollarSign,
  Baby,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import type { PublicPositionProfile } from "@/lib/actions/matching";
import { applyToPosition } from "@/lib/actions/jobs";
import { VerificationBanner } from "@/components/hub/VerificationBanner";
import { VerificationRequiredModal } from "@/components/verification/VerificationRequiredModal";

function ageDisplay(months: number): string {
  if (months < 12) return `${months}mo`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem > 0 ? `${years}y ${rem}mo` : `${years}y`;
}

const DAY_OPTIONS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const DAY_SHORT: Record<string, string> = {
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
  Sunday: "Sun",
};
const BRACKET_KEYS = ["morning", "midday", "afternoon", "evening"] as const;
const BRACKET_LABEL: Record<string, string> = {
  morning: "Morning",
  midday: "Midday",
  afternoon: "Afternoon",
  evening: "Evening",
};

function ScheduleGrid({
  weeklyRoster,
  rosterByDay,
}: {
  weeklyRoster: string[];
  rosterByDay: Record<string, string[]>;
}) {
  if (weeklyRoster.length === 0) return null;
  const sortedDays = DAY_OPTIONS.filter((d) => weeklyRoster.includes(d));
  if (sortedDays.length === 0) return null;

  return (
    <div className="rounded-lg bg-violet-50 border border-violet-200 p-2.5">
      <div className="grid grid-cols-5 gap-x-1 gap-y-0.5 text-[10px]">
        <div />
        {BRACKET_KEYS.map((b) => (
          <div key={b} className="text-center text-violet-500 font-medium">
            {BRACKET_LABEL[b]}
          </div>
        ))}
        {sortedDays.map((day) => {
          const dayTimes = rosterByDay[day] ?? [];
          return (
            <div key={day} className="contents">
              <div className="text-violet-700 font-medium truncate pr-1 text-[11px]">
                {DAY_SHORT[day]}
              </div>
              {BRACKET_KEYS.map((b) => (
                <div
                  key={b}
                  className="flex items-center justify-center py-0.5"
                >
                  <div
                    className={`h-2.5 w-2.5 rounded-full ${
                      dayTimes.includes(b) ? "bg-violet-400" : "bg-violet-200"
                    }`}
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// POSITION SUMMARY — template placeholder
// TODO [MIGRATION]: Replace with AI-generated summary.
// System needs: prompt template + OpenAI call on position create/update,
// stored in nanny_positions.ai_summary (TEXT column to add).
// Prompt should receive: all position fields, children data, parent name,
// roster data. Output: natural-language bullet-point summary.
// ─────────────────────────────────────────────────────────────

function buildSummaryIntro(p: PublicPositionProfile): string {
  const isAdminPosition = p.source && p.source !== "parent";
  const familyLabel = isAdminPosition
    ? p.parentFirstName // Already "The Mitchell Family"
    : `The ${p.parentLastName ?? p.parentFirstName} family`;
  const suburb = p.suburb ?? "Sydney";

  let childDesc = "";
  if (p.children.length === 1) {
    const c = p.children[0];
    const g = c.gender?.toLowerCase();
    const gLabel =
      g === "male" || g === "boy"
        ? "son"
        : g === "female" || g === "girl"
          ? "daughter"
          : "little one";
    childDesc = `their ${ageDisplay(c.ageMonths)} old ${gLabel}`;
  } else if (p.children.length > 1) {
    const ages = p.children.map((c) => ageDisplay(c.ageMonths));
    childDesc = `their ${p.children.length} children (${ages.join(" & ")})`;
  }

  let reasonClause = "";
  if (p.reasonForNanny && p.reasonForNanny.length > 0) {
    const r = p.reasonForNanny[0].toLowerCase();
    if (r.includes("work")) reasonClause = " as they head back to work";
    else if (r.includes("support") || r.includes("help"))
      reasonClause = " for some extra support at home";
    else if (r.includes("break") || r.includes("recharge"))
      reasonClause = " while they take some time to recharge";
    else if (r.includes("development") || r.includes("education"))
      reasonClause = " to support their child's learning and development";
    else if (r.includes("pick up") || r.includes("drop off"))
      reasonClause = " to help with pick-ups and drop-offs";
  }

  return `${familyLabel} in ${suburb} is looking for a nanny to care for ${childDesc || "their little one"}${reasonClause}.`;
}

function buildLookingFor(p: PublicPositionProfile): string[] {
  const items: string[] = [];

  // Experience — based on years_of_experience field + child ages for context
  if (p.yearsOfExperience) {
    if (p.children.some((c) => c.ageMonths < 12)) {
      items.push(
        `${p.yearsOfExperience}+ years experience preferred, ideally with newborns or babies`,
      );
    } else if (p.children.some((c) => c.ageMonths < 24)) {
      items.push(
        `${p.yearsOfExperience}+ years experience preferred, ideally with babies or toddlers`,
      );
    } else {
      items.push(
        `${p.yearsOfExperience}+ years of childcare experience preferred`,
      );
    }
  } else {
    if (p.children.some((c) => c.ageMonths < 12)) {
      items.push("Experience with newborns or babies is a plus");
    } else if (p.children.some((c) => c.ageMonths < 24)) {
      items.push("Experience with babies or toddlers is a plus");
    }
  }

  // Care role
  if (p.levelOfSupport && p.levelOfSupport.length > 0) {
    const roles = p.levelOfSupport.map((s) => s.toLowerCase());
    if (roles.includes("primary carer")) {
      items.push("Confident being the sole carer during your hours");
    } else if (roles.includes("shared care")) {
      items.push("Happy working alongside a parent in a shared care setup");
    } else if (
      roles.includes("mothers help") ||
      roles.includes("mother's help")
    ) {
      items.push("Comfortable in a mother's help role, working alongside Mum");
    }
  }

  // Focus type — what the family wants you to do with the kids
  if (p.focusType === "Educational play") {
    items.push("A focus on educational play and creative learning activities");
  } else if (p.focusType === "Just supervision") {
    items.push("Keeping the kids safe, happy, and entertained");
  }

  // Support type
  if (p.supportType === "Tailored developmental support") {
    items.push("Comfortable providing tailored developmental support");
  }

  // Qualifications — always mentioned in a friendly way
  items.push("Formal qualifications not required, but experience is valued");
  items.push("First Aid certificate is a plus but not essential");

  // Driver / car — mention either way
  if (p.driversLicenseRequired && p.carRequired) {
    items.push(
      "Driver's license and own car needed for school runs and activities",
    );
  } else if (p.carRequired) {
    items.push("Own car needed — some driving to activities involved");
  } else if (p.driversLicenseRequired) {
    items.push("Driver's license required");
  } else {
    items.push("No car or license needed");
  }

  // Pets
  if (p.comfortableWithPetsRequired) {
    items.push("The family has pets — must be comfortable around animals");
  }

  // Additional needs — only if parent specified
  if (p.childNeeds) {
    if (p.childNeedsDetails) {
      items.push(
        `Comfortable supporting a child with additional needs — ${p.childNeedsDetails}`,
      );
    } else {
      items.push("Comfortable supporting a child with additional needs");
    }
  }

  // Language — only if not English
  if (p.languagePreference && p.languagePreference !== "English") {
    if (p.languagePreferenceDetails) {
      items.push(`${p.languagePreferenceDetails} speaker preferred`);
    } else {
      items.push("Bilingual or multilingual preferred");
    }
  }

  return items;
}

function buildWhatYouGet(p: PublicPositionProfile): string[] {
  const items: string[] = [];

  // Schedule stability — accurate to actual data values
  const isFixed = p.scheduleType === "Fixed" || p.scheduleType === "Yes";
  const isOngoing = p.placementLength === "Ongoing";

  if (isFixed && isOngoing) {
    items.push("Consistent days and hours, every week");
  } else if (isFixed) {
    items.push("Set days and hours for the duration of the role");
  } else if (isOngoing) {
    items.push("Ongoing role with flexible hours that suit you both");
  } else {
    items.push(
      "Flexible arrangement — days and times can be worked out together",
    );
  }

  // Rate — only for parent positions
  if (p.hourlyRate && (!p.source || p.source === "parent")) {
    items.push(`Competitive pay at $${p.hourlyRate}/hr`);
  }

  // Family vibe
  items.push("A family that values and respects their nanny");

  // Urgency / start
  if (p.urgency === "Immediately" || p.urgency === "As soon as possible") {
    items.push("Start right away — the family is ready for you");
  } else if (p.startDate) {
    const d = new Date(p.startDate);
    const label = d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
    });
    items.push(`Start date: ${label}`);
  }

  // Placement length
  if (isOngoing) {
    items.push("Long-term position — not just a short gig");
  }

  return items;
}

interface Props {
  position: PublicPositionProfile;
  alreadyApplied?: boolean;
  /** Server-hydrated viewer role (Bailey 2026-05-19 amendment 5). Drops the
   * `useAuth()` flash bug — gate UI is correct on first paint. */
  viewerRole?: "nanny" | "parent" | "guest";
  /** Server-hydrated nanny verification level. Null for non-nannies. Used
   * for the Apply preflight + the in-page verification banner. */
  nannyVerificationLevel?: number | null;
}

const NANNY_FULL_ACCESS_LEVEL = 3;

export function PositionJobView({
  position,
  alreadyApplied = false,
  viewerRole = "guest",
  nannyVerificationLevel = null,
}: Props) {
  const router = useRouter();
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(alreadyApplied);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);

  const isNanny = viewerRole === "nanny";
  const isUnverifiedNanny =
    isNanny &&
    nannyVerificationLevel !== null &&
    nannyVerificationLevel < NANNY_FULL_ACCESS_LEVEL;
  // The "Looking for a Nanny?" banner is for prospective parents — show it
  // to both unauthenticated visitors AND logged-in parents. Hide from nannies.
  const showLookingForNannyBanner =
    viewerRole === "guest" || viewerRole === "parent";

  const handleApply = async () => {
    if (!isNanny || applying || applied) return;
    // Client-side pre-check: open the verification modal instead of round-
    // tripping a guaranteed `not_verified` rejection. Server still enforces
    // the gate as the safety net (applyToPosition rejects level<3).
    if (isUnverifiedNanny) {
      setVerifyModalOpen(true);
      return;
    }
    setApplying(true);
    setApplyError(null);
    const result = await applyToPosition(position.id);
    setApplying(false);
    if (result.success) {
      setApplied(true);
      setTimeout(() => router.push("/nanny"), 800);
    } else if (result.error === "already_applied") {
      setApplyError("You have already applied to this position");
    } else if (result.error === "not_verified") {
      // Defence-in-depth: if the server somehow rejects on verification
      // (e.g. level changed mid-session), surface the same modal.
      setVerifyModalOpen(true);
    } else {
      setApplyError("Something went wrong. Please try again.");
    }
  };

  // "Get a Nanny" link destination — parent path for logged-in parents,
  // generic matchmaking onboarding otherwise.
  const getNannyHref =
    viewerRole === "parent" ? "/parent/matchmaking" : "/matchmaking/onboarding";

  return (
    <div className="mx-auto max-w-2xl px-4 py-4 space-y-3 flex flex-col min-h-[calc(100dvh-56px)]">
      {/* Verification banner — unverified nannies need a clear path to verify
          before they can apply. Bailey 2026-05-19 amendment 4. */}
      {isUnverifiedNanny && (
        <div className="max-w-[23rem] mx-auto w-full">
          <VerificationBanner
            role="nanny"
            message="Verify your account to apply for this position"
            submessage="Upload your WWCC and ID to get verified"
          />
        </div>
      )}

      {/* "Find your Nanny" CTA — guests + parents (Bailey 2026-05-19 amendment 5). */}
      {showLookingForNannyBanner && (
        <Link
          href={getNannyHref}
          className="flex items-center justify-between max-w-[23rem] mx-auto w-full rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow px-4 py-3"
          style={{
            background:
              "linear-gradient(135deg, #EDE9FE 0%, #DDD6FE 50%, #C4B5FD 100%)",
          }}
        >
          <div>
            <p className="text-sm font-bold text-violet-900 leading-snug">
              Looking for a Nanny?
            </p>
            <p className="text-xs text-violet-700 mt-0.5">
              Find the perfect match for your family
            </p>
          </div>
          <div className="shrink-0 ml-3 inline-flex items-center gap-1 bg-white text-violet-700 text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm">
            Find your Nanny <ArrowRight className="h-3 w-3" />
          </div>
        </Link>
      )}

      {/* Back arrow — logged-in users only */}
      {viewerRole !== "guest" && (
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-slate-400 hover:text-slate-600 transition-colors self-start -mb-1"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="text-sm">Back</span>
        </button>
      )}

      {/* Header + Summary intro */}
      <div className="w-full max-w-[23rem] mx-auto px-4">
        <h1 className="text-base font-bold text-slate-800 leading-tight">
          {position.source && position.source !== "parent"
            ? `${position.parentFirstName} is looking for a nanny`
            : `The ${position.parentLastName ?? position.parentFirstName} family is looking for a nanny`}
        </h1>
        <p className="text-xs text-slate-500 leading-relaxed mt-1">
          {buildSummaryIntro(position)}
        </p>
      </div>

      {/* Details Card */}
      <div className="w-full rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden max-w-[23rem] mx-auto">
        <div className="px-4 pt-3 pb-2 space-y-1.5">
          {/* Location + posted date / Applied tag */}
          <div className="flex items-start justify-between">
            {position.suburb && (
              <div className="flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5 text-violet-500 flex-shrink-0" />
                <p className="text-sm font-medium text-slate-800">
                  {position.suburb}
                </p>
              </div>
            )}
            {applied ? (
              <span className="shrink-0 ml-2 inline-flex items-center gap-1 rounded-full bg-green-50 border border-green-200 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                Applied
              </span>
            ) : (
              <p className="text-[11px] text-slate-400 shrink-0 ml-2">
                {(() => {
                  const days = Math.floor(
                    (Date.now() - new Date(position.createdAt).getTime()) /
                      86400000,
                  );
                  if (days === 0) return "Today";
                  if (days === 1) return "1 day ago";
                  return `${days} days ago`;
                })()}
              </p>
            )}
          </div>

          {/* Children */}
          {position.children.length > 0 && (
            <div className="flex items-center gap-2">
              <Baby className="h-3.5 w-3.5 text-violet-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-slate-800">
                  {position.children.length}{" "}
                  {position.children.length === 1 ? "child" : "children"}
                </p>
                <p className="text-[11px] text-slate-400">
                  {position.children
                    .map((c) => {
                      const g = c.gender?.toLowerCase();
                      const label =
                        g === "male" || g === "boy"
                          ? "Boy"
                          : g === "female" || g === "girl"
                            ? "Girl"
                            : "Child";
                      return `${label} (${ageDisplay(c.ageMonths)})`;
                    })
                    .join(", ")}
                </p>
              </div>
            </div>
          )}

          {/* Hours */}
          {position.hoursPerWeek && (
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-violet-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-slate-800">
                  {position.hoursPerWeek} hrs/wk
                </p>
                <p className="text-[11px] text-slate-400">
                  {position.scheduleType === "Fixed" ||
                  position.scheduleType === "Yes"
                    ? "Fixed schedule"
                    : "Flexible schedule"}
                </p>
              </div>
            </div>
          )}

          {/* Rate — hidden for AI/admin positions */}
          {position.hourlyRate && position.source === "parent" && (
            <div className="flex items-center gap-2">
              <DollarSign className="h-3.5 w-3.5 text-violet-500 flex-shrink-0" />
              <p className="text-sm font-medium text-slate-800">
                ${position.hourlyRate}/hr
              </p>
            </div>
          )}
        </div>

        {/* Schedule grid */}
        {position.weeklyRoster.length > 0 &&
          Object.keys(position.rosterByDay).length > 0 && (
            <div className="px-4 pb-3">
              <ScheduleGrid
                weeklyRoster={position.weeklyRoster}
                rosterByDay={position.rosterByDay}
              />
            </div>
          )}

        {/* Summary */}
        <div className="px-4 pb-4 pt-1 border-t border-slate-100 space-y-3">
          {/* What you get */}
          <div>
            <p className="text-sm font-medium text-slate-800 mb-1.5">
              What you get
            </p>
            <ul className="space-y-1">
              {buildWhatYouGet(position).map((item, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm text-slate-700 leading-snug"
                >
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-green-400 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* What the family is looking for */}
          <div>
            <p className="text-sm font-medium text-slate-800 mb-1.5">
              What the family is looking for
            </p>
            <ul className="space-y-1">
              {buildLookingFor(position).map((item, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm text-slate-700 leading-snug"
                >
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-violet-400 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Childcare Professional Ad Tile — hidden for now */}
      {false && (
        <Link
          href="/apply"
          className="flex items-center justify-between max-w-[23rem] mx-auto w-full rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow px-4 py-3"
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

      {/* Spacer for sticky CTA */}
      <div className="h-3.5" />

      {/* Sticky Apply CTA — hidden when nanny has already applied */}
      {!(isNanny && applied) && (
        <div className="fixed bottom-0 left-0 right-0 z-20 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+20px)] pt-3 bg-gradient-to-t from-slate-50 from-60%">
          <div className="max-w-[23rem] mx-auto space-y-1.5">
            {applyError && (
              <p className="text-xs text-red-600 text-center">{applyError}</p>
            )}
            {isNanny ? (
              <Button
                onClick={handleApply}
                disabled={applying}
                className="w-full h-11 rounded-lg font-medium text-sm bg-violet-600 hover:bg-violet-700 text-white"
              >
                {applying ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-4 w-4 animate-spin" /> Applying...
                  </span>
                ) : (
                  "Apply"
                )}
              </Button>
            ) : (
              <Link href="/apply">
                <Button className="w-full bg-violet-600 hover:bg-violet-700 text-white h-11 rounded-lg font-medium text-sm">
                  Apply
                </Button>
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Apply-time verification gate (Bailey 2026-05-19 amendment 4). Opens
          on Apply click for unverified nannies + on server `not_verified`
          response as a defence-in-depth fallback. */}
      <VerificationRequiredModal
        open={verifyModalOpen}
        onOpenChange={setVerifyModalOpen}
        title="Verify your account to apply"
        message="Complete verification to send your application to this family."
      />
    </div>
  );
}
