/**
 * An invoice draft as a header plus lines (plan 06 §14.1, b2.3; brief §0a A): the shared zod schema the form
 * (06b-4), its actions and the store all parse with. Client-safe (no I/O). The database checks every rule again when
 * it creates the invoice (amendment 21: `bad_lines`, `future`), so a caller that skips this can't get past them.
 *
 * - **Shifts:** a date in the invoice's week (Monday–Sunday) or, for a Trial Shift, its date; quarter-hour hours,
 *   at most 24 for a shift and for all of a date's shifts together; a rate in whole pence up to the typo ceiling; an
 *   optional one-line description. She may add several shifts on one date, at different rates.
 * - **Expenses:** one of the five types, whole pence up to the ceiling, an optional description; no date (14.3).
 * - At least one shift; at most 28 shifts and 20 expenses (two PDF pages). Nothing after London's today.
 * - Plain messages that never echo what was typed; every limit comes from `src/config/invoices.ts`.
 * - Hours a float sum left a hair off a quarter (0.1 + 0.15) come out as the exact quarter, so the database's
 *   `hours * 4 = trunc(hours * 4)` holds for what the store sends.
 *
 * BB-wave1-041126/06b2-build, 2026-11-06.
 */

import { z } from "zod";
import { INVOICE_RULES } from "@/config/invoices";
import { formatInvoiceMoney } from "./money";
import { QUARTERS_PER_HOUR, toQuarters } from "./totals";
import { EXPENSE_TYPE_KEYS, INVOICE_KINDS } from "./types";
import { optionalText, VALIDATION_MESSAGES } from "./validation";
import { isFutureLondonDate, isLondonDate, isLondonMonday, weekEndOf } from "./week";

const { maxShiftHours, ratePence, expensePence, maxShiftLines, maxExpenseLines, text } = INVOICE_RULES;

export const LINE_MESSAGES = Object.freeze({
  kind: "Choose Regular week or Trial Shift",
  family: "Choose a family",
  date: "Choose a date",
  monday: "Choose the Monday the week starts on",
  future: "You can't invoice a week or date that hasn't happened yet",
  invalid: VALIDATION_MESSAGES.invalid,
  shiftDate: "Choose a day in this invoice's week",
  trialDate: "A Trial Shift is invoiced on its trial date",
  hours: "Enter the hours worked",
  hourStep: "Enter the hours in quarter-hour steps, like 7.75",
  shiftHoursMax: `A shift can be at most ${maxShiftHours} hours`,
  dayHoursMax: `A day's shifts can add up to at most ${maxShiftHours} hours`,
  rate: `Enter a rate of up to ${formatInvoiceMoney(ratePence.max)} an hour`,
  expenseType: "Choose what the expense was for",
  expenseAmount: `Enter an amount of up to ${formatInvoiceMoney(expensePence.max)}`,
  noShift: "Add at least one shift",
  tooManyShifts: `An invoice can have at most ${maxShiftLines} shifts`,
  tooManyExpenses: `An invoice can have at most ${maxExpenseLines} expenses`,
  tooManyLines: `An invoice can have at most ${maxShiftLines + maxExpenseLines} lines`,
  tooLong: VALIDATION_MESSAGES.tooLong,
  oneLine: VALIDATION_MESSAGES.oneLine,
} as const);
const M = LINE_MESSAGES;

/** Whole quarters, or null when the hours aren't positive quarter hours. */
function quartersOf(hours: number): number | null {
  try {
    return toQuarters(hours);
  } catch {
    return null;
  }
}

const description = optionalText(text.descriptionMax);

/** The issue code a refusal carries, so callers read a code, never a message's wording (review TS L10). */
export const FUTURE_ISSUE = "future";

/** Positive quarter hours up to 24, as the exact quarter (0.1 + 0.15 → 0.25); one message per mistake. */
const hours = z
  .number({ error: M.hours })
  .positive({ error: M.hours, abort: true })
  .max(maxShiftHours, { error: M.shiftHoursMax, abort: true })
  .transform((value, ctx) => {
    const quarters = quartersOf(value);
    if (quarters === null) {
      ctx.addIssue({ code: "custom", message: M.hourStep });
      return z.NEVER;
    }
    return quarters / QUARTERS_PER_HOUR;
  });

export const shiftLineSchema = z.object({
  kind: z.literal("shift"),
  date: z.string({ error: M.date }).refine(isLondonDate, M.date),
  hours,
  ratePence: z.number({ error: M.rate }).int(M.rate).min(ratePence.min, M.rate).max(ratePence.max, M.rate),
  description,
});

export const expenseLineSchema = z.object({
  kind: z.literal("expense"),
  expenseType: z.enum(EXPENSE_TYPE_KEYS, { error: M.expenseType }),
  amountPence: z.number({ error: M.expenseAmount }).int(M.expenseAmount).min(expensePence.min, M.expenseAmount).max(expensePence.max, M.expenseAmount),
  description,
});

/** One line of an invoice, by kind. */
export const invoiceLineSchema = z.discriminatedUnion("kind", [shiftLineSchema, expenseLineSchema], { error: M.invalid });
export type ShiftLine = z.output<typeof shiftLineSchema>;
export type ExpenseLine = z.output<typeof expenseLineSchema>;
export type InvoiceLine = z.output<typeof invoiceLineSchema>;

type Ctx = z.RefinementCtx;
interface DraftShape {
  readonly kind: (typeof INVOICE_KINDS)[number];
  readonly periodStart: string;
  readonly lines: readonly InvoiceLine[];
}

function issue(ctx: Ctx, path: (string | number)[], message: string): void {
  ctx.addIssue({ code: "custom", path, message, ...(message === M.future ? { params: { issue: FUTURE_ISSUE } } : {}) });
}

/** The counts: at least one shift, at most 28 shifts and 20 expenses. */
function checkCounts(lines: readonly InvoiceLine[], ctx: Ctx): void {
  const shifts = lines.filter((l) => l.kind === "shift").length;
  if (shifts === 0) issue(ctx, ["lines"], M.noShift);
  if (shifts > maxShiftLines) issue(ctx, ["lines"], M.tooManyShifts);
  if (lines.length - shifts > maxExpenseLines) issue(ctx, ["lines"], M.tooManyExpenses);
}

/** Each shift in the week (or on the trial date), never after today; each date's shifts at most 24 hours. */
function checkShiftDates(draft: DraftShape, now: Date, ctx: Ctx): void {
  const last = draft.kind === "regular_week" ? weekEndOf(draft.periodStart) : draft.periodStart;
  const quartersOnDate = new Map<string, number>();
  draft.lines.forEach((line, i) => {
    if (line.kind !== "shift") return;
    if (line.date < draft.periodStart || line.date > last) {
      issue(ctx, ["lines", i, "date"], draft.kind === "regular_week" ? M.shiftDate : M.trialDate);
    } else if (isFutureLondonDate(line.date, now)) {
      issue(ctx, ["lines", i, "date"], M.future);
    }
    const total = (quartersOnDate.get(line.date) ?? 0) + (quartersOf(line.hours) ?? 0);
    quartersOnDate.set(line.date, total);
    if (total > maxShiftHours * QUARTERS_PER_HOUR) issue(ctx, ["lines", i, "hours"], M.dayHoursMax);
  });
}

/**
 * A whole draft (brief §3 nanny 3–5, §0a A). `now` decides what is "future" (London's today). The invoice id is the
 * caller's (a retry is the same invoice); the family is checked on the server and again by the database.
 */
export function invoiceDraftSchema(now: Date) {
  return z
    .object({
      invoiceId: z.guid({ error: M.invalid }),
      kind: z.enum(INVOICE_KINDS, { error: M.kind }),
      targetId: z.guid({ error: M.family }),
      periodStart: z.string({ error: M.date }).refine(isLondonDate, { error: M.date, abort: true }),
      lines: z.array(invoiceLineSchema, { error: M.noShift }).max(maxShiftLines + maxExpenseLines, M.tooManyLines),
      replacesInvoiceId: z.guid({ error: M.invalid }).nullable(),
    })
    .superRefine((draft, ctx) => {
      // zod still runs this when a field failed: a period that isn't a date has its issue already (review TS H1)
      if (!isLondonDate(draft.periodStart)) return;
      if (draft.kind === "regular_week" && !isLondonMonday(draft.periodStart)) issue(ctx, ["periodStart"], M.monday);
      if (isFutureLondonDate(draft.periodStart, now)) issue(ctx, ["periodStart"], M.future);
      checkCounts(draft.lines, ctx);
      checkShiftDates(draft, now, ctx);
    });
}
export type InvoiceDraft = z.output<ReturnType<typeof invoiceDraftSchema>>;
