import { notFound, redirect } from "next/navigation";
import { mayBookNow } from "@/lib/calls/call-allowed";
import { CALL_PAGE_PATH, safeNextPath } from "@/lib/calls/next-path";
import { sessionCaller } from "@/lib/calls/parent-session";
import { loadMyCallView } from "@/lib/calls/parent-state";
import { callBookingEnabled } from "@/lib/features/flags";
import { CallPageClient } from "./CallPageClient";

/**
 * `/matchmaking/call` — her Complimentary matchmaker call, as the next slide of the funnel (brief 04 §0a.1; 04b
 * rework W1; was `/parent/call`, plan B6).
 *
 * `CALL_BOOKING_ENABLED` off → 404 before anything is read (brief §0.15). The middleware doesn't guard
 * `/matchmaking`, so the page does: signed out → `/login?redirect=` this path with its query (the login page honours
 * safe internal paths, `src/app/(auth)/login/page.tsx:87`); signed in but not a parent → 404. Her view is loaded here,
 * on the server, with every time already in London words, so the device's zone can't matter (§3 parent 6). `next` is
 * checked (`next-path.ts`): onward never leaves `/parent`. `?change=1` opens straight into changing her time (W5).
 *
 * W17 items 13, 15: the same rule as the hold action (`mayBookNow`: the card's rule, or a booked call still ahead she
 * is changing, and no hired or connected nanny). It runs alongside her view load (Promise.all), not after it, though
 * its own reads still add work to the request. "no" — before Start call booking, after Stop calling or an answered
 * call, out of scope, or with a nanny — sends her straight onward to the checked `next`, so the slide never shows a
 * picker whose taps would be refused. "yes" renders as before; so does "unknown" (her view and the hold action already
 * handle a read that failed).
 *
 * BB-wave1-041126/04b-build, 2026-11-04; BB-wave1-041126/04b-rework, 2026-11-05.
 */
export const dynamic = "force-dynamic";

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

/** This page's own path and query, to come back to after signing in. */
function returnPath(searchParams: SearchParams): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    for (const one of Array.isArray(value) ? value : [value]) if (typeof one === "string") query.append(key, one);
  }
  const search = query.toString();
  return search === "" ? CALL_PAGE_PATH : `${CALL_PAGE_PATH}?${search}`;
}

export default async function MatchmakingCallPage({ searchParams }: { searchParams: SearchParams }) {
  if (!callBookingEnabled()) notFound();
  const caller = await sessionCaller();
  if (caller.kind === "signed_out") redirect(`/login?redirect=${encodeURIComponent(returnPath(searchParams))}`);
  if (caller.kind !== "parent") notFound();
  const [allowed, view] = await Promise.all([mayBookNow(caller.parentId), loadMyCallView(caller.parentId)]);
  const nextHref = safeNextPath(searchParams.next);
  if (allowed === "no") redirect(nextHref);

  // The slide draws its own funnel shell (W3): no app wrapper here.
  return (
    <CallPageClient
      initial={view.ok ? view.value : { kind: "load_failed" }}
      nextHref={nextHref}
      startChanging={searchParams.change === "1"}
    />
  );
}
