/**
 * The nanny's invoice PDF (plan 06 step 8, §14.8; brief §0a D, §0.5, §7). The nanny is the issuer on its face.
 * BabyBloom appears as the website header's wordmark at the top (BAI 2026-11-04, replacing brief D7 for the mark
 * only) and as "Generated with BabyBloom" in the footer; it is never in the From block (plan R8). It is the one place
 * her full bank details appear (brief D12). Families get name and email only (brief §11 Q10).
 *
 * 06b-2: an invoice is a header plus lines. The page: the wordmark and "INVOICE"; the number, issue date and
 * "Replaces …"; From (by business type) and Bill to (`sections/issuer`); the shift table and the expenses
 * (`sections/lines`); the closing block — childcare, VAT per her mode, expenses and the total, with Pay to beside
 * them — kept whole together (`sections/totals`). At the most lines (28 shifts, 20 expenses) it runs to two A4
 * pages, with the violet band and the footer on each. Everything comes from the created row's snapshot, so a later
 * Settings change never alters it.
 *
 * Built from react-pdf primitives only (helpers are called, never mounted as components), so a test can walk every
 * string without rendering — the `client-hire-summary` pattern. The look (BAI 2026-11-04, 06b-1) is kept: an opaque
 * white page, the wordmark in `public/logo.svg`'s two colours, the brand's slate and violet (`theme.ts`). The
 * wordmark, the title and the total are ASCII and print in the built-in Helvetica Bold (no font file); everything a
 * nanny or family typed prints in the Unicode font (`font.ts`, plan R7), whose variable face prints one weight.
 *
 * `@pending:legal` — brief 11's invoice wording (the sole-trader statement; `11-legal-text.md` §3) drops in at the
 * footer slot below. BB-wave1-041126/06a-build, 2026-11-04; 06b-1 (the look), 2026-11-04; 06b2-build, 2026-11-06.
 */

import { Document, Page, Text, View, type DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { SITE_NAME } from "@/lib/constants";
import type { ExpenseType, InvoiceKind, VatMode } from "../types";
import { issueDateLabel } from "../week";
import type { IssuerSnapshot } from "../store-map";
import { parties } from "./sections/issuer";
import { describeLine, expenseTable, shiftTable } from "./sections/lines";
import { closing } from "./sections/totals";
import { keepWhole, styles } from "./theme";

/** Who she was on the invoice (its snapshot), with her full name (the invoice's `nanny_name`). */
export type InvoicePdfIssuer = IssuerSnapshot & { readonly name: string };

export interface InvoicePdfShift {
  readonly date: string;
  readonly description: string | null;
  readonly hours: number;
  readonly ratePence: number;
  readonly amountPence: number;
}

export interface InvoicePdfExpense {
  readonly expenseType: ExpenseType;
  readonly description: string | null;
  readonly amountPence: number;
}

export interface InvoicePdfData {
  readonly number: string;
  /** The instant the invoice was created; printed as its London date. */
  readonly issuedAt: string;
  readonly kind: InvoiceKind;
  /** A Regular week's Monday, or the Trial Shift's date. */
  readonly periodStart: string;
  readonly issuer: InvoicePdfIssuer;
  readonly billTo: { readonly name: string; readonly email: string };
  readonly shifts: readonly InvoicePdfShift[];
  readonly expenses: readonly InvoicePdfExpense[];
  readonly totals: {
    readonly hours: number;
    readonly shiftsPence: number;
    readonly expensesPence: number;
    readonly vat: { readonly mode: VatMode; readonly rateBp: number | null; readonly pence: number };
    readonly totalPence: number;
  };
  readonly payTo: { readonly accountName: string; readonly sortCode: string; readonly accountNumber: string };
  readonly replacesNumber: string | null;
}

/** The website header's wordmark (`LandingHeader.tsx`, `public/logo.svg`), then the title. */
function header(): ReactElement {
  return (
    <View style={styles.header}>
      <View style={styles.wordmark}>
        <Text style={styles.wordmarkBaby}>Baby</Text>
        <Text style={styles.wordmarkBloom}>Bloom</Text>
      </View>
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

/** "Page X of Y" in the footer of each page of a longer invoice; nothing on a one-page invoice (BAI 2026-11-07). */
export const pageLabel = ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }): string =>
  totalPages > 1 ? `Page ${pageNumber} of ${totalPages}` : "";

export function InvoicePdf(data: InvoicePdfData): ReactElement<DocumentProps> {
  return (
    <Document
      title={`Invoice ${data.number}`}
      author={data.issuer.tradingName}
      subject={describeLine(data.kind, data.periodStart)}
      language="en-GB"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.band} fixed />
        {header()}
        {meta(data)}
        {parties(data)}
        {shiftTable(data)}
        {expenseTable(data)}
        {closing(data)}
        <View style={styles.footer} fixed>
          {/* @pending:legal — brief 11's sole-trader statement goes here, above the line below (11-legal-text.md §3). */}
          <Text>{`Generated with ${SITE_NAME}`}</Text>
          <Text style={styles.pageNumber} render={pageLabel} />
        </View>
      </Page>
    </Document>
  );
}
