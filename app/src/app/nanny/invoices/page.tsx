/**
 * `/nanny/invoices` (server) — her invoices (plan 06 old step 14, §14.6 b4.4; brief §0.6–0.9, §3 nanny 1, 7–11, §8;
 * R20). A server component.
 *
 * - **Switch off:** `notFound()` before any auth or read.
 * - **Her nanny session only** (`proveNanny`): none — a parent, an admin, nobody — is a 404 (R20: the invoices are the
 *   nanny's side of the app only). Signed out, the middleware sends her to sign in first.
 * - Reads, in parallel and as hers: her invoices, her bank details **masked** (`readMaskedDetails`: the account name
 *   and the last digits, never the full numbers) and who she is on her invoices (the business type and a trading name
 *   she entered).
 * - **The props are the RSC payload** (what the browser receives): the rows' strings and invoice ids
 *   (`invoice-list-view.ts`), the masks, the business type's label and her trading name — no other id, no version.
 * - A failed read: the page with one plain message (never a half list). `?notice=` shows a send answer that lands here.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { notFound } from "next/navigation";
import { BUSINESS_TYPES } from "@/config/invoices";
import { nannyInvoicesEnabled } from "@/lib/features/flags";
import { proveNanny } from "@/lib/invoices/nanny-proof";
import { readMaskedDetails, readMyInvoices } from "@/lib/invoices/store";
import { readIssuer } from "@/lib/invoices/store-business";
import { noticeFor, toInvoiceRows } from "./invoice-list-view";
import { InvoicesClient } from "./InvoicesClient";

interface PageProps {
  readonly searchParams?: Readonly<Record<string, string | string[] | undefined>>;
}

export default async function NannyInvoicesPage({ searchParams }: PageProps) {
  if (!nannyInvoicesEnabled()) notFound();
  const proof = await proveNanny();
  if (!proof) notFound();
  const [mine, masks, issuer] = await Promise.all([readMyInvoices(proof), readMaskedDetails(proof), readIssuer(proof)]);
  const notice = noticeFor(searchParams?.notice);
  if (!mine.ok || !masks.ok || !issuer.ok) {
    return <InvoicesClient rows={[]} business={null} bank={null} loadFailed notice={notice} />;
  }
  const m = masks.value;
  const i = issuer.value;
  return (
    <InvoicesClient
      rows={toInvoiceRows(mine.value, new Date())}
      business={{ businessType: BUSINESS_TYPES[i.businessType], tradingName: i.tradingNameSource === "business" ? i.tradingName : null }}
      bank={m === null ? null : { accountName: m.accountName, sortCodeLast2: m.sortCodeLast2, accountLast4: m.accountLast4 }}
      loadFailed={false}
      notice={notice}
    />
  );
}
