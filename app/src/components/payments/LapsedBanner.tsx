"use client";

/**
 * LapsedBanner — S3.
 *
 * Persistent unclosable banner that sits above the development feed
 * when `family_has_access(childId) === false`. Pairs with the
 * SubscribeModal (S1/S2) which fires on every page load — the modal
 * is the active interrupt; the banner is the ambient reminder for
 * the rest of the session after the modal is dismissed.
 *
 * Spec: `system/APP/PAYMENTS/FRONTEND/03-build-spec.md` §S3.
 *
 * Critical invariants:
 * - **Unclosable.** No close affordance. The lapsed state is
 *   system reality — communicating it honestly is the point.
 * - Parent + nanny variants render different copy + CTA labels.
 * - Amber palette (matches PastDueBanner — warning-state semantic).
 * - No "track" terminology.
 *
 * The parent route decides WHEN to render this banner (gated on
 * `family_has_access(childId) === false`). The banner is pure
 * presentation — it does not query state.
 */

import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DfyAccessLine,
  isDfyLapseReason,
  type SubscribeModalLapseReason,
} from "./SubscribeModal";

export interface LapsedBannerProps {
  /** Audience — drives copy + CTA label. */
  role: "parent" | "nanny";
  /** Child's first name — interpolated into headline. */
  childFirstName: string;
  /**
   * Parent's first name — surfaced on the nanny variant CTA.
   * Optional; falls back to "the parent" when absent.
   */
  parentFirstName?: string;
  /**
   * Fires when the user clicks the primary CTA. Typical parent-
   * route behaviour is to re-open the SubscribeModal (so the
   * user gets the full pitch + secondary CTAs), but the parent
   * route could also route direct to /parent/subscribe.
   *
   * Optional on the parent variant — omit when the parent is
   * already on the Subscribe destination page so the button
   * would self-navigate (Bailey 2026-05-14). The nanny variant
   * always renders its Share CTA (different action, not a
   * self-nav risk).
   */
  onPrimaryCta?: () => void;
  /**
   * The paywall copy key (4g). For the two done-for-you keys the parent variant shows one line and no Subscribe
   * button (ADR-091/093). Optional: absent = today's self-serve copy.
   */
  lapseReason?: SubscribeModalLapseReason;
  /** Nanny variant (4g, ADR-091): the family is done-for-you — one line, no share-to-subscribe CTA. */
  familyIsDfy?: boolean;
}

export const NANNY_DFY_LINE =
  "This family's app access is arranged by Baby Bloom.";

export function LapsedBanner({
  role,
  childFirstName,
  parentFirstName,
  onPrimaryCta,
  lapseReason,
  familyIsDfy = false,
}: LapsedBannerProps) {
  if (role === "nanny" && familyIsDfy) {
    return (
      <div
        role="status"
        className="flex w-full items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 sm:px-6"
      >
        <Lock className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
        <p className="flex-1 text-sm text-amber-900">{NANNY_DFY_LINE}</p>
      </div>
    );
  }

  if (role === "parent" && lapseReason && isDfyLapseReason(lapseReason)) {
    return (
      <div
        role="status"
        className="flex w-full items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 sm:px-6"
      >
        <Lock className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
        <p className="flex-1 text-sm text-amber-900">
          <DfyAccessLine reason={lapseReason} />
        </p>
      </div>
    );
  }

  if (role === "parent") {
    return (
      <div
        role="status"
        className="flex w-full items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 sm:px-6"
      >
        <Lock className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
        <p className="flex-1 text-sm text-amber-900">
          <span className="font-semibold">Subscription required.</span>{" "}
          Subscribe to keep adding to {childFirstName}&apos;s feed.
        </p>
        {onPrimaryCta && (
          <Button
            size="sm"
            className="shrink-0 bg-violet-600 hover:bg-violet-700"
            onClick={onPrimaryCta}
          >
            Subscribe
          </Button>
        )}
      </div>
    );
  }

  // role === "nanny"
  const parentRef = parentFirstName ?? "the parent";
  return (
    <div
      role="status"
      className="flex w-full items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 sm:px-6"
    >
      <Lock className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
      <p className="flex-1 text-sm text-amber-900">
        <span className="font-semibold">
          {childFirstName}&apos;s family subscription has lapsed.
        </span>{" "}
        {parentRef} needs to subscribe to continue.
      </p>
      {onPrimaryCta && (
        <Button
          size="sm"
          className="shrink-0 bg-violet-600 hover:bg-violet-700"
          onClick={onPrimaryCta}
        >
          Share with {parentRef}
        </Button>
      )}
    </div>
  );
}
