/**
 * The invoice's lines (plan 06 §14.8; brief §0a D; 06b-4 rework, ledger readings 6, 7): **childcare** — "Childcare,
 * 2–29 Nov 2026" (the period: the earliest to the latest shift date; one date for one day) over Date · Description ·
 * Hours · Rate · Amount, one row per shift in date order (several on one date, at their own rates, keep her order),
 * and no table at all for an invoice of expenses only — then **expenses**, Type · Description · Amount, in her order,
 * when she has any. A long table runs on to the next page row by row; a row is never split. Called as functions,
 * never mounted.
 *
 * BB-wave1-041126/06b2-build, 2026-11-06 (shifts in date order: coordinator follow-up); 06b4-server, 2026-11-12.
 */

import { Text, View } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { EXPENSE_TYPES } from "@/config/invoices";
import { formatHours, formatInvoiceMoney } from "../../money";
import { dayLabel, periodLabel } from "../../week";
import type { InvoicePdfData, InvoicePdfExpense, InvoicePdfShift } from "../InvoicePdf";
import { styles } from "../theme";

/** "Childcare, 2–29 Nov 2026" or "Childcare, 5 Oct 2026" (ledger reading 7: replaces "week of …" and "Trial Shift, …"). */
export function describeLine(periodStart: string, periodEnd: string): string {
  return `Childcare, ${periodLabel(periodStart, periodEnd)}`;
}

type CellStyle = (typeof styles)[keyof typeof styles];

const head = (cells: readonly (readonly [string, CellStyle])[]): ReactElement => (
  <View style={styles.headRow} wrap={false}>
    {cells.map(([text, style]) => <Text key={text} style={[style, styles.label]}>{text}</Text>)}
  </View>
);

/**
 * Her shifts by date, earliest first, so a line she added later prints with its day (coordinator, 06b-2). The sort is
 * stable: shifts on one date keep her order. Only the PDF's order: the data, line numbers and readers keep hers.
 */
export const inDateOrder = (shifts: readonly InvoicePdfShift[]): InvoicePdfShift[] =>
  [...shifts].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

/** One shift's row; never split across pages. */
function shiftRow(s: InvoicePdfShift, i: number): ReactElement {
  return (
    <View key={i} style={styles.row} wrap={false}>
      <Text style={styles.cellDate}>{dayLabel(s.date)}</Text>
      <Text style={styles.cellDescription}>{s.description ?? ""}</Text>
      <Text style={styles.cellHours}>{formatHours(s.hours)}</Text>
      <Text style={styles.cellRate}>{formatInvoiceMoney(s.ratePence)}</Text>
      <Text style={styles.cellAmount}>{formatInvoiceMoney(s.amountPence)}</Text>
    </View>
  );
}

function expenseRow(e: InvoicePdfExpense, i: number): ReactElement {
  return (
    <View key={i} style={styles.row} wrap={false}>
      <Text style={styles.cellType}>{EXPENSE_TYPES[e.expenseType]}</Text>
      <Text style={styles.cellDescription}>{e.description ?? ""}</Text>
      <Text style={styles.cellAmount}>{formatInvoiceMoney(e.amountPence)}</Text>
    </View>
  );
}

/**
 * A table: its title, head and first row kept together (never a title stranded at a page's foot: review React M2),
 * then the other rows, each whole. A continuation page carries rows without the head (a known limit).
 */
function table(title: string, cells: readonly (readonly [string, CellStyle])[], rows: readonly ReactElement[]): ReactElement {
  const [first, ...rest] = rows;
  return (
    <View style={styles.section}>
      <View wrap={false}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {head(cells)}
        {first}
      </View>
      {rest}
    </View>
  );
}

/** The shift table: every shift, in date order; nothing for an invoice of expenses only. */
export function shiftTable(data: InvoicePdfData): ReactElement | null {
  if (data.shifts.length === 0) return null;
  return table(
    describeLine(data.periodStart, data.periodEnd),
    [["Date", styles.cellDate], ["Description", styles.cellDescription], ["Hours", styles.cellHours], ["Rate", styles.cellRate], ["Amount", styles.cellAmount]],
    inDateOrder(data.shifts).map(shiftRow),
  );
}

/** The expenses table, or nothing when she has none. */
export function expenseTable(data: InvoicePdfData): ReactElement | null {
  if (data.expenses.length === 0) return null;
  return table("Expenses", [["Type", styles.cellType], ["Description", styles.cellDescription], ["Amount", styles.cellAmount]], data.expenses.map(expenseRow));
}
