// T-032 — Nanny Contact Management page (RSC).
// Reads URL search params → parses to typed state → fetches a page of leads +
// the optionally-open drawer detail → renders the client wrapper.

import { Suspense } from "react";
import { requireAdmin } from "@/lib/admin/require-admin";
import { notFound } from "next/navigation";
import { fetchLeads, fetchLeadsAggregateStats } from "@/lib/leads/fetch-leads";
import { fetchLeadDetail } from "@/lib/leads/fetch-lead-detail";
import { fetchActivityTimeline } from "@/lib/leads/timeline";
import { parseLeadQueryState } from "@/lib/leads/query-builder";
import { AdminLeadsClient } from "./AdminLeadsClient";

export const dynamic = "force-dynamic";

interface AdminLeadsPageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

export default async function AdminLeadsPage({
  searchParams,
}: AdminLeadsPageProps) {
  const gate = await requireAdmin();
  if (gate.error) notFound();

  const state = parseLeadQueryState(searchParams ?? {});
  const openLeadId = (() => {
    const v = searchParams?.openLead;
    if (typeof v === "string") return v;
    if (Array.isArray(v) && typeof v[0] === "string") return v[0];
    return null;
  })();

  const [leadsPage, stats, detail] = await Promise.all([
    fetchLeads(state),
    fetchLeadsAggregateStats(),
    openLeadId ? fetchLeadDetail(openLeadId) : Promise.resolve(null),
  ]);

  const timeline = detail
    ? await fetchActivityTimeline(detail.nanny_user_id, detail.nanny_id)
    : [];

  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-muted-foreground">Loading…</div>
      }
    >
      <AdminLeadsClient
        initialState={state}
        leadsPage={leadsPage}
        stats={stats}
        initialDetail={detail}
        initialTimeline={timeline}
        openLeadId={openLeadId}
      />
    </Suspense>
  );
}
