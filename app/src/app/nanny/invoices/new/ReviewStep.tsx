"use client";

/**
 * The review (plan 06 old step 14, §14.6 b4.4; brief §0.4, §0a A, C, §3 nanny 6): what goes out, before it goes.
 *
 * - "This invoice goes to Olivia Hartley (olivia@…) and a copy to you"; the duplicate warning ("You have already
 *   invoiced … for dates in this period (…)": a live invoice of hers to this family whose period overlaps); "Replaces …"
 *   for a correction; anything the last answer said.
 * - Who she is, read-only, with "Change in Settings" (`IssuerSummary`). Her bank details **masked** ("sort code
 *   ••-••-56, account ending 4321"); only when they (or an address) are missing, the first-invoice setup for them.
 * - Every line: the shifts under "Childcare, {period}" — the server's period, the first to the last shift date — by
 *   date as the PDF prints them (her order within a date), each with its day, hours × rate and amount, the description
 *   under it; then "Expenses". Expenses only: no Childcare section. Then the server's totals (no Childcare line with
 *   no hours).
 * - "Back" to the form as she left it; "Send" — never while the setup is still needed.
 * - Each review starts with focus on its heading (on entry, and when the setup or a change gives a new review).
 *
 * BB-wave1-041126/06b4, 2026-11-12; BB-wave1-041126/06b4-ui, 2026-11-12 (rework: the period, expenses only).
 */

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { EditNotice } from "@/components/settings/EditNotice";
import { SettingsSubsection } from "@/components/settings/SettingsSubsection";
import { Button } from "@/components/ui/button";
import { EXPENSE_TYPES } from "@/config/invoices";
import type { BusinessPageInput } from "@/lib/invoices/actions/business-page";
import type { InvoicePreview } from "@/lib/invoices/actions/invoice-messages";
import { maskedDetailsLine } from "@/lib/invoices/masking";
import { formatHours, formatInvoiceMoney } from "@/lib/invoices/money";
import { lineAmountPence } from "@/lib/invoices/totals";
import { EXPENSE_TYPE_KEYS } from "@/lib/invoices/types";
import { dayLabel, periodLabel } from "@/lib/invoices/week";
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
  /** Moves on each time the setup saves: the setup starts again empty if it still shows. */
  readonly setupRound: number;
  readonly onBack: () => void;
  readonly onSend: () => void;
  readonly onSaveSetup: (input: BusinessPageInput) => void;
}

const typeLabel = (type: string): string => {
  const known = EXPENSE_TYPE_KEYS.find((key) => key === type);
  return known ? EXPENSE_TYPES[known] : type;
};

type Shift = Extract<FormDraft["lines"][number], { readonly kind: "shift" }>;
type Expense = Extract<FormDraft["lines"][number], { readonly kind: "expense" }>;

/** Shifts by date, earliest first, as the PDF prints them; `sort` is stable, so her order stays within a date. */
const byDate = (shifts: readonly Shift[]): readonly Shift[] => [...shifts].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

function LineItem({ main, detail, amount, description }: { readonly main: string; readonly detail: string; readonly amount: number; readonly description: string }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-sm text-slate-900">{main}{detail && <span className="text-slate-500"> · </span>}{detail && <span>{detail}</span>}</p>
        {description.trim() !== "" && <p className="break-words text-xs text-slate-500">{description}</p>}
      </div>
      <p className="shrink-0 text-sm font-medium tabular-nums text-slate-900">{formatInvoiceMoney(amount)}</p>
    </li>
  );
}

function Lines({ draft, preview }: { readonly draft: FormDraft; readonly preview: InvoicePreview }) {
  const shifts = byDate(draft.lines.flatMap((l) => (l.kind === "shift" ? [l] : [])));
  const expenses: readonly Expense[] = draft.lines.flatMap((l) => (l.kind === "expense" ? [l] : []));
  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      {shifts.length > 0 && <h2 className="text-sm font-semibold text-slate-900">Childcare, {periodLabel(preview.periodStart, preview.periodEnd)}</h2>}
      {shifts.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {shifts.map((s, i) => (
            <LineItem key={`s${i}`} main={dayLabel(s.date)} detail={`${formatHours(s.hours)} h × ${formatInvoiceMoney(s.ratePence)}`}
              amount={lineAmountPence(s.hours, s.ratePence)} description={s.description} />
          ))}
        </ul>
      )}
      {expenses.length > 0 && <h2 className="text-sm font-semibold text-slate-900">Expenses</h2>}
      {expenses.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {expenses.map((e, i) => <LineItem key={`e${i}`} main={typeLabel(e.expenseType)} detail="" amount={e.amountPence} description={e.description} />)}
        </ul>
      )}
    </div>
  );
}

function Warnings({ preview }: { readonly preview: InvoicePreview }) {
  return (
    <>
      {preview.duplicates.map((d) => (
        <p key={d.invoiceId} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          You have already invoiced {preview.recipient.familyName} for dates in this period ({d.number})
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

export function ReviewStep({ preview, draft, notice, pending, setupIssues, setupRound, onBack, onSend, onSaveSetup }: ReviewStepProps) {
  const setup = preview.needsPaymentDetails || preview.needsAddress;
  const { familyName, emailHint } = preview.recipient;
  const heading = useRef<HTMLHeadingElement>(null);
  // each review (on entry, and after the setup or a change: a new answer) starts at its heading (code review M2)
  useEffect(() => heading.current?.focus(), [preview]);
  return (
    <div className="space-y-5">
      <h2 ref={heading} tabIndex={-1} className="rounded-sm text-base font-medium text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
        This invoice goes to {familyName} ({emailHint}) and a copy to you
      </h2>
      <Warnings preview={preview} />
      <EditNotice notice={notice === null ? null : { tone: "alert", text: notice }} />
      <IssuerSummary issuer={preview.issuer} recipient={preview.recipient} />
      {preview.bank && <BankDetails bank={preview.bank} />}
      {setup && <FirstInvoiceSetup key={setupRound} preview={preview} issues={setupIssues} saving={pending === "setup"} onSave={onSaveSetup} />}
      <Lines draft={draft} preview={preview} />
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
