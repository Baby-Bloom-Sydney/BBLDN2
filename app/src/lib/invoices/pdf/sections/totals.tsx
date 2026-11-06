/**
 * The invoice's totals and pay-to (plan 06 §14.5, §14.8; brief §0a D, D12): the closing block — the totals on the
 * right under the amounts, her bank details beside them — kept whole on one page (`wrap={false}`), so at the most
 * lines they move to the next page together rather than splitting, and the invoice stays two pages. Called as
 * functions, never mounted.
 *
 * - No VAT: "Childcare", "Expenses" (when she has any), "Total".
 * - VAT added: "Childcare", "VAT at 20%", "Expenses", "Total" (the worked example's figures are in the tests).
 * - VAT included: "Childcare (including VAT)", "of which VAT at 20%", "Expenses", "Total".
 * - Pay to: her full account name, sort code and account number — the one place they appear (brief D12).
 *
 * The figures are the created row's (the database worked them out with the same calculator, `totals.ts`).
 *
 * BB-wave1-041126/06b2-build, 2026-11-06.
 */

import { Text, View } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { BASIS_POINTS_PER_PERCENT } from "@/config/invoices";
import { formatSortCode } from "../../masking";
import { formatInvoiceMoney } from "../../money";
import type { InvoicePdfData } from "../InvoicePdf";
import { styles, wholeUnlessLong } from "../theme";

const PERCENT = BASIS_POINTS_PER_PERCENT;

/** 2000 → "20%", 1750 → "17.5%", 1 → "0.01%" (basis points to a percent, no trailing zeros). */
export function vatRateLabel(rateBp: number): string {
  const whole = Math.floor(rateBp / PERCENT);
  const hundredths = String(rateBp % PERCENT).padStart(2, "0").replace(/0+$/, "");
  return `${whole}${hundredths === "" ? "" : `.${hundredths}`}%`;
}

function row(label: string, pence: number): ReactElement {
  return (
    <View key={label} style={styles.totalsRow}>
      <Text style={styles.totalsLabel}>{label}</Text>
      <Text style={styles.totalsValue}>{formatInvoiceMoney(pence)}</Text>
    </View>
  );
}

/** Childcare, VAT per her mode, expenses and the total (14.8). */
export function totalsBox(data: InvoicePdfData): ReactElement {
  const { shiftsPence, expensesPence, vat, totalPence } = data.totals;
  const rate = vat.rateBp === null ? "" : vatRateLabel(vat.rateBp);
  const childcare = vat.mode === "included"
    ? [row("Childcare (including VAT)", shiftsPence), row(`of which VAT at ${rate}`, vat.pence)]
    : [row("Childcare", shiftsPence), ...(vat.mode === "added" ? [row(`VAT at ${rate}`, vat.pence)] : [])];
  return (
    <View style={styles.totals} wrap={false}>
      {childcare}
      {expensesPence > 0 ? row("Expenses", expensesPence) : null}
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.total}>{formatInvoiceMoney(totalPence)}</Text>
      </View>
    </View>
  );
}

function payRow(label: string, value: string): ReactElement {
  return (
    <View style={styles.payRow}>
      <Text style={styles.payLabel}>{label}</Text>
      <Text style={styles.payValue} hyphenationCallback={wholeUnlessLong}>{value}</Text>
    </View>
  );
}

/** The totals, then her bank details: one block, never split across pages. */
export function closing(data: InvoicePdfData): ReactElement {
  return (
    <View style={styles.closing} wrap={false}>
      {totalsBox(data)}
      {payToBox(data.payTo)}
    </View>
  );
}

/** Her bank details, whole on one page. */
export function payToBox(payTo: InvoicePdfData["payTo"]): ReactElement {
  return (
    <View style={styles.payTo} wrap={false}>
      <Text style={styles.label}>Pay to</Text>
      {payRow("Account name", payTo.accountName)}
      {payRow("Sort code", formatSortCode(payTo.sortCode))}
      {payRow("Account number", payTo.accountNumber)}
    </View>
  );
}
