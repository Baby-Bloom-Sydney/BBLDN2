"use client";

/**
 * Who the invoice is from and to, read-only (plan 06 §14.6 b4.4, §14.8; brief §0a A "Who she is … comes from her
 * Settings and is shown read-only on the review with 'Change in Settings'. It cannot be changed inside the invoice."):
 * the PDF's three columns, with the PDF's own lines (`invoice-text.ts`) —
 * - **From:** her name and one address (a limited company's registered office);
 * - **Business:** her trading name or the company's or partnership's name, "Company no. …", "VAT no. …" — left out
 *   when there's nothing to show;
 * - **Bill to:** the family's name and their email, masked to its local part ("olivia@…").
 * "Change in Settings" opens her Business page in a new tab; Review again reads the change.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { useId } from "react";
import type { InvoicePreview } from "@/lib/invoices/actions/invoice-messages";
import { businessLines, businessName, fromLines, type IssuerText } from "@/lib/invoices/invoice-text";
import { ChangeInSettingsLink } from "../BusinessSummaryCard";

function Party({ label, lines }: { readonly label: string; readonly lines: readonly string[] }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="min-w-0 space-y-0.5">
      <p id={id} className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      {lines.map((line, i) => (
        <p key={`${i}-${line}`} className={i === 0 ? "break-words text-sm font-semibold text-slate-900" : "break-words text-sm text-slate-700"}>{line}</p>
      ))}
    </div>
  );
}

/** Her issuer as the PDF's lines take it ("" where the review has none yet). */
function issuerText(issuer: InvoicePreview["issuer"]): IssuerText {
  return {
    businessType: issuer.businessType,
    name: issuer.name ?? "",
    tradingName: issuer.tradingName ?? "",
    address: issuer.address ?? "",
    companyName: issuer.companyName,
    companyNumber: issuer.companyNumber,
    registeredOffice: issuer.registeredOffice,
    partnershipName: issuer.partnershipName,
    vatNumber: issuer.vat.number,
  };
}

export function IssuerSummary({ issuer, recipient }: Pick<InvoicePreview, "issuer" | "recipient">) {
  const text = issuerText(issuer);
  const from = fromLines(text).flatMap((line) => line.split("\n"));
  const business = [businessName(text), ...businessLines(text)].filter((line): line is string => line !== null);
  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid gap-4 sm:grid-cols-3">
        <Party label="From" lines={from} />
        {business.length > 0 && <Party label="Business" lines={business} />}
        <Party label="Bill to" lines={[recipient.familyName, recipient.emailHint]} />
      </div>
      <ChangeInSettingsLink />
    </div>
  );
}
