/**
 * The Settings Business section, server half (plan 06 §14.6 b3.3–b3.4): the one piece of the invoice feature the
 * Settings page renders, passed into the client Settings shell as a prop slot (`NannySettingsClient`'s
 * `businessSection`; plan X4). A server component — no `"use client"`.
 *
 * - **Switch off:** renders nothing and reads nothing (not even the session).
 * - **Switch on:** her proof from the request's session, then her effective issuer (`readIssuer`, defaults included)
 *   and her **masked** bank details, read in parallel, mapped by `business-view.ts` into the client section's two
 *   props, through the lazy client entry (`BusinessSettingsLazy`). The props are what the browser receives (the RSC payload): never a full bank number, an id, a proof or a
 *   family field (06b-2 handoff; the leaf's test pins them).
 * - A failed read, or no nanny session: one plain message, never an empty or half section.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */

import { SettingsSubsection } from "@/components/settings/SettingsSubsection";
import { nannyInvoicesEnabled } from "@/lib/features/flags";
import { proveNanny } from "@/lib/invoices/nanny-proof";
import { readMaskedDetails } from "@/lib/invoices/store";
import { readIssuer } from "@/lib/invoices/store-business";
import { BusinessSettingsLazy } from "./BusinessSettingsLazy";
import { toBankView, toBusinessView } from "./business-view";

export const LOAD_FAILED = "We couldn't load your business details. Please refresh the page.";

function LoadFailed() {
  return (
    <SettingsSubsection>
      <p role="alert" className="px-4 py-5 text-sm text-slate-600">
        {LOAD_FAILED}
      </p>
    </SettingsSubsection>
  );
}

export async function BusinessSettingsLeaf() {
  if (!nannyInvoicesEnabled()) return null;
  const proof = await proveNanny();
  if (!proof) return <LoadFailed />;
  const [issuer, masked] = await Promise.all([readIssuer(proof), readMaskedDetails(proof)]);
  if (!issuer.ok || !masked.ok) return <LoadFailed />;
  return <BusinessSettingsLazy business={toBusinessView(issuer.value)} bank={toBankView(masked.value)} />;
}
