"use client";

/**
 * Formal label/value row used throughout settings.
 *
 * Reference: macOS System Settings, Apple ID, GitHub Settings,
 * Stripe Dashboard, 1Password — all share this pattern. Data is
 * shown read-only with a chevron affordance to drill into an edit
 * surface. The formality comes from:
 *   - Compact horizontal density (label left, value right)
 *   - Read-by-default (no inputs sitting in edit mode)
 *   - Optional verification status badge inline with the value
 *   - Optional "last updated" / audit caption beneath the value
 *
 * `value` is intentionally rendered as a plain string — for
 * formatted values (dates, masked numbers) the caller formats
 * before passing in. `display` overrides the value rendering when
 * a richer node is needed (e.g. a "Not set" placeholder).
 */

import { ChevronRight, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { type ReactNode } from "react";

export interface SettingsRowProps {
  label: string;
  /** Formatted display value. `null`/empty renders the placeholder. */
  value?: string | null;
  /** Custom node to render in the value slot. Takes precedence
   *  over `value` when present. Useful for badges-as-value or a
   *  placeholder formatted differently. */
  display?: ReactNode;
  /** Click handler — when present, the row becomes a button with a
   *  chevron and edit affordance. When absent the row is read-only. */
  onClick?: () => void;
  /** Locked rows show a lock icon and don't render the chevron. */
  locked?: boolean;
  /** "Last verified", "Last updated", or any audit-style caption
   *  rendered beneath the value in muted slate. */
  caption?: string;
  /** Right-aligned status pill (e.g. "Verified", "Pending"). */
  badge?: { label: string; tone: "neutral" | "success" | "warning" | "danger" };
  /** When true, the value is rendered with monospace + extra
   *  spacing — appropriate for ID numbers like DBS certificate numbers. */
  mono?: boolean;
  /** Hide the bottom border (use on the last row of a subsection). */
  isLast?: boolean;
}

const PLACEHOLDER = "Not set";

const BADGE_TONES = {
  neutral: "bg-slate-100 text-slate-600",
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-rose-50 text-rose-700",
} as const;

export function SettingsRow({
  label,
  value,
  display,
  onClick,
  locked,
  caption,
  badge,
  mono,
  isLast,
}: SettingsRowProps) {
  const isInteractive = !!onClick && !locked;
  const Wrapper = isInteractive ? "button" : "div";

  const valueNode =
    display ??
    (value && value.length > 0 ? (
      <span
        className={cn(
          "text-sm text-slate-900",
          mono && "font-mono tracking-tight",
        )}
      >
        {value}
      </span>
    ) : (
      <span className="text-sm italic text-slate-400">{PLACEHOLDER}</span>
    ));

  return (
    <Wrapper
      type={isInteractive ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-4 px-4 py-3 text-left transition-colors",
        !isLast && "border-b border-slate-100",
        isInteractive && "hover:bg-slate-50/70 active:bg-slate-100/70",
        isInteractive &&
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1",
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-slate-500">{label}</div>
        <div className="mt-0.5 truncate">{valueNode}</div>
        {caption && (
          <div className="mt-0.5 text-[11px] text-slate-400">{caption}</div>
        )}
      </div>

      {badge && (
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
            BADGE_TONES[badge.tone],
          )}
        >
          {badge.label}
        </span>
      )}

      {locked ? (
        <Lock
          className="h-3.5 w-3.5 shrink-0 text-slate-300"
          aria-hidden="true"
        />
      ) : isInteractive ? (
        <ChevronRight
          className="h-4 w-4 shrink-0 text-slate-300"
          aria-hidden="true"
        />
      ) : null}
    </Wrapper>
  );
}
