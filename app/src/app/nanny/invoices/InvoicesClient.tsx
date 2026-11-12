"use client";

/**
 * `/nanny/invoices`, client half (plan 06 old step 14, §14.6 b4.4; brief §0.1–0.9, §3 nanny 1, 7–11; §14.3; R14a,
 * R15). Header styles per brief §7 (the `/nanny/positions` title, hub cards).
 *
 * - **"New invoice" is never disabled** (§14.3 replaces §0.1): with no bank details, her first invoice asks for them.
 * - Her business card (masked bank details, "Change in Settings"), then her invoices, filterable by family (R14a).
 * - Cancel opens the reason dialog; resend calls the action for that email; each refreshes the list after (the
 *   actions revalidate it). One resend at a time; a refusal shows its plain message.
 * - A failed read: one plain message instead of the list. A send answer that landed here: its message on top.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { EditNotice } from "@/components/settings/EditNotice";
import { Button } from "@/components/ui/button";
import { INVOICE_ACTION_MESSAGES, type ReviewBank } from "@/lib/invoices/actions/invoice-messages";
import { resendInvoiceEmail } from "@/lib/invoices/actions/resend-invoice-email";
import { BusinessSummaryCard, type BusinessSummary } from "./BusinessSummaryCard";
import { CancelInvoiceDialog, type CancelTarget } from "./CancelInvoiceDialog";
import { familyNames, type InvoiceRowView } from "./invoice-list-view";
import { InvoiceList, type ResendKey } from "./InvoiceList";

export interface InvoicesClientProps {
  readonly rows: readonly InvoiceRowView[];
  readonly business: BusinessSummary | null;
  readonly bank: ReviewBank | null;
  readonly loadFailed: boolean;
  readonly notice: string | null;
}

const ALL = "";

function FamilyFilter({ names, value, onChange }: { readonly names: readonly string[]; readonly value: string; readonly onChange: (v: string) => void }) {
  const id = useId();
  if (names.length < 2) return null;
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">Family</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}
        className="h-9 min-w-0 flex-1 rounded-md border border-input bg-white px-3 text-base shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:flex-none md:text-sm">
        <option value={ALL}>All families</option>
        {names.map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
    </div>
  );
}

/** Resend one email; the list refreshes after. One at a time (a ref: React 18 batches state). */
function useResend(onDone: () => void) {
  const [resending, setResending] = useState<ResendKey | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const resend = async (key: ResendKey) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setResending(key);
    setMessage(null);
    try {
      const result = await resendInvoiceEmail({ invoiceId: key.invoiceId, what: key.what, recipient: key.recipient });
      if (!result.ok) setMessage(result.message);
    } catch {
      setMessage(INVOICE_ACTION_MESSAGES.error);
    }
    inFlight.current = false;
    setResending(null);
    onDone();
  };
  return { resending, message, resend };
}

export function InvoicesClient({ rows, business, bank, loadFailed, notice }: InvoicesClientProps) {
  const router = useRouter();
  const [family, setFamily] = useState(ALL);
  const [cancelling, setCancelling] = useState<CancelTarget | null>(null);
  const { resending, message, resend } = useResend(() => router.refresh());
  const names = useMemo(() => familyNames(rows), [rows]);
  const shown = family === ALL ? rows : rows.filter((r) => r.familyName === family);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Invoices</h1>
        <Button asChild className="bg-violet-600 text-white hover:bg-violet-700">
          <Link href="/nanny/invoices/new">
            <Plus aria-hidden="true" />
            New invoice
          </Link>
        </Button>
      </div>
      <EditNotice notice={notice === null ? null : { tone: "status", text: notice }} />
      <BusinessSummaryCard business={business} bank={bank} />
      {loadFailed ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-4 py-5 text-sm text-slate-600 shadow-sm">{INVOICE_ACTION_MESSAGES.error}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-4 py-5 text-sm text-slate-600 shadow-sm">No invoices yet.</p>
      ) : (
        <div className="space-y-3">
          <FamilyFilter names={names} value={family} onChange={setFamily} />
          <EditNotice notice={message === null ? null : { tone: "alert", text: message }} />
          <InvoiceList rows={shown} onResend={resend} resending={resending}
            onCancel={(row) => setCancelling({ invoiceId: row.invoiceId, number: row.number, familyName: row.familyName })} />
        </div>
      )}
      <CancelInvoiceDialog target={cancelling} onClose={() => setCancelling(null)}
        onCancelled={() => {
          setCancelling(null);
          router.refresh();
        }} />
    </div>
  );
}
