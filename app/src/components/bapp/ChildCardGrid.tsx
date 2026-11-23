"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Baby, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChildClient } from "@/types/bapp";
import { AddChildSheet } from "./AddChildSheet";
import { AddChildSheetParent } from "./AddChildSheetParent";
import { AddChildModal } from "./AddChildModal";
import { ConnectExistingChildSheet } from "./ConnectExistingChildSheet";
import { OnboardSheet } from "./OnboardSheet";

function calculateAge(dob: string): string {
  const birth = new Date(dob);
  const now = new Date();
  const months =
    (now.getFullYear() - birth.getFullYear()) * 12 +
    (now.getMonth() - birth.getMonth());
  if (months < 1) return "Newborn";
  if (months < 12) return `${months}mo`;
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  if (remainingMonths === 0) return `${years}yr`;
  return `${years}yr ${remainingMonths}mo`;
}

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  created_auto: { label: "New", color: "bg-slate-100 text-slate-600" },
  created_manual: { label: "New", color: "bg-slate-100 text-slate-600" },
  setup: { label: "Ready", color: "bg-blue-50 text-blue-700" },
  active_nanny: { label: "Active", color: "bg-emerald-50 text-emerald-700" },
  trial: { label: "Trial", color: "bg-amber-50 text-amber-700" },
  trial_ended: { label: "Trial Ended", color: "bg-orange-50 text-orange-700" },
  active: { label: "Active", color: "bg-emerald-50 text-emerald-700" },
  closed: { label: "Closed", color: "bg-red-50 text-red-600" },
};

interface ChildCardGridProps {
  children: ChildClient[];
  role: "nanny" | "parent";
  /**
   * Set of child_client.id values whose family is currently subscribed
   * (parent_subscriptions.status in trial/active_monthly/active_upfront).
   * Renders a small green tick on those tiles — the only positive-state
   * indicator on the nanny child grid per DSS §8 Q8 (Bailey 2026-05-12).
   * Unsubscribed tiles render normally (no negative-state indicator;
   * gates handle that elsewhere).
   *
   * Optional. Callers that don't pass it get no ticks.
   */
  subscribedChildIds?: Set<string>;
  /**
   * Starts the nanny's add-child sheet open, on arrival only (the hub's `?add=child`, from the invoice picker's "Add
   * family", 06b-4). Read once as the sheet's starting state; a parent's grid ignores it.
   */
  openAddOnArrival?: boolean;
}

export function ChildCardGrid({
  children,
  role,
  subscribedChildIds,
  openAddOnArrival = false,
}: ChildCardGridProps) {
  const router = useRouter();
  const [chooserOpen, setChooserOpen] = useState(false);
  const [addNannySheetOpen, setAddNannySheetOpen] = useState(
    role === "nanny" && openAddOnArrival,
  );
  const [addParentSheetOpen, setAddParentSheetOpen] = useState(false);
  const [connectSheetOpen, setConnectSheetOpen] = useState(false);
  const [onboardChild, setOnboardChild] = useState<ChildClient | null>(null);

  function handleCardClick(child: ChildClient) {
    if (!child.onboarded) {
      setOnboardChild(child);
    } else {
      router.push(`/${role}/development/${child.id}`);
    }
  }

  function handleAddNew() {
    if (role === "parent") {
      setAddParentSheetOpen(true);
    } else {
      setAddNannySheetOpen(true);
    }
  }

  const hasChildren = children.length > 0;

  return (
    <>
      {hasChildren ? (
        <div className="grid grid-cols-2 gap-3">
          {children.map((child, index) => {
            const badge =
              STATUS_BADGE[child.status] ?? STATUS_BADGE.created_auto;
            const isShell = !child.onboarded;
            const hasPhoto = !!child.profile_picture_url;
            const isSubscribed = subscribedChildIds?.has(child.id) ?? false;

            return (
              <button
                key={child.id}
                onClick={() => handleCardClick(child)}
                className={cn(
                  "relative flex flex-col items-center gap-2 rounded-2xl border bg-white p-4 shadow-sm transition-all hover:shadow-md hover:border-emerald-200",
                  isShell
                    ? "border-dashed border-slate-300"
                    : "border-slate-200",
                )}
              >
                {/* Subscribed-family tick — DSS §8 Q8 (Bailey 2026-05-12).
                    Top-right of the tile, small + emerald. Only visible
                    for nanny role (parents always own their own family
                    subscription state; the tick on the parent side
                    would be tautological). */}
                {isSubscribed && role === "nanny" && (
                  <span
                    className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm"
                    aria-label="Family subscribed"
                  >
                    <Check className="h-3 w-3" aria-hidden="true" />
                  </span>
                )}
                {/* Avatar — prefers the child's profile picture; falls
                    back to the Baby icon when none uploaded yet (per
                    user feedback 2026-05-07: never show first-letter
                    monogram, never leave the slot empty). */}
                <div
                  className={cn(
                    "flex h-14 w-14 items-center justify-center overflow-hidden rounded-full",
                    isShell
                      ? "bg-slate-100 text-slate-400"
                      : "bg-emerald-50 text-emerald-500",
                  )}
                >
                  {hasPhoto ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={child.profile_picture_url ?? ""}
                      alt={child.first_name ?? "Child"}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Baby className="h-6 w-6" aria-hidden="true" />
                  )}
                </div>

                {/* Name + age */}
                <div className="text-center">
                  <p className="text-sm font-semibold text-slate-900">
                    {isShell ? `Child ${index + 1}` : child.first_name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {child.date_of_birth
                      ? calculateAge(child.date_of_birth)
                      : child.age_months_approx
                        ? `~${child.age_months_approx}mo`
                        : ""}
                  </p>
                </div>

                {/* Status badge or "Set up" prompt */}
                {isShell ? (
                  <span className="text-xs font-medium text-emerald-600">
                    Set up
                  </span>
                ) : (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium",
                      badge.color,
                    )}
                  >
                    {badge.label}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        // Empty state — full-width "Add Child" CTA. Per user spec
        // (2026-05-07): when no children exist this should be a clear
        // full-width box, not a tile competing with siblings.
        <button
          onClick={() => setChooserOpen(true)}
          aria-label="Add Child"
          className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50/30 p-8 shadow-sm transition-all hover:border-emerald-400 hover:bg-emerald-50/60"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <Plus className="h-6 w-6" aria-hidden="true" />
          </div>
          <p className="text-base font-semibold text-slate-900">Add Child</p>
          <p className="max-w-xs text-center text-xs text-slate-500">
            Add your first child to start following their development
          </p>
        </button>
      )}

      {/* Inline link affordance — only visible when at least one
          child is already shown. The full-width CTA above takes over
          for the empty state. */}
      {hasChildren && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => setChooserOpen(true)}
            className="text-sm font-medium text-emerald-600 underline-offset-4 transition-colors hover:text-emerald-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
          >
            + Add Child
          </button>
        </div>
      )}

      {/* Sheets + chooser */}
      <AddChildModal
        open={chooserOpen}
        onOpenChange={setChooserOpen}
        role={role}
        onAddNew={handleAddNew}
        onConnectExisting={() => setConnectSheetOpen(true)}
      />
      <AddChildSheet
        open={addNannySheetOpen}
        onOpenChange={setAddNannySheetOpen}
      />
      <AddChildSheetParent
        open={addParentSheetOpen}
        onOpenChange={setAddParentSheetOpen}
      />
      <ConnectExistingChildSheet
        open={connectSheetOpen}
        onOpenChange={setConnectSheetOpen}
        role={role}
      />
      {onboardChild && (
        <OnboardSheet
          child={onboardChild}
          open={!!onboardChild}
          onOpenChange={(open) => {
            if (!open) setOnboardChild(null);
          }}
        />
      )}
    </>
  );
}
