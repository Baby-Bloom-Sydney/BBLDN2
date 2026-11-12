"use client";

/**
 * Her invoices, newest first (plan 06 old step 14, §14.6 b4.4; brief §0.6–0.9, §3 nanny 7–11; R15). Each a card:
 * the family, the period, the number; the total and hours; the status ("Sent", "Cancelled · Wrong hours"), "Emailed
 * ✓", "Replaces …" / "Replaced by …"; what wasn't delivered with its resend; then "View PDF" (a new tab, through the
 * PDF route), "Cancel invoice", "Send a corrected invoice". Cards stack at every width, so nothing scrolls sideways
 * at 320 px.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import Link from "next/link";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InvoiceStatus } from "@/lib/invoices/types";
import { cn } from "@/lib/utils";
import type { InvoiceRowView, Undelivered } from "./invoice-list-view";

const STATUS: Readonly<Record<InvoiceStatus, { readonly label: string; readonly tone: string }>> = {
  sent: { label: "Sent", tone: "bg-green-50 text-green-700" },
  cancelled: { label: "Cancelled", tone: "bg-slate-100 text-slate-600" },
  sending: { label: "Sending…", tone: "bg-violet-50 text-violet-700" },
  failed: { label: "Not sent", tone: "bg-slate-100 text-slate-600" },
};

const UNDELIVERED_TO = { family: "Not delivered to the family", nanny: "Not delivered to you" } as const;
const RESEND = { invoice: "Resend email", cancellation: "Resend cancellation" } as const;

/** A resend in flight: which invoice, and which email. */
export interface ResendKey {
  readonly invoiceId: string;
  readonly what: Undelivered["what"];
  readonly recipient: Undelivered["recipient"];
}

export interface InvoiceListProps {
  readonly rows: readonly InvoiceRowView[];
  readonly onCancel: (row: InvoiceRowView) => void;
  readonly onResend: (key: ResendKey) => void;
  /** The resend running now (its button shows it; the others wait). */
  readonly resending: ResendKey | null;
}

function StatusLine({ row }: { readonly row: InvoiceRowView }) {
  const status = STATUS[row.status];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className={cn("rounded-full px-2 py-0.5 font-medium", status.tone)}>
        {row.cancelReason ? `${status.label} · ${row.cancelReason}` : status.label}
      </span>
      {row.emailed && <span className="font-medium text-green-700">Emailed ✓</span>}
      {row.replacesNumber && <span className="break-all text-slate-500">Replaces {row.replacesNumber}</span>}
      {row.replacedByNumber && <span className="break-all text-slate-500">Replaced by {row.replacedByNumber}</span>}
    </div>
  );
}

function ResendLine({ row, item, onResend, resending }: { readonly row: InvoiceRowView; readonly item: Undelivered } & Pick<InvoiceListProps, "onResend" | "resending">) {
  const running = resending?.invoiceId === row.invoiceId && resending.what === item.what && resending.recipient === item.recipient;
  const noteId = `${row.invoiceId}-${item.what}-${item.recipient}`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2">
      <span id={noteId} className="text-xs font-medium text-amber-800">{UNDELIVERED_TO[item.recipient]}</span>
      <Button type="button" variant="outline" size="sm" aria-describedby={noteId} disabled={resending !== null}
        onClick={() => onResend({ invoiceId: row.invoiceId, what: item.what, recipient: item.recipient })}>
        {running && <Loader2 className="animate-spin" aria-hidden="true" />}
        {RESEND[item.what]}
      </Button>
    </div>
  );
}

function Actions({ row, onCancel }: { readonly row: InvoiceRowView; readonly onCancel: (row: InvoiceRowView) => void }) {
  if (!row.hasPdf && !row.canCancel && !row.canCorrect) return null;
  return (
    <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
      {row.hasPdf && (
        <Button asChild variant="outline" size="sm">
          <a href={`/nanny/invoices/${encodeURIComponent(row.invoiceId)}/pdf`} target="_blank" rel="noopener noreferrer">
            <FileText aria-hidden="true" />
            View PDF
          </a>
        </Button>
      )}
      {row.canCorrect && (
        <Button asChild variant="outline" size="sm" className="text-violet-700 hover:text-violet-800">
          <Link href={`/nanny/invoices/new?replaces=${encodeURIComponent(row.invoiceId)}`}>Send a corrected invoice</Link>
        </Button>
      )}
      {row.canCancel && (
        <Button type="button" variant="ghost" size="sm" className="text-slate-600" onClick={() => onCancel(row)}>
          Cancel invoice
        </Button>
      )}
    </div>
  );
}

function InvoiceCard({ row, onCancel, onResend, resending }: { readonly row: InvoiceRowView } & Omit<InvoiceListProps, "rows">) {
  return (
    <li className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words font-semibold text-slate-900">{row.familyName}</p>
          <p className="text-sm text-slate-500">{row.period}</p>
          <p className="mt-1 break-all font-mono text-xs text-slate-500">{row.number}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-base font-semibold text-slate-900">{row.total}</p>
          <p className="text-xs text-slate-500">{row.hours}</p>
        </div>
      </div>
      <StatusLine row={row} />
      {row.undelivered.map((item) => (
        <ResendLine key={`${item.what}-${item.recipient}`} row={row} item={item} onResend={onResend} resending={resending} />
      ))}
      <Actions row={row} onCancel={onCancel} />
    </li>
  );
}

export function InvoiceList({ rows, onCancel, onResend, resending }: InvoiceListProps) {
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <InvoiceCard key={row.invoiceId} row={row} onCancel={onCancel} onResend={onResend} resending={resending} />
      ))}
    </ul>
  );
}
