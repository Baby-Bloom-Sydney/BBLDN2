"use client";

/**
 * /admin/calls client (plan C3, C4; BB-wave1-041126/04c1-build). The Calls tab, and the row drawer as the
 * `/admin/leads` drawer (`AdminLeadsClient.tsx`): `Sheet side="right"`, `w-full overflow-y-auto p-0 sm:max-w-2xl`,
 * mirrored to `?openCall=<parentUserId>` so it is shareable and survives a refresh. A click opens it at once
 * (optimistic) with a skeleton while the server reads her; a click outside or Escape closes it at once too.
 *
 * 04c-2 (BB-wave1-041126/04c2-build): two tabs, Calls · Calendar (the `/admin/users` `Tabs`). The open tab follows the
 * URL — `?tab=calendar` is the Calendar, anything else Calls, including after Back/Forward or the drawer's push (review
 * round 1, React M1); choosing a tab writes it with `history.replaceState` (Next 14.2 keeps `useSearchParams` in step),
 * so a refresh keeps it and the switch costs no server read. The Calendar panel stays mounted while hidden, so a
 * half-typed block or week of hours survives a look at the Calls tab (React M2). Each tab says when its own read
 * failed, so a failed calls read never hides the Calendar (and the reverse).
 */

import { type MouseEvent, useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CalendarView } from "@/lib/calls/calendar";
import { ADMIN_COPY } from "@/lib/calls/copy";
import type { CallsDashboard } from "@/lib/calls/dashboard";
import type { FamilyPanel } from "@/lib/calls/family-panel";
import { AlertLine } from "../cohorts/parts";
import { defaultCallControl, type RenderCallControl } from "./CallRowParts";
import { CallRowPanel } from "./CallRowPanel";
import { CalendarTab } from "./CalendarTab";
import { CallsTab } from "./CallsTab";

const PAGE = "/admin/calls";

export type CallsPageTab = "calls" | "calendar";

export interface CallsClientProps {
  /** Null: the Calls tab's read failed (its tab says so). */
  readonly dashboard: CallsDashboard | null;
  /** The Calendar tab's read; null when it failed (its tab says so). */
  readonly calendar?: CalendarView | null;
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

/** The open tab: the URL's `?tab=` (whenever it changes), or a choice, mirrored to the URL without a reload. */
function usePageTab() {
  const fromUrl: CallsPageTab = useSearchParams()?.get("tab") === "calendar" ? "calendar" : "calls";
  const [tab, setTab] = useState<CallsPageTab>(fromUrl);
  useEffect(() => setTab(fromUrl), [fromUrl]);
  const choose = (value: string) => {
    const next: CallsPageTab = value === "calendar" ? "calendar" : "calls";
    setTab(next);
    window.history.replaceState(null, "", next === "calendar" ? `${PAGE}?tab=calendar` : PAGE);
  };
  return { tab, choose };
}

interface PageTabsProps {
  readonly tab: ReturnType<typeof usePageTab>;
  readonly dashboard: CallsDashboard | null;
  readonly calendar: CalendarView | null;
  readonly onOpen: (parentUserId: string) => void;
  readonly renderCallControl: RenderCallControl;
}

function PageTabs({ tab, dashboard, calendar, onOpen, renderCallControl }: PageTabsProps) {
  return (
    <Tabs value={tab.tab} onValueChange={tab.choose} className="space-y-6">
      <TabsList aria-label={ADMIN_COPY.tabsLabel}>
        <TabsTrigger value="calls">{ADMIN_COPY.callsTab}</TabsTrigger>
        <TabsTrigger value="calendar">{ADMIN_COPY.calendarTab}</TabsTrigger>
      </TabsList>
      <TabsContent value="calls">
        {dashboard ? <CallsTab dashboard={dashboard} onOpen={onOpen} renderCallControl={renderCallControl} /> : <AlertLine>{ADMIN_COPY.loadFailed}</AlertLine>}
      </TabsContent>
      <TabsContent value="calendar" forceMount hidden={tab.tab !== "calendar"}>
        <CalendarTab calendar={calendar} />
      </TabsContent>
    </Tabs>
  );
}

export function CallsClient({ dashboard, calendar = null, openCallId, panel, panelFailed, renderCallControl = defaultCallControl }: CallsClientProps) {
  const drawer = useDrawer(openCallId);
  const pageTab = usePageTab();
  const ready = panel !== null && panel.parentUserId === drawer.shown;
  const failed = panelFailed && drawer.shown === openCallId;
  return (
    <div className="mt-6" onClickCapture={drawer.noteClick}>
      <PageTabs tab={pageTab} dashboard={dashboard} calendar={calendar} onOpen={drawer.open} renderCallControl={renderCallControl} />
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
