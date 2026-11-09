"use client";

/**
 * The Business section's client entry (b3.3): what the server leaf renders. It carries none of the section's code —
 * the page and the shared schemas (zod) load by a dynamic import only when this renders (the switch on and
 * `?s=business`), so the Settings page's own bundle stays as it was (imported statically, `/nanny/settings` first
 * load went 165 → 201 kB with the switch off). Server-rendered as usual; the props pass straight through. While the
 * code loads, the page keeps its title (the section draws its own title row; 06b-3 rework).
 *
 * BB-wave1-041126/06b3-build, 2026-11-07; BB-wave1-041126/06b3-rework, 2026-11-09.
 */

import dynamic from "next/dynamic";
import { SettingsSectionTitle } from "@/components/settings/SettingsSectionTitle";
import type { HomeAddress } from "@/lib/settings/nanny-profile-rules";
import type { BankView, BusinessView, Versions } from "./business-view";

const BusinessSettingsForm = dynamic(() => import("./BusinessSettingsForm").then((m) => m.BusinessSettingsForm), {
  loading: () => (
    <div className="space-y-5 px-1">
      <SettingsSectionTitle>Business</SettingsSectionTitle>
      <p role="status" className="text-sm text-slate-500">
        Loading…
      </p>
    </div>
  ),
});

export interface BusinessSettingsLazyProps {
  readonly business: BusinessView;
  readonly bank: BankView | null;
  readonly home: HomeAddress | null;
  readonly versions: Versions;
}

export function BusinessSettingsLazy(props: BusinessSettingsLazyProps) {
  return <BusinessSettingsForm {...props} />;
}
