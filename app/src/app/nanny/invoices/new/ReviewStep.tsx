"use client";

/**
 * The review (plan 06 old step 14, §14.6 b4.4; brief §0.4, §0a A, C, §3 nanny 6): what goes out, before it goes.
 *
 * - "This invoice goes to Olivia Hartley (olivia@…) and a copy to you"; the duplicate warning ("You have already
 *   invoiced … for this week (…)"); "Replaces …" for a correction; anything the last answer said.
 * - Who she is, read-only, with "Change in Settings" (`IssuerSummary`). Her bank details **masked** ("sort code
 *   ••-••-56, account ending 4321") — or, only when they (or an address) are missing, the first-invoice setup.
 * - Every line (its day, hours × rate and amount, the description under it), then the server's totals.
 * - "Back" to the form as she left it; "Send" — never while the setup is still needed.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { Loader2 } from "lucide-react";
import { EditNotice } from "@/components/settings/EditNotice";
import { SettingsSubsection } from "@/components/settings/SettingsSubsection";
import { Button } from "@/components/ui/button";
import { EXPENSE_TYPES } from "@/config/invoices";
import type { BusinessPageInput } from "@/lib/invoices/actions/business-page";
import type { InvoicePreview } from "@/lib/invoices/actions/invoice-messages";
import { periodForSubject } from "@/lib/invoices/emails/invoice-wording";
import { maskedDetailsLine } from "@/lib/invoices/masking";
import { formatHours, formatInvoiceMoney } from "@/lib/invoices/money";
import { lineAmountPence } from "@/lib/invoices/totals";
import { EXPENSE_TYPE_KEYS } from "@/lib/invoices/types";
import { dayLabel, weekRangeLabel } from "@/lib/invoices/week";
import { FirstInvoiceSetup } from "./FirstInvoiceSetup";
import type { FormDraft } from "./invoice-form";
import { IssuerSummary } from "./IssuerSummary";
import type { ReviewPending } from "./useInvoiceReview";
import { TotalsBox } from "./TotalsBox";

export interface ReviewStepProps {
  readonly preview: InvoicePreview;
  readonly draft: FormDraft;
  readonly notice: string | null;
  readonly pending: ReviewPending;
  readonly setupIssues: Readonly<Record<string, string>>;
  readonly onBack: () => void;
  readonly onSend: () => void;
  readonly onSaveSetup: (input: BusinessPageInput) => void;
}

const typeLabel = (type: string): string => {
  const known = EXPENSE_TYPE_KEYS.find((key) => key === type);
  return known ? EXPENSE_TYPES[known] : type;
};

function Lines({ draft }: { readonly draft: FormDraft }) {
  const heading = draft.kind === "trial_shift" ? periodForSubject("trial_shift", draft.periodStart) : `Childcare, week of ${weekRangeLabel(draft.periodStart)}`;
  const shifts = draft.lines.flatMap((l) => (l.kind === "shift" ? [l] : []));
  const expenses = draft.lines.flatMap((l) => (l.kind === "expense" ? [l] : []));
  const row = (key: string, main: string, detail: string, amount: number, description: string) => (
    <li key={key} className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-sm text-slate-900">{main}{detail && <span className="text-slate-500"> · </span>}{detail && <span>{detail}</span>}</p>
        {description.trim() !== "" && <p className="break-words text-xs text-slate-500">{description}</p>}
      </div>
      <p className="shrink-0 text-sm font-medium tabular-nums text-slate-900">{formatInvoiceMoney(amount)}</p>
    </li>
  );
  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">{heading}</h2>
      <ul className="divide-y divide-slate-100">
        {shifts.map((s, i) => row(`s${i}`, dayLabel(s.date), `${formatHours(s.hours)} h × ${formatInvoiceMoney(s.ratePence)}`, lineAmountPence(s.hours, s.ratePence), s.description))}
      </ul>
      {expenses.length > 0 && <h2 className="text-sm font-semibold text-slate-900">Expenses</h2>}
      {expenses.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {expenses.map((e, i) => row(`e${i}`, typeLabel(e.expenseType), "", e.amountPence, e.description))}
        </ul>
      )}
    </div>
  );
}

function Warnings({ preview, kind }: { readonly preview: InvoicePreview; readonly kind: FormDraft["kind"] }) {
  const forWhat = kind === "trial_shift" ? "for this Trial Shift" : "for this week";
  return (
    <>
      {preview.duplicates.map((d) => (
        <p key={d.invoiceId} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          You have already invoiced {preview.recipient.familyName} {forWhat} ({d.number})
        </p>
      ))}
      {preview.replaces && <p className="break-all text-sm text-slate-600">Replaces {preview.replaces.number}</p>}
    </>
  );
}

function BankDetails({ bank }: { readonly bank: NonNullable<InvoicePreview["bank"]> }) {
  return (
    <SettingsSubsection header="Bank details">
      <div className="px-4 py-3 text-sm text-slate-900">
        <p className="break-words">{bank.accountName}</p>
        <p>{maskedDetailsLine(bank)}</p>
      </div>
    </SettingsSubsection>
  );
}

export function ReviewStep({ preview, draft, notice, pending, setupIssues, onBack, onSend, onSaveSetup }: ReviewStepProps) {
  const setup = preview.needsPaymentDetails || preview.needsAddress;
  const { familyName, emailHint } = preview.recipient;
  return (
    <div className="space-y-5">
      <p className="text-base font-medium text-slate-900">This invoice goes to {familyName} ({emailHint}) and a copy to you</p>
      <Warnings preview={preview} kind={draft.kind} />
      <EditNotice notice={notice === null ? null : { tone: "alert", text: notice }} />
      <IssuerSummary issuer={preview.issuer} recipient={preview.recipient} />
      {setup ? (
        <FirstInvoiceSetup preview={preview} issues={setupIssues} saving={pending === "setup"} onSave={onSaveSetup} />
      ) : (
        preview.bank && <BankDetails bank={preview.bank} />
      )}
      <Lines draft={draft} />
      <TotalsBox totals={preview.totals} vat={preview.vat} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={onBack} disabled={pending !== null}>Back</Button>
        {!setup && (
          <Button type="button" onClick={onSend} aria-disabled={pending !== null || undefined} className="bg-violet-600 text-white hover:bg-violet-700">
            {pending === "send" && <Loader2 className="animate-spin" aria-hidden="true" />}
            {pending === "send" ? "Sending…" : "Send"}
          </Button>
        )}
      </div>
    </div>
  );
}
