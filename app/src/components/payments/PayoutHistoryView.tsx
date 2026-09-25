"use client";

/**
 * PayoutHistoryView — list of all past + scheduled payouts.
 * Used by both `/nanny/payouts/history` and the "Payout History" leaf
 * inside settings.
 */

import { AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { PayoutHistoryRow } from "@/lib/payments/queryPayoutHistory";
import { formatAuDate } from "@/lib/format/date";

interface Props {
  rows: PayoutHistoryRow[] | null;
  /** Omit the page heading when embedded inside another surface. */
  embedded?: boolean;
}

export function PayoutHistoryView({ rows, embedded = false }: Props) {
  if (!rows) {
    return (
      <div
        role="alert"
        className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      >
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-medium">
            Couldn&apos;t load your history right now.
          </p>
          <p>Please refresh the page in a moment.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!embedded && (
        <h1 className="text-2xl font-bold text-slate-900">
          Contribution history
        </h1>
      )}

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-slate-600">
              No contributions yet. They appear here once each cycle&apos;s
              release window has cleared.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between px-5 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium text-slate-900">
                      £{(p.amountAudCents / 100).toFixed(2)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {p.parentFirstName} · {formatAuDate(p.periodStart)} →{" "}
                      {formatAuDate(p.periodEnd)}
                    </p>
                  </div>
                  <span className="text-xs text-slate-500">
                    {p.status === "paid" && p.paidAt
                      ? `Paid ${formatAuDate(p.paidAt)}`
                      : `${p.status} · ${formatAuDate(p.scheduledReleaseAt)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
