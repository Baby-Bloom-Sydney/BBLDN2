"use client";

/**
 * Tree-driven settings shell.
 *
 * Behaviour by URL state:
 *
 *   1. `?s=` empty → Menu landing.
 *      - Mobile: list of top-level items.
 *      - Desktop: sidebar + identity card + "Select a setting".
 *
 *   2. `?s=<branch-id>` → Sub-menu drill-down.
 *      - Renders the branch's children as a list.
 *      - Optional `dangerLink` slot at the bottom (Account → Close
 *        account).
 *      - Sidebar highlights the top-level ancestor on desktop.
 *      - Mobile shows back-arrow → root.
 *
 *      - Opt-in `defaultLeafId` (06b-3 rework): desktop opens that
 *        leaf instead of "Select a setting"; mobile keeps its menu.
 *
 *   3. `?s=<leaf-id>` → Leaf content.
 *      - Renders breadcrumb (root → ancestors → this leaf) + the
 *        leaf's content (supplied by the parent client via
 *        `renderLeaf(node)`).
 *      - Sidebar highlights the top-level ancestor on desktop.
 *      - Mobile shows back-arrow → IMMEDIATE PARENT (one level up,
 *        not all the way to root) so deep paths feel like iOS
 *        Settings drill-down.
 *      - A node with `ownHeader` draws its own title row (an
 *        editable page's Edit button sits beside it); the shell
 *        draws only the breadcrumb.
 */

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { type ReactNode } from "react";
import { type SettingsNode, findNode, visibleChildren } from "./tree";
import { SettingsSidebar } from "./SettingsSidebar";
import { MobileMenu } from "./MobileMenu";
import { BranchMenu } from "./BranchMenu";
import { SettingsBreadcrumb } from "./SettingsBreadcrumb";
import { SettingsSectionTitle } from "./SettingsSectionTitle";

interface SettingsShellProps {
  /** Document title and the synthetic root crumb in breadcrumbs. */
  title: string;
  /** Subtitle for the menu landing. */
  description?: string;
  /** Identity card rendered on the menu landing only. */
  identityCard?: ReactNode;
  /** Base URL for the settings root (e.g. "/parent/settings"). */
  basePath: string;
  /** Top-level tree. Each node may have its own children. */
  tree: SettingsNode[];
  /** ID of the active node (URL search param `s`), empty when on
   *  the menu landing. */
  activeId: string;
  /** Render content for a given leaf node. Called only when
   *  `activeId` resolves to a leaf. */
  renderLeaf: (node: SettingsNode) => ReactNode;
  /** Optional bottom-of-branch danger link, keyed by branch id.
   *  Reserved for future deeper hierarchies. The Close-account
   *  affordance moved to `pageBottomLink` in 2026-05-07 so it
   *  always appears at the bottom of the entire settings page,
   *  not just inside Account's drill-down. */
  branchDangerLinks?: Record<string, { label: string; targetId: string }>;
  /** Optional small muted hyperlink rendered at the very bottom of
   *  the settings page, just above the global footer (MiniFooter
   *  in the root layout). Used by both clients to expose
   *  "Close account" without making it a tile. */
  pageBottomLink?: { label: string; targetId: string };
  /** Group label above the sidebar tree (e.g. "PERSONAL"). */
  sidebarGroupLabel?: string;
  /** Opt-in (06b-3 rework, ledger B06 §9.1 R6): on desktop with no
   *  `?s=`, open this leaf instead of the "Select a setting" panel.
   *  Mobile keeps its menu. */
  defaultLeafId?: string;
}

export function SettingsShell({
  title,
  description,
  identityCard,
  basePath,
  tree,
  activeId,
  renderLeaf,
  branchDangerLinks,
  pageBottomLink,
  sidebarGroupLabel,
  defaultLeafId,
}: SettingsShellProps) {
  const found = findNode(tree, activeId);
  const node = found?.node ?? null;
  const path = found?.path ?? [];
  const isRoot = !node;
  const isBranch = !!node?.children;
  // Desktop only: with no `?s=`, the opt-in default leaf (mobile keeps its menu)
  const landing = isRoot && defaultLeafId ? findNode(tree, defaultLeafId) : null;
  const activeRootId = (found ?? landing)?.path[0]?.id ?? "";

  // For mobile back-arrow on a leaf: navigate to the immediate
  // parent (path[path.length - 2]), not all the way to root.
  const parentNode = path.length > 1 ? path[path.length - 2] : null;
  const backHref = parentNode ? `${basePath}?s=${parentNode.id}` : basePath;
  const backLabel = parentNode ? parentNode.label : title;

  // Section header content for branch and leaf views — title +
  // breadcrumb only. Per user feedback (2026-05-07) sections do
  // not display a subheader/description; the title alone is the
  // section identity.
  const headerFor = (n: SettingsNode, p: SettingsNode[]) => (
    <header className="space-y-2 px-1">
      <SettingsBreadcrumb basePath={basePath} path={p} rootLabel={title} />
      {!n.ownHeader && (
        <div className="flex items-start justify-between gap-3">
          <SettingsSectionTitle>{n.label}</SettingsSectionTitle>
          {n.status && (
            <span
              className={
                statusToneClass(n.status.tone) +
                " inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0"
              }
            >
              {n.status.label}
            </span>
          )}
        </div>
      )}
    </header>
  );
  const sectionHeader = node && headerFor(node, path);

  return (
    // Self-contained min-height so the shell is at least
    // viewport-minus-chrome tall regardless of the parent layout.
    // The buffer (160px) approximates the global DashboardNav
    // (64px) + MiniFooter (~36px) + main padding + breathing
    // room. The mt-auto link at the end of this flex-col then
    // gets pushed to the actual viewport bottom on short pages,
    // and sits at the natural end of content on long pages.
    // We use `[100dvh]` (dynamic viewport) so iOS keyboard /
    // toolbar adjustments behave correctly.
    <div className="flex flex-col min-h-[calc(100dvh-160px)]">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-6 lg:py-10">
        {/* ── Mobile back-arrow on non-root views ─────────────── */}
        {!isRoot && (
          <div className="mb-4 lg:hidden">
            <Link
              href={backHref}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700"
            >
              <ArrowLeft className="h-4 w-4" />
              {backLabel}
            </Link>
          </div>
        )}

        {/* ── Mobile root header ──────────────────────────────── */}
        {isRoot && (
          <header className="mb-6 lg:hidden">
            <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
            {identityCard && <div className="mt-5">{identityCard}</div>}
          </header>
        )}

        {/* ── Mobile root menu ────────────────────────────────── */}
        {isRoot && <MobileMenu basePath={basePath} tree={tree} />}

        {/* ── Mobile non-root content ─────────────────────────── */}
        {!isRoot && (
          <div className="lg:hidden">
            <SectionView
              node={node}
              path={path}
              basePath={basePath}
              renderLeaf={renderLeaf}
              branchDangerLinks={branchDangerLinks}
              isBranch={isBranch}
              sectionHeader={sectionHeader}
            />
          </div>
        )}

        {/* ── Desktop sidebar + content ───────────────────────── */}
        <div className="hidden lg:grid lg:grid-cols-[260px_1fr] lg:gap-10">
          <div>
            <header className="mb-6 px-3">
              <h1 className="text-xl font-bold text-slate-900">{title}</h1>
            </header>
            <SettingsSidebar
              basePath={basePath}
              tree={tree}
              activeRootId={activeRootId}
              groupLabel={sidebarGroupLabel}
            />
          </div>
          <div className="min-w-0">
            {landing ? (
              <SectionView
                node={landing.node}
                path={landing.path}
                basePath={basePath}
                renderLeaf={renderLeaf}
                branchDangerLinks={branchDangerLinks}
                isBranch={!!landing.node.children}
                sectionHeader={headerFor(landing.node, landing.path)}
              />
            ) : isRoot ? (
              <div className="space-y-6">
                {identityCard}
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-12 text-center">
                  <p className="text-sm font-medium text-slate-600">
                    Select a setting from the sidebar.
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Your selection opens here.
                  </p>
                </div>
              </div>
            ) : (
              <SectionView
                node={node}
                path={path}
                basePath={basePath}
                renderLeaf={renderLeaf}
                branchDangerLinks={branchDangerLinks}
                isBranch={isBranch}
                sectionHeader={sectionHeader}
              />
            )}
          </div>
        </div>
      </div>

      {/* Page-bottom muted link — `mt-auto` absorbs all available
          space above it in the flex-col so the link is forced to
          the bottom of the settings shell, just above the global
          MiniFooter. */}
      {pageBottomLink && (
        <div className="mt-auto pb-3 pt-10 text-center">
          <Link
            href={`${basePath}?s=${pageBottomLink.targetId}`}
            className="text-[11px] text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
          >
            {pageBottomLink.label}
          </Link>
        </div>
      )}
    </div>
  );
}

interface SectionViewProps {
  node: SettingsNode;
  path: SettingsNode[];
  basePath: string;
  renderLeaf: (node: SettingsNode) => ReactNode;
  branchDangerLinks?: Record<string, { label: string; targetId: string }>;
  isBranch: boolean;
  sectionHeader: ReactNode;
}

function SectionView({
  node,
  basePath,
  renderLeaf,
  branchDangerLinks,
  isBranch,
  sectionHeader,
}: SectionViewProps) {
  return (
    <div className="space-y-5">
      {sectionHeader}

      {isBranch ? (
        // BRANCH — render its children as a drill-down list.
        // Skip rendering when a branch has no visible children
        // (still show the breadcrumb + an empty-state card).
        visibleChildren(node).length > 0 ? (
          <BranchMenu
            branch={node}
            basePath={basePath}
            dangerLink={branchDangerLinks?.[node.id]}
          />
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center">
            <p className="text-sm text-slate-500">
              Nothing in this section yet.
            </p>
          </div>
        )
      ) : (
        // LEAF — render content from the parent client.
        <div>{renderLeaf(node)}</div>
      )}
    </div>
  );
}

function statusToneClass(tone: "neutral" | "success" | "warning" | "danger") {
  return {
    neutral: "bg-slate-100 text-slate-700",
    success: "bg-emerald-50 text-emerald-700",
    warning: "bg-amber-50 text-amber-700",
    danger: "bg-rose-50 text-rose-700",
  }[tone];
}
