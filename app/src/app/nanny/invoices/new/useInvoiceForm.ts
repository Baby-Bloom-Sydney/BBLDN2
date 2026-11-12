"use client";

/**
 * The new-invoice form's state (plan 06 §14.3, §14.6 b4.4): react-hook-form with one field array for the shifts and one
 * for the expenses, the week she's invoicing, and the refusals shown on it.
 *
 * - **Starts** from the target: her usual week laid on the week shown first (or the Trial Shift's date), a correction's
 *   lines and expenses (`invoice-form.ts`).
 * - **Another week** lays her usual week on it again (her shifts start over; expenses stay).
 * - **A refusal** (the shared schema's, or the server's) by path lands under her fields — focus to the first — and the
 *   message that names no field shows above the button ("Please check the details marked below." otherwise).
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { useState } from "react";
import { useFieldArray, useForm, type FieldPath } from "react-hook-form";
import type { InvoiceActionRefusal } from "@/lib/invoices/actions/invoice-messages";
import {
  formIssues,
  poundsOfPence,
  shiftsForWeek,
  type DraftHeader,
  type InvoiceFormValues,
  type InvoiceTargetView,
  type ShiftRowValue,
} from "./invoice-form";

const SHIFT_FIELDS = ["date", "hours", "rate", "description"] as const;
const EXPENSE_FIELDS = ["expenseType", "amount", "description"] as const;

/** "shifts.1.hours" as the form's own field path; null for anything else. */
function fieldPath(key: string): FieldPath<InvoiceFormValues> | null {
  const m = /^(shifts|expenses)\.(\d+)\.(\w+)$/.exec(key);
  if (!m) return null;
  const index = Number(m[2]);
  if (m[1] === "shifts") {
    const field = SHIFT_FIELDS.find((f) => f === m[3]);
    return field ? `shifts.${index}.${field}` : null;
  }
  const field = EXPENSE_FIELDS.find((f) => f === m[3]);
  return field ? `expenses.${index}.${field}` : null;
}

export function useInvoiceForm(target: InvoiceTargetView, today: string) {
  const form = useForm<InvoiceFormValues>({
    defaultValues: {
      shifts: shiftsForWeek(target.pattern, target.periodStart, today, target.ratePence),
      expenses: target.expenses.map((e) => ({ ...e })),
    },
  });
  const shifts = useFieldArray({ control: form.control, name: "shifts" });
  const expenses = useFieldArray({ control: form.control, name: "expenses" });
  const [periodStart, setPeriodStart] = useState(target.periodStart);
  const [message, setMessage] = useState<string | null>(null);

  const setWeek = (monday: string) => {
    setPeriodStart(monday);
    shifts.replace(shiftsForWeek(target.pattern, monday, today, target.ratePence));
    form.clearErrors();
    setMessage(null);
  };

  const showRefusal = (refusal: Pick<InvoiceActionRefusal, "message" | "fields">) => {
    const issues = formIssues(refusal.fields ?? {}, form.getValues("shifts").length);
    form.clearErrors();
    Object.entries(issues.fields).forEach(([key, text], i) => {
      const path = fieldPath(key);
      if (path) form.setError(path, { type: "refused", message: text }, { shouldFocus: i === 0 });
    });
    setMessage(issues.form ?? refusal.message);
  };

  const header: DraftHeader = { kind: target.kind, targetId: target.targetId, periodStart, replacesInvoiceId: target.replaces?.invoiceId ?? null };
  const newShift = (date: string): ShiftRowValue => ({ date, hours: "", rate: poundsOfPence(target.ratePence), description: "" });
  return { form, shifts, expenses, periodStart, setWeek, header, message, setMessage, showRefusal, newShift };
}
