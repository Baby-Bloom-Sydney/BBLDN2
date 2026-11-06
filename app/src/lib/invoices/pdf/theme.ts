/**
 * The invoice PDF's look, shared by the page (`InvoicePdf.tsx`) and its sections (`sections/`): 06b-1's palette,
 * bold face and styles (BAI 2026-11-04: "our logo, plus a white background not see through"), moved here so every
 * part uses one copy. The palette, the wordmark, the white page and the violet band are unchanged; 06b-2 adds the
 * table, totals and section styles the lines need and tightens the vertical spacing, so the most lines an invoice
 * can hold (28 shifts, 20 expenses) fit two A4 pages.
 *
 * Everything a nanny or family typed prints in the Unicode font (`font.ts`, plan R7, the page's default); only
 * ASCII labels use the built-in Helvetica Bold.
 *
 * BB-wave1-041126/06b-1, 2026-11-04; BB-wave1-041126/06b2-build, 2026-11-06.
 */

import { StyleSheet } from "@react-pdf/renderer";
import { INVOICE_FONT_FAMILY } from "./font";

/** Slate and violet from the site's palette; `ink` and `violet` are the wordmark's two colours (`public/logo.svg`). */
export const COLOUR = {
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
export const BOLD = { fontFamily: "Helvetica", fontWeight: "bold" } as const;

/** The wordmark's size; the halves sit a fifth of it apart, as `gap-1` does at `text-xl` in the site header. */
export const WORDMARK_SIZE = 22;

/** Emails and the invoice number never break with a hyphen. */
export const keepWhole = (word: string): string[] => [word];

/** The longest word kept whole: a longer one can't fit the narrowest column a name prints in (the pay-to value). */
const LONG_WORD = 18;

/**
 * Names keep their words whole (no "Soph-ie"), except a word too long for its column, which textkit's own hyphenation
 * may break — a hyphen is better than a name running out of its box over the totals (review React M3). textkit passes
 * its hyphenator as the second argument (`@react-pdf/textkit` `hyphenate(word, builtinHyphenate)`).
 */
export const wholeUnlessLong = (word: string, hyphenate?: (word: string) => string[]): string[] =>
  word.length > LONG_WORD && hyphenate ? hyphenate(word) : [word];

export const styles = StyleSheet.create({
  page: { paddingTop: 52, paddingHorizontal: 48, paddingBottom: 72, backgroundColor: COLOUR.white, fontFamily: INVOICE_FONT_FAMILY, fontSize: 10, color: COLOUR.text },
  band: { position: "absolute", top: 0, left: 0, right: 0, height: 6, backgroundColor: COLOUR.violet },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 },
  wordmark: { flexDirection: "row" },
  wordmarkBaby: { ...BOLD, fontSize: WORDMARK_SIZE, color: COLOUR.ink },
  wordmarkBloom: { ...BOLD, fontSize: WORDMARK_SIZE, color: COLOUR.violet, marginLeft: WORDMARK_SIZE / 5 },
  title: { ...BOLD, fontSize: 18, letterSpacing: 4, color: COLOUR.ink },
  meta: { flexDirection: "row", backgroundColor: COLOUR.violetTint, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 16, marginBottom: 22 },
  metaNumber: { flex: 1, paddingRight: 16 },
  metaDate: { alignItems: "flex-end" },
  number: { fontSize: 12, color: COLOUR.violetDeep }, // BB-<name>-<YYMMDD>-<seq> runs to 52 characters
  metaValue: { fontSize: 12, color: COLOUR.ink },
  replaces: { color: COLOUR.violetDeep, marginTop: 4 },
  label: { fontSize: 7.5, color: COLOUR.muted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 5 },
  parties: { flexDirection: "row", marginBottom: 22 },
  party: { flex: 1, paddingRight: 16 },
  partyName: { fontSize: 12, color: COLOUR.ink, marginBottom: 4 },
  partyLine: { color: COLOUR.text, marginBottom: 3 },
  section: { marginBottom: 14 },
  sectionTitle: { fontSize: 10.5, color: COLOUR.ink, marginBottom: 6 },
  headRow: { flexDirection: "row", backgroundColor: COLOUR.panel, borderRadius: 6, paddingTop: 7, paddingBottom: 2, paddingHorizontal: 10 },
  row: { flexDirection: "row", paddingVertical: 3, paddingHorizontal: 10, borderBottom: `1 solid ${COLOUR.rule}`, fontSize: 8.5, lineHeight: 1.25 },
  cellDate: { width: 64 },
  cellType: { width: 78 },
  cellDescription: { flex: 1, paddingRight: 8 },
  cellHours: { width: 40, textAlign: "right" },
  cellRate: { width: 58, textAlign: "right" },
  cellAmount: { width: 66, textAlign: "right" },
  // the closing block: the totals on the right (under the amounts), her bank details beside them, kept whole together
  closing: { flexDirection: "row-reverse", alignItems: "flex-start", marginTop: 6 },
  totals: { width: 230, marginRight: 10 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  totalsLabel: { color: COLOUR.muted },
  totalsValue: { color: COLOUR.ink },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6, paddingTop: 8, borderTop: `2 solid ${COLOUR.violet}` },
  totalLabel: { fontSize: 10, color: COLOUR.muted },
  total: { ...BOLD, fontSize: 16, color: COLOUR.ink },
  payTo: { flex: 1, marginRight: 24, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: COLOUR.panel, borderLeft: `3 solid ${COLOUR.violet}`, borderRadius: 4 },
  payRow: { flexDirection: "row", marginBottom: 4 },
  payLabel: { width: 86, color: COLOUR.muted }, // "Account number" is the longest label (review React M3)
  payValue: { flex: 1, color: COLOUR.ink }, // a long account name wraps inside the box
  footer: { position: "absolute", bottom: 32, left: 48, right: 48, paddingTop: 10, borderTop: `1 solid ${COLOUR.rule}`, fontSize: 8, color: COLOUR.faint, textAlign: "center" },
});
