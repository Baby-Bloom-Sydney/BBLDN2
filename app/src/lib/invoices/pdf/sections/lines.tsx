/**
 * The invoice's lines (plan 06 §14.8; brief §0a D): **childcare** — "Childcare, week of 8–14 Feb 2027" (or "Trial
 * Shift, Wed 3 Feb 2027") over Date · Description · Hours · Rate · Amount, one row per shift in date order (several
 * on one date, at their own rates, keep her order) — then **expenses**, Type · Description · Amount, in her order, when
 * she has any. A long table runs on to the next page row by row; a row is never split. Called as functions, never
 * mounted.
 *
 * BB-wave1-041126/06b2-build, 2026-11-06 (shifts in date order: coordinator follow-up).
 */

import { Text, View } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { EXPENSE_TYPES } from "@/config/invoices";
import { formatHours, formatInvoiceMoney } from "../../money";
import type { InvoiceKind } from "../../types";
import { dayLabel, shiftDateLabel, weekRangeLabel } from "../../week";
import type { InvoicePdfData, InvoicePdfExpense, InvoicePdfShift } from "../InvoicePdf";
import { styles } from "../theme";

/** "Childcare, week of 8–14 Feb 2027" or "Trial Shift, Wed 3 Feb 2027" (plan §3a, 14.8). */
export function describeLine(kind: InvoiceKind, periodStart: string): string {
  return kind === "regular_week" ? `Childcare, week of ${weekRangeLabel(periodStart)}` : `Trial Shift, ${shiftDateLabel(periodStart)}`;
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

/** The shift table: every shift, in date order. */
export function shiftTable(data: InvoicePdfData): ReactElement {
  return table(
    describeLine(data.kind, data.periodStart),
    [["Date", styles.cellDate], ["Description", styles.cellDescription], ["Hours", styles.cellHours], ["Rate", styles.cellRate], ["Amount", styles.cellAmount]],
    inDateOrder(data.shifts).map(shiftRow),
  );
}

/** The expenses table, or nothing when she has none. */
export function expenseTable(data: InvoicePdfData): ReactElement | null {
  if (data.expenses.length === 0) return null;
  return table("Expenses", [["Type", styles.cellType], ["Description", styles.cellDescription], ["Amount", styles.cellAmount]], data.expenses.map(expenseRow));
}
