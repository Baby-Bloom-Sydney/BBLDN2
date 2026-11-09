/**
 * The Settings Business section, server half (plan 06 §14.6 b3.3–b3.4; ledger B06 §9.1 R2, R3): the one piece of the
 * invoice feature the Settings page renders, passed into the client Settings shell as a prop slot (`NannySettingsClient`'s
 * `businessSection`; plan X4). A server component — no `"use client"`.
 *
 * - **Switch off:** renders nothing and reads nothing (not even the session).
 * - **Switch on:** her proof from the request's session, then her effective issuer (`readIssuer`, with its version)
 *   and her bank details in full — her own Settings page is the one screen that shows them (BAI 2026-11-09, brief
 *   §0b 1; `readBankDetailsForSettings`) — read in parallel. Her address and its version come from the Settings page's
 *   own profile read (one record: her profile). The props are what the browser receives (the RSC payload): her
 *   business details, her bank details, her address and the three versions — never an id, a proof or a family field
 *   (the leaf's test pins them).
 * - A failed read, or no nanny session: one plain message under the page title, never an empty or half section.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07; BB-wave1-041126/06b3-rework, 2026-11-09.
 */

import { SettingsSectionTitle } from "@/components/settings/SettingsSectionTitle";
import { SettingsSubsection } from "@/components/settings/SettingsSubsection";
import { nannyInvoicesEnabled } from "@/lib/features/flags";
import { proveNanny } from "@/lib/invoices/nanny-proof";
import { readBankDetailsForSettings } from "@/lib/invoices/store";
import { readIssuer } from "@/lib/invoices/store-business";
import type { HomeAddress } from "@/lib/settings/nanny-profile-rules";
import { BusinessSettingsLazy } from "./BusinessSettingsLazy";
import { toBankView, toBusinessView } from "./business-view";

export const LOAD_FAILED = "We couldn't load your business details. Please refresh the page.";

export interface BusinessSettingsLeafProps {
  /** Her address as the Settings page read it from her profile (null = none of it on file). */
  readonly home: HomeAddress | null;
  /** That profile row's version. */
  readonly homeUpdatedAt: string | null;
}

function LoadFailed() {
  return (
    <div className="space-y-5">
      <div className="px-1">
        <SettingsSectionTitle>Business</SettingsSectionTitle>
      </div>
      <SettingsSubsection>
        <p className="px-4 py-5 text-sm text-slate-600">{LOAD_FAILED}</p>
      </SettingsSubsection>
    </div>
  );
}

export async function BusinessSettingsLeaf({ home, homeUpdatedAt }: BusinessSettingsLeafProps) {
  if (!nannyInvoicesEnabled()) return null;
  const proof = await proveNanny();
  if (!proof) return <LoadFailed />;
  const [issuer, bank] = await Promise.all([readIssuer(proof), readBankDetailsForSettings(proof)]);
  if (!issuer.ok || !bank.ok) return <LoadFailed />;
  const address = home === null ? null : { line1: home.line1, line2: home.line2, town: home.town, postcode: home.postcode };
  return (
    <BusinessSettingsLazy
      business={toBusinessView(issuer.value)}
      bank={toBankView(bank.value)}
      home={address}
      versions={{ business: issuer.value.businessUpdatedAt, bank: bank.value?.updatedAt ?? null, home: homeUpdatedAt }}
    />
  );
}
