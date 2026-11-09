/**
 * A Settings section's title (the page heading under the breadcrumb). One copy of its look, shared by the shell and
 * by a leaf that draws its own title row (`SettingsEditHeader`; 06b-3 rework, ledger B06 §9.1 R1).
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */

import { type ReactNode } from "react";

export function SettingsSectionTitle({ id, children }: { readonly id?: string; readonly children: ReactNode }) {
  return (
    <h2 id={id} className="text-lg font-semibold text-slate-900 lg:text-xl">
      {children}
    </h2>
  );
}
