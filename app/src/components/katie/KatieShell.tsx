"use client";

/**
 * KatieShell — the two-deck wrapper.
 *
 * Desktop (≥1280px):
 *   [katie column ⅓ of main width][main content centered][empty right margin]
 *
 * Below 1280px:
 *   single viewport — carousel between the two decks, swipe or tap to swap.
 *   `currentDeck` state driven by KatieContext (toggled by header/nav icons).
 *
 * Hidden entirely when the user is not authenticated or NEXT_PUBLIC_KATIE_ENABLED
 * is not true. In those cases children render full-width as before.
 */

import { type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { KatieProvider, useKatie } from "@/contexts/KatieContext";
import { PreloadProvider } from "@/contexts/PreloadContext";
import { KatieDeck } from "./KatieDeck";
import {
  KatieTabs,
  KATIE_PANEL_ID,
  KATIE_TAB_ID,
  MAIN_PANEL_ID,
  MAIN_TAB_ID,
} from "./KatieTabs";
import { DashboardNav } from "@/components/layout/DashboardNav";
import { nannyInvoicesEnabled } from "@/lib/features/flags";
import { useKatieRealtime } from "./use-katie-realtime";
import {
  useIsDesktop,
  useMarkReadOnVisibility,
} from "./use-mark-read-on-visibility";

/** Routes where the dashboard header + tabs should NOT render — e.g.
 *  the verification onboarding flow and the parent typeform. The
 *  per-role dashboard wrappers used to gate this themselves; A-07
 *  hoisted the header into KatieShell so this list moved with it.
 *  Kept centralised so future "distraction-free" routes only need
 *  one place to be added. */
const DISTRACTION_FREE_PATHS = [
  "/nanny/onboarding-verification",
  // T-022 — onboarding contributions page is part of the same focused
  // signup flow; same hide-DashboardNav-and-Katie-tabs treatment.
  "/nanny/onboarding/add-child",
  "/parent/request",
];

function isDistractionFreePath(pathname: string): boolean {
  return DISTRACTION_FREE_PATHS.some((p) => pathname.startsWith(p));
}

/** Routes where the DashboardNav still renders but the Katie/Portal
 *  tabs are hidden. Settings is the canonical case (2026-05-07): a
 *  settings page is its own focused surface, the deck-swap UI would
 *  add visual noise + ambiguous routing. Kept separate from
 *  `DISTRACTION_FREE_PATHS` because we DO want the global header /
 *  avatar dropdown / sign-out on settings. */
const TABS_HIDDEN_PATHS = [
  "/nanny/settings",
  "/parent/settings",
  // Payments surfaces — Katie/Portal tabs are noise on these. Per
  // FRONTEND/03-build-spec.md § "Navigation chrome rules" + UX-FIX-PLAN
  // FIX-3 / FIX-4 (2026-05-12 audit).
  "/parent/subscribe",
  "/parent/subscription",
  "/subscribe-for",
  "/nanny/payouts",
];

function isTabsHiddenPath(pathname: string): boolean {
  return (
    TABS_HIDDEN_PATHS.some((p) => pathname.startsWith(p)) ||
    // Brief 06 (plan R11): the nanny's invoice pages, read at call time; while off the list is today's.
    (nannyInvoicesEnabled() && pathname.startsWith("/nanny/invoices"))
  );
}

// Breakpoint tailored to LAYOUT.md spec. Swapping carousel kicks in below.
const CAROUSEL_BP = "1280px";

interface KatieShellProps {
  children: ReactNode;
  /** Optional footer rendered at the bottom of `<main>`. Used by the
   *  root layout to render `<MiniFooter />` so it sticks to the
   *  bottom of the viewport when content is shorter than the
   *  viewport, and sits at the end of the content (after scroll)
   *  when content overflows. The classic "sticky footer" CSS pattern,
   *  achieved via `flex-col` on `<main>` + `flex-1` on the content
   *  wrapper. */
  footer?: ReactNode;
}

/** Derive the dashboard role straight from the URL path, so the
 *  chrome (header + tabs) renders deterministically without waiting
 *  for client-side auth state to populate. The previous gate
 *  depended on `useAuth().user && useAuth().role`, which left a
 *  loading-window where the dashboard chrome was hidden — and on
 *  Vercel that window could persist indefinitely if the Supabase
 *  client failed silently. */
function pathRole(pathname: string): "nanny" | "parent" | null {
  if (pathname.startsWith("/nanny")) return "nanny";
  if (pathname.startsWith("/parent")) return "parent";
  return null;
}

export function KatieShell({ children, footer }: KatieShellProps) {
  const pathname = usePathname();
  const navRole = pathRole(pathname);

  // Non-dashboard routes (public pages, /admin, /auth, /api) get
  // a plain layout — no Katie deck, no DashboardNav, no tabs. Those
  // routes have their own chrome.
  if (!navRole) {
    return (
      <div className="flex min-h-dvh flex-col">
        <div className="flex flex-1 flex-col">{children}</div>
        {footer}
      </div>
    );
  }

  // PreloadProvider wraps KatieProvider so KatieDeck (rendered inside
  // the shell) and any future page publisher can both reach
  // `usePreloadOptional()`. Latency:Efficiency build, WU7 (F2 client).
  return (
    <PreloadProvider>
      <KatieProvider>
        <ShellInner footer={footer} navRole={navRole}>
          {children}
        </ShellInner>
      </KatieProvider>
    </PreloadProvider>
  );
}

// ── Inner component that consumes the context ───────────────────────────

function ShellInner({
  children,
  footer,
  navRole,
}: {
  children: ReactNode;
  footer?: ReactNode;
  navRole: "nanny" | "parent";
}) {
  const { visibleDeck, unreadCount, setUnreadCount } = useKatie();
  const pathname = usePathname();

  // Realtime unread count + polling fallback
  useKatieRealtime();

  // Mark-read on carousel swap (immediate) + desktop 2s-in-viewport (delayed).
  const isDesktop = useIsDesktop();
  useMarkReadOnVisibility({
    visibleDeck,
    unreadCount,
    setUnreadCount,
    isDesktop,
  });

  // Header / tabs render only on full-chrome routes. Distraction-free
  // paths (verification onboarding, parent typeform) opt out so the
  // user's focus stays on the task. Settings pages opt out of tabs
  // ONLY — the global header still shows so the user has access to
  // the avatar dropdown / sign-out.
  const showChrome = !isDistractionFreePath(pathname);
  const showTabs = showChrome && !isTabsHiddenPath(pathname);

  // Tailwind's JIT picks up arbitrary values in template strings at build time.
  // We need a fixed CSS custom property for the carousel width switch.
  //
  // Mobile-viewport notes (real-soak fix 2026-05-06):
  //   • `min-h-dvh` / `h-dvh` (instead of `min-h-screen` / `h-screen`) makes
  //     the layout track the dynamic viewport. On iOS Safari, `100vh`
  //     measures with the URL bar hidden, so the bottom of an `h-screen`
  //     element extends past the visible area when the bar is showing —
  //     the user sees the input cut off + can scroll past into blank
  //     space. `dvh` updates with the visible viewport, fixing both.
  //   • `min-w-0` on the flex children is non-negotiable: a flex item's
  //     default `min-width: auto` is its intrinsic content width, so any
  //     deeply-nested wide content (long URL, table, code block) makes
  //     the item bulge past the viewport. The body's `overflow-x-hidden`
  //     then clips that overflow visually instead of wrapping it.
  //     Adding `min-w-0` lets the flex child shrink below its content
  //     width so overflow handling on the inner content (word-break,
  //     scroll bar, etc.) actually applies.
  //   • `overscroll-contain` on the aside prevents iOS rubber-band into
  //     blank space. Deliberately NOT using `overflow-hidden` — that
  //     would silently break any future `position: sticky` descendant.
  //     The `h-dvh` + `min-h-dvh` pair already prevents document-level
  //     scroll-past; overflow-hidden was belt-and-braces we don't need.
  // A-07 height contract:
  //   • Outer container: `h-dvh` on narrow viewports — drives the
  //     overall height budget so the inner row can deduct the tab
  //     strip's height naturally via flex-col distribution. Desktop
  //     (xl+) keeps `min-h-dvh` so the page can grow when content
  //     does (no carousel + no tab strip on desktop).
  //   • Inner row: `flex-1 min-h-0` so it consumes the leftover budget
  //     after the tabs and shrinks correctly when content overflows.
  //   • Aside: `h-full` on narrow (drives off the inner row height),
  //     `xl:h-dvh` on desktop (sticky to viewport since there's no
  //     tab strip eating into the budget).
  // Without this contract, `h-dvh` on the aside extended past the
  // shorter parent row (the row was viewport-minus-tabs-tall) by the
  // tab-strip height, clipping the input + footer below the fold on
  // iOS Safari (code-reviewer MED 2026-05-06).
  return (
    // `overflow-hidden` on the carousel breakpoint clips the outer
    // wrapper to its `h-dvh`. With body scroll suppressed, the only
    // scrollable surfaces are the explicit `overflow-y-auto`
    // descendants — `<main>` for the BB-app deck and KatieDeck's
    // internal messages list for the chat deck. Two bugs were
    // caused by the prior body-scroll behaviour (2026-05-07):
    //   1. KatieTabs (sticky top-16 of the outer wrapper) slid
    //      past the viewport once body scroll moved the wrapper.
    //   2. The Katie input + footer could be scrolled past on
    //      mobile because the aside's `h-full` was sized against an
    //      outer that the body could move.
    // Clipping body scroll fixes both at the root: outer stays
    // anchored to the viewport, sticky tabs always pin, KatieInput
    // sits at viewport bottom because the deck container is now
    // reliably exactly viewport-minus-chrome tall.
    <div
      className="flex h-dvh w-full flex-col overflow-hidden xl:h-auto xl:min-h-dvh xl:overflow-visible"
      style={{ ["--katie-bp" as string]: CAROUSEL_BP }}
    >
      {/* A-07 fix: persistent header + tabs.
          - DashboardNav was previously rendered inside the per-role
            wrapper (NannyDashboard / ParentDashboard) which lived
            inside the swap-able main element. Swapping to Katie
            hid the entire main, taking the header with it. Hoisting
            into KatieShell makes the header constant across swaps —
            one global chrome regardless of deck.
          - Tabs sit directly under the header (no margin / gap)
            per spec §60. Hidden on desktop (xl+) where side-by-side
            renders both decks. */}
      {showChrome && <DashboardNav role={navRole} />}
      {showTabs && <KatieTabs role={navRole} />}

      <div className="flex w-full min-h-0 flex-1 xl:flex-row">
        {/* Katie column — visible side-by-side on wide; full-screen carousel panel on narrow.
            A-07: aside body adopts the lilac bg so the active Katie tab head
            merges seamlessly with the body below it (Chrome-tab visual). Applied on
            both mobile + desktop per Bailey's confirmation that desktop should match.
            ARIA: this aside IS the tabpanel for the Katie tab — `role="tabpanel"`
            + `aria-labelledby` linkage replaces the prior `aria-label="Katie"`. */}
        <aside
          id={KATIE_PANEL_ID}
          role="tabpanel"
          aria-labelledby={KATIE_TAB_ID}
          className={[
            "sticky top-0 flex h-full min-w-0 overscroll-contain border-r border-slate-200 bg-[hsl(var(--color-katie-bg-lilac))] xl:h-dvh",
            // Wide: ⅓ of the main width (approximated via max-w-xs) pinned left
            "xl:w-[336px] xl:flex-shrink-0",
            // Narrow: full-width carousel panel, shown/hidden via class
            "w-full xl:sticky",
            visibleDeck === "katie" ? "xl:relative" : "hidden xl:flex",
          ].join(" ")}
        >
          {/* `h-full min-h-0` so KatieDeck's `h-full` resolves to
              the aside's actual height even when the message list
              tries to push past it. Without `min-h-0` flex children
              default to `min-height: auto` (intrinsic content size),
              which would let a long conversation grow the wrapper
              past the aside and the bottom-pinned input would slide
              below the fold. */}
          <div className="h-full min-h-0 w-full min-w-0">
            <KatieDeck />
          </div>
        </aside>

        {/* Main deck — hidden when carousel is showing Katie; always visible on wide.
            We wrap children in a tabpanel div rather than putting the role on
            the <main> element itself so the existing main-landmark semantics
            stay intact (a11y-architect HIGH on tabpanel linkage).

            `overflow-y-auto` on the carousel breakpoint moves the
            scroll context INSIDE main rather than letting BB-app
            content overflow into body scroll. Two bugs were caused
            by the prior body-scrolls-too behaviour (2026-05-07):
              1. The KatieTabs strip is `sticky top-16` to the OUTER
                 (h-dvh) wrapper. When body scrolled, the wrapper
                 scrolled with it and the tabs slid past the
                 viewport. Pinning scroll inside main keeps the
                 wrapper anchored — tabs stay pinned forever.
              2. The Katie deck's pinned-bottom input was scrollable-
                 past on mobile because its parent aside lived inside
                 a body-scrolling page. With the outer anchored, the
                 aside's own internal flex layout pins the input to
                 the bottom of the viewport as designed.
            Desktop (xl:) keeps `overflow-visible` so document scroll
            continues to drive the page on wider layouts. */}
        <main
          className={[
            // `flex flex-col` so the inner content wrapper can grow
            // via `flex-1` and the footer naturally sits at the
            // bottom of main's box. When content fits, footer pins
            // to viewport bottom. When content overflows, footer
            // appears at the end of the scroll. Standard sticky-
            // footer pattern (per user feedback 2026-05-07).
            "flex flex-col min-w-0 flex-1 overflow-y-auto xl:overflow-visible",
            visibleDeck === "main" ? "block" : "hidden xl:block",
          ].join(" ")}
        >
          <div
            id={MAIN_PANEL_ID}
            role="tabpanel"
            aria-labelledby={MAIN_TAB_ID}
            tabIndex={0}
            className="flex-1"
          >
            {children}
          </div>
          {footer}
        </main>
      </div>
    </div>
  );
}
