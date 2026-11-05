"use client";

/**
 * /admin/calls client (plan C3, C4; BB-wave1-041126/04c1-build). The Calls tab, and the row drawer as the
 * `/admin/leads` drawer (`AdminLeadsClient.tsx`): `Sheet side="right"`, `w-full overflow-y-auto p-0 sm:max-w-2xl`,
 * mirrored to `?openCall=<parentUserId>` so it is shareable and survives a refresh. A click opens it at once
 * (optimistic) with a skeleton while the server reads her; a click outside or Escape closes it at once too.
 *
 * Only Calls in 04c-1; the Calendar tab (`?tab=calendar`) is 04c-2's.
 */

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ADMIN_COPY } from "@/lib/calls/copy";
import type { CallsDashboard } from "@/lib/calls/dashboard";
import type { FamilyPanel } from "@/lib/calls/family-panel";
import { AlertLine } from "../cohorts/parts";
import { defaultCallControl, type RenderCallControl } from "./CallRowParts";
import { CallRowPanel } from "./CallRowPanel";
import { CallsTab } from "./CallsTab";

const PAGE = "/admin/calls";

export interface CallsClientProps {
  readonly dashboard: CallsDashboard;
  /** `?openCall=` as the server read it (a user id), or null. */
  readonly openCallId: string | null;
  /** Her drawer, read by the server for `openCallId`; null while none, or when it failed (`panelFailed`). */
  readonly panel: FamilyPanel | null;
  readonly panelFailed: boolean;
  readonly renderCallControl?: RenderCallControl;
}

function PanelLoading() {
  return (
    <div data-testid="call-panel-loading" className="space-y-3 p-4" aria-hidden="true">
      <Skeleton className="h-6 w-1/2 motion-reduce:animate-none" />
      <Skeleton className="h-24 w-full motion-reduce:animate-none" />
      <Skeleton className="h-40 w-full motion-reduce:animate-none" />
    </div>
  );
}

/** The drawer's open state: the URL is the source of truth, a click flips it at once (the leads drawer's way). */
function useDrawer(openCallId: string | null) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [wanted, setWanted] = useState<string | null>(openCallId);
  useEffect(() => setWanted(openCallId), [openCallId]);
  const open = (parentUserId: string) => {
    setWanted(parentUserId);
    startTransition(() => router.push(`${PAGE}?openCall=${encodeURIComponent(parentUserId)}`, { scroll: false }));
  };
  const close = () => {
    setWanted(null);
    startTransition(() => router.push(PAGE, { scroll: false }));
  };
  return { wanted, open, close, refresh: () => router.refresh() };
}

export function CallsClient({ dashboard, openCallId, panel, panelFailed, renderCallControl = defaultCallControl }: CallsClientProps) {
  const drawer = useDrawer(openCallId);
  const ready = panel !== null && panel.parentUserId === drawer.wanted;
  const failed = panelFailed && drawer.wanted === openCallId;
  return (
    <div className="mt-6">
      <CallsTab dashboard={dashboard} onOpen={drawer.open} renderCallControl={renderCallControl} />
      <Sheet open={drawer.wanted !== null} onOpenChange={(isOpen) => !isOpen && drawer.close()}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-2xl">
          <SheetTitle className="sr-only">{ready ? `${ADMIN_COPY.panelBooking}: ${panel.contact.name}` : ADMIN_COPY.panelBooking}</SheetTitle>
          <SheetDescription className="sr-only">{ADMIN_COPY.pageIntro}</SheetDescription>
          {ready ? (
            <CallRowPanel key={panel.parentUserId} panel={panel} renderCallControl={renderCallControl} onChanged={drawer.refresh} />
          ) : failed ? (
            <div className="p-4">
              <AlertLine>{ADMIN_COPY.familyFailed}</AlertLine>
            </div>
          ) : (
            <PanelLoading />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
