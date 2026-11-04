"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const HIDDEN_PATHS = [
  "/parent/request",
  "/matchmaking/onboarding",
  "/bb/test/onboarding-verification",
  "/nanny/onboarding-verification",
  // T-022 — same hide-footer treatment as the verification flow.
  "/nanny/onboarding/add-child",
  "/apply",
  // Brief 04 §0a.1 (04b rework W2): the call slide is a funnel slide — no footer.
  "/matchmaking/call",
];

// useSearchParams forces the closest Suspense boundary to client-render;
// wrapping the body in our own Suspense localises that cost to the footer
// rather than bailing every page out of static optimisation.
function MiniFooterInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Headless funnel: parallel to LandingHeader. See T-039 Slice B.
  const funnelSrc = searchParams.get("src");
  if (funnelSrc === "std" || funnelSrc === "adv") return null;

  if (HIDDEN_PATHS.some((p) => pathname.startsWith(p))) return null;

  return (
    <div className="flex justify-center gap-3 text-[10px] text-slate-400 py-3">
      <Link href="/about" className="hover:underline">
        About
      </Link>
      <Link href="/legal/privacy-policy" className="hover:underline">
        Privacy Policy
      </Link>
      <Link href="/legal/client-terms" className="hover:underline">
        Terms and Conditions
      </Link>
    </div>
  );
}

export function MiniFooter() {
  return (
    <Suspense fallback={null}>
      <MiniFooterInner />
    </Suspense>
  );
}
