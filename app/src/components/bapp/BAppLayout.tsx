"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Home,
  ImageIcon,
  Volleyball,
  BarChart3,
  Plus,
  Eye,
  BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChildClient } from "@/types/bapp";
import { ObservationSheet } from "./sheets/ObservationSheet";
import { DiarySheet } from "./sheets/DiarySheet";
import { PlanSheet } from "./sheets/PlanSheet";
import { ChildAvatarEditor } from "./ChildAvatarEditor";
import { ChildDetailsEditor } from "./ChildDetailsEditor";
import { SparkleIcon } from "@/components/katie/messages/SparkleIcon";
import { SubscribeModal } from "@/components/payments/SubscribeModal";
import { SubscribeModalNanny } from "@/components/payments/SubscribeModalNanny";
import { LapsedBanner } from "@/components/payments/LapsedBanner";
import type { SubscribeModalLapseReason } from "@/components/payments/SubscribeModal";

interface BAppLayoutProps {
  child: ChildClient;
  role: "nanny" | "parent";
  children: React.ReactNode;
  /**
   * Whether the child's family currently has app access. Defaults to
   * true (backward compat for callers not yet wired to the access
   * gate). When false:
   *   - The LapsedBanner renders above page content.
   *   - The FAB + all three action buttons trigger the SubscribeModal
   *     instead of opening the Observation / Diary / Plan sheets.
   *   - Per S4 in `system/APP/PAYMENTS/FRONTEND/03-build-spec.md`.
   */
  familyHasAccess?: boolean;
  /** Drives modal body copy when familyHasAccess === false. */
  lapseReason?: SubscribeModalLapseReason;
  /** Parent's first name — surfaced to nanny in lapsed-state copy. */
  parentFirstName?: string;
  /** Nanny's first name — surfaced to parent in lapsed-state copy. */
  nannyFirstName?: string;
  /**
   * Pre-generated nanny-share URL from `createSubscribeInvite` (S5).
   * Required when `role === "nanny"` AND `familyHasAccess === false`
   * — the nanny variant of the SubscribeModal renders the share CTA
   * via this URL. The layout server component is responsible for
   * minting / fetching this before rendering BAppLayout.
   */
  nannyShareUrl?: string;
  /** 4g (ADR-091): nanny side — the family is done-for-you, so no share-to-subscribe CTA. */
  familyIsDfy?: boolean;
  /** Pre-built share-text body matching the URL. */
  nannyShareText?: string;
}

const TABS = [
  { id: "feed", label: "Feed", path: "", icon: Home },
  // Order swapped per user feedback (2026-05-07): Progress before
  // Activities so the middle two tabs read child-state first
  // (Progress = "where they're at"), then planning second
  // (Activities = "what's next").
  { id: "progress", label: "Progress", path: "/progress", icon: BarChart3 },
  {
    id: "activities",
    label: "Activities",
    path: "/activities",
    icon: Volleyball,
  },
  { id: "library", label: "Library", path: "/library", icon: ImageIcon },
] as const;

/** Compute whole months between a date-of-birth ISO string and now.
 *  Counts whole calendar months (so a child born on the 5th who is
 *  measured on the 4th of N months later has only N−1 full months).
 *  Returns null when the dob is missing or unparseable.  */
function ageMonthsFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const dobDate = new Date(dob);
  if (Number.isNaN(dobDate.getTime())) return null;
  const now = new Date();
  let months =
    (now.getFullYear() - dobDate.getFullYear()) * 12 +
    (now.getMonth() - dobDate.getMonth());
  if (now.getDate() < dobDate.getDate()) months -= 1;
  return Math.max(0, months);
}

/** Format an integer month count as a hero-card age label.
 *    0       → "Newborn"
 *    1–11    → "N months" (singular form for 1)
 *    12–23   → "N years, M months"  (or just "N year" when M = 0)
 *    24+     → "Yy Mmo" compact form to keep the line short
 *  Returns null when the count is null, so callers can branch on
 *  presence rather than comparing against an empty string. */
function formatAgeLabel(months: number | null): string | null {
  if (months == null) return null;
  if (months === 0) return "Newborn";
  if (months < 12) return `${months} month${months === 1 ? "" : "s"}`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (months < 24) {
    if (rem === 0) return `${years} year`;
    return `${years} year, ${rem} month${rem === 1 ? "" : "s"}`;
  }
  if (rem === 0) return `${years}y`;
  return `${years}y ${rem}mo`;
}

export function BAppLayout({
  child,
  role,
  children,
  familyHasAccess = true,
  lapseReason = "subscription_lapsed",
  parentFirstName,
  nannyFirstName,
  nannyShareUrl,
  nannyShareText,
  familyIsDfy = false,
}: BAppLayoutProps) {
  const pathname = usePathname();
  const [fabOpen, setFabOpen] = useState(false);
  const [observationOpen, setObservationOpen] = useState(false);
  const [diaryOpen, setDiaryOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  // S4 — modal state for lapsed-family interrupt. The FAB and every
  // action button funnel into this when familyHasAccess is false.
  const [subscribeModalOpen, setSubscribeModalOpen] = useState(false);

  const childFirstName = child.first_name ?? "your child";

  /** Single chokepoint for what happens when the user tries to act
   *  on a child entry. In active state: open the relevant sheet.
   *  In lapsed state: open the SubscribeModal instead. */
  const handleAction = (action: "design" | "observation" | "diary"): void => {
    setFabOpen(false);
    if (!familyHasAccess) {
      setSubscribeModalOpen(true);
      return;
    }
    if (action === "design") setPlanOpen(true);
    else if (action === "observation") setObservationOpen(true);
    else setDiaryOpen(true);
  };

  /** FAB button click. Active state: toggle the expansion. Lapsed
   *  state: skip the expansion and go straight to the modal. */
  const handleFabClick = (): void => {
    if (!familyHasAccess) {
      setSubscribeModalOpen(true);
      return;
    }
    setFabOpen(!fabOpen);
  };

  const basePath = `/${role}/development/${child.id}`;
  const hubPath = `/${role}?t=children`;

  // Prefer DOB-derived age (auto-updates with time) over the cached
  // `age_months_approx` snapshot (which can drift). Fall back to the
  // approx column only when the DOB is missing — same data, less
  // freshness, but keeps a label visible for legacy children whose
  // parent skipped DOB entry.
  const ageMonths =
    ageMonthsFromDob(child.date_of_birth) ?? child.age_months_approx;
  const ageLabel = formatAgeLabel(ageMonths);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Scrollable content area */}
      <div className="relative mx-auto max-w-lg px-4 pb-24 pt-4 space-y-4">
        {/* Back arrow above the hero card.
            Absolutely positioned so it has ZERO impact on the
            layout flow — the wrapper's `pt-4 space-y-4` (16px gap
            between the chrome zone and the hero card) is preserved
            exactly. The arrow is sized to fit inside that 16px
            band: `h-4 w-4` icon at `top-0 left-3`, no surrounding
            padding. Per user spec (2026-05-07): "small enough that
            it does not effect the current size gap between the hero
            card and the above content." Hit-target is 16×16 — below
            WCAG 2.5.8's 24×24 recommendation, but this trade-off was
            an explicit user requirement: visual continuity over
            touch-target generosity. The hover/focus colour still
            communicates affordance. */}
        <Link
          href={hubPath}
          aria-label="Back"
          className="absolute left-3 top-0 z-10 inline-flex h-4 w-4 text-slate-600 transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Link>

        {/* ═══════════════════════════════════════════════════
            HERO CARD
           ═══════════════════════════════════════════════════ */}
        <div className="relative rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {/* Pencil-edit affordance for name + DOB. Sits absolute in
              the top-right of the hero card, mirroring the nanny
              profile pattern (`NannyMyProfile.tsx`). The avatar
              keeps its own click-to-edit camera affordance — name /
              DOB lives behind the pencil so the avatar surface
              isn't overloaded. */}
          <div className="absolute right-3 top-3 z-10">
            <ChildDetailsEditor
              childId={child.id}
              currentFirstName={child.first_name}
              currentDateOfBirth={child.date_of_birth}
            />
          </div>

          {/* Gradient header strip */}
          <div className="h-12 bg-gradient-to-br from-emerald-50 to-emerald-100/50" />

          <div className="px-5 pb-4">
            {/* Avatar + Name — overlaps the header strip. The avatar is
                click-to-edit per amendment A-06: either the linked
                parent or nanny can add/replace/remove the child's
                picture (server action enforces the role check). */}
            <div className="flex items-end gap-4 -mt-8">
              <div className="relative shrink-0">
                <ChildAvatarEditor
                  childId={child.id}
                  currentUrl={child.profile_picture_url}
                  childFirstName={child.first_name}
                />
              </div>

              <div className="flex-1 min-w-0 pb-1 pt-4">
                <h1 className="text-2xl font-bold text-slate-900">
                  {child.first_name ?? "Child"}
                </h1>
                {/* Age — small + faded so the name carries the weight.
                    Prefers live DOB calc over `age_months_approx` so
                    the label refreshes naturally as the child grows. */}
                {ageLabel && (
                  <p className="text-xs text-slate-400">{ageLabel}</p>
                )}
                {/* "Following with [Nanny]" relational frame on the
                    parent's side — UX-FIX-PLAN FIX-9. Surfaces the
                    nanny so the parent feels the relationship the
                    platform is built on, not just the transaction. */}
                {role === "parent" && nannyFirstName && (
                  <p className="text-xs text-slate-500">
                    Following with {nannyFirstName}
                  </p>
                )}
              </div>
            </div>

            {/* Tab bar — inside the hero card */}
            <div className="mt-4 flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
              {TABS.map((tab) => {
                const tabPath = tab.path ? `${basePath}${tab.path}` : basePath;
                const isActive = pathname === tabPath;
                const Icon = tab.icon;
                return (
                  <Link
                    key={tab.id}
                    href={tabPath}
                    className={cn(
                      "flex-1 flex items-center justify-center rounded-md py-1.5 transition-all",
                      isActive
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-400 hover:text-slate-600",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════
            PAGE CONTENT
           ═══════════════════════════════════════════════════ */}
        {/* S3 — Lapsed banner. Persistent + unclosable while
            familyHasAccess is false. Sits above feed content so
            it's seen regardless of where the user scrolls. */}
        {!familyHasAccess && (
          <LapsedBanner
            role={role}
            childFirstName={childFirstName}
            parentFirstName={parentFirstName}
            onPrimaryCta={() => setSubscribeModalOpen(true)}
            lapseReason={lapseReason}
            familyIsDfy={familyIsDfy}
          />
        )}
        {children}
      </div>

      {/* FAB
          Per user feedback (2026-05-07):
          - Centred horizontally at the bottom (was bottom-right).
          - Smaller (h-10 w-10, was h-12 w-12).
          - Always brand violet (was emerald → red-when-open).
          - When open: pop-up options stack ABOVE, close button stays
            below them (was reversed — close above, options below).
          - Pop-up option colours (revised 2026-05-07):
              · Design Activity → `bg-indigo-100 text-indigo-600`
                with a violet Katie SparkleIcon — designing
                activities is a Katie surface.
              · Observation → `bg-emerald-100 text-emerald-600`
                — same emerald as the Growth tile icon, signalling
                that observations feed the developmental progress
                surface.
              · Diary Entry → `bg-violet-100 text-violet-600`
                — Katie purple, signals diary entries are written
                in the carer/Katie voice and read by the parent. */}
      <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 flex-col items-center gap-2">
        {/* Menu items (visible when open) */}
        {fabOpen && (
          <>
            <button
              type="button"
              onClick={() => handleAction("design")}
              className="flex items-center gap-2 rounded-full bg-indigo-100 py-2 pl-3 pr-4 text-sm font-medium text-indigo-600 shadow-sm transition-all animate-in slide-in-from-bottom-2 duration-200"
              style={{ animationDelay: "0ms" }}
            >
              {/* Katie SparkleIcon (text-violet-600 inherited from
                  the parent button). Same shape rendered next to
                  every Katie chat message — designing an activity
                  is a Katie surface, so the icon should signal
                  that lineage. */}
              <SparkleIcon className="h-4 w-4 text-violet-600" />
              Design Activity
            </button>
            <button
              type="button"
              onClick={() => handleAction("observation")}
              className="flex items-center gap-2 rounded-full bg-emerald-100 py-2 pl-3 pr-4 text-sm font-medium text-emerald-600 shadow-sm transition-all animate-in slide-in-from-bottom-2 duration-200"
              style={{ animationDelay: "50ms" }}
            >
              <Eye className="h-4 w-4" />
              Observation
            </button>
            <button
              type="button"
              onClick={() => handleAction("diary")}
              className="flex items-center gap-2 rounded-full bg-violet-100 py-2 pl-3 pr-4 text-sm font-medium text-violet-600 shadow-sm transition-all animate-in slide-in-from-bottom-2 duration-200"
              style={{ animationDelay: "100ms" }}
            >
              <BookOpen className="h-4 w-4" />
              Diary Entry
            </button>
          </>
        )}

        {/* Main FAB button — close button when open. Stays below the
            options because the parent uses `flex-col` (not reverse). */}
        <button
          type="button"
          onClick={handleFabClick}
          aria-label={fabOpen ? "Close menu" : "Open menu"}
          aria-expanded={fabOpen}
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full bg-violet-600 shadow-lg transition-transform duration-200 hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2",
            fabOpen && "rotate-45",
          )}
        >
          <Plus className="h-5 w-5 text-white" />
        </button>
      </div>

      {/* Click-outside handler for the open FAB. Renders only when
          open. Transparent (no scrim) — the gray overlay was removed
          per user feedback (2026-05-07); the menu stays readable
          against the page chrome alone, and the click-catcher still
          dismisses when the user taps anywhere off the buttons. */}
      {fabOpen && (
        <div className="fixed inset-0 z-30" onClick={() => setFabOpen(false)} />
      )}

      {/* Observation Sheet */}
      <ObservationSheet
        open={observationOpen}
        onOpenChange={setObservationOpen}
        childId={child.id}
      />

      {/* Diary Sheet */}
      <DiarySheet
        open={diaryOpen}
        onOpenChange={setDiaryOpen}
        childId={child.id}
        childFirstName={child.first_name}
      />

      {/* Plan Sheet */}
      <PlanSheet
        open={planOpen}
        onOpenChange={setPlanOpen}
        childId={child.id}
      />

      {/* S1/S2 — SubscribeModal. Rendered when familyHasAccess is
          false. Parent gets the pricing-CTA variant; nanny gets
          the share-link variant. Triggered by:
          - The FAB main button (handleFabClick)
          - Any FAB action button (handleAction)
          - The LapsedBanner's primary CTA */}
      {!familyHasAccess && role === "parent" && (
        <SubscribeModal
          isOpen={subscribeModalOpen}
          onClose={() => setSubscribeModalOpen(false)}
          childId={child.id}
          childFirstName={childFirstName}
          nannyFirstName={nannyFirstName}
          lapseReason={lapseReason}
        />
      )}
      {!familyHasAccess &&
        role === "nanny" &&
        nannyShareUrl &&
        nannyShareText && (
          <SubscribeModalNanny
            isOpen={subscribeModalOpen}
            onClose={() => setSubscribeModalOpen(false)}
            childFirstName={childFirstName}
            parentFirstName={parentFirstName}
            shareUrl={nannyShareUrl}
            shareText={nannyShareText}
          />
        )}
    </div>
  );
}
