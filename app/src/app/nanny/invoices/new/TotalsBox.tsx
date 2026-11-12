"use client";

/**
 * The invoice's totals (plan 06 §14.5, §14.8; brief §0a A "Totals … updating as she types", §7 the green "Estimated
 * weekly pay" box): childcare, VAT per her mode, expenses when there are any, and the total — the PDF's own lines
 * (`invoice-text.ts`). The form passes its live figures (`totals.ts` over the complete rows); the review passes the
 * server's.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { totalsLines } from "@/lib/invoices/invoice-text";
import { formatInvoiceMoney } from "@/lib/invoices/money";
import type { InvoiceTotals, VatSetting } from "@/lib/invoices/totals";

export function TotalsBox({ totals, vat }: { readonly totals: InvoiceTotals; readonly vat: VatSetting }) {
  const lines = totalsLines({
    shiftsPence: totals.shiftsPence,
    expensesPence: totals.expensesPence,
    vat: { mode: vat.mode, rateBp: vat.rateBp, pence: totals.vatPence },
  });
  return (
    <section aria-label="Totals" className="rounded-lg border border-green-100 bg-green-50 px-4 py-3">
      <dl className="space-y-1 text-sm">
        {lines.map((line) => (
          <div key={line.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-green-700">{line.label}</dt>
            <dd className="font-medium tabular-nums text-green-800">{formatInvoiceMoney(line.pence)}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-3 border-t border-green-100 pt-2">
          <dt className="font-semibold text-green-800">Total</dt>
          <dd className="text-lg font-semibold tabular-nums text-green-700">{formatInvoiceMoney(totals.totalPence)}</dd>
        </div>
      </dl>
    </section>
  );
}
