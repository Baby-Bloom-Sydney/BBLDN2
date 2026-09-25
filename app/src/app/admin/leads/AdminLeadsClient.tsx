"use client";

// T-032 — Client wrapper for /admin/leads. Owns:
//   - Filter / sort / page state (mirrored to URL search params)
//   - Drawer open / close (mirrored to ?openLead=<uuid>)
//   - Funnel-widget rendering
//   - Switching between desktop table + mobile cards

import { useRouter, usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { LeadWorklistTabs } from "./LeadWorklistTabs";
import { LeadFiltersBar } from "./LeadFiltersBar";
import { LeadsListTable } from "./LeadsListTable";
import { LeadsListCards } from "./LeadsListCards";
import { LeadDrawer } from "./LeadDrawer";
import { LeadsFunnelWidget } from "./LeadsFunnelWidget";
import { LeadsPagination } from "./LeadsPagination";
import type { LeadQueryState } from "@/lib/leads/types";
import type { LeadsAggregateStats, LeadsPage } from "@/lib/leads/fetch-leads";
import type { LeadDetail } from "@/lib/leads/fetch-lead-detail";
import type { TimelineEvent } from "@/lib/leads/types";
import { serialiseLeadQueryState } from "@/lib/leads/query-builder";

interface AdminLeadsClientProps {
  initialState: LeadQueryState;
  leadsPage: LeadsPage;
  stats: LeadsAggregateStats;
  initialDetail: LeadDetail | null;
  initialTimeline: TimelineEvent[];
  openLeadId: string | null;
}

export function AdminLeadsClient({
  initialState,
  leadsPage,
  stats,
  initialDetail,
  initialTimeline,
  openLeadId,
}: AdminLeadsClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  // Optimistic local state for the drawer so it closes instantly on outside
  // click. The URL stays the source of truth for shareable / refreshable
  // state, but we no longer block the Sheet's close on a server round-trip
  // — previously each outside click queued a router.push inside a transition
  // and the Sheet only closed once the new RSC props landed, which read as
  // "needs multiple fast clicks" from the user's seat.
  const serverWantsOpen = Boolean(openLeadId) && Boolean(initialDetail);
  const [drawerOpen, setDrawerOpen] = useState(serverWantsOpen);

  // Re-sync from URL: opening a new lead (or arriving via shared link) flips
  // the local state on; the server-driven close path also keeps us in sync.
  useEffect(() => {
    setDrawerOpen(serverWantsOpen);
  }, [serverWantsOpen]);

  const pushState = useCallback(
    (next: LeadQueryState, leadId: string | null = openLeadId) => {
      const params = serialiseLeadQueryState(next);
      if (leadId) params.set("openLead", leadId);
      const search = params.toString();
      const url = search ? `${pathname}?${search}` : pathname;
      startTransition(() => router.push(url));
    },
    [openLeadId, pathname, router],
  );

  const openDrawer = useCallback(
    (nannyUserId: string) => {
      setDrawerOpen(true);
      const params = serialiseLeadQueryState(initialState);
      params.set("openLead", nannyUserId);
      const search = params.toString();
      startTransition(() => router.push(`${pathname}?${search}`));
    },
    [initialState, pathname, router],
  );

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    const params = serialiseLeadQueryState(initialState);
    const search = params.toString();
    const url = search ? `${pathname}?${search}` : pathname;
    startTransition(() => router.push(url));
  }, [initialState, pathname, router]);

  const headerStats = useMemo(
    () => ({
      totalNannies: stats.totalNannies,
      newThisWeek: stats.newThisWeek,
      contactedThisWeek: stats.contactedThisWeek,
      activatedThisWeek: stats.activatedThisWeek,
    }),
    [stats],
  );

  return (
    <div className="space-y-4">
      {/* Header strip */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Nanny Contacts</h1>
          <p className="mt-1 text-sm text-slate-500">
            {headerStats.totalNannies.toLocaleString("en-GB")} nannies. Manual contact
            + log + notes.
          </p>
        </div>
        <LeadsFunnelWidget stats={headerStats} />
      </div>

      {/* Worklist tabs */}
      <LeadWorklistTabs
        currentTab={initialState.filters.tab}
        onChange={(tab) =>
          pushState({
            ...initialState,
            filters: { ...initialState.filters, tab },
            page: 1,
          })
        }
        disabled={isPending}
      />

      {/* Filter bar */}
      <LeadFiltersBar
        state={initialState}
        onChange={(next) => pushState({ ...next, page: 1 })}
        disabled={isPending}
      />

      {/* Desktop table */}
      <div className="hidden md:block">
        <LeadsListTable
          rows={leadsPage.rows}
          onRowClick={openDrawer}
          openLeadId={openLeadId}
          isPending={isPending}
        />
      </div>

      {/* Mobile cards */}
      <div className="block md:hidden">
        <LeadsListCards
          rows={leadsPage.rows}
          onRowClick={openDrawer}
          isPending={isPending}
        />
      </div>

      {/* Pagination */}
      <LeadsPagination
        page={leadsPage.page}
        pageSize={leadsPage.pageSize}
        total={leadsPage.total}
        renderedCount={leadsPage.rows.length}
        onPageChange={(page) => pushState({ ...initialState, page })}
        onPageSizeChange={(pageSize) =>
          pushState({ ...initialState, page: 1, pageSize })
        }
        disabled={isPending}
      />

      {/* Drawer */}
      <Sheet open={drawerOpen} onOpenChange={(open) => !open && closeDrawer()}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto p-0 sm:max-w-2xl"
        >
          <SheetTitle className="sr-only">
            {initialDetail
              ? `Nanny contact: ${initialDetail.user_profile?.first_name ?? ""} ${initialDetail.user_profile?.last_name ?? ""}`.trim() ||
                "Nanny contact"
              : "Nanny contact"}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Full contact details, log, and notes for this nanny.
          </SheetDescription>
          {initialDetail && (
            <LeadDrawer detail={initialDetail} timeline={initialTimeline} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
