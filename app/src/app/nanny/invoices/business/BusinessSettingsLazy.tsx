"use client";

/**
 * The Business section's client entry (b3.3): what the server leaf renders. It carries none of the section's code —
 * the dialogs and the shared schemas (zod) load by a dynamic import only when this renders (the switch on and
 * `?s=business`), so the Settings page's own bundle stays as it was (imported statically, `/nanny/settings` first
 * load went 165 → 201 kB with the switch off). Server-rendered as usual; the props pass straight through.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */

import dynamic from "next/dynamic";
import type { BankView, BusinessView } from "./business-view";

const BusinessSettingsForm = dynamic(() => import("./BusinessSettingsForm").then((m) => m.BusinessSettingsForm), {
  loading: () => (
    <p role="status" className="px-1 text-sm text-slate-500">
      Loading…
    </p>
  ),
});

export function BusinessSettingsLazy(props: { readonly business: BusinessView; readonly bank: BankView | null }) {
  return <BusinessSettingsForm {...props} />;
}
