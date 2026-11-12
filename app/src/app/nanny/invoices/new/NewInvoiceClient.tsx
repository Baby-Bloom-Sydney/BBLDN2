"use client";

/**
 * `/nanny/invoices/new`, client half (plan 06 old step 14, §14.3, §14.5, §14.6 b4.4; brief §0a A, C, §3 nanny 3–7;
 * A4, A5). Header styles per brief §7.
 *
 * - **Who and when** (`TargetPicker`): her family, Regular week or Trial Shift, the week.
 * - **The form** (`useInvoiceForm`): shifts and expenses as react-hook-form field arrays (`ShiftRows`, `ExpenseRows`),
 *   the totals live from the one calculator with her VAT (`TotalsBox`). "Review" runs the shared schema first, then
 *   asks the server (`useInvoiceReview`) — which works out every figure itself.
 * - **The review** (`ReviewStep`): who she is read-only, masked bank details or the first-invoice setup, the lines, the
 *   server's totals; Back and Send.
 * - The form is keyed by its target, so another family or kind starts afresh.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { EditNotice } from "@/components/settings/EditNotice";
import { Button } from "@/components/ui/button";
import { INVOICE_ACTION_MESSAGES } from "@/lib/invoices/actions/invoice-messages";
import type { VatSetting } from "@/lib/invoices/totals";
import { draftOf, liveTotals, localCheck, weekDays } from "./invoice-form";
import { ExpenseRows } from "./ExpenseRows";
import { ReviewStep } from "./ReviewStep";
import { ShiftRows } from "./ShiftRows";
import type { FamilyOption, InvoiceTargetView } from "./invoice-form";
import { TargetPicker } from "./TargetPicker";
import { TotalsBox } from "./TotalsBox";
import { useInvoiceForm } from "./useInvoiceForm";
import { useInvoiceReview } from "./useInvoiceReview";

export interface NewInvoiceClientProps {
  readonly families: readonly FamilyOption[];
  readonly target: InvoiceTargetView | null;
  readonly vat: VatSetting;
  /** London's today ("YYYY-MM-DD"), from the server: days after it can't be picked. */
  readonly today: string;
  readonly loadFailed: boolean;
}

const card = "rounded-2xl border border-slate-200 bg-white px-4 py-5 text-sm text-slate-600 shadow-sm";

/** London's today as an instant the shared schema reads ("future" = after this date). */
const nowOf = (today: string): Date => new Date(`${today}T12:00:00Z`);

function InvoiceBuilder({ families, target, vat, today }: Omit<NewInvoiceClientProps, "loadFailed" | "target"> & { readonly target: InvoiceTargetView }) {
  const router = useRouter();
  const f = useInvoiceForm(target, today);
  const r = useInvoiceReview({ onFormRefusal: f.showRefusal, go: (href) => router.push(href) });
  const { state } = r;

  if (state.step === "review" && state.preview && state.draft) {
    return (
      <ReviewStep preview={state.preview} draft={state.draft} notice={state.notice} pending={r.pending} setupIssues={state.setupIssues}
        onBack={r.back} onSend={r.send} onSaveSetup={r.saveSetup} />
    );
  }
  const onReview = f.form.handleSubmit((values) => {
    const draft = draftOf(f.header, values);
    const refusal = localCheck(draft, nowOf(today));
    if (refusal) return f.showRefusal(refusal);
    f.setMessage(null);
    return r.review(draft);
  });
  const trialDate = target.kind === "trial_shift" ? target.periodStart : null;
  return (
    <form onSubmit={onReview} noValidate className="space-y-5">
      <TargetPicker families={families} target={target} periodStart={f.periodStart} onWeek={f.setWeek} />
      <section aria-label="Childcare" className="space-y-3">
        <h2 className="px-1 text-sm font-semibold text-slate-900">Childcare</h2>
        <ShiftRows form={f.form} rows={f.shifts} days={weekDays(f.periodStart)} fixedDate={trialDate} today={today} newRow={f.newShift} />
      </section>
      <section aria-label="Expenses" className="space-y-3">
        <h2 className="px-1 text-sm font-semibold text-slate-900">Expenses</h2>
        <ExpenseRows form={f.form} rows={f.expenses} />
      </section>
      <TotalsBox totals={liveTotals(f.form.watch(), vat)} vat={vat} />
      <EditNotice notice={f.message === null ? null : { tone: "alert", text: f.message }} />
      <Button type="submit" aria-disabled={r.pending !== null || undefined} className="w-full bg-violet-600 text-white hover:bg-violet-700 sm:w-auto">
        {r.pending === "review" && <Loader2 className="animate-spin" aria-hidden="true" />}
        Review
      </Button>
    </form>
  );
}

function Body(props: NewInvoiceClientProps) {
  if (props.loadFailed) return <p className={card}>{INVOICE_ACTION_MESSAGES.error}</p>;
  if (props.families.length === 0) return <p className={card}>You have no families to invoice yet.</p>;
  if (props.target === null) return <TargetPicker families={props.families} target={null} periodStart="" onWeek={() => undefined} />;
  const key = `${props.target.kind}:${props.target.targetId}:${props.target.replaces?.invoiceId ?? ""}`;
  return <InvoiceBuilder key={key} {...props} target={props.target} />;
}

export function NewInvoiceClient(props: NewInvoiceClientProps) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/nanny/invoices" aria-label="Back to invoices"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">New invoice</h1>
      </div>
      <Body {...props} />
    </div>
  );
}
