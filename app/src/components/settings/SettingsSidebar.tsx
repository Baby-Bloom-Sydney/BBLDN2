"use client";

/**
 * Sidebar — top-level navigation only. When the user drills into a
 * sub-tree (e.g. Account → Verification → DBS), the corresponding
 * top-level item (Account) stays highlighted so the user always
 * knows which top-level surface they're inside.
 *
 * Reference: macOS System Settings — top-level categories live in
 * the sidebar; sub-items appear in the right-hand detail panel.
 */

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { type SettingsNode } from "./tree";

interface SettingsSidebarProps {
  basePath: string;
  /** Top-level tree. Hidden nodes are excluded by the renderer. */
  tree: SettingsNode[];
  /** ID of whichever top-level node currently contains the active
   *  section. Empty string when on the menu landing. */
  activeRootId: string;
  /** Optional group header above the tree (e.g. "PERSONAL"). */
  groupLabel?: string;
}

const STATUS_TONES = {
  neutral: "bg-slate-100 text-slate-600",
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-rose-50 text-rose-700",
} as const;

export function SettingsSidebar({
  basePath,
  tree,
  activeRootId,
  groupLabel,
}: SettingsSidebarProps) {
  const items = tree.filter((n) => !n.hidden);
  return (
    <nav
      aria-label="Settings sections"
      className="hidden lg:sticky lg:top-24 lg:block lg:self-start"
    >
      {groupLabel && (
        <h4 className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {groupLabel}
        </h4>
      )}
      <ul className="space-y-0.5">
        {items.map((n) => {
          const isActive = n.id === activeRootId;
          const Icon = n.icon;
          return (
            <li key={n.id}>
              <Link
                href={`${basePath}?s=${n.id}`}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-violet-50 font-medium text-violet-700"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                )}
              >
                {Icon && (
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0",
                      isActive ? "text-violet-600" : "text-slate-400",
                    )}
                  />
                )}
                <span className="flex-1 truncate">{n.label}</span>
                {n.status && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[9px] font-medium",
                      STATUS_TONES[n.status.tone],
                    )}
                  >
                    {n.status.label}
                  </span>
                )}
                {isActive && (
                  <ChevronRight
                    className="h-3.5 w-3.5 text-violet-400"
                    aria-hidden="true"
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
