import { notFound } from "next/navigation";
import { PARENT_COPY } from "@/lib/calls/copy";
import { safeNextPath } from "@/lib/calls/next-path";
import { sessionParentId } from "@/lib/calls/parent-session";
import { loadMyCallView } from "@/lib/calls/parent-state";
import { callBookingEnabled } from "@/lib/features/flags";
import { CallPageClient } from "./CallPageClient";

/**
 * `/parent/call` — her Complimentary matchmaker call (brief 04 §0.1–0.5, §3 parent; plan B6).
 *
 * `CALL_BOOKING_ENABLED` off → 404 before anything is read (brief §0.15). Signed out, the middleware sends her to
 * `/login?redirect=/parent/call` and back (`src/lib/supabase/middleware.ts`); not a parent → 404. Her view is loaded
 * here, on the server, with every time already in London words, so the device's zone can't matter (§3 parent 6).
 * `next` is checked (`next-path.ts`): "Go to my matches" never leaves `/parent`.
 *
 * BB-wave1-041126/04b-build, 2026-11-04.
 */
export const dynamic = "force-dynamic";

export default async function ParentCallPage({ searchParams }: { searchParams: { next?: string | string[] } }) {
  if (!callBookingEnabled()) notFound();
  const parentId = await sessionParentId();
  if (parentId === null) notFound();
  const view = await loadMyCallView(parentId);

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">{PARENT_COPY.pageHeading}</h1>
        <p className="mt-1 text-sm text-slate-600">{PARENT_COPY.pageIntro}</p>
      </header>
      <CallPageClient initial={view.ok ? view.value : { kind: "load_failed" }} nextHref={safeNextPath(searchParams.next)} />
    </div>
  );
}
