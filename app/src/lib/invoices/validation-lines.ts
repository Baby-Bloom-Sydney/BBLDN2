/**
 * An invoice draft as a family and its lines (plan 06 §14.1, b2.3; brief §0a A; 06b-4 rework, BAI 2026-11-12: "we can
 * deduce this from their earliest and latest date"): the shared zod schema the form, its actions and the store all
 * parse with. Client-safe (no I/O). The database checks every rule again when it creates the invoice (amendment 21:
 * `bad_lines`, `future`), so a caller that skips this can't get past them.
 *
 * - **The draft:** her family's link id (`targetId`: her placement or her connection), the lines and any correction.
 *   No kind and no period: the server and the database work out the link, its kind, the earliest allowed date and
 *   the period (ledger reading 5).
 * - **Shifts:** each on its own real London date, never after today; quarter-hour hours, at most 24 for a shift and
 *   for all of a date's shifts together; a rate in whole pence up to the typo ceiling; an optional one-line
 *   description ("trial" goes there if she wants). She may add several shifts on one date, at different rates.
 * - **Expenses:** one of the five types, whole pence up to the ceiling, an optional description; no date (14.3).
 * - At least one line, shift or expense (an invoice of expenses only is allowed); at most 100 shifts and 40 expenses,
 *   a page-size bound and not a period rule. The period has no cap.
 * - A date before the family's earliest allowed date needs the family, so the review refuses it (`too_early`).
 * - Plain messages that never echo what was typed; every limit comes from `src/config/invoices.ts`.
 * - Hours a float sum left a hair off a quarter (0.1 + 0.15) come out as the exact quarter, so the database's
 *   `hours * 4 = trunc(hours * 4)` holds for what the store sends.
 *
 * BB-wave1-041126/06b2-build, 2026-11-06; BB-wave1-041126/06b4-server, 2026-11-12.
 */

import { z } from "zod";
import { INVOICE_RULES } from "@/config/invoices";
import { formatInvoiceMoney } from "./money";
import { QUARTERS_PER_HOUR, toQuarters } from "./totals";
import { EXPENSE_TYPE_KEYS } from "./types";
import { optionalText, VALIDATION_MESSAGES } from "./validation";
import { isFutureLondonDate, isLondonDate } from "./week";

const { maxShiftHours, ratePence, expensePence, maxShiftLines, maxExpenseLines, text } = INVOICE_RULES;

export const LINE_MESSAGES = Object.freeze({
  family: "Choose a family",
  date: "Choose a date",
  future: "You can't invoice a date that hasn't happened yet",
  tooEarly: "Choose a date on or after your first day with this family",
  invalid: VALIDATION_MESSAGES.invalid,
  hours: "Enter the hours worked",
  hourStep: "Enter the hours in quarter-hour steps, like 7.75",
  shiftHoursMax: `A shift can be at most ${maxShiftHours} hours`,
  dayHoursMax: `A day's shifts can add up to at most ${maxShiftHours} hours`,
  rate: `Enter a rate of up to ${formatInvoiceMoney(ratePence.max)} an hour`,
  expenseType: "Choose what the expense was for",
  expenseAmount: `Enter an amount of up to ${formatInvoiceMoney(expensePence.max)}`,
  noLine: "Add a shift or an expense",
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

function issue(ctx: Ctx, path: (string | number)[], message: string): void {
  ctx.addIssue({ code: "custom", path, message, ...(message === M.future ? { params: { issue: FUTURE_ISSUE } } : {}) });
}

/** The counts: at least one line, at most 100 shifts and 40 expenses. */
function checkCounts(lines: readonly InvoiceLine[], ctx: Ctx): void {
  const shifts = lines.filter((l) => l.kind === "shift").length;
  if (lines.length === 0) issue(ctx, ["lines"], M.noLine);
  if (shifts > maxShiftLines) issue(ctx, ["lines"], M.tooManyShifts);
  if (lines.length - shifts > maxExpenseLines) issue(ctx, ["lines"], M.tooManyExpenses);
}

/**
 * Each shift never after London's today; each date's shifts at most 24 hours (the message on the one that goes over).
 * zod still runs this when a field failed, so a date that isn't one has its own issue already and no `future` (review
 * TS H1).
 */
function checkShiftDates(lines: readonly InvoiceLine[], now: Date, ctx: Ctx): void {
  const quartersOnDate = new Map<string, number>();
  lines.forEach((line, i) => {
    if (line.kind !== "shift") return;
    if (isLondonDate(line.date) && isFutureLondonDate(line.date, now)) issue(ctx, ["lines", i, "date"], M.future);
    const total = (quartersOnDate.get(line.date) ?? 0) + (quartersOf(line.hours) ?? 0);
    quartersOnDate.set(line.date, total);
    if (total > maxShiftHours * QUARTERS_PER_HOUR) issue(ctx, ["lines", i, "hours"], M.dayHoursMax);
  });
}

/**
 * A whole draft (brief §3 nanny 3–5, §0a A; 06b-4 rework). `now` decides what is "future" (London's today). The
 * invoice id is the caller's (a retry is the same invoice); the family is checked on the server and again by the
 * database. Anything else sent (a kind, a period) is dropped: they are worked out, never taken.
 */
export function invoiceDraftSchema(now: Date) {
  return z
    .object({
      invoiceId: z.guid({ error: M.invalid }),
      targetId: z.guid({ error: M.family }),
      lines: z.array(invoiceLineSchema, { error: M.noLine }).max(maxShiftLines + maxExpenseLines, M.tooManyLines),
      replacesInvoiceId: z.guid({ error: M.invalid }).nullable(),
    })
    .superRefine((draft, ctx) => {
      checkCounts(draft.lines, ctx);
      checkShiftDates(draft.lines, now, ctx);
    });
}
export type InvoiceDraft = z.output<ReturnType<typeof invoiceDraftSchema>>;

/** An invoice's period: London calendar dates, first and last, inclusive. */
export interface InvoicePeriod {
  readonly start: string;
  readonly end: string;
}

/**
 * The period (spec d, g; ledger reading 3): the earliest to the latest shift date, whatever her order; with no shift,
 * `today` — the London send date — for both ends. Pure: the form, the review and the PDF all show this one.
 */
export function invoicePeriodOf(lines: readonly InvoiceLine[], today: string): InvoicePeriod {
  if (!isLondonDate(today)) throw new RangeError("today must be a London date");
  const dates = lines.flatMap((l) => (l.kind === "shift" ? [l.date] : [])).sort();
  const [first] = dates;
  const last = dates.at(-1);
  return first === undefined || last === undefined ? { start: today, end: today } : { start: first, end: last };
}
