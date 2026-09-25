"use client";

import { useState, useEffect, type ComponentType } from "react";
import { cn } from "@/lib/utils";
import { SparkleIcon } from "@/components/katie/messages/SparkleIcon";
import { TileActionMenu } from "./TileActionMenu";

interface TileHeaderProps {
  /** Tile leading-icon. Wide-typed as a `ComponentType<{ className }>`
   *  rather than `LucideIcon` so the same slot can host either a
   *  Lucide icon (most tile types) or a custom SVG component (e.g.
   *  Katie's chat `SparkleIcon` on `CustomTile`) — keeping the
   *  whole-app "tile icons match the surface they relate to" rule
   *  intact without a separate prop. */
  icon: ComponentType<{ className?: string }>;
  iconColor: string;
  badgeText: string;
  authorName: string;
  createdAt: string;
  /** Suppress the inline author label entirely. Used by Katie-authored
   *  tiles (e.g. `CustomTile`) where the leading SparkleIcon already
   *  conveys "this came from Katie" — adding the calling user's name
   *  next to it as text would be misleading. */
  hideAuthor?: boolean;
  /** `bapp_logs.id` of the tile being rendered. When present the
   *  3-dot overflow menu is shown in the top-right; when omitted
   *  the slot is empty. We thread this rather than auto-detecting
   *  from a wider FeedItem so the header stays simple to test in
   *  isolation. */
  logId?: string;
}

/** Authored by Katie? Detected by the `author_name` her bot writes
 *  into bapp_logs (currently the literal string "Katie" — see
 *  `getFeed` author resolution + `chat/tiles.test.ts`). When true,
 *  the tile header shows the universal Katie sparkle instead of
 *  the textual name. */
const KATIE_AUTHOR_NAME = "Katie";

function relativeDate(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

/** Format a stable date string for SSR (no relative time) */
function stableDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

export function TileHeader({
  icon: Icon,
  iconColor,
  badgeText,
  authorName,
  createdAt,
  hideAuthor = false,
  logId,
}: TileHeaderProps) {
  // Use stable date on server, switch to relative on client to avoid hydration mismatch
  const [dateText, setDateText] = useState(() => stableDate(createdAt));

  useEffect(() => {
    setDateText(relativeDate(createdAt));
  }, [createdAt]);

  const isKatie = authorName === KATIE_AUTHOR_NAME;

  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-full",
          iconColor,
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      {/* Layout (per user feedback 2026-05-07):
            [icon] [badge] [author small]    [date]
          - Author moved out of the right-hand pill into the inline
            row next to the badge. Pill removed; smaller, faded text.
          - Date moved from inline-next-to-badge to the right slot
            (where the author pill used to live). No pill.
          - When author is Katie, the universal sparkle from her
            chat replaces the textual name — Katie is recognised by
            her icon, not labelled by name. */}
      <div className="flex flex-1 items-center gap-1.5 min-w-0">
        <span className="truncate text-sm font-medium text-slate-900">
          {badgeText}
        </span>
        {!hideAuthor && isKatie && (
          <>
            <SparkleIcon className="h-3 w-3 shrink-0 text-violet-500" />
            <span className="sr-only">{KATIE_AUTHOR_NAME}</span>
          </>
        )}
        {!hideAuthor && !isKatie && (
          <span className="truncate text-[11px] text-slate-400">
            {authorName}
          </span>
        )}
      </div>
      <span className="text-xs text-slate-400">{dateText}</span>
      {logId && <TileActionMenu logId={logId} />}
    </div>
  );
}
