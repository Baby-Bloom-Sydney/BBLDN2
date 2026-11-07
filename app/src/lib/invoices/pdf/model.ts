/**
 * The PDF's data from what the store returns (plan 06 step 8; §14.6 b2.6). Pure.
 *
 * - From the **created invoice's snapshot**: the number, the family, her name, who she was on it (the issuer by
 *   business type), its lines in her order, and every figure. A later change to her business details never alters a
 *   PDF (plan 14.4: the snapshot holds).
 * - From **her saved bank details**: the full account name, sort code and account number — the one place they
 *   appear (brief D12) — once their last 4 match the account the invoice recorded.
 * - The figures are checked against `totals.ts` (one set of maths for the form, the server, the PDF and the database,
 *   risk X2): a created row whose lines, hours, VAT or total don't add up is never printed.
 *
 * BB-wave1-041126/06a-build, 2026-11-04; BB-wave1-041126/06b2-build, 2026-11-06.
 */

import { logFailure } from "../db";
import type { CreatedInvoice, StoredPaymentDetails } from "../store-map";
import { linesInOrder, type StoredLine } from "../store-map-lines";
import { invoiceTotals, lineAmountPence } from "../totals";
import { FAILED, invoiceOk, refused, type InvoiceResult } from "../types";
import type { InvoicePdfData, InvoicePdfExpense, InvoicePdfShift } from "./InvoicePdf";

/** True when every line's amount and every header figure is what the calculator gives. */
function addsUp(created: CreatedInvoice, lines: readonly StoredLine[]): boolean {
  try {
    const shiftsOk = lines.every((l) => l.kind !== "shift" || lineAmountPence(l.hours, l.ratePence) === l.amountPence);
    const t = invoiceTotals(
      lines.map((l) => (l.kind === "shift" ? { kind: "shift", hours: l.hours, ratePence: l.ratePence } : { kind: "expense", amountPence: l.amountPence })),
      { mode: created.vat.mode, rateBp: created.vat.rateBp },
    );
    return shiftsOk && t.hours === created.hours && t.shiftsPence === created.shiftsPence && t.expensesPence === created.expensesPence
      && t.vatPence === created.vat.pence && t.totalPence === created.totalPence;
  } catch {
    return false;
  }
}

/**
 * `no_details` when her details now name a different account than the invoice recorded (changed in between), and
 * `error` when the figures don't add up: results, not throws, so the send path can always finish the row as failed
 * (06a code review 9).
 */
export function invoicePdfData(created: CreatedInvoice, details: StoredPaymentDetails): InvoiceResult<InvoicePdfData> {
  if (details.accountLast4 !== created.accountLast4) return refused("no_details");
  const lines = linesInOrder(created.lines);
  if (!addsUp(created, lines)) {
    logFailure("invoicePdfData", { code: "figures_mismatch" }); // a code only: never the row's figures or names
    return FAILED;
  }
  const shifts = lines.flatMap((l): InvoicePdfShift[] =>
    l.kind === "shift" ? [{ date: l.date, description: l.description, hours: l.hours, ratePence: l.ratePence, amountPence: l.amountPence }] : []);
  const expenses = lines.flatMap((l): InvoicePdfExpense[] =>
    l.kind === "expense" ? [{ expenseType: l.expenseType, description: l.description, amountPence: l.amountPence }] : []);
  return invoiceOk({
    number: created.number,
    issuedAt: created.createdAt,
    kind: created.kind,
    periodStart: created.periodStart,
    issuer: { name: created.nannyName, ...created.issuer },
    billTo: { name: created.familyName, email: created.familyEmail },
    shifts,
    expenses,
    totals: {
      hours: created.hours,
      shiftsPence: created.shiftsPence,
      expensesPence: created.expensesPence,
      vat: created.vat,
      totalPence: created.totalPence,
    },
    payTo: { accountName: details.accountName, sortCode: details.sortCode, accountNumber: details.accountNumber },
    replacesNumber: created.replacesNumber,
  });
}
