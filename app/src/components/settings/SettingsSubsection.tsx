"use client";

/**
 * Subsection wrapper. Mirrors the iOS / macOS Settings pattern of
 * grouping related rows under a small-caps header with a single
 * rounded card containing the row stack. Multiple subsections
 * stack vertically with a labelled divider above each.
 */

import { type ReactNode } from "react";

interface SettingsSubsectionProps {
  /** Optional header — small-caps muted slate. Omit when a
   *  section has only one logical group of rows. */
  header?: string;
  /** Optional small footnote rendered BELOW the row group. Used
   *  for legal copy or links to learn more. */
  footnote?: ReactNode;
  children: ReactNode;
}

export function SettingsSubsection({
  header,
  footnote,
  children,
}: SettingsSubsectionProps) {
  return (
    <div className="space-y-2">
      {header && (
        <div className="px-1">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {header}
          </h3>
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {children}
      </div>
      {footnote && (
        <p className="px-1 text-[11px] text-slate-500">{footnote}</p>
      )}
    </div>
  );
}
