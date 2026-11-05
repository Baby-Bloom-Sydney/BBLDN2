import { notFound } from "next/navigation";
import { z } from "zod";
import { proveAdmin } from "@/lib/calls/admin-proof";
import { ADMIN_COPY } from "@/lib/calls/copy";
import { loadCallsDashboard } from "@/lib/calls/dashboard";
import { loadFamilyPanel } from "@/lib/calls/family-panel";
import { callBookingEnabled } from "@/lib/features/flags";
import { AlertLine } from "../cohorts/parts";
import { CallsClient } from "./CallsClient";

/**
 * `/admin/calls` — the matchmaker calls still to make, booked or not (brief 04 §0.8–0.11, §3 admin 1–4, 6; plan C3,
 * C4, §13; BB-wave1-041126/04c1-build). The `/admin/cohorts` shape with the switch in front: `CALL_BOOKING_ENABLED`
 * off → 404 before the admin check or any read; not an admin → 404; then the Calls tab's one read and, for
 * `?openCall=<parent user id>`, her drawer. Admin only (middleware `/admin` + `proveAdmin`). Every time is London.
 * The Calendar tab (`?tab=calendar`) is 04c-2's.
 */
export const dynamic = "force-dynamic";

interface AdminCallsPageProps {
  readonly searchParams?: Record<string, string | string[] | undefined>;
}

/** `?openCall=`, first value, only if it is a user id. */
function openCallParam(searchParams: AdminCallsPageProps["searchParams"]): string | null {
  const raw = searchParams?.openCall;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return z.uuid().safeParse(value).success ? (value as string) : null;
}

export default async function AdminCallsPage({ searchParams }: AdminCallsPageProps) {
  if (!callBookingEnabled()) notFound();
  const proof = await proveAdmin();
  if (!proof) notFound();
  const openCallId = openCallParam(searchParams);
  const [dashboard, panel] = await Promise.all([loadCallsDashboard(proof), openCallId ? loadFamilyPanel(proof, openCallId) : Promise.resolve(null)]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="text-2xl font-bold text-slate-900">{ADMIN_COPY.pageHeading}</h1>
      <p className="mt-1 text-sm text-slate-500">{`${ADMIN_COPY.pageIntro} ${ADMIN_COPY.londonNote}`}</p>
      {dashboard.ok ? (
        <CallsClient
          dashboard={dashboard.value}
          openCallId={openCallId}
          panel={panel?.ok ? panel.value : null}
          panelFailed={panel !== null && !panel.ok}
        />
      ) : (
        <div className="mt-6">
          <AlertLine>{ADMIN_COPY.loadFailed}</AlertLine>
        </div>
      )}
    </div>
  );
}
