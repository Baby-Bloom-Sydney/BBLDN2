/**
 * `/nanny/invoices/new` (server) — a new invoice (plan 06 old step 14, §14.3, §14.6 b4.4; brief §0a A, C, §3 nanny
 * 3–7, §8; R20). A server component.
 *
 * - **Switch off:** `notFound()` before any auth or read. **Her nanny session only** (`proveNanny`): none is a 404.
 * - Reads, as hers: the families she can invoice, her VAT setting (for the live totals only), and what the parameters
 *   ask for — `?placement=` or `?connection=` (any of her ids for a family: that family pre-selected) or `?replaces=`
 *   (a correction: its family fixed, its lines).
 * - **The props are the RSC payload:** the families and the target as `target.ts` shapes them (no family id, no
 *   email, no kind), her VAT mode and rate, and London's today (the last date she can pick) — nothing of her bank
 *   details, her address or her name. The review step asks the server for those (`previewInvoice`), masked.
 * - A failed read: the page with one plain message.
 * - `maxDuration = 30`: Send renders the PDF, stores it and sends two emails from this page.
 *
 * BB-wave1-041126/06b4, 2026-11-12; BB-wave1-041126/06b4-ui, 2026-11-12 (rework: a family, no week or kind).
 */

import { notFound } from "next/navigation";
import { nannyInvoicesEnabled } from "@/lib/features/flags";
import { listInvoiceableFamilies } from "@/lib/invoices/families";
import { proveNanny } from "@/lib/invoices/nanny-proof";
import { readIssuer } from "@/lib/invoices/store-business";
import { londonToday } from "@/lib/timezone";
import { NewInvoiceClient } from "./NewInvoiceClient";
import { familyOptions, loadTarget, targetRequestOf } from "./target";

export const maxDuration = 30;

interface PageProps {
  readonly searchParams?: Readonly<Record<string, string | string[] | undefined>>;
}

const NO_VAT = { mode: "none", rateBp: null } as const;

export default async function NewInvoicePage({ searchParams }: PageProps) {
  if (!nannyInvoicesEnabled()) notFound();
  const proof = await proveNanny();
  if (!proof) notFound();
  const now = new Date();
  const today = londonToday(now);
  const failed = <NewInvoiceClient families={[]} target={null} vat={NO_VAT} today={today} loadFailed />;
  const [families, issuer] = await Promise.all([listInvoiceableFamilies(proof), readIssuer(proof)]);
  if (!families.ok || !issuer.ok) return failed;
  const target = await loadTarget(proof, targetRequestOf(searchParams), families.value, now);
  if (!target.ok) return failed;
  return (
    <NewInvoiceClient
      families={familyOptions(families.value)}
      target={target.value}
      vat={{ mode: issuer.value.vat.mode, rateBp: issuer.value.vat.rateBp }}
      today={today}
      loadFailed={false}
    />
  );
}
