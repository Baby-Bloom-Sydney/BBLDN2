"use client";

import { useState, useRef, useLayoutEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { qualificationBadgeLabel } from "@/lib/matching/qualification-display";

/** Badge text for a qualification — the ladder short label (E-2); "No Qualifications" / off-ladder show nothing */
export function abbreviateQualification(qual: string): string {
  return qualificationBadgeLabel(qual);
}

export interface TraitBadge {
  icon: React.ElementType;
  label: string;
  variant: "violet" | "slate";
  className?: string;
}

interface ExpandableBadgesProps {
  badges: TraitBadge[];
  /** If inside an <a> tag, prevents navigation on expand/collapse click */
  preventLinkNavigation?: boolean;
}

export function ExpandableBadges({ badges, preventLinkNavigation }: ExpandableBadgesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(badges.length);
  const [measured, setMeasured] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // Temporarily show all to measure
    const children = Array.from(container.children) as HTMLElement[];
    if (children.length === 0) return;

    const firstTop = children[0].offsetTop;
    let fits = children.length;

    for (let i = 1; i < children.length; i++) {
      if (children[i].offsetTop > firstTop + 2) {
        // This child wrapped — we need to leave room for the "+ X more" badge
        // so we take one fewer from the first row
        fits = Math.max(i - 1, 1);
        break;
      }
    }

    setVisibleCount(fits);
    setMeasured(true);
  }, []);

  useLayoutEffect(() => {
    if (expanded) return;
    // Reset to show all so we can re-measure
    setVisibleCount(badges.length);
    setMeasured(false);
  }, [expanded, badges.length]);

  useLayoutEffect(() => {
    if (expanded || measured) return;
    measure();
  }, [expanded, measured, measure]);

  // Re-measure on resize
  useLayoutEffect(() => {
    if (expanded) return;
    const observer = new ResizeObserver(() => {
      setMeasured(false);
      setVisibleCount(badges.length);
    });
    if (containerRef.current?.parentElement) {
      observer.observe(containerRef.current.parentElement);
    }
    return () => observer.disconnect();
  }, [expanded, badges.length]);

  const overflowing = measured && visibleCount < badges.length;
  const displayBadges = expanded ? badges : badges.slice(0, measured ? visibleCount : badges.length);
  const hiddenCount = badges.length - visibleCount;

  const handleClick = (e: React.MouseEvent) => {
    if (preventLinkNavigation) e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "mt-3 flex gap-1 sm:gap-1.5",
        expanded ? "flex-wrap" : "flex-nowrap overflow-hidden"
      )}
      style={!expanded && measured ? { maxHeight: "1.75rem" } : undefined}
    >
      {displayBadges.map((b, i) => (
        <Badge
          key={i}
          variant="secondary"
          className={cn(
            "rounded-lg text-[9px] sm:text-[10px] md:text-xs font-medium tracking-tight whitespace-nowrap shrink-0 px-1.5 sm:px-2.5 py-0.5 sm:py-0.5 md:py-1",
            b.variant === "violet" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600",
            b.className
          )}
        >
          <b.icon className="mr-0.5 sm:mr-1 h-2.5 w-2.5 sm:h-3 sm:w-3 shrink-0" /> {b.label}
        </Badge>
      ))}
      {!expanded && overflowing && (
        <button
          onClick={(e) => { handleClick(e); setExpanded(true); }}
          className="shrink-0"
        >
          <Badge variant="secondary" className="rounded-lg text-[9px] sm:text-[10px] md:text-xs font-medium tracking-tight px-1.5 sm:px-2.5 py-0.5 sm:py-0.5 md:py-1 bg-slate-100 text-slate-600 cursor-pointer hover:bg-slate-200 transition-colors whitespace-nowrap">
            + {hiddenCount} more
          </Badge>
        </button>
      )}
      {expanded && overflowing && (
        <button
          onClick={(e) => { handleClick(e); setExpanded(false); }}
          className="shrink-0"
        >
          <Badge variant="secondary" className="rounded-lg text-[9px] sm:text-[10px] md:text-xs font-medium tracking-tight px-1.5 sm:px-2.5 py-0.5 sm:py-0.5 md:py-1 bg-slate-100 text-slate-600 cursor-pointer hover:bg-slate-200 transition-colors whitespace-nowrap">
            − less
          </Badge>
        </button>
      )}
    </div>
  );
}
