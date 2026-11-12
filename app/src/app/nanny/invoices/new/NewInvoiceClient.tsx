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
 * - The form is keyed by its target, so another family or kind starts afresh; the picker sits outside it, so it is never
 *   remounted and keeps her focus. Focus follows the steps: the review's heading on entry, Review on Back, the first
 *   refused field when the form comes back with problems (code review M2).
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
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
import { TargetPicker, WeekSelect } from "./TargetPicker";
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

interface BuilderProps extends Omit<NewInvoiceClientProps, "loadFailed" | "target" | "families"> {
  readonly target: InvoiceTargetView;
  /** Tells the page whether the review is showing (the picker hides while it is). */
  readonly onReviewing: (reviewing: boolean) => void;
}

/** Focus when the form comes back (code review M2): the first refused field, else — back from the review — Review. */
function useFormFocus(f: ReturnType<typeof useInvoiceForm>, step: "form" | "review", review: RefObject<HTMLButtonElement>) {
  const last = useRef(step);
  const { form, focusTo, focused } = f;
  useEffect(() => {
    const back = last.current === "review" && step === "form";
    last.current = step;
    if (step !== "form") return;
    if (focusTo) {
      form.setFocus(focusTo.path);
      focused();
    } else if (back) {
      review.current?.focus();
    }
  }, [step, focusTo, form, focused, review]);
}

function InvoiceBuilder({ target, vat, today, onReviewing }: BuilderProps) {
  const router = useRouter();
  const f = useInvoiceForm(target, today);
  const r = useInvoiceReview({ onFormRefusal: f.showRefusal, go: (href) => router.push(href) });
  const { state } = r;
  const reviewButton = useRef<HTMLButtonElement>(null);
  useFormFocus(f, state.step, reviewButton);
  useEffect(() => onReviewing(state.step === "review"), [state.step, onReviewing]);

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
  return (
    <form onSubmit={onReview} noValidate className="space-y-5">
      {target.kind === "regular_week" && <WeekSelect weeks={target.weeks} value={f.periodStart} onWeek={f.setWeek} />}
      <section aria-labelledby="new-invoice-childcare" className="space-y-3">
        <h2 id="new-invoice-childcare" className="px-1 text-sm font-semibold text-slate-900">Childcare</h2>
        <ShiftRows form={f.form} rows={f.shifts} days={weekDays(f.periodStart)} fixedDate={target.kind === "trial_shift" ? target.periodStart : null}
          today={today} newRow={f.newShift} />
      </section>
      <section aria-labelledby="new-invoice-expenses" className="space-y-3">
        <h2 id="new-invoice-expenses" className="px-1 text-sm font-semibold text-slate-900">Expenses</h2>
        <ExpenseRows form={f.form} rows={f.expenses} />
      </section>
      <TotalsBox totals={liveTotals(f.form.watch(), vat)} vat={vat} />
      <EditNotice notice={f.message === null ? null : { tone: "alert", text: f.message }} />
      <Button ref={reviewButton} type="submit" aria-disabled={r.pending !== null || undefined}
        className="w-full bg-violet-600 text-white hover:bg-violet-700 aria-disabled:opacity-70 sm:w-auto">
        {r.pending === "review" && <Loader2 className="animate-spin" aria-hidden="true" />}
        Review
      </Button>
    </form>
  );
}

/**
 * The picker sits outside the form, which is keyed by its target and starts afresh for each one: so picking a family,
 * kind or trial date never remounts the picker, and her focus stays on it (code review M2). It hides while the review
 * shows.
 */
function Body(props: NewInvoiceClientProps) {
  const [reviewing, setReviewing] = useState(false);
  const onReviewing = useCallback((value: boolean) => setReviewing(value), []);
  if (props.loadFailed) return <p className={card}>{INVOICE_ACTION_MESSAGES.error}</p>;
  if (props.families.length === 0) return <p className={card}>You have no families to invoice yet.</p>;
  const { target } = props;
  return (
    <div className="space-y-5">
      <div hidden={reviewing && target !== null}>
        <TargetPicker families={props.families} target={target} />
      </div>
      {target && (
        <InvoiceBuilder key={`${target.kind}:${target.targetId}:${target.replaces?.invoiceId ?? ""}`} target={target} vat={props.vat}
          today={props.today} onReviewing={onReviewing} />
      )}
    </div>
  );
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
