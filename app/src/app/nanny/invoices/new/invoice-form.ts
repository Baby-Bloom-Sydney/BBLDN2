/**
 * The new-invoice form's model (plan 06 §14.3, §14.5, §14.6 b4.4; brief §0a A, §3 nanny 3–5; 06b-4 rework, BAI
 * 2026-11-12: "we can deduce this from their earliest and latest date"; "start off with a short and simple, button …
 * to add shift or add expense"). Pure and client-safe: the form holds what she types as text; this turns it into the
 * draft the actions take, works out the live totals with the one calculator (`totals.ts`) and checks the draft before
 * the server is asked.
 *
 * - **Money** is typed in pounds (with or without a pound sign, pence and thousands commas) and becomes whole pence
 *   with no float maths; anything else is NaN, which the shared schema refuses with its plain message (never echoing
 *   what she typed).
 * - **The draft:** the family's link id, shifts then expenses in her order (the PDF prints shifts by date), and any
 *   correction. No kind and no period: the server works them out from the family and the dates (ledger reading 5).
 * - **Live totals** count only the rows that are complete (the shared line schemas), so nothing throws while she
 *   types; VAT is hers (from her Settings, read by the page). The server works every figure out again.
 * - **Rows:** a new shift starts with the date given (blank from "Add shift"), hours blank and the family's rate; a
 *   correction starts from its own lines, each with its own date.
 * - **The local check:** the shared schema, then any shift dated before the family's earliest date (`tooEarly`, as the
 *   server's `too_early`), by field. Refusals come by path ("lines.2.hours"); `formIssues` maps them onto her rows.
 *
 * BB-wave1-041126/06b4, 2026-11-12; BB-wave1-041126/06b4-ui, 2026-11-12 (rework: no week, no kind, start empty).
 */

import { NO_PENCE } from "@/config/invoices";
import { draftRefusal, tooEarlyRefusal, type InvoiceActionRefusal } from "@/lib/invoices/actions/invoice-messages";
import { formatInvoiceMoney } from "@/lib/invoices/money";
import type { PrefillExpense, PrefillShift } from "@/lib/invoices/prefill";
import { invoiceTotals, lineAmountPence, type InvoiceTotals, type VatSetting } from "@/lib/invoices/totals";
import { expenseLineSchema, invoiceDraftSchema, shiftLineSchema } from "@/lib/invoices/validation-lines";
import { isLondonDate } from "@/lib/invoices/week";

const PENCE_PER_POUND = 100;
const NO_AMOUNT = "—";
/** The schema needs an invoice id; the local check uses this one and the server mints its own (it ignores the client's). */
const LOCAL_CHECK_ID = "00000000-0000-4000-8000-000000000000";

export interface ShiftRowValue {
  date: string;
  hours: string;
  rate: string;
  description: string;
}

export interface ExpenseRowValue {
  expenseType: string;
  amount: string;
  description: string;
}

export interface InvoiceFormValues {
  shifts: ShiftRowValue[];
  expenses: ExpenseRowValue[];
}

/** What the draft is for: the header the form doesn't edit as rows. */
export interface DraftHeader {
  /** The family's link id (`FamilyOption.targetId`). */
  readonly targetId: string;
  readonly replacesInvoiceId: string | null;
}

export type DraftLine =
  | { readonly kind: "shift"; readonly date: string; readonly hours: number; readonly ratePence: number; readonly description: string }
  | { readonly kind: "expense"; readonly expenseType: string; readonly amountPence: number; readonly description: string };

export interface FormDraft extends DraftHeader {
  readonly lines: readonly DraftLine[];
}

/** A family she can invoice, as the picker holds it: client-safe, no family id. */
export interface FamilyOption {
  readonly key: string;
  readonly familyName: string;
  readonly area: string | null;
  /** The family's link id, which the draft sends. */
  readonly targetId: string;
  /** The first date she can invoice this family for ("YYYY-MM-DD"); London's today is the last. */
  readonly earliest: string;
  /** Her rate for a new shift row, in pence; null = blank. */
  readonly ratePence: number | null;
}

/** What the page opens on: the family chosen (by its option's key) and, for a correction, its lines. */
export interface InvoiceTargetView {
  readonly familyKey: string;
  readonly shifts: readonly ShiftRowValue[];
  readonly expenses: readonly ExpenseRowValue[];
  /** The cancelled invoice this one corrects: the family is then fixed. */
  readonly replaces: { readonly invoiceId: string; readonly number: string } | null;
}

const MONEY = /^£?\s*(\d{1,7})(?:\.(\d{1,2}))?$/;
const THOUSANDS = /^£?\s*\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/;

/** Pounds as she types them, in whole pence; NaN when it isn't an amount in pounds and pence. */
export function penceOfPounds(text: string): number {
  const trimmed = text.trim();
  const plain = THOUSANDS.test(trimmed) ? trimmed.replace(/,/g, "") : trimmed;
  const m = MONEY.exec(plain);
  if (!m) return Number.NaN;
  return Number(m[1]) * PENCE_PER_POUND + Number((m[2] ?? "").padEnd(2, "0"));
}

/** Pence as the field shows them ("18.00"); "" for none. */
export function poundsOfPence(pence: number | null): string {
  if (pence === null || !Number.isSafeInteger(pence) || pence < 0) return "";
  return `${Math.trunc(pence / PENCE_PER_POUND)}.${String(pence % PENCE_PER_POUND).padStart(2, "0")}`;
}

/** Plain decimal hours ("8", "7.75", ".25"): never an exponent, hex, binary or sign that `Number` would read. */
const PLAIN_HOURS = /^(?:\d{1,3}(?:\.\d{1,6})?|\.\d{1,6})$/;

/** Hours as typed; NaN when blank or not plain decimal hours (the schema then says "Enter the hours worked"). */
const hoursOf = (text: string): number => (PLAIN_HOURS.test(text.trim()) ? Number(text.trim()) : Number.NaN);

const shiftLine = (s: ShiftRowValue): DraftLine => ({ kind: "shift", date: s.date, hours: hoursOf(s.hours), ratePence: penceOfPounds(s.rate), description: s.description });
const expenseLine = (e: ExpenseRowValue): DraftLine => ({ kind: "expense", expenseType: e.expenseType, amountPence: penceOfPounds(e.amount), description: e.description });

/** The draft the actions take: the family, shifts then expenses in her order, any correction. */
export function draftOf(header: DraftHeader, values: InvoiceFormValues): FormDraft {
  return { targetId: header.targetId, replacesInvoiceId: header.replacesInvoiceId, lines: [...values.shifts.map(shiftLine), ...values.expenses.map(expenseLine)] };
}

/** A new shift row: the date given ("" from "Add shift"), hours blank, the family's rate. */
export function newShiftRow(date: string, ratePence: number | null): ShiftRowValue {
  return { date, hours: "", rate: poundsOfPence(ratePence), description: "" };
}

/** A correction's lines as her rows (`correctionPrefill`'s), each shift with its own date. */
export function correctionRows(prefill: { readonly shifts: readonly PrefillShift[]; readonly expenses: readonly PrefillExpense[] }): {
  readonly shifts: readonly ShiftRowValue[];
  readonly expenses: readonly ExpenseRowValue[];
} {
  return {
    shifts: prefill.shifts.map((s) => ({ date: s.date, hours: s.hours === null ? "" : String(s.hours), rate: poundsOfPence(s.ratePence), description: s.description ?? "" })),
    expenses: prefill.expenses.map((e) => ({ expenseType: e.expenseType, amount: poundsOfPence(e.amountPence), description: e.description ?? "" })),
  };
}

/** The complete lines only, for the live totals. */
function completeLines(values: InvoiceFormValues) {
  const shifts = values.shifts.flatMap((s) => {
    const parsed = shiftLineSchema.safeParse(shiftLine(s));
    return parsed.success ? [{ kind: "shift" as const, hours: parsed.data.hours, ratePence: parsed.data.ratePence }] : [];
  });
  const expenses = values.expenses.flatMap((e) => {
    const parsed = expenseLineSchema.safeParse(expenseLine(e));
    return parsed.success ? [{ kind: "expense" as const, amountPence: parsed.data.amountPence }] : [];
  });
  return [...shifts, ...expenses];
}

const NO_TOTALS: InvoiceTotals = Object.freeze({
  hours: 0, shiftsPence: NO_PENCE, expensesPence: NO_PENCE, vatPence: NO_PENCE, netShiftsPence: NO_PENCE, totalPence: NO_PENCE,
});

/** The totals as she types (14.5), over the complete rows, with her VAT setting. */
export function liveTotals(values: InvoiceFormValues, vat: VatSetting): InvoiceTotals {
  try {
    return invoiceTotals(completeLines(values), vat);
  } catch {
    return NO_TOTALS;
  }
}

/** One shift's amount, or a dash while it isn't complete. */
export function lineAmountText(row: ShiftRowValue): string {
  const parsed = shiftLineSchema.safeParse(shiftLine(row));
  return parsed.success ? formatInvoiceMoney(lineAmountPence(parsed.data.hours, parsed.data.ratePence)) : NO_AMOUNT;
}

const SHIFT_FIELDS: Readonly<Record<string, keyof ShiftRowValue>> = { date: "date", hours: "hours", ratePence: "rate", description: "description" };
const EXPENSE_FIELDS: Readonly<Record<string, keyof ExpenseRowValue>> = { expenseType: "expenseType", amountPence: "amount", description: "description" };

/** A line's path ("lines.2.hours") as her row's field ("expenses.0.amount"); null for anything else. */
function rowField(path: string, shiftCount: number): string | null {
  const m = /^lines\.(\d+)(?:\.(\w+))?$/.exec(path);
  if (!m) return null;
  const index = Number(m[1]);
  const field = m[2] ?? "";
  if (index < shiftCount) return `shifts.${index}.${SHIFT_FIELDS[field] ?? "date"}`;
  return `expenses.${index - shiftCount}.${EXPENSE_FIELDS[field] ?? "expenseType"}`;
}

export interface FormIssues {
  /** The first refusal that names no row ("Add a shift or an expense"). */
  readonly form: string | null;
  /** Her rows' fields → their messages. */
  readonly fields: Readonly<Record<string, string>>;
}

/** A refusal's fields (by path) onto her rows and the form. */
export function formIssues(byPath: Readonly<Record<string, string>>, shiftCount: number): FormIssues {
  return Object.entries(byPath).reduce<FormIssues>((found, [path, message]) => {
    const field = rowField(path, shiftCount);
    if (field !== null) return Object.hasOwn(found.fields, field) ? found : { ...found, fields: { ...found.fields, [field]: message } };
    return found.form === null ? { ...found, form: message } : found;
  }, { form: null, fields: {} });
}

/** The indexes of shifts dated (a real date) before the family's earliest date. */
const tooEarlyIndexes = (draft: FormDraft, earliest: string): number[] =>
  draft.lines.flatMap((line, i) => (line.kind === "shift" && isLondonDate(line.date) && line.date < earliest ? [i] : []));

/** A field path's place on the page: its line, then a line's date before its other fields ("lines" → first). */
function placeOf(path: string): readonly [number, number] {
  const m = /^lines\.(\d+)(\.date)?/.exec(path);
  return m ? [Number(m[1]), m[2] ? 0 : 1] : [-1, 0];
}

/** Fields in page order, so the first one is the first she sees (focus goes there). */
function inPageOrder(fields: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const entries = Object.entries(fields).sort(([a], [b]) => {
    const [la, fa] = placeOf(a);
    const [lb, fb] = placeOf(b);
    return la - lb || fa - fb;
  });
  return Object.fromEntries(entries);
}

/**
 * The shared schema on her draft, then the family's earliest date, before the server is asked (the server checks both
 * again): null when it passes. A field the schema refused keeps the schema's message.
 */
export function localCheck(draft: FormDraft, now: Date, earliest: string): InvoiceActionRefusal | null {
  const parsed = invoiceDraftSchema(now).safeParse({ ...draft, invoiceId: LOCAL_CHECK_ID });
  const early = tooEarlyIndexes(draft, earliest);
  if (parsed.success) return early.length === 0 ? null : tooEarlyRefusal(early);
  const refusal = draftRefusal(parsed.error);
  const tooEarly = early.length === 0 ? {} : tooEarlyRefusal(early).fields;
  return { ...refusal, fields: inPageOrder({ ...tooEarly, ...refusal.fields }) };
}
