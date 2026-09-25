"use client";

/**
 * Shared PlacementCard — the parent's "my nanny" tile.
 *
 * Architectural commitment (TileRegistry leading comment): the chat
 * version of this card is the SAME component rendered on /parent/position
 * — no chat-specific copy. This file is the source of truth for the
 * visual.
 *
 * The main page needs inline editing (rate, hours) and a 3-dot menu
 * (edit / contact / remove). Those affordances aren't part of the
 * read-only chat tile, so they're injected via slot props:
 *
 *   - `rateNode`  — replaces the rate text with an inline input on edit
 *   - `hoursNode` — same, for weekly hours
 *   - `menuSlot`  — top-right block (3-dot menu + save tick)
 *
 * The chat tile passes none of those, hides the View Profile button
 * (whole-card click navigates instead), and provides `onClick` so the
 * card renders as a button.
 *
 * Carve-out: the "Remove nanny" dialog and "Contact" popover stay in
 * `PositionPageClient.tsx` because they own state (removeStep,
 * showContactPopup) above this component. Only the read-only visual
 * layer lives here.
 */

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Calendar,
  Clock,
  PoundSterling,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlacementData } from "@/lib/types/placement";

export interface PlacementCardProps {
  placement: PlacementData;
  /**
   * Compact density — slightly smaller padding and avatar. Used by
   * Katie's chat tile so the placement fits the chat row height.
   */
  compact?: boolean;
  /**
   * Override for the rate display (right column, top). Defaults to
   * read-only formatted text. Main page passes an `<input>` when
   * editing.
   */
  rateNode?: React.ReactNode;
  /** Override for the weekly hours display. Defaults to read-only text. */
  hoursNode?: React.ReactNode;
  /**
   * Absolute top-right block — 3-dot menu, save tick, etc. Omitted
   * means no menu (chat tile).
   */
  menuSlot?: React.ReactNode;
  /** Suppress the View Profile button at the bottom (chat tile uses onClick). */
  hideViewProfile?: boolean;
  /**
   * When provided, the entire card becomes a `<button>` so a click
   * anywhere navigates. Used by the chat tile.
   */
  onClick?: () => void;
  /**
   * Renders a small subtle "see all nannies" link under the default
   * variant's View Profile button. Default false. Per amendment A-04:
   * the parent's hub hides the browse-nannies sub-tab when an active
   * placement exists, but discoverability is preserved via this inline
   * link — quiet enough not to suggest "you might want to switch", but
   * accessible for legitimate compare/replace cases.
   *
   * Compact variant ignores this prop — it's used in surfaces (Katie
   * chat tile etc.) where the browse-nannies link would be out of place.
   */
  showBrowseNanniesLink?: boolean;
}

function computeAge(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null;
  const birth = new Date(dateOfBirth);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

function StartDateLine({ startDate }: { startDate: string | null }) {
  if (!startDate) return null;
  if (startDate === "tbc") {
    return (
      <div className="flex items-center justify-end gap-1 text-sm text-amber-600">
        <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
        Start TBC
      </div>
    );
  }
  const startMon = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(startMon.getTime())) return null;
  const isPast = startMon <= new Date();
  const label = startMon.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
  return (
    <div className="flex items-center justify-end gap-1 text-sm text-slate-500">
      <Calendar className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
      {isPast ? `Started ${label}` : `Starting ${label}`}
    </div>
  );
}

// ── Default-variant (A-03 hero card) helpers ──────────────────────────
//
// The default variant renders a vertical "stat" grid below the avatar +
// name. Each cell is a small column with a label and a value. These
// helpers keep the per-cell value markup colocated with the card so a
// future copy or token tweak doesn't require chasing across files.

function Stat({
  icon,
  label,
  valueNode,
}: {
  icon: React.ReactNode;
  label: string;
  valueNode: React.ReactNode;
}) {
  // text-slate-500 (#64748b on slate-50 = 4.84:1) clears WCAG AA for
  // 11px text. The original `text-slate-400` (#94a3b8 = 2.85:1) failed
  // (a11y-architect HIGH 2026-05-06).
  return (
    <div className="flex min-w-0 flex-col items-center gap-0.5 rounded-lg bg-slate-50 px-2 py-2.5">
      <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-slate-500">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-sm font-medium text-slate-700">{valueNode}</div>
    </div>
  );
}

function defaultStatValueRate(placement: PlacementData) {
  const value = placement.hourlyRate
    ? `£${placement.hourlyRate}/hr`
    : placement.nannyHourlyRate
      ? `£${placement.nannyHourlyRate}/hr`
      : "Not set";
  return <span>{value}</span>;
}

function defaultStatValueHours(placement: PlacementData) {
  return (
    <span>
      {placement.weeklyHours ? `${placement.weeklyHours}/wk` : "Not set"}
    </span>
  );
}

function StartDateValue({ startDate }: { startDate: string | null }) {
  if (!startDate) return <span className="text-slate-400">Not set</span>;
  if (startDate === "tbc") return <span className="text-amber-600">TBC</span>;
  const startMon = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(startMon.getTime())) {
    return <span className="text-slate-400">Not set</span>;
  }
  return (
    <span>
      {startMon.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
    </span>
  );
}

// ── Compact-variant helpers ────────────────────────────────────────────
// These remain unchanged from the pre-A-03 implementation. The compact
// body branch above still consumes them.

function defaultRateNode(placement: PlacementData) {
  const value = placement.hourlyRate
    ? `£${placement.hourlyRate}/hr`
    : placement.nannyHourlyRate
      ? `£${placement.nannyHourlyRate}/hr`
      : "Rate not set";
  return (
    <div className="flex items-center justify-end gap-1">
      <PoundSterling className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
      <span className="text-sm text-slate-600 font-medium">{value}</span>
    </div>
  );
}

function defaultHoursNode(placement: PlacementData) {
  const value = placement.weeklyHours
    ? `${placement.weeklyHours}hrs/wk`
    : "Hours not set";
  return (
    <div className="flex items-center justify-end gap-1">
      <Clock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
      <span className="text-sm text-slate-600">{value}</span>
    </div>
  );
}

export function PlacementCard({
  placement,
  compact = false,
  rateNode,
  hoursNode,
  menuSlot,
  hideViewProfile = false,
  onClick,
  showBrowseNanniesLink = false,
}: PlacementCardProps) {
  const age = computeAge(placement.nannyDateOfBirth);
  const interactive = typeof onClick === "function";

  // Nested-interactive guard. The interactive variant wraps the body
  // in a `<button>`. Menu slot + visible View Profile link both
  // contain `<button>` / `<a>` elements — nesting them inside the
  // outer button is invalid HTML and breaks assistive tech. The chat
  // tile passes `hideViewProfile` and no menu, so this is safe today.
  // Surface the misuse loudly in dev rather than silently rendering
  // a broken card.
  if (
    interactive &&
    process.env.NODE_ENV !== "production" &&
    (menuSlot || !hideViewProfile)
  ) {
    console.error(
      "[PlacementCard] `onClick` cannot combine with `menuSlot` or a visible View Profile link " +
        "— would nest interactive elements inside an outer <button>. Pass `hideViewProfile` and " +
        "drop `menuSlot` when using the interactive variant.",
    );
  }

  const firstName = placement.nannyName.split(" ")[0];
  const lastInitial = (placement.nannyName.split(" ")[1] ?? "")
    .charAt(0)
    .toUpperCase();

  // ───────────────────────────────────────────────────────────────────────
  // Compact body — UNCHANGED from prior implementation. Used by Katie's
  // chat tile and any other surface that consumes
  // <PlacementCard compact />. Editing this branch breaks those consumers.
  // ───────────────────────────────────────────────────────────────────────
  const compactBody = (
    <CardContent className="px-4 py-3">
      <div className="flex items-start gap-4 relative">
        <div className="shrink-0">
          {placement.nannyPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={placement.nannyPhoto}
              alt=""
              className="w-14 h-14 rounded-full object-cover"
            />
          ) : (
            <div className="w-14 h-14 rounded-full bg-violet-100 flex items-center justify-center">
              <span className="text-lg font-semibold text-violet-500">
                {placement.nannyName.charAt(0)}
              </span>
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <h3 className="font-semibold text-base text-slate-900 truncate">
              {firstName}
            </h3>
            {age != null && (
              <span className="text-base text-slate-400 shrink-0">{age}</span>
            )}
          </div>

          {placement.nannySuburb && (
            <div className="flex items-center gap-1 text-sm text-slate-500 mt-0.5">
              <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              {placement.nannySuburb}
            </div>
          )}

          {placement.wwccVerified && (
            <div className="flex items-center gap-1 text-green-600 text-xs font-medium mt-1">
              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
              Verified
            </div>
          )}
        </div>

        <div className="shrink-0 text-right space-y-1.5 mr-14">
          {rateNode ?? defaultRateNode(placement)}
          {hoursNode ?? defaultHoursNode(placement)}
          <StartDateLine startDate={placement.startDate} />
        </div>

        {menuSlot && (
          <div className="absolute top-0 right-0 flex items-center gap-0.5">
            {menuSlot}
          </div>
        )}
      </div>

      {!hideViewProfile && (
        <div className="mt-4">
          <Button asChild variant="outline" className="w-full">
            <Link href={`/nannies/${placement.nannyId}`}>
              View Profile
              <ArrowRight className="ml-1.5 w-4 h-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      )}
    </CardContent>
  );

  // ───────────────────────────────────────────────────────────────────────
  // Default body — A-03 redesign. Mobile-first vertical hero card:
  //   - Large centred avatar (w-28 mobile → w-32 sm)
  //   - Full first name (no truncate; wraps)
  //   - Suburb + Verified badge centred under name
  //   - Stats grid: Rate · Hours · Start (3 columns on sm, 1 column stack on smaller)
  //   - Optional menu slot top-right (absolute, doesn't reflow)
  //   - View Profile button bottom (full-width)
  // Tokens: existing violet/slate/green per Baby Bloom design system.
  // ───────────────────────────────────────────────────────────────────────
  const defaultBody = (
    <CardContent className="px-5 py-6 sm:py-8">
      <div className="relative flex flex-col items-center gap-5 text-center">
        {/* Menu slot — absolute so it doesn't reflow the hero */}
        {menuSlot && (
          <div className="absolute top-0 right-0 flex items-center gap-0.5">
            {menuSlot}
          </div>
        )}

        {/* Avatar */}
        <div className="shrink-0">
          {placement.nannyPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={placement.nannyPhoto}
              alt=""
              className="h-28 w-28 sm:h-32 sm:w-32 rounded-full object-cover ring-4 ring-violet-50"
            />
          ) : (
            <div className="h-28 w-28 sm:h-32 sm:w-32 rounded-full bg-violet-100 flex items-center justify-center ring-4 ring-violet-50">
              <span className="text-4xl sm:text-5xl font-semibold text-violet-500">
                {firstName.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
        </div>

        {/* Name + age. `break-words` allows long first names to wrap rather
            than truncate (real-soak: "Christopher", "Maximilian"). */}
        <div className="w-full">
          {/* slate-500 (≈4.84:1 on white) clears AA for normal text;
              text-slate-400 (≈2.85:1) failed per a11y-architect HIGH. */}
          <h3 className="font-bold text-2xl sm:text-3xl text-slate-900 break-words">
            {firstName}
            {lastInitial ? (
              <span className="text-slate-500 font-medium">
                {" "}
                {lastInitial}.
              </span>
            ) : null}
            {age != null && (
              <span className="ml-2 text-lg sm:text-xl text-slate-500 font-medium">
                {age}
              </span>
            )}
          </h3>
        </div>

        {/* Suburb + Verified row */}
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 -mt-2">
          {placement.nannySuburb && (
            <div className="flex items-center gap-1 text-sm text-slate-500">
              <MapPin className="w-4 h-4 shrink-0" aria-hidden="true" />
              {placement.nannySuburb}
            </div>
          )}
          {placement.wwccVerified && (
            <div className="flex items-center gap-1 text-sm font-medium text-green-600">
              <ShieldCheck className="w-4 h-4" aria-hidden="true" />
              Verified
            </div>
          )}
        </div>

        {/* Stats grid. `grid-cols-1 sm:grid-cols-3` stacks the three cells
            vertically on the smallest viewports (a11y-architect MED:
            cells were cramped at 320px when the main page injects an
            <input> for inline rate/hours editing — the stack gives each
            input its full row). Icons use slate-500 to clear the 3:1
            graphical-contrast threshold on the slate-50 cell background. */}
        <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
          <Stat
            icon={<PoundSterling className="h-4 w-4 text-slate-500" />}
            label="Rate"
            valueNode={rateNode ?? defaultStatValueRate(placement)}
          />
          <Stat
            icon={<Clock className="h-4 w-4 text-slate-500" />}
            label="Hours"
            valueNode={hoursNode ?? defaultStatValueHours(placement)}
          />
          <Stat
            icon={<Calendar className="h-4 w-4 text-slate-500" />}
            label="Start"
            valueNode={<StartDateValue startDate={placement.startDate} />}
          />
        </div>
      </div>

      {!hideViewProfile && (
        <div className="mt-6">
          <Button asChild variant="outline" className="w-full">
            <Link href={`/nannies/${placement.nannyId}`}>
              View Profile
              <ArrowRight className="ml-1.5 w-4 h-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      )}

      {/* A-04: subtle browse-nannies fallthrough. The parent hub hides
          its "Nannies" sub-tab when a placement exists; this preserves
          discoverability without prompting "switch nannies" energy.
          a11y: persistent underline (WCAG 1.4.1 — color alone isn't a
          sufficient differentiator) + py-2 padding so the touch target
          clears WCAG 2.5.8 24px minimum despite the small text size. */}
      {showBrowseNanniesLink && (
        <div className="mt-3 text-center">
          <Link
            href="/parent?t=childcare&s=nannies"
            className="inline-block py-2 px-1 text-xs text-slate-600 underline decoration-slate-300 underline-offset-4 hover:text-slate-800 hover:decoration-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 focus-visible:ring-offset-2 rounded"
          >
            see all nannies
          </Link>
        </div>
      )}
    </CardContent>
  );

  const body = compact ? compactBody : defaultBody;

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 focus-visible:ring-offset-2"
      >
        <Card className="hover:shadow-md transition-all hover:border-violet-200 overflow-hidden">
          {body}
        </Card>
      </button>
    );
  }

  return (
    <Card className="hover:shadow-md transition-all hover:border-violet-200 overflow-hidden">
      {body}
    </Card>
  );
}
