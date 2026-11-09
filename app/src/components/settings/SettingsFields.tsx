"use client";

/**
 * The fields an editable Settings page shows in place of its rows (06b-3 rework, ledger B06 §9.1 R1), moved from the
 * Business section's dialogs (06b-3 `form-fields.tsx`) so Profile, Contact details and Business share one copy:
 * - `TextField`: a labelled input or text area; its hint and its plain error wired to it (`aria-describedby`), a
 *   refused one marked `aria-invalid`;
 * - `RadioChoice` / `RadioGroupFieldset`: native radios on bordered rows (Settings has no radio component), with an
 *   optional small grey suffix after the label (BAI: "(Recommended)");
 * - `EditRow`: one field in the card's row rhythm, so edit mode keeps the view's layout.
 * The design system's `Input`, `Textarea` and `Label`; violet focus and checked states, rose for errors.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07 (as `form-fields.tsx`); BB-wave1-041126/06b3-rework, 2026-11-09.
 */

import { type InputHTMLAttributes, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const INVALID = "aria-[invalid=true]:border-rose-400 aria-[invalid=true]:focus-visible:ring-rose-400";

type InputExtras = Pick<InputHTMLAttributes<HTMLInputElement>, "autoComplete" | "inputMode" | "maxLength" | "placeholder" | "spellCheck" | "type"> &
  Readonly<Partial<Record<`data-${string}`, string>>>;

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
        // 16 px on a phone, as `Input` is, so iOS doesn't zoom on focus (06b-3 React review M5)
        <Textarea {...control} className={`${INVALID} text-base md:text-sm`} rows={4} placeholder={input?.placeholder}
          onChange={(e) => onChange(e.target.value)} />
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
  /** Small grey text after the label, e.g. "(Recommended)". */
  readonly suffix?: string;
}

/** One native radio on a bordered row; the whole row is its label, so the tap target is the row. */
export function RadioChoice({ name, value, checked, onSelect, label, suffix }: RadioChoiceProps) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
        checked ? "border-violet-300 bg-violet-50/60" : "border-slate-200 bg-white hover:bg-slate-50",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onSelect}
        className="h-4 w-4 shrink-0 accent-violet-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
      />
      <span className="min-w-0 text-sm font-medium text-slate-900">
        {label}
        {suffix && <>{" "}<span className="font-normal text-slate-500">{suffix}</span></>}
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

/** One field in a Settings card, in the rows' rhythm. */
export function EditRow({ children, isLast = false }: { readonly children: ReactNode; readonly isLast?: boolean }) {
  return <div className={cn("px-4 py-3", !isLast && "border-b border-slate-100")}>{children}</div>;
}
