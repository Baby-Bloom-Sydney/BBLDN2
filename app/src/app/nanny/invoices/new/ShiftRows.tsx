"use client";

/**
 * The invoice's shifts (plan 06 §14.6 b4.4; brief §0a A "add a shift … multiple shifts on the same day … different
 * rates … seamless and intuitive"; 06b-4 rework, BAI 2026-11-12: no week, each shift its own date): react-hook-form's
 * field array, one card per shift, under the "Childcare" heading — which shows only once there is a shift.
 *
 * - **Date:** a date input from the family's earliest date to London's today, blank until she picks one (the local
 *   check and the server refuse a date outside them, by field).
 * - **Hours** (quarter hours), **Rate** (pounds an hour, the family's rate to start with), an optional **Description**
 *   ("trial" goes there if she wants), and the line's **Amount** as she types.
 * - "Add another shift this day" adds a shift on the same date just after it; "Remove" removes it (focus to the row in
 *   its place, else "Add shift", which the form renders under the lines).
 * - Each card stacks its fields at 320 px and sits on one line from `md`. A field's problem shows under it
 *   (`aria-invalid`, `aria-describedby`) and goes as she types. The date registers first, so a new row's focus starts
 *   there.
 *
 * BB-wave1-041126/06b4, 2026-11-12; BB-wave1-041126/06b4-ui, 2026-11-12 (rework).
 */

import { useCallback, useEffect, useId, useState, type ReactNode, type RefObject } from "react";
import type { UseFieldArrayReturn, UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { INVOICE_RULES } from "@/config/invoices";
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

/** A section of lines under its heading, shown only once it has a line. */
export function LinesSection({ title, count, children }: { readonly title: string; readonly count: number; readonly children: ReactNode }) {
  const id = useId();
  if (count === 0) return null;
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="px-1 text-sm font-semibold text-slate-900">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export interface ShiftRowsProps {
  readonly form: UseFormReturn<InvoiceFormValues>;
  readonly rows: UseFieldArrayReturn<InvoiceFormValues, "shifts">;
  /** The family's earliest date and London's today: the dates she can pick. */
  readonly earliest: string;
  readonly today: string;
  /** A new row on a date, with the family's rate. */
  readonly newRow: (date: string) => ShiftRowValue;
  /** "Add shift": focus goes there when the last shift is removed. */
  readonly addButton: RefObject<HTMLButtonElement>;
}

type CardProps = Omit<ShiftRowsProps, "addButton"> & { readonly index: number; readonly value: ShiftRowValue; readonly onRemove: () => void };

function ShiftCard({ form, rows, newRow, earliest, today, index, value, onRemove }: CardProps) {
  const id = `${useId()}-shift`;
  const errors = form.formState.errors.shifts?.[index];
  const field = (name: keyof ShiftRowValue) => {
    const path = `shifts.${index}.${name}` as const;
    return { ...form.register(path, { onChange: () => form.clearErrors(path) }), ...invalidProps(`${id}-${name}`, errors?.[name]?.message), id: `${id}-${name}` };
  };
  const date = field("date"); // registered first: a new row's focus starts on its date
  return (
    <fieldset className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <legend className="sr-only">Shift {index + 1}</legend>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.7fr)_minmax(0,0.9fr)_minmax(0,2fr)]">
        <RowField id={`${id}-date`} label="Date" error={errors?.date?.message} className="col-span-2 md:col-span-1">
          <Input type="date" min={earliest} max={today} className={INVALID} {...date} />
        </RowField>
        <RowField id={`${id}-hours`} label="Hours" error={errors?.hours?.message}>
          <Input inputMode="decimal" className={INVALID} {...field("hours")} {...PRIVATE} />
        </RowField>
        <RowField id={`${id}-rate`} label="Rate" error={errors?.rate?.message}>
          <PoundsInput><Input inputMode="decimal" className={cn("pl-7", INVALID)} {...field("rate")} {...PRIVATE} /></PoundsInput>
        </RowField>
        <RowField id={`${id}-description`} label="Description" error={errors?.description?.message} className="col-span-2 md:col-span-1">
          <Input maxLength={INVOICE_RULES.text.descriptionMax} className={INVALID} {...field("description")} {...PRIVATE} />
        </RowField>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm"><span className="text-slate-500">Amount</span>{" "}<span className="font-medium tabular-nums text-slate-900">{lineAmountText(value)}</span></p>
        <div className="flex flex-wrap gap-1">
          <Button type="button" variant="ghost" size="sm" className="text-violet-700 hover:bg-violet-50 hover:text-violet-800" onClick={() => rows.insert(index + 1, newRow(value.date))}>
            Add another shift this day
          </Button>
          <Button type="button" variant="ghost" size="sm" className="text-slate-600" onClick={onRemove}>Remove</Button>
        </div>
      </div>
    </fieldset>
  );
}

/**
 * After a Remove, focus goes to the row that took its place (its first field), else to the add button — never lost to
 * the page (code review M2). Run after the removal has rendered.
 */
export function useFocusAfterRemove(focusRow: (index: number) => boolean, fallback: RefObject<HTMLButtonElement>) {
  const [removed, setRemoved] = useState<{ readonly index: number } | null>(null);
  useEffect(() => {
    if (removed === null) return;
    if (!focusRow(removed.index)) fallback.current?.focus();
    setRemoved(null);
  }, [removed, focusRow, fallback]);
  return (index: number) => setRemoved({ index });
}

export function ShiftRows({ addButton, ...props }: ShiftRowsProps) {
  const { form, rows } = props;
  const values = form.watch("shifts");
  const focusRow = useCallback((index: number) => {
    if (index >= form.getValues("shifts").length) return false;
    form.setFocus(`shifts.${index}.date`);
    return true;
  }, [form]);
  const removedAt = useFocusAfterRemove(focusRow, addButton);
  return (
    <LinesSection title="Childcare" count={rows.fields.length}>
      {rows.fields.map((field, index) => (
        <ShiftCard key={field.id} {...props} index={index} value={values[index] ?? field} onRemove={() => {
          rows.remove(index);
          removedAt(index);
        }} />
      ))}
    </LinesSection>
  );
}
