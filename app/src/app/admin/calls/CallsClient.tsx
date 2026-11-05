"use client";

/**
 * /admin/calls client (plan C3, C4; BB-wave1-041126/04c1-build). The Calls tab, and the row drawer as the
 * `/admin/leads` drawer (`AdminLeadsClient.tsx`): `Sheet side="right"`, `w-full overflow-y-auto p-0 sm:max-w-2xl`,
 * mirrored to `?openCall=<parentUserId>` so it is shareable and survives a refresh. A click opens it at once
 * (optimistic) with a skeleton while the server reads her; a click outside or Escape closes it at once too.
 *
 * Only Calls in 04c-1; the Calendar tab (`?tab=calendar`) is 04c-2's.
 */

import { type MouseEvent, useEffect, useRef, useState, useTransition } from "react";
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
    <div data-testid="call-panel-loading" role="status" className="space-y-3 p-4 pr-12">
      <span className="sr-only">{ADMIN_COPY.loading}</span>
      <Skeleton aria-hidden="true" className="h-6 w-1/2 motion-reduce:animate-none" />
      <Skeleton aria-hidden="true" className="h-24 w-full motion-reduce:animate-none" />
      <Skeleton aria-hidden="true" className="h-40 w-full motion-reduce:animate-none" />
    </div>
  );
}

/** Her name's buttons under `root` now (a table row and a phone card), the visible one first. */
function familyButtons(parentUserId: string, root: ParentNode = document): HTMLElement[] {
  const all = [...root.querySelectorAll<HTMLElement>("[data-family-id]")].filter((el) => el.dataset.familyId === parentUserId);
  return [...all.filter((el) => el.getClientRects().length > 0), ...all.filter((el) => el.getClientRects().length === 0)];
}

interface Opener {
  readonly parentUserId: string;
  /** The heading of the section she was opened from: the fallback when her name has left the page. */
  readonly headingId: string | null;
}

/**
 * Where focus goes when the drawer closes (review round 2 M5): her name's button as the page now draws it — in the
 * section she was opened from first (she can be in History too), then anywhere, since after a write her row may have
 * moved section, and Safari and Firefox don't focus a clicked button at all — else that section's heading. A
 * deep-linked open has no opener and keeps Radix's default.
 */
function focusBack(opener: Opener | null): boolean {
  if (opener === null) return false;
  const heading = opener.headingId ? document.getElementById(opener.headingId) : null;
  const section = heading?.closest("section") ?? null;
  const target = (section ? familyButtons(opener.parentUserId, section)[0] : undefined) ?? familyButtons(opener.parentUserId)[0] ?? heading;
  target?.focus();
  return target !== null && target !== undefined;
}

/**
 * The drawer's open state: the URL is the source of truth, a click flips it at once (the leads drawer's way). `shown`
 * is the family on screen — still the last one while the drawer slides out, so it never flashes the skeleton.
 */
function useDrawer(openCallId: string | null) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [wanted, setWanted] = useState<string | null>(openCallId);
  const last = useRef<string | null>(openCallId);
  const opener = useRef<Opener | null>(null);
  const clicked = useRef<HTMLElement | null>(null);
  useEffect(() => setWanted(openCallId), [openCallId]);
  if (wanted !== null) last.current = wanted;
  const open = (parentUserId: string) => {
    const button = clicked.current?.dataset.familyId === parentUserId ? clicked.current : familyButtons(parentUserId)[0];
    const from = button?.closest("section")?.querySelector("h2") ?? null;
    opener.current = { parentUserId, headingId: from?.id || null };
    setWanted(parentUserId);
    startTransition(() => router.push(`${PAGE}?openCall=${encodeURIComponent(parentUserId)}`, { scroll: false }));
  };
  const close = () => {
    setWanted(null);
    startTransition(() => router.push(PAGE, { scroll: false }));
  };
  const restoreFocus = (event: Event) => {
    if (focusBack(opener.current)) event.preventDefault();
  };
  /** The family button a click (or Enter) came from, so `open` knows which of her rows it was. */
  const noteClick = (event: MouseEvent) => {
    clicked.current = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-family-id]") : null;
  };
  return { wanted, shown: wanted ?? last.current, open, close, restoreFocus, noteClick, refresh: () => router.refresh() };
}

export function CallsClient({ dashboard, openCallId, panel, panelFailed, renderCallControl = defaultCallControl }: CallsClientProps) {
  const drawer = useDrawer(openCallId);
  const ready = panel !== null && panel.parentUserId === drawer.shown;
  const failed = panelFailed && drawer.shown === openCallId;
  return (
    <div className="mt-6" onClickCapture={drawer.noteClick}>
      <CallsTab dashboard={dashboard} onOpen={drawer.open} renderCallControl={renderCallControl} />
      <Sheet open={drawer.wanted !== null} onOpenChange={(isOpen) => !isOpen && drawer.close()}>
        {/* [&>button]:z-20 — the Sheet's own close button stays above the drawer's sticky header. */}
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-2xl [&>button]:z-20" onCloseAutoFocus={drawer.restoreFocus}>
          <SheetTitle className="sr-only">{ready ? `${ADMIN_COPY.panelBooking}: ${panel.contact.name}` : ADMIN_COPY.panelBooking}</SheetTitle>
          <SheetDescription className="sr-only">{ADMIN_COPY.pageIntro}</SheetDescription>
          {ready ? (
            <CallRowPanel key={panel.parentUserId} panel={panel} renderCallControl={renderCallControl} onChanged={drawer.refresh} />
          ) : failed ? (
            <div className="p-4 pr-12">
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
