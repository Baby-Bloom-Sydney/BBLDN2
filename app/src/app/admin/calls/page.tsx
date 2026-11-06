import { notFound } from "next/navigation";
import { z } from "zod";
import { calendarWeek } from "@/lib/calls/admin-calls";
import { proveAdmin } from "@/lib/calls/admin-proof";
import { ADMIN_COPY } from "@/lib/calls/copy";
import { loadCallsDashboard } from "@/lib/calls/dashboard";
import { loadFamilyPanel } from "@/lib/calls/family-panel";
import { callBookingEnabled } from "@/lib/features/flags";
import { CallsClient } from "./CallsClient";

/**
 * `/admin/calls` — the matchmaker calls still to make, booked or not (brief 04 §0.8–0.11, §3 admin 1–4, 6; plan C3,
 * C4, §13; BB-wave1-041126/04c1-build). The `/admin/cohorts` shape with the switch in front: `CALL_BOOKING_ENABLED`
 * off → 404 before the admin check or any read; not an admin → 404; then the Calls tab's one read and, for
 * `?openCall=<parent user id>`, her drawer. Admin only (middleware `/admin` + `proveAdmin`). Every time is London.
 *
 * 04c-2 (BB-wave1-041126/04c2-build): the Calendar tab's one read (`calendarWeek`) runs alongside, after the switch and
 * the proof; `?tab=calendar` opens that tab (the client reads it from the URL), anything else Calls. Each tab says when
 * its own read failed.
 */
export const dynamic = "force-dynamic";

interface AdminCallsPageProps {
  readonly searchParams?: Record<string, string | string[] | undefined>;
}

/** `?openCall=`, first value, only if it is a user id. */
function openCallParam(searchParams: AdminCallsPageProps["searchParams"]): string | null {
  const raw = searchParams?.openCall;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}

export default async function AdminCallsPage({ searchParams }: AdminCallsPageProps) {
  if (!callBookingEnabled()) notFound();
  const proof = await proveAdmin();
  if (!proof) notFound();
  const openCallId = openCallParam(searchParams);
  const [dashboard, panel, calendar] = await Promise.all([
    loadCallsDashboard(proof),
    openCallId ? loadFamilyPanel(proof, openCallId) : Promise.resolve(null),
    calendarWeek(proof),
  ]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="text-2xl font-bold text-slate-900">{ADMIN_COPY.pageHeading}</h1>
      <p className="mt-1 text-sm text-slate-500">{`${ADMIN_COPY.pageIntro} ${ADMIN_COPY.londonNote}`}</p>
      <CallsClient
        dashboard={dashboard.ok ? dashboard.value : null}
        calendar={calendar.ok ? calendar.value : null}
        openCallId={openCallId}
        panel={panel?.ok ? panel.value : null}
        panelFailed={panel !== null && !panel.ok}
      />
    </div>
  );
}
