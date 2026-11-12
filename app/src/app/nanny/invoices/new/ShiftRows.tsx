"use client";

/**
 * The invoice's shifts (plan 06 §14.6 b4.4; brief §0a A "add a shift … multiple shifts on the same day … different
 * rates … seamless and intuitive"): react-hook-form's field array, one card per shift.
 *
 * - **Date:** a `<select>` of the week's seven days ("Mon 8 Feb"), the days after London's today disabled, so a date
 *   outside the week can't be picked; a Trial Shift's date is fixed (shown, not chosen).
 * - **Hours** (quarter hours), **Rate** (pounds an hour, her rate to start with), an optional **Description**, and the
 *   line's **Amount** as she types.
 * - "Add another shift this day" adds a shift on the same date just after it; "Remove" removes it; "Add shift" adds one
 *   on the next day that has happened.
 * - Each card stacks its fields at 320 px and sits on one line from `md`. A field's problem shows under it
 *   (`aria-invalid`, `aria-describedby`) and goes as she types.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { useId, type ReactNode } from "react";
import { Plus } from "lucide-react";
import type { UseFieldArrayReturn, UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { INVOICE_RULES } from "@/config/invoices";
import { dayLabel } from "@/lib/invoices/week";
import { cn } from "@/lib/utils";
import { lineAmountText, type InvoiceFormValues, type ShiftRowValue } from "./invoice-form";

/** The rose ring of a refused field (the Settings fields' rule). */
export const INVALID = "aria-[invalid=true]:border-rose-600 aria-[invalid=true]:focus-visible:ring-rose-600";
export const SELECT = "flex h-9 w-full rounded-md border border-input bg-white px-3 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm";
const PRIVATE = { autoComplete: "off", spellCheck: false } as const;

/** One labelled field of a row, its problem under it. */
export function RowField({ id, label, error, className, children }: { readonly id: string; readonly label: string; readonly error?: string; readonly className?: string; readonly children: ReactNode }) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <Label htmlFor={id} className="text-xs text-slate-600">{label}</Label>
      {children}
      {error && <p id={`${id}-error`} className="text-xs font-medium text-rose-600">{error}</p>}
    </div>
  );
}

/** A refused field's wiring. */
export const invalidProps = (id: string, error: string | undefined) =>
  error ? ({ "aria-invalid": true, "aria-describedby": `${id}-error` } as const) : ({} as const);

/** "£" before an amount in pounds. */
export function PoundsInput({ children }: { readonly children: ReactNode }) {
  return (
    <div className="relative">
      <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">£</span>
      {children}
    </div>
  );
}

export interface ShiftRowsProps {
  readonly form: UseFormReturn<InvoiceFormValues>;
  readonly rows: UseFieldArrayReturn<InvoiceFormValues, "shifts">;
  /** The week's seven days, Monday first (unused for a Trial Shift). */
  readonly days: readonly string[];
  /** A Trial Shift's date: fixed. */
  readonly fixedDate: string | null;
  readonly today: string;
  /** A new row on a date, with her rate. */
  readonly newRow: (date: string) => ShiftRowValue;
}

function DateControl({ id, index, form, days, fixedDate, today, error }: Pick<ShiftRowsProps, "form" | "days" | "fixedDate" | "today"> & { readonly id: string; readonly index: number; readonly error?: string }) {
  if (fixedDate !== null) return <p className="flex h-9 items-center text-sm font-medium text-slate-900">{dayLabel(fixedDate)}</p>;
  const name = `shifts.${index}.date` as const;
  return (
    <select id={id} className={cn(SELECT, INVALID)} {...invalidProps(id, error)} {...form.register(name, { onChange: () => form.clearErrors(name) })}>
      {days.map((day) => <option key={day} value={day} disabled={day > today}>{dayLabel(day)}</option>)}
    </select>
  );
}

function ShiftCard({ index, value, ...props }: ShiftRowsProps & { readonly index: number; readonly value: ShiftRowValue }) {
  const { form, rows, newRow } = props;
  const id = `${useId()}-shift`;
  const errors = form.formState.errors.shifts?.[index];
  const field = (name: "hours" | "rate" | "description") => {
    const path = `shifts.${index}.${name}` as const;
    return { ...form.register(path, { onChange: () => form.clearErrors(path) }), ...PRIVATE, ...invalidProps(`${id}-${name}`, errors?.[name]?.message), id: `${id}-${name}` };
  };
  return (
    <fieldset className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <legend className="sr-only">Shift {index + 1}</legend>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.7fr)_minmax(0,0.9fr)_minmax(0,2fr)]">
        <RowField id={`${id}-date`} label="Date" error={errors?.date?.message} className="col-span-2 md:col-span-1">
          <DateControl {...props} id={`${id}-date`} index={index} error={errors?.date?.message} />
        </RowField>
        <RowField id={`${id}-hours`} label="Hours" error={errors?.hours?.message}>
          <Input inputMode="decimal" className={INVALID} {...field("hours")} />
        </RowField>
        <RowField id={`${id}-rate`} label="Rate" error={errors?.rate?.message}>
          <PoundsInput><Input inputMode="decimal" className={cn("pl-7", INVALID)} {...field("rate")} /></PoundsInput>
        </RowField>
        <RowField id={`${id}-description`} label="Description" error={errors?.description?.message} className="col-span-2 md:col-span-1">
          <Input maxLength={INVOICE_RULES.text.descriptionMax} className={INVALID} {...field("description")} />
        </RowField>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm"><span className="text-slate-500">Amount</span>{" "}<span className="font-medium tabular-nums text-slate-900">{lineAmountText(value)}</span></p>
        <div className="flex flex-wrap gap-1">
          <Button type="button" variant="ghost" size="sm" className="text-violet-700 hover:bg-violet-50 hover:text-violet-800" onClick={() => rows.insert(index + 1, newRow(value.date))}>
            Add another shift this day
          </Button>
          <Button type="button" variant="ghost" size="sm" className="text-slate-600" onClick={() => rows.remove(index)}>Remove</Button>
        </div>
      </div>
    </fieldset>
  );
}

/** The next day after the last row's that has happened, else the last row's day (a Trial Shift's: its date). */
function nextDate(values: readonly ShiftRowValue[], days: readonly string[], fixedDate: string | null, today: string): string {
  if (fixedDate !== null) return fixedDate;
  const last = values.at(-1)?.date;
  if (last === undefined) return days[0] ?? today;
  const next = days[days.indexOf(last) + 1];
  return next !== undefined && next <= today ? next : last;
}

export function ShiftRows(props: ShiftRowsProps) {
  const values = props.form.watch("shifts");
  return (
    <div className="space-y-3">
      {props.rows.fields.map((field, index) => (
        <ShiftCard key={field.id} {...props} index={index} value={values[index] ?? field} />
      ))}
      <Button type="button" variant="outline" size="sm" className="text-violet-700 hover:bg-violet-50 hover:text-violet-800"
        onClick={() => props.rows.append(props.newRow(nextDate(values, props.days, props.fixedDate, props.today)))}>
        <Plus aria-hidden="true" />
        Add shift
      </Button>
    </div>
  );
}
