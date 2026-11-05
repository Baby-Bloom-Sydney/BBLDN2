"use client";

/**
 * The Calls tab (plan C3; brief §0.8, §0.13, §3 admin 1; BB-wave1-041126/04c1-build), top to bottom: this week's
 * counts line and, with Cohorts on, the cohort line; the free-time banner (red: none; amber: running low); then
 * Today and upcoming, Overdue, Not booked — to call, and History. Everything was read once on the server
 * (`loadCallsDashboard`); this draws it. With nobody to call and no history, one empty state.
 *
 * `renderCallControl` is each row's Call slot — a `tel:` link by default; brief 05 passes its dialer.
 */

import { PhoneCall } from "lucide-react";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { ADMIN_COPY } from "@/lib/calls/copy";
import type { CallsDashboard, FreeTimeBanner } from "@/lib/calls/dashboard";
import { AlertLine, SmallLabel } from "../cohorts/parts";
import { defaultCallControl, type RenderCallControl } from "./CallRowParts";
import { CallSection, HistorySection } from "./CallSection";

export interface CallsTabProps {
  readonly dashboard: CallsDashboard;
  readonly onOpen: (parentUserId: string) => void;
  readonly renderCallControl?: RenderCallControl;
}

function WeekCard({ counts, cohort }: Pick<CallsDashboard, "counts" | "cohort">) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <SmallLabel>This week</SmallLabel>
        {counts === null ? <AlertLine>{ADMIN_COPY.countsFailed}</AlertLine> : <p className="text-base font-semibold text-slate-900">{counts}</p>}
        {cohort && <p className="text-sm font-medium text-violet-700">{cohort}</p>}
      </CardContent>
    </Card>
  );
}

function Banner({ banner }: { readonly banner: FreeTimeBanner }) {
  if (banner.tone === "red") {
    return (
      <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
        {banner.line}
      </p>
    );
  }
  return (
    <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
      {banner.line}
    </p>
  );
}

const isEmpty = (d: CallsDashboard): boolean =>
  d.upcoming.length === 0 && d.overdue.length === 0 && d.notBooked.length === 0 && d.history !== null && d.history.length === 0;

export function CallsTab({ dashboard, onOpen, renderCallControl = defaultCallControl }: CallsTabProps) {
  const rows = { onOpen, renderCallControl };
  return (
    <div className="space-y-6">
      <WeekCard counts={dashboard.counts} cohort={dashboard.cohort} />
      {dashboard.banner && <Banner banner={dashboard.banner} />}
      {isEmpty(dashboard) ? (
        <EmptyState icon={PhoneCall} title={ADMIN_COPY.nothingYetTitle} description={ADMIN_COPY.nothingYetBody} />
      ) : (
        <>
          <CallSection id="calls-upcoming" title={ADMIN_COPY.sectionUpcoming} rows={dashboard.upcoming} {...rows} />
          <CallSection id="calls-overdue" title={ADMIN_COPY.sectionOverdue} rows={dashboard.overdue} {...rows} />
          <CallSection id="calls-not-booked" title={ADMIN_COPY.sectionNotBooked} rows={dashboard.notBooked} {...rows} />
          <HistorySection rows={dashboard.history} onOpen={onOpen} />
        </>
      )}
    </div>
  );
}
