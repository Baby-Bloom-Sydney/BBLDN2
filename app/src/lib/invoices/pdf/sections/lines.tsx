/**
 * The invoice's lines (plan 06 §14.8; brief §0a D): **childcare** — "Childcare, week of 8–14 Feb 2027" (or "Trial
 * Shift, Wed 3 Feb 2027") over Date · Description · Hours · Rate · Amount, one row per shift in her order (several on
 * one date, at their own rates) — then **expenses**, Type · Description · Amount, when she has any. A long table
 * runs on to the next page row by row; a row is never split. Called as functions, never mounted.
 *
 * BB-wave1-041126/06b2-build, 2026-11-06.
 */

import { Text, View } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { EXPENSE_TYPES } from "@/config/invoices";
import { formatHours, formatInvoiceMoney } from "../../money";
import type { InvoiceKind } from "../../types";
import { dayLabel, shiftDateLabel, weekRangeLabel } from "../../week";
import type { InvoicePdfData } from "../InvoicePdf";
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

/** The shift table: every shift, in her order. */
export function shiftTable(data: InvoicePdfData): ReactElement {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{describeLine(data.kind, data.periodStart)}</Text>
      {head([["Date", styles.cellDate], ["Description", styles.cellDescription], ["Hours", styles.cellHours], ["Rate", styles.cellRate], ["Amount", styles.cellAmount]])}
      {data.shifts.map((s, i) => (
        <View key={i} style={styles.row} wrap={false}>
          <Text style={styles.cellDate}>{dayLabel(s.date)}</Text>
          <Text style={styles.cellDescription}>{s.description ?? ""}</Text>
          <Text style={styles.cellHours}>{formatHours(s.hours)}</Text>
          <Text style={styles.cellRate}>{formatInvoiceMoney(s.ratePence)}</Text>
          <Text style={styles.cellAmount}>{formatInvoiceMoney(s.amountPence)}</Text>
        </View>
      ))}
    </View>
  );
}

/** The expenses table, or nothing when she has none. */
export function expenseTable(data: InvoicePdfData): ReactElement | null {
  if (data.expenses.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Expenses</Text>
      {head([["Type", styles.cellType], ["Description", styles.cellDescription], ["Amount", styles.cellAmount]])}
      {data.expenses.map((e, i) => (
        <View key={i} style={styles.row} wrap={false}>
          <Text style={styles.cellType}>{EXPENSE_TYPES[e.expenseType]}</Text>
          <Text style={styles.cellDescription}>{e.description ?? ""}</Text>
          <Text style={styles.cellAmount}>{formatInvoiceMoney(e.amountPence)}</Text>
        </View>
      ))}
    </View>
  );
}
