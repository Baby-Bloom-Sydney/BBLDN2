/**
 * The nanny's invoice PDF (plan 06 step 8, §3a; brief §0.5, §7). The nanny is the issuer on its face; BabyBloom
 * appears only as "Generated with BabyBloom" in the footer (brief D7, plan R8). It is the one place her full bank
 * details appear (brief D12). Families get name and email only (brief §11 Q10).
 *
 * Built from react-pdf primitives only (no sub-components), so a test can walk every string without rendering —
 * the `client-hire-summary` pattern. Styles follow the hire summary (slate text, violet number box) in the
 * Unicode font (`font.ts`, plan R7); hierarchy is by size and colour, as the variable font prints one weight.
 *
 * `@pending:legal` — brief 11's invoice wording (the sole-trader statement; `11-legal-text.md` §3) drops in at the
 * footer slot below. BB-wave1-041126/06a-build, 2026-11-04.
 */

import { Document, Page, StyleSheet, Text, View, type DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { SITE_NAME } from "@/lib/constants";
import { formatSortCode } from "../masking";
import { formatHours, formatInvoiceMoney } from "../money";
import type { InvoiceKind } from "../types";
import { issueDateLabel, shiftDateLabel, weekRangeLabel } from "../week";
import { INVOICE_FONT_FAMILY } from "./font";

export interface InvoicePdfData {
  readonly number: string;
  /** The instant the invoice was created; printed as its London date. */
  readonly issuedAt: string;
  readonly issuer: { readonly name: string; readonly tradingName: string | null; readonly address: string | null };
  readonly billTo: { readonly name: string; readonly email: string };
  readonly line: {
    readonly kind: InvoiceKind;
    readonly periodStart: string;
    readonly hours: number;
    readonly ratePence: number;
    readonly totalPence: number;
  };
  readonly payTo: { readonly accountName: string; readonly sortCode: string; readonly accountNumber: string };
  readonly replacesNumber: string | null;
}

const COLOUR = { text: "#1e293b", muted: "#64748b", faint: "#94a3b8", rule: "#e2e8f0", violet: "#7c3aed", violetTint: "#f5f3ff" } as const;

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: INVOICE_FONT_FAMILY, fontSize: 10.5, color: COLOUR.text },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 },
  title: { fontSize: 24, letterSpacing: 2, color: COLOUR.text },
  numberBox: { backgroundColor: COLOUR.violetTint, padding: 10, borderRadius: 6, alignItems: "flex-end" },
  number: { fontSize: 12, color: COLOUR.violet }, // BB-<name>-<YYMMDD>-<seq> runs to 52 characters
  muted: { color: COLOUR.muted, marginTop: 2 },
  replaces: { color: COLOUR.violet, marginTop: 4 },
  parties: { flexDirection: "row", marginBottom: 24 },
  party: { flex: 1, paddingRight: 16 },
  label: { fontSize: 8.5, color: COLOUR.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  partyLine: { marginBottom: 3 },
  row: { flexDirection: "row", paddingVertical: 6, borderBottom: `1 solid ${COLOUR.rule}` },
  headRow: { flexDirection: "row", paddingBottom: 6, borderBottom: `1 solid ${COLOUR.muted}` },
  description: { flex: 4 },
  figure: { flex: 1, textAlign: "right" },
  totalRow: { flexDirection: "row", paddingVertical: 8 },
  totalLabel: { flex: 6, textAlign: "right", color: COLOUR.muted },
  total: { flex: 1, textAlign: "right", fontSize: 13 },
  payTo: { marginTop: 20, padding: 12, border: `1 solid ${COLOUR.rule}`, borderRadius: 6 },
  payRow: { flexDirection: "row", marginBottom: 3 },
  payLabel: { width: 110, color: COLOUR.muted },
  footer: { position: "absolute", bottom: 32, left: 40, right: 40, paddingTop: 10, borderTop: `1 solid ${COLOUR.rule}`, fontSize: 8.5, color: COLOUR.faint, textAlign: "center" },
});

/** Names, emails and numbers never break with a hyphen. */
const keepWhole = (word: string): string[] => [word];

/** "Childcare, week of 8–14 Feb 2027" or "Trial Shift, Wed 3 Feb 2027" (plan §3a). */
export function describeLine(kind: InvoiceKind, periodStart: string): string {
  return kind === "regular_week" ? `Childcare, week of ${weekRangeLabel(periodStart)}` : `Trial Shift, ${shiftDateLabel(periodStart)}`;
}

function party(label: string, lines: readonly string[]): ReactElement {
  return (
    <View style={styles.party}>
      <Text style={styles.label}>{label}</Text>
      {lines.map((line, i) => (
        <Text key={i} style={styles.partyLine} hyphenationCallback={keepWhole}>{line}</Text>
      ))}
    </View>
  );
}

function payRow(label: string, value: string): ReactElement {
  return (
    <View style={styles.payRow}>
      <Text style={styles.payLabel}>{label}</Text>
      <Text hyphenationCallback={keepWhole}>{value}</Text>
    </View>
  );
}

export function InvoicePdf(data: InvoicePdfData): ReactElement<DocumentProps> {
  const { issuer, billTo, line, payTo } = data;
  const from = [issuer.tradingName, issuer.name, issuer.address].filter((s): s is string => Boolean(s));
  return (
    <Document title={`Invoice ${data.number}`} author={issuer.tradingName ?? issuer.name}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>INVOICE</Text>
          <View style={styles.numberBox}>
            <Text style={styles.number} hyphenationCallback={keepWhole}>{data.number}</Text>
            <Text style={styles.muted}>{`Issued ${issueDateLabel(data.issuedAt)}`}</Text>
            {data.replacesNumber ? <Text style={styles.replaces}>{`Replaces ${data.replacesNumber}`}</Text> : null}
          </View>
        </View>
        <View style={styles.parties}>
          {party("From", from)}
          {party("Bill to", [billTo.name, billTo.email])}
        </View>
        <View style={styles.headRow}>
          <Text style={[styles.description, styles.label]}>Description</Text>
          <Text style={[styles.figure, styles.label]}>Hours</Text>
          <Text style={[styles.figure, styles.label]}>Rate</Text>
          <Text style={[styles.figure, styles.label]}>Amount</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.description}>{describeLine(line.kind, line.periodStart)}</Text>
          <Text style={styles.figure}>{formatHours(line.hours)}</Text>
          <Text style={styles.figure}>{formatInvoiceMoney(line.ratePence)}</Text>
          <Text style={styles.figure}>{formatInvoiceMoney(line.totalPence)}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.total}>{formatInvoiceMoney(line.totalPence)}</Text>
        </View>
        <View style={styles.payTo}>
          <Text style={styles.label}>Pay to</Text>
          {payRow("Account name", payTo.accountName)}
          {payRow("Sort code", formatSortCode(payTo.sortCode))}
          {payRow("Account number", payTo.accountNumber)}
        </View>
        <View style={styles.footer} fixed>
          {/* @pending:legal — brief 11's sole-trader statement goes here, above the line below (11-legal-text.md §3). */}
          <Text>{`Generated with ${SITE_NAME}`}</Text>
        </View>
      </Page>
    </Document>
  );
}
