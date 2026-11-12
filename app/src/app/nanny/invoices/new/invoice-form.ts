/**
 * The new-invoice form's model (plan 06 §14.3, §14.5, §14.6 b4.4; brief §0a A, §3 nanny 3–5). Pure and client-safe:
 * the form holds what she types as text; this turns it into the draft the actions take, works out the live totals
 * with the one calculator (`totals.ts`), lists the weeks she can pick and lays her usual week on the one she picks.
 *
 * - **Money** is typed in pounds (with or without a pound sign, pence and thousands commas) and becomes whole pence
 *   with no float maths;
 *   anything else is NaN, which the shared schema refuses with its plain message (never echoing what she typed).
 * - **The draft:** shifts, then expenses, each in her order — the order her PDF prints them.
 * - **Live totals** count only the rows that are complete (the shared line schemas), so nothing throws while she
 *   types; VAT is hers (from her Settings, read by the page). The server works every figure out again.
 * - **Weeks:** this London week back to the placement's first week, at most `WEEKS_SHOWN`, newest first; a
 *   correction's week is always offered. Future weeks are never offered; future days are disabled in the form.
 * - **Pre-fill for a week** (plan 14.3, as `prefill.ts` makes it for one week): her usual pattern — weekday, hours,
 *   rate, description — laid on the chosen week; days after London's today dropped; none left → one row on the
 *   Monday with the hours blank and her rate. The page gets the pattern from last week's pre-fill (a week with no
 *   future day), so every week she picks starts from the same pattern.
 * - **Refusals** come by path ("lines.2.hours"); `formIssues` maps them onto her rows ("expenses.0.amount").
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { NO_PENCE } from "@/config/invoices";
import { draftRefusal, type InvoiceActionRefusal } from "@/lib/invoices/actions/invoice-messages";
import { formatInvoiceMoney } from "@/lib/invoices/money";
import type { PrefillShift } from "@/lib/invoices/prefill";
import { invoiceTotals, lineAmountPence, type InvoiceTotals, type VatSetting } from "@/lib/invoices/totals";
import type { InvoiceKind } from "@/lib/invoices/types";
import { expenseLineSchema, invoiceDraftSchema, shiftLineSchema } from "@/lib/invoices/validation-lines";
import { isLondonDate, isLondonMonday } from "@/lib/invoices/week";
import { addLondonDays, londonMondayOf } from "@/lib/timezone";

/** The weeks a Regular week can be picked from, counting this one. */
export const WEEKS_SHOWN = 26;
const PENCE_PER_POUND = 100;
const DAY_MS = 86_400_000;
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

/** Her usual shift, as a weekday of any week (0 = Monday; a Trial Shift's is 0 from its date). */
export interface PatternShift {
  readonly offset: number;
  readonly hours: number | null;
  readonly ratePence: number | null;
  readonly description: string | null;
}

/** What the draft is for: the header the form doesn't edit as rows. */
export interface DraftHeader {
  readonly kind: InvoiceKind;
  readonly targetId: string;
  readonly periodStart: string;
  readonly replacesInvoiceId: string | null;
}

export type DraftLine =
  | { readonly kind: "shift"; readonly date: string; readonly hours: number; readonly ratePence: number; readonly description: string }
  | { readonly kind: "expense"; readonly expenseType: string; readonly amountPence: number; readonly description: string };

export interface FormDraft extends DraftHeader {
  readonly lines: readonly DraftLine[];
}

/** A family she can invoice, as the picker shows it. */
export interface FamilyOption {
  readonly key: string;
  readonly familyName: string;
  readonly area: string | null;
  /** The placement a Regular week for this family uses; null = Trial Shifts only. */
  readonly placementId: string | null;
  readonly trials: readonly { readonly connectionId: string; readonly date: string }[];
}

/** The invoice the form starts from. */
export interface InvoiceTargetView {
  readonly kind: InvoiceKind;
  readonly targetId: string;
  readonly familyKey: string;
  readonly familyName: string;
  readonly area: string | null;
  /** A Regular week's Mondays she can pick, newest first; [] for a Trial Shift. */
  readonly weeks: readonly string[];
  /** The Monday shown first, or the Trial Shift's date. */
  readonly periodStart: string;
  readonly pattern: readonly PatternShift[];
  readonly expenses: readonly ExpenseRowValue[];
  /** Her rate for a new row. */
  readonly ratePence: number | null;
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

/** Hours as typed ("7.75"); NaN when blank or not a number. */
const hoursOf = (text: string): number => (text.trim() === "" ? Number.NaN : Number(text.trim()));

const shiftLine = (s: ShiftRowValue): DraftLine => ({ kind: "shift", date: s.date, hours: hoursOf(s.hours), ratePence: penceOfPounds(s.rate), description: s.description });
const expenseLine = (e: ExpenseRowValue): DraftLine => ({ kind: "expense", expenseType: e.expenseType, amountPence: penceOfPounds(e.amount), description: e.description });

/** The draft the actions take: shifts then expenses, in her order. */
export function draftOf(header: DraftHeader, values: InvoiceFormValues): FormDraft {
  return { ...header, lines: [...values.shifts.map(shiftLine), ...values.expenses.map(expenseLine)] };
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

/** The Mondays she can pick: this week back to the placement's first week (at most `WEEKS_SHOWN`), newest first. */
export function weekOptions(input: { readonly today: string; readonly startDate: string | null; readonly include: string | null }): readonly string[] {
  const current = londonMondayOf(input.today);
  const first = input.startDate !== null && isLondonDate(input.startDate) ? londonMondayOf(input.startDate) : null;
  const weeks: string[] = [];
  for (let i = 0; i < WEEKS_SHOWN; i += 1) {
    const week = addLondonDays(current, -7 * i);
    if (i > 0 && first !== null && week < first) break;
    weeks.push(week);
  }
  const extra = input.include;
  const offered = extra !== null && isLondonMonday(extra) && extra <= current && !weeks.includes(extra);
  return offered ? [...weeks, extra].sort((a, b) => b.localeCompare(a)) : weeks;
}

/** A week's seven days, Monday first. */
export function weekDays(monday: string): readonly string[] {
  return Array.from({ length: 7 }, (_, i) => addLondonDays(monday, i));
}

const daysFrom = (start: string, date: string): number =>
  Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / DAY_MS);

/** Shifts dated in the week starting `start` (or on a Trial Shift's date) as a pattern of offsets from it. */
export function patternOf(shifts: readonly PrefillShift[], start: string): readonly PatternShift[] {
  return shifts.map((s) => ({ offset: daysFrom(start, s.date), hours: s.hours, ratePence: s.ratePence, description: s.description }));
}

/** Her pattern laid on the week starting `start`: days after `today` dropped; none left → one blank row on `start`. */
export function shiftsForWeek(pattern: readonly PatternShift[], start: string, today: string, ratePence: number | null): ShiftRowValue[] {
  const rows = pattern
    .map((p): ShiftRowValue => ({
      date: addLondonDays(start, p.offset),
      hours: p.hours === null ? "" : String(p.hours),
      rate: poundsOfPence(p.ratePence),
      description: p.description ?? "",
    }))
    .filter((row) => row.date <= today);
  return rows.length > 0 ? rows : [{ date: start, hours: "", rate: poundsOfPence(ratePence), description: "" }];
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
  /** The first refusal that names no row ("Add at least one shift"; a week that hasn't happened). */
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

/** The shared schema on her draft before the server is asked (the server checks it again): null when it passes. */
export function localCheck(draft: FormDraft, now: Date): InvoiceActionRefusal | null {
  const parsed = invoiceDraftSchema(now).safeParse({ ...draft, invoiceId: LOCAL_CHECK_ID });
  return parsed.success ? null : draftRefusal(parsed.error);
}
