"use client";

/**
 * The new-invoice form's state (plan 06 §14.3, §14.6 b4.4; 06b-4 rework, BAI 2026-11-12: start empty): react-hook-form
 * with one field array for the shifts and one for the expenses, for one family, and the refusals shown on it.
 *
 * - **Starts empty** — or, for a correction, from its own lines (`invoice-form.ts`). The form is keyed by its family,
 *   so another family starts afresh (rates belong to a family).
 * - **A new shift** carries the family's rate; the draft carries the family's link id and any correction.
 * - **A refusal** (the shared schema's, the earliest date's, or the server's) by path lands under her fields and the
 *   message that names no field shows above the button ("Please check the details marked below." otherwise). The
 *   first refused field is focused once the form is on screen (`focusTo`; a refusal from Send arrives while the review
 *   is showing).
 *
 * BB-wave1-041126/06b4, 2026-11-12; BB-wave1-041126/06b4-ui, 2026-11-12 (rework).
 */

import { useCallback, useState } from "react";
import { useFieldArray, useForm, type FieldPath } from "react-hook-form";
import type { InvoiceActionRefusal } from "@/lib/invoices/actions/invoice-messages";
import {
  formIssues,
  newShiftRow,
  type DraftHeader,
  type FamilyOption,
  type InvoiceFormValues,
  type InvoiceTargetView,
  type ShiftRowValue,
} from "./invoice-form";

/** What the form starts from: nothing, or a correction's lines and what it replaces. */
export type FormStart = Omit<InvoiceTargetView, "familyKey">;

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

export function useInvoiceForm(family: FamilyOption, start: FormStart | null) {
  const form = useForm<InvoiceFormValues>({
    defaultValues: {
      shifts: (start?.shifts ?? []).map((s) => ({ ...s })),
      expenses: (start?.expenses ?? []).map((e) => ({ ...e })),
    },
  });
  const shifts = useFieldArray({ control: form.control, name: "shifts" });
  const expenses = useFieldArray({ control: form.control, name: "expenses" });
  const [message, setMessage] = useState<string | null>(null);

  /** The field to focus once the form is on screen (a refusal can arrive while the review is showing). */
  const [focusTo, setFocusTo] = useState<{ readonly path: FieldPath<InvoiceFormValues> } | null>(null);
  const focused = useCallback(() => setFocusTo(null), []);

  const showRefusal = (refusal: Pick<InvoiceActionRefusal, "message" | "fields">) => {
    const issues = formIssues(refusal.fields ?? {}, form.getValues("shifts").length);
    form.clearErrors();
    const paths = Object.entries(issues.fields).flatMap(([key, text]) => {
      const path = fieldPath(key);
      if (path) form.setError(path, { type: "refused", message: text });
      return path ? [path] : [];
    });
    setFocusTo(paths[0] ? { path: paths[0] } : null);
    setMessage(issues.form ?? refusal.message);
  };

  const header: DraftHeader = { targetId: family.targetId, replacesInvoiceId: start?.replaces?.invoiceId ?? null };
  const newShift = (date: string): ShiftRowValue => newShiftRow(date, family.ratePence);
  return { form, shifts, expenses, header, message, setMessage, showRefusal, newShift, focusTo, focused };
}
