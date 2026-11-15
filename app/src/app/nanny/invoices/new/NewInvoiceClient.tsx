"use client";

/**
 * `/nanny/invoices/new`, client half (plan 06 old step 14, §14.3, §14.5, §14.6 b4.4; brief §0a A, C, §3 nanny 3–7;
 * A4, A5; 06b-4 rework, BAI 2026-11-12). Header styles per brief §7.
 *
 * - **Who** (`TargetPicker`): her family, or "Add family". Nothing else until she chooses one.
 * - **The form** (`useInvoiceForm`) starts empty: "Add shift" and "Add expense" side by side under the picker. Lines
 *   appear above them, under "Childcare" and "Expenses" (`ShiftRows`, `ExpenseRows`). The totals (`TotalsBox`, live
 *   from the one calculator with her VAT) and "Review" show only once there is a line ("Without them being able to see
 *   or click 'review' until they have at least entered one shift/expense"). "Review" runs the shared schema and the
 *   family's earliest date first, then asks the server (`useInvoiceReview`) — which works out every figure itself.
 * - **The review** (`ReviewStep`): who she is read-only, masked bank details or the first-invoice setup, the lines, the
 *   server's totals; Back and Send.
 * - The form is keyed by its family, so another family starts afresh; the picker sits outside it, so it is never
 *   remounted and keeps her focus. Focus follows the steps: the review's heading on entry, Review on Back, the first
 *   refused field when the form comes back with problems (code review M2).
 * - A family whose first day is still to come (a hire starting later, no trial): "Add shift" is off, with a note saying
 *   from when; an invoice of expenses only still works.
 * - No family yet: one line and "Add family" (her hub's Children tab, to invite one).
 *
 * BB-wave1-041126/06b4, 2026-11-12; BB-wave1-041126/06b4-ui, 2026-11-12 (rework: no week, no kind, start empty).
 */

import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import { EditNotice } from "@/components/settings/EditNotice";
import { Button } from "@/components/ui/button";
import { INVOICE_ACTION_MESSAGES } from "@/lib/invoices/actions/invoice-messages";
import type { VatSetting } from "@/lib/invoices/totals";
import { periodLabel } from "@/lib/invoices/week";
import { draftOf, liveTotals, localCheck, type FamilyOption, type InvoiceTargetView } from "./invoice-form";
import { ExpenseRows, newExpenseRow } from "./ExpenseRows";
import { ReviewStep } from "./ReviewStep";
import { ShiftRows } from "./ShiftRows";
import { ADD_FAMILY_HREF, ADD_FAMILY_LABEL, TargetPicker } from "./TargetPicker";
import { TotalsBox } from "./TotalsBox";
import { useInvoiceForm, type FormStart } from "./useInvoiceForm";
import { useInvoiceReview } from "./useInvoiceReview";

export interface NewInvoiceClientProps {
  readonly families: readonly FamilyOption[];
  readonly target: InvoiceTargetView | null;
  readonly vat: VatSetting;
  /** London's today ("YYYY-MM-DD"), from the server: the last date she can pick. */
  readonly today: string;
  readonly loadFailed: boolean;
}

const card = "rounded-2xl border border-slate-200 bg-white px-4 py-5 text-sm text-slate-600 shadow-sm";
const ADD = "flex-1 text-violet-700 hover:bg-violet-50 hover:text-violet-800 sm:flex-none";

/** London's today as an instant the shared schema reads ("future" = after this date). */
const nowOf = (today: string): Date => new Date(`${today}T12:00:00Z`);

interface BuilderProps {
  readonly family: FamilyOption;
  readonly start: FormStart | null;
  readonly vat: VatSetting;
  readonly today: string;
  /** Tells the page whether the review is showing (the picker hides while it is). */
  readonly onReviewing: (reviewing: boolean) => void;
}

type Form = ReturnType<typeof useInvoiceForm>;
type Review = ReturnType<typeof useInvoiceReview>;

/** Focus when the form comes back (code review M2): the first refused field, else — back from the review — Review. */
function useFormFocus(f: Form, step: "form" | "review", review: RefObject<HTMLButtonElement>) {
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

interface AddButtonsProps {
  readonly f: Form;
  readonly family: FamilyOption;
  readonly today: string;
  readonly addShift: RefObject<HTMLButtonElement>;
  readonly addExpense: RefObject<HTMLButtonElement>;
}

/**
 * "Add shift" and "Add expense", side by side under the lines. A family whose first day is still to come (a hire
 * starting later, no trial) has no date she could pick: "Add shift" is off, with a note saying from when.
 */
function AddButtons({ f, family, today, addShift, addExpense }: AddButtonsProps) {
  const noteId = useId();
  const notYet = family.earliest > today;
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button ref={addShift} type="button" variant="outline" size="sm" className={ADD} disabled={notYet} aria-describedby={notYet ? noteId : undefined}
          onClick={() => f.shifts.append(f.newShift(""))}>
          <Plus aria-hidden="true" />
          Add shift
        </Button>
        <Button ref={addExpense} type="button" variant="outline" size="sm" className={ADD} onClick={() => f.expenses.append(newExpenseRow())}>
          <Plus aria-hidden="true" />
          Add expense
        </Button>
      </div>
      {notYet && <p id={noteId} className="px-1 text-xs text-slate-500">You can add shifts from {periodLabel(family.earliest, family.earliest)}</p>}
    </div>
  );
}

interface FormStepProps extends Omit<BuilderProps, "start" | "onReviewing"> {
  readonly f: Form;
  readonly r: Review;
  readonly reviewButton: RefObject<HTMLButtonElement>;
}

/** The form: lines above the two buttons; the totals, any message and Review once there is a line. */
function FormStep({ family, vat, today, f, r, reviewButton }: FormStepProps) {
  const addShift = useRef<HTMLButtonElement>(null);
  const addExpense = useRef<HTMLButtonElement>(null);
  const values = f.form.watch();
  const hasLines = f.shifts.fields.length + f.expenses.fields.length > 0;
  const { setMessage } = f;
  useEffect(() => { if (!hasLines) setMessage(null); }, [hasLines, setMessage]);
  const onReview = f.form.handleSubmit((typed) => {
    const draft = draftOf(f.header, typed);
    const refusal = localCheck(draft, nowOf(today), family.earliest);
    if (refusal) return f.showRefusal(refusal);
    f.setMessage(null);
    return r.review(draft);
  });
  return (
    <form onSubmit={onReview} noValidate className="space-y-5">
      <ShiftRows form={f.form} rows={f.shifts} earliest={family.earliest} today={today} newRow={f.newShift} addButton={addShift} />
      <ExpenseRows form={f.form} rows={f.expenses} addButton={addExpense} />
      <AddButtons f={f} family={family} today={today} addShift={addShift} addExpense={addExpense} />
      {hasLines && (
        <>
          <TotalsBox totals={liveTotals(values, vat)} vat={vat} />
          <EditNotice notice={f.message === null ? null : { tone: "alert", text: f.message }} />
          <Button ref={reviewButton} type="submit" aria-disabled={r.pending !== null || undefined}
            className="w-full bg-violet-600 text-white hover:bg-violet-700 aria-disabled:opacity-70 sm:w-auto">
            {r.pending === "review" && <Loader2 className="animate-spin" aria-hidden="true" />}
            Review
          </Button>
        </>
      )}
    </form>
  );
}

function InvoiceBuilder({ family, start, vat, today, onReviewing }: BuilderProps) {
  const router = useRouter();
  const f = useInvoiceForm(family, start);
  const r = useInvoiceReview({ onFormRefusal: f.showRefusal, go: (href) => router.push(href) });
  const { state } = r;
  const reviewButton = useRef<HTMLButtonElement>(null);
  useFormFocus(f, state.step, reviewButton);
  useEffect(() => onReviewing(state.step === "review"), [state.step, onReviewing]);
  if (state.step === "review" && state.preview && state.draft) {
    return (
      <ReviewStep preview={state.preview} draft={state.draft} notice={state.notice} pending={r.pending} setupIssues={state.setupIssues} setupRound={r.setupRound}
        onBack={r.back} onSend={r.send} onSaveSetup={r.saveSetup} />
    );
  }
  return <FormStep family={family} vat={vat} today={today} f={f} r={r} reviewButton={reviewButton} />;
}

/** No family yet: say so, and offer to invite one from her Children tab. */
function NoFamilies() {
  return (
    <div className={`${card} space-y-3`}>
      <p>You have no families to invoice yet.</p>
      <Button asChild variant="outline" size="sm" className="text-violet-700 hover:bg-violet-50 hover:text-violet-800">
        <Link href={ADD_FAMILY_HREF}>
          <Plus aria-hidden="true" />
          {ADD_FAMILY_LABEL}
        </Link>
      </Button>
    </div>
  );
}

/**
 * The picker sits outside the form, which is keyed by its family and starts afresh for each one: so picking a family
 * never remounts the picker, and her focus stays on it (code review M2). It hides while the review shows. The page's
 * target (a family from `?placement=` / `?connection=`, or a correction) is chosen to start with.
 */
function Body({ families, target, vat, today, loadFailed }: NewInvoiceClientProps) {
  const [reviewing, setReviewing] = useState(false);
  const onReviewing = useCallback((value: boolean) => setReviewing(value), []);
  const [chosen, setChosen] = useState(target?.familyKey ?? "");
  if (loadFailed) return <p className={card}>{INVOICE_ACTION_MESSAGES.error}</p>;
  if (families.length === 0) return <NoFamilies />;
  const family = families.find((f) => f.key === chosen);
  const start = target !== null && target.familyKey === chosen ? target : null;
  return (
    <div className="space-y-5">
      <div hidden={reviewing && family !== undefined}>
        <TargetPicker families={families} value={chosen} onChoose={setChosen} replaces={target?.replaces ?? null} />
      </div>
      {family && (
        <InvoiceBuilder key={`${family.key}:${start?.replaces?.invoiceId ?? ""}`} family={family} start={start} vat={vat} today={today}
          onReviewing={onReviewing} />
      )}
    </div>
  );
}

export function NewInvoiceClient(props: NewInvoiceClientProps) {
  const { target } = props;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/nanny/invoices" aria-label="Back to invoices"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">New invoice</h1>
      </div>
      {/* a new target from the server (another ?placement= or ?replaces=) starts the page again */}
      <Body key={target ? `${target.familyKey}:${target.replaces?.invoiceId ?? ""}` : ""} {...props} />
    </div>
  );
}
