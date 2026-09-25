"use client";

/**
 * NannyEarningsBadge — small wallet tile rendered next to the avatar
 * in `DashboardNav` for nanny role only.
 *
 * Spec: DSS §8 Q2 (Bailey 2026-05-12) — nanny sees the total £ value
 * + wallet icon, on every page, from the moment they add their first
 * child. Clicking routes to `/nanny/payouts` where the breakdown
 * lives (next payout, this month, per family).
 *
 * Copy rules:
 *  - Just the £ value. NO "across N families" text per Bailey.
 *  - Format: `£N` (no decimals; values are always whole hundreds).
 *
 * Fetch model: a single `/api/nanny/earnings-badge` GET on mount.
 * The value moves slowly (a new family is a manual user action), so
 * we don't poll. The next nav transition naturally re-fetches via
 * the badge re-mount.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { trackEvent } from "@/lib/analytics/trackEvent";

interface BadgePayload {
  totalAud: number;
}

export function NannyEarningsBadge() {
  const [data, setData] = useState<BadgePayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/nanny/earnings-badge", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as BadgePayload;
        if (!cancelled) setData(json);
      } catch {
        // Best-effort fetch; if it fails, the badge silently doesn't
        // render. Failure mode is "no wallet visible" — not a hard
        // error to the user.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Hide until data lands AND there's something earned. Showing £0
  // would be noise; the wallet appears when the nanny has actual
  // money paid + accruing (Bailey correction 2026-05-13).
  if (!data || data.totalAud === 0) return null;

  return (
    <Link
      href="/nanny/payouts"
      onClick={() =>
        trackEvent({
          event_name: "nanny_earnings_badge_clicked",
          user_role: "nanny",
        })
      }
      className="flex h-8 items-center gap-1.5 rounded-full bg-emerald-50 px-3 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
      aria-label={`Open contributions dashboard — current cycle total £${data.totalAud}`}
    >
      <Wallet className="h-4 w-4" aria-hidden="true" />
      <span>£{data.totalAud}</span>
    </Link>
  );
}
