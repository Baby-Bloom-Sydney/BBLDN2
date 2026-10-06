/**
 * Tree-driven settings navigation.
 *
 * Each node is either a "branch" (has `children`, drills down to a
 * sub-menu) or a "leaf" (renders its content). The shape supports
 * arbitrary nesting so the settings surface can grow indefinitely
 * without changing the navigation primitive.
 *
 * Reference: macOS System Settings, Apple ID, iOS Settings — every
 * row is either a drill-down (chevron right) or a value (with edit
 * affordance). The same component handles both via the tree.
 */

import { type ComponentType } from "react";

export interface SettingsNode {
  /** Unique within the whole tree. The URL search param `s` holds
   *  this id, e.g. `?s=dbs`. The walker below resolves an id back
   *  to its path so breadcrumbs / sidebar highlighting can be
   *  computed without storing a path-encoded id in the URL. */
  id: string;
  label: string;
  /** One-line caption shown beside the label in branch menus and
   *  beneath the title in the section header. */
  description?: string;
  /** Optional Lucide icon for branch menu rows. */
  icon?: ComponentType<{ className?: string }>;
  /** Optional inline status (used in branch menus and the sidebar)
   *  e.g. "Verified", "Action required", a count. */
  status?: {
    label: string;
    tone: "neutral" | "success" | "warning" | "danger";
  };
  /** Branch nodes carry children. Leaf nodes leave this undefined. */
  children?: SettingsNode[];
  /** Leaf-only: identifies which content component the parent
   *  client should render. When null/undefined, the renderer
   *  falls through to a "Coming soon" placeholder so we can wire
   *  scaffolding ahead of implementation. */
  contentKey?: string;
  /** Hidden nodes are addressable by URL but don't appear in
   *  branch menus or sidebars — used for "Close account" which is
   *  reachable only via the small link at the bottom of Account. */
  hidden?: boolean;
  /** Marks the node visually as destructive (rose tint). Used by
   *  the close-account leaf. */
  danger?: boolean;
}

/** Walk a tree to locate a node by id, returning the node + the
 *  full path of ancestors that lead to it. Returns null when the
 *  id is empty or not found. */
export function findNode(
  tree: SettingsNode[],
  id: string,
): { node: SettingsNode; path: SettingsNode[] } | null {
  if (!id) return null;
  for (const n of tree) {
    if (n.id === id) return { node: n, path: [n] };
    if (n.children) {
      const sub = findNode(n.children, id);
      if (sub) return { node: sub.node, path: [n, ...sub.path] };
    }
  }
  return null;
}

/** Filters a node's children to only those that should appear in
 *  visible menus (excludes `hidden` nodes). */
export function visibleChildren(node: SettingsNode): SettingsNode[] {
  return (node.children ?? []).filter((c) => !c.hidden);
}
