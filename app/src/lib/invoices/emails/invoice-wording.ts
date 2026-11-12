/**
 * The wording the three invoice emails share (plan 06 §3a, §14.8; brief §0.5, §0.8; R16): the period, the totals
 * sentence, first names, one-line subjects, escaping and the shell every one of them is built in. Pure: builds
 * strings, sends nothing; client-safe (the list's cancel dialog reads `CANCEL_REASON_LABELS`).
 *
 * - **No bank detail is ever an input** here: `sendEmail` keeps every body in `email_logs` (brief §5, §9.8), so the
 *   facts are the number, the period, the two names and the figures only.
 * - The totals sentence is plan 14.8's: "32 hours of childcare and <expenses> of expenses, <total> in total", with
 *   ", including VAT" only when she charges VAT, and the expenses clause left out when there are none. Amounts are
 *   the one money format (`formatInvoiceMoney`).
 * - Names are escaped in the html; subjects are one line (no CR/LF or other controls), whatever the snapshot holds.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { NO_PENCE } from "@/config/invoices";
import { SITE_NAME } from "@/lib/constants";
import { emailHeader } from "@/lib/email/brand";
import type { EmailTemplate } from "@/lib/email/templates/types";
import { formatHours, formatInvoiceMoney } from "../money";
import type { CancelReason, InvoiceKind, VatMode } from "../types";
import { shiftDateLabel, weekOfLabel } from "../week";

/** The reasons she can give when cancelling (brief §0.8), as the list and the emails show them. */
export const CANCEL_REASON_LABELS: Readonly<Record<CancelReason, string>> = Object.freeze({
  wrong_hours: "Wrong hours",
  wrong_rate: "Wrong rate",
  wrong_period: "Wrong week or date",
  wrong_family: "Wrong family",
  other: "Other",
});

/** The figures an email states: the header's, as the created row holds them. */
export interface InvoiceEmailFigures {
  readonly hours: number;
  readonly expensesPence: number;
  readonly totalPence: number;
  readonly vatMode: VatMode;
}

/** Everything an invoice email may say about the invoice. Never a bank field. */
export interface InvoiceEmailFacts {
  readonly number: string;
  readonly kind: InvoiceKind;
  /** A Regular week's Monday, or the Trial Shift's date. */
  readonly periodStart: string;
  /** Her full name (the invoice's snapshot). */
  readonly nannyName: string;
  /** The family's name (the invoice's snapshot). */
  readonly familyName: string;
  readonly figures: InvoiceEmailFigures;
  /** The cancelled invoice this one corrects, if any. */
  readonly replacesNumber: string | null;
}

export type InvoiceEmail = EmailTemplate & { readonly text: string };

/** "week of 8 Feb 2027" or "Trial Shift, Wed 3 Feb 2027": a subject's period. */
export function periodForSubject(kind: InvoiceKind, periodStart: string): string {
  return kind === "trial_shift" ? `Trial Shift, ${shiftDateLabel(periodStart)}` : `week of ${weekOfLabel(periodStart)}`;
}

/** "the week of 8 Feb 2027" or "the Trial Shift on Wed 3 Feb 2027": a sentence's period. */
export function periodForSentence(kind: InvoiceKind, periodStart: string): string {
  return kind === "trial_shift" ? `the Trial Shift on ${shiftDateLabel(periodStart)}` : `the week of ${weekOfLabel(periodStart)}`;
}

/** Plan 14.8's totals sentence, without its full stop. */
export function totalsClause(figures: InvoiceEmailFigures): string {
  const hours = `${formatHours(figures.hours)} ${figures.hours === 1 ? "hour" : "hours"} of childcare`;
  const expenses = figures.expensesPence > NO_PENCE ? ` and ${formatInvoiceMoney(figures.expensesPence)} of expenses` : "";
  const vat = figures.vatMode === "none" ? "" : ", including VAT";
  return `${hours}${expenses}, ${formatInvoiceMoney(figures.totalPence)} in total${vat}`;
}

/** The first word of a full name ("" when there is none). */
export function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}

/** One line: controls (CR, LF, tab …) and line separators become spaces, runs of spaces one. */
export function oneLine(value: string): string {
  return value.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").replace(/ {2,}/g, " ").trim();
}

const HTML_ESCAPES: Readonly<Record<string, string>> = Object.freeze({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" });

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

const PARAGRAPH = "font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;";

/**
 * The shell every invoice email is built in (the details-changed email's): the brand header, a heading, the
 * paragraphs (escaped), the footer the caller chose; the text is the paragraphs and the name, a blank line apart.
 */
export function renderEmail(parts: { readonly heading: string; readonly paragraphs: readonly string[]; readonly footer: string }): {
  readonly html: string;
  readonly text: string;
} {
  const body = parts.paragraphs.map((p) => `<p style="${PARAGRAPH}">${escapeHtml(p)}</p>`).join("\n    ");
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#f8fafc;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;">
  <div style="background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;padding:32px;">
    ${emailHeader()}
    <h2 style="font-size:20px;font-weight:700;color:#1e293b;margin:0 0 16px;">${escapeHtml(parts.heading)}</h2>
    ${body}
    ${parts.footer}
  </div>
</div>
</body></html>`;
  return { html, text: [...parts.paragraphs, SITE_NAME].join("\n\n") };
}
