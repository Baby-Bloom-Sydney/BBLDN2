"use client";

/**
 * The invoice's expenses (plan 06 §14.3, §14.6 b4.4; brief §0a A "add expenses with a type section for details"): what
 * she bought for the child and the family repays at cost — a **Type** (Food, Activities, Travel, Supplies, Other), an
 * optional **Description** and the **Amount** in pounds. None to start with; "Add expense" adds one, "Remove" takes it
 * away. A card per expense, stacked at 320 px; a field's problem under it.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { useId } from "react";
import { Plus } from "lucide-react";
import type { UseFieldArrayReturn, UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EXPENSE_TYPES, INVOICE_RULES } from "@/config/invoices";
import { EXPENSE_TYPE_KEYS } from "@/lib/invoices/types";
import { LINE_MESSAGES } from "@/lib/invoices/validation-lines";
import { cn } from "@/lib/utils";
import type { InvoiceFormValues } from "./invoice-form";
import { INVALID, invalidProps, PoundsInput, RowField, SELECT } from "./ShiftRows";

export interface ExpenseRowsProps {
  readonly form: UseFormReturn<InvoiceFormValues>;
  readonly rows: UseFieldArrayReturn<InvoiceFormValues, "expenses">;
}

const NEW_EXPENSE = Object.freeze({ expenseType: "", amount: "", description: "" });

function ExpenseCard({ form, rows, index }: ExpenseRowsProps & { readonly index: number }) {
  const id = `${useId()}-expense`;
  const errors = form.formState.errors.expenses?.[index];
  const register = (name: "expenseType" | "amount" | "description") => {
    const path = `expenses.${index}.${name}` as const;
    return { ...form.register(path, { onChange: () => form.clearErrors(path) }), ...invalidProps(`${id}-${name}`, errors?.[name]?.message), id: `${id}-${name}` };
  };
  return (
    <fieldset className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <legend className="sr-only">Expense {index + 1}</legend>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)_minmax(0,0.9fr)]">
        <RowField id={`${id}-expenseType`} label="Type" error={errors?.expenseType?.message} className="col-span-2 md:col-span-1">
          <select className={cn(SELECT, INVALID)} {...register("expenseType")}>
            <option value="" disabled>{LINE_MESSAGES.expenseType}</option>
            {EXPENSE_TYPE_KEYS.map((type) => <option key={type} value={type}>{EXPENSE_TYPES[type]}</option>)}
          </select>
        </RowField>
        <RowField id={`${id}-description`} label="Description" error={errors?.description?.message} className="col-span-2 md:col-span-1">
          <Input maxLength={INVOICE_RULES.text.descriptionMax} autoComplete="off" className={INVALID} {...register("description")} />
        </RowField>
        <RowField id={`${id}-amount`} label="Amount" error={errors?.amount?.message}>
          <PoundsInput><Input inputMode="decimal" autoComplete="off" className={cn("pl-7", INVALID)} {...register("amount")} /></PoundsInput>
        </RowField>
        <div className="flex items-end justify-end md:col-span-3">
          <Button type="button" variant="ghost" size="sm" className="text-slate-600" onClick={() => rows.remove(index)}>Remove</Button>
        </div>
      </div>
    </fieldset>
  );
}

export function ExpenseRows({ form, rows }: ExpenseRowsProps) {
  return (
    <div className="space-y-3">
      {rows.fields.map((field, index) => <ExpenseCard key={field.id} form={form} rows={rows} index={index} />)}
      <Button type="button" variant="outline" size="sm" className="text-violet-700 hover:bg-violet-50 hover:text-violet-800" onClick={() => rows.append({ ...NEW_EXPENSE })}>
        <Plus aria-hidden="true" />
        Add expense
      </Button>
    </div>
  );
}
