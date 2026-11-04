/**
 * The nanny's invoice PDF (plan 06 step 8, §3a; brief §0.5, §7). The nanny is the issuer on its face. BabyBloom
 * appears as the website header's wordmark at the top (BAI 2026-11-04, replacing brief D7 for the mark only) and as
 * "Generated with BabyBloom" in the footer; it is never in the From block (plan R8). It is the one place her full
 * bank details appear (brief D12). Families get name and email only (brief §11 Q10).
 *
 * Built from react-pdf primitives only (helpers are called, never mounted as components), so a test can walk every
 * string without rendering — the `client-hire-summary` pattern. The look (BAI 2026-11-04): an opaque white page,
 * the wordmark in `public/logo.svg`'s two colours, the brand's slate and violet. The wordmark, the title and the
 * total are ASCII and print in the built-in Helvetica Bold (no font file); everything a nanny or family typed prints
 * in the Unicode font (`font.ts`, plan R7), whose variable face prints one weight.
 *
 * `@pending:legal` — brief 11's invoice wording (the sole-trader statement; `11-legal-text.md` §3) drops in at the
 * footer slot below. BB-wave1-041126/06a-build, 2026-11-04; 06b-1 (the look), 2026-11-04.
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

/** Slate and violet from the site's palette; `ink` and `violet` are the wordmark's two colours (`public/logo.svg`). */
const COLOUR = {
  ink: "#0f172a",
  text: "#1e293b",
  muted: "#64748b",
  faint: "#94a3b8",
  rule: "#e2e8f0",
  panel: "#f8fafc",
  violet: "#8b5cf6",
  violetDeep: "#6d28d9",
  violetTint: "#f5f3ff",
  white: "#FFFFFF",
} as const;

/** The built-in bold face, for ASCII-only text (the wordmark, the title, the total). */
const BOLD = { fontFamily: "Helvetica", fontWeight: "bold" } as const;

const styles = StyleSheet.create({
  page: { paddingTop: 52, paddingHorizontal: 48, paddingBottom: 80, backgroundColor: COLOUR.white, fontFamily: INVOICE_FONT_FAMILY, fontSize: 10, color: COLOUR.text },
  band: { position: "absolute", top: 0, left: 0, right: 0, height: 6, backgroundColor: COLOUR.violet },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 28 },
  wordmark: { ...BOLD, fontSize: 22 },
  // Nested Text keeps the family but not the weight, so each half carries the bold face itself.
  wordmarkBaby: { ...BOLD, color: COLOUR.ink },
  wordmarkBloom: { ...BOLD, color: COLOUR.violet },
  title: { ...BOLD, fontSize: 18, letterSpacing: 4, color: COLOUR.ink },
  meta: { flexDirection: "row", backgroundColor: COLOUR.violetTint, borderRadius: 8, paddingVertical: 14, paddingHorizontal: 16, marginBottom: 32 },
  metaNumber: { flex: 1, paddingRight: 16 },
  metaDate: { alignItems: "flex-end" },
  number: { fontSize: 12, color: COLOUR.violetDeep }, // BB-<name>-<YYMMDD>-<seq> runs to 52 characters
  metaValue: { fontSize: 12, color: COLOUR.ink },
  replaces: { color: COLOUR.violetDeep, marginTop: 4 },
  label: { fontSize: 7.5, color: COLOUR.muted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 5 },
  parties: { flexDirection: "row", marginBottom: 36 },
  party: { flex: 1, paddingRight: 16 },
  partyName: { fontSize: 12, color: COLOUR.ink, marginBottom: 4 },
  partyLine: { color: COLOUR.text, marginBottom: 3 },
  headRow: { flexDirection: "row", backgroundColor: COLOUR.panel, borderRadius: 6, paddingTop: 8, paddingBottom: 3, paddingHorizontal: 10 },
  row: { flexDirection: "row", paddingVertical: 12, paddingHorizontal: 10, borderBottom: `1 solid ${COLOUR.rule}` },
  description: { flex: 4 },
  figure: { flex: 1.3, textAlign: "right" },
  totalBox: { alignSelf: "flex-end", width: 210, flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 14, marginRight: 10, paddingTop: 10, borderTop: `2 solid ${COLOUR.violet}` },
  totalLabel: { fontSize: 10, color: COLOUR.muted },
  total: { ...BOLD, fontSize: 16, color: COLOUR.ink },
  payTo: { marginTop: 40, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: COLOUR.panel, borderLeft: `3 solid ${COLOUR.violet}`, borderRadius: 4 },
  payRow: { flexDirection: "row", marginBottom: 4 },
  payLabel: { width: 120, color: COLOUR.muted },
  payValue: { color: COLOUR.ink },
  footer: { position: "absolute", bottom: 32, left: 48, right: 48, paddingTop: 10, borderTop: `1 solid ${COLOUR.rule}`, fontSize: 8, color: COLOUR.faint, textAlign: "center" },
});

/** Names, emails and numbers never break with a hyphen. */
const keepWhole = (word: string): string[] => [word];

/** "Childcare, week of 8–14 Feb 2027" or "Trial Shift, Wed 3 Feb 2027" (plan §3a). */
export function describeLine(kind: InvoiceKind, periodStart: string): string {
  return kind === "regular_week" ? `Childcare, week of ${weekRangeLabel(periodStart)}` : `Trial Shift, ${shiftDateLabel(periodStart)}`;
}

/** The website header's wordmark (`LandingHeader.tsx`, `public/logo.svg`), then the title. */
function header(): ReactElement {
  return (
    <View style={styles.header}>
      <Text style={styles.wordmark}>
        <Text style={styles.wordmarkBaby}>Baby</Text>
        <Text style={styles.wordmarkBloom}>Bloom</Text>
      </Text>
      <Text style={styles.title}>INVOICE</Text>
    </View>
  );
}

function meta(data: InvoicePdfData): ReactElement {
  return (
    <View style={styles.meta}>
      <View style={styles.metaNumber}>
        <Text style={styles.label}>Invoice number</Text>
        <Text style={styles.number} hyphenationCallback={keepWhole}>{data.number}</Text>
        {data.replacesNumber ? <Text style={styles.replaces}>{`Replaces ${data.replacesNumber}`}</Text> : null}
      </View>
      <View style={styles.metaDate}>
        <Text style={styles.label}>Issue date</Text>
        <Text style={styles.metaValue}>{issueDateLabel(data.issuedAt)}</Text>
      </View>
    </View>
  );
}

function party(label: string, lines: readonly string[]): ReactElement {
  return (
    <View style={styles.party}>
      <Text style={styles.label}>{label}</Text>
      {lines.map((line, i) => (
        <Text key={i} style={i === 0 ? styles.partyName : styles.partyLine} hyphenationCallback={keepWhole}>{line}</Text>
      ))}
    </View>
  );
}

function lineTable(line: InvoicePdfData["line"]): ReactElement {
  return (
    <View>
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
      <View style={styles.totalBox}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.total}>{formatInvoiceMoney(line.totalPence)}</Text>
      </View>
    </View>
  );
}

function payRow(label: string, value: string): ReactElement {
  return (
    <View style={styles.payRow}>
      <Text style={styles.payLabel}>{label}</Text>
      <Text style={styles.payValue} hyphenationCallback={keepWhole}>{value}</Text>
    </View>
  );
}

function payToBox(payTo: InvoicePdfData["payTo"]): ReactElement {
  return (
    <View style={styles.payTo}>
      <Text style={styles.label}>Pay to</Text>
      {payRow("Account name", payTo.accountName)}
      {payRow("Sort code", formatSortCode(payTo.sortCode))}
      {payRow("Account number", payTo.accountNumber)}
    </View>
  );
}

export function InvoicePdf(data: InvoicePdfData): ReactElement<DocumentProps> {
  const { issuer, billTo } = data;
  const from = [issuer.tradingName, issuer.name, issuer.address].filter((s): s is string => Boolean(s));
  return (
    <Document title={`Invoice ${data.number}`} author={issuer.tradingName ?? issuer.name}>
      <Page size="A4" style={styles.page}>
        <View style={styles.band} fixed />
        {header()}
        {meta(data)}
        <View style={styles.parties}>
          {party("From", from)}
          {party("Bill to", [billTo.name, billTo.email])}
        </View>
        {lineTable(data.line)}
        {payToBox(data.payTo)}
        <View style={styles.footer} fixed>
          {/* @pending:legal — brief 11's sole-trader statement goes here, above the line below (11-legal-text.md §3). */}
          <Text>{`Generated with ${SITE_NAME}`}</Text>
        </View>
      </Page>
    </Document>
  );
}
