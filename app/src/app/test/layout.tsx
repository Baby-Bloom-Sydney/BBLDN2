import type { Metadata } from "next";

/**
 * The demo and test surfaces stay production-reachable and clickable — this is
 * not a removal (Q-10, BAI 2026-09-25; `04-sequence.md` §4 `removals`). What
 * they do not do is get indexed. The metadata lives on the layout rather than
 * the page because two of the six roots are `'use client'` pages, which cannot
 * export `metadata`, and because a layout covers the nested routes underneath
 * it in one place. Matching `disallow` lines are in `src/app/robots.ts`.
 *
 * 12.09 — BB-LDN-2h-250926.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function DemoRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
