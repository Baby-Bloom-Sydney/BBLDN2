"use client";

/**
 * The fields the Business dialogs share (b3.3): a labelled text input or text area, and a native radio choice (plan
 * 14.6: no radio-group component). Each wires its hint and its plain error to the control (`aria-describedby`) and
 * marks a refused control `aria-invalid`. The design system's `Input`, `Textarea` and `Label`; violet focus and
 * checked states, rose for errors (brief §7).
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */

import type { InputHTMLAttributes, ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const INVALID = "aria-[invalid=true]:border-rose-400 aria-[invalid=true]:focus-visible:ring-rose-400";

type InputExtras = Pick<InputHTMLAttributes<HTMLInputElement>, "autoComplete" | "inputMode" | "maxLength" | "placeholder" | "spellCheck">;

export interface TextFieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly hint?: ReactNode;
  readonly error?: string;
  /** A text area (an address) instead of one line. */
  readonly multiline?: boolean;
  readonly input?: InputExtras;
}

const describedBy = (id: string, hint: boolean, error: boolean): string | undefined =>
  [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter((x) => x !== null).join(" ") || undefined;

export function TextField({ id, label, value, onChange, hint, error, multiline = false, input }: TextFieldProps) {
  const control = {
    id,
    value,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy(id, hint !== undefined, error !== undefined),
    className: INVALID,
  } as const;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {multiline ? (
        <Textarea {...control} rows={4} placeholder={input?.placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input {...control} {...input} onChange={(e) => onChange(e.target.value)} />
      )}
      {hint !== undefined && (
        <p id={`${id}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-rose-600">
          {error}
        </p>
      )}
    </div>
  );
}

export interface RadioChoiceProps {
  readonly name: string;
  readonly value: string;
  readonly checked: boolean;
  readonly onSelect: () => void;
  readonly label: string;
  readonly hint?: string;
}

/** One native radio on a bordered row; the whole row is its label, so the tap target is the row. */
export function RadioChoice({ name, value, checked, onSelect, label, hint }: RadioChoiceProps) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
        checked ? "border-violet-300 bg-violet-50/60" : "border-slate-200 hover:bg-slate-50",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onSelect}
        className="mt-0.5 h-4 w-4 shrink-0 accent-violet-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-900">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

/** A labelled group of radios. */
export function RadioGroupFieldset({ legend, children }: { readonly legend: string; readonly children: ReactNode }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium text-slate-900">{legend}</legend>
      {children}
    </fieldset>
  );
}

/** The dialog's fields, scrolling inside it when a small screen can't fit them, so Save stays in reach. */
export function DialogFields({ children }: { readonly children: ReactNode }) {
  return <div className="-mx-1 max-h-[60dvh] space-y-4 overflow-y-auto px-1 py-1">{children}</div>;
}
