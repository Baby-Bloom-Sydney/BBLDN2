import { notFound } from "next/navigation";
import { z } from "zod";
import { calendarWeek } from "@/lib/calls/admin-calls";
import { proveAdmin } from "@/lib/calls/admin-proof";
import { ADMIN_COPY } from "@/lib/calls/copy";
import { loadCallsDashboard } from "@/lib/calls/dashboard";
import { loadFamilyPanel } from "@/lib/calls/family-panel";
import { callBookingEnabled, justcallWebhookEnabled } from "@/lib/features/flags";
import { listUnmatched } from "@/lib/justcall/admin";
import { CallsClient } from "./CallsClient";
import { JustCallCallsClient } from "./JustCallCallsClient";

/**
 * `/admin/calls` — the matchmaker calls still to make, booked or not (brief 04 §0.8–0.11, §3 admin 1–4, 6; plan C3,
 * C4, §13; BB-wave1-041126/04c1-build). The `/admin/cohorts` shape with the switch in front: `CALL_BOOKING_ENABLED`
 * off → 404 before the admin check or any read; not an admin → 404; then the Calls tab's one read and, for
 * `?openCall=<parent user id>`, her drawer. Admin only (middleware `/admin` + `proveAdmin`). Every time is London.
 *
 * 04c-2 (BB-wave1-041126/04c2-build): the Calendar tab's one read (`calendarWeek`) runs alongside, after the switch and
 * the proof; `?tab=calendar` opens that tab (the client reads it from the URL), anything else Calls. Each tab says when
 * its own read failed.
 *
 * Brief 05 (05a-2, plan 05 §5 B7, D1; BB-wave2-231126/05-build): with `JUSTCALL_WEBHOOK_ENABLED` on (it needs call
 * booking too), the Unmatched JustCall calls are read alongside, after the proof, and the page renders
 * `JustCallCallsClient` (04's client with 05's two slots). With it off: no JustCall read, and `CallsClient` exactly as
 * today (`page.test.tsx`'s snapshots).
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
  const logging = justcallWebhookEnabled();
  const [dashboard, panel, calendar, unmatched] = await Promise.all([
    loadCallsDashboard(proof),
    openCallId ? loadFamilyPanel(proof, openCallId) : Promise.resolve(null),
    calendarWeek(proof),
    logging ? listUnmatched(proof) : Promise.resolve(null),
  ]);
  const client = {
    dashboard: dashboard.ok ? dashboard.value : null,
    calendar: calendar.ok ? calendar.value : null,
    openCallId,
    panel: panel?.ok ? panel.value : null,
    panelFailed: panel !== null && !panel.ok,
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="text-2xl font-bold text-slate-900">{ADMIN_COPY.pageHeading}</h1>
      <p className="mt-1 text-sm text-slate-500">{`${ADMIN_COPY.pageIntro} ${ADMIN_COPY.londonNote}`}</p>
      {logging ? <JustCallCallsClient {...client} unmatched={unmatched?.ok ? unmatched.value : null} /> : <CallsClient {...client} />}
    </div>
  );
}
