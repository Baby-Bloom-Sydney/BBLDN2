/**
 * The wording the three invoice emails share (plan 06 §3a, §14.8; brief §0.5, §0.8; R16): the period, the totals
 * sentence, first names, one-line subjects, escaping and the shell every one of them is built in. Pure: builds
 * strings, sends nothing; client-safe (the list's cancel dialog reads `CANCEL_REASON_LABELS`).
 *
 * - **No bank detail is ever an input** here: `sendEmail` keeps every body in `email_logs` (brief §5, §9.8), so the
 *   facts are the number, the period, the two names and the figures only.
 * - The totals sentence is plan 14.8's: "32 hours of childcare and <expenses> of expenses, <total> in total", with
 *   ", including VAT" only when she charges VAT, and the expenses clause left out when there are none. An invoice of
 *   expenses only leaves out the hours, and the VAT with them (expenses are at cost): "<expenses> of expenses,
 *   <total> in total" (ledger reading 6). Amounts are the one money format (`formatInvoiceMoney`).
 * - The period (06b-4 rework, reading 7): the period label — "2–29 Nov 2026", or "5 Oct 2026" for one day — in
 *   place of "week of …" and "Trial Shift, …", in the subjects and the sentences alike.
 * - Names are escaped in the html; subjects are one line (no CR/LF or other controls), whatever the snapshot holds.
 *
 * BB-wave1-041126/06b4, 2026-11-12; BB-wave1-041126/06b4-server, 2026-11-12.
 */

import { NO_PENCE } from "@/config/invoices";
import { SITE_NAME } from "@/lib/constants";
import { emailHeader } from "@/lib/email/brand";
import type { EmailTemplate } from "@/lib/email/templates/types";
import { formatHours, formatInvoiceMoney } from "../money";
import type { CancelReason, VatMode } from "../types";
import { periodLabel } from "../week";

/** The reasons she can give when cancelling (brief §0.8), as the list and the emails show them. */
export const CANCEL_REASON_LABELS: Readonly<Record<CancelReason, string>> = Object.freeze({
  wrong_hours: "Wrong hours",
  wrong_rate: "Wrong rate",
  wrong_period: "Wrong dates", // no weeks any more (06b-4 rework); the code stays `wrong_period`
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
  /** The period: its first and last shift dates (for an invoice of expenses only, its send date both times). */
  readonly periodStart: string;
  readonly periodEnd: string;
  /** Her full name (the invoice's snapshot). */
  readonly nannyName: string;
  /** The family's name (the invoice's snapshot). */
  readonly familyName: string;
  readonly figures: InvoiceEmailFigures;
  /** The cancelled invoice this one corrects, if any. */
  readonly replacesNumber: string | null;
}

export type InvoiceEmail = EmailTemplate & { readonly text: string };

/** "2–29 Nov 2026" or "5 Oct 2026": an invoice's period, in a subject or a sentence. */
export function invoicePeriod(facts: { readonly periodStart: string; readonly periodEnd: string }): string {
  return periodLabel(facts.periodStart, facts.periodEnd);
}

/** Plan 14.8's totals sentence, without its full stop; for expenses only, no hours and no VAT (reading 6). */
export function totalsClause(figures: InvoiceEmailFigures): string {
  const total = `${formatInvoiceMoney(figures.totalPence)} in total`;
  const expenses = `${formatInvoiceMoney(figures.expensesPence)} of expenses`;
  if (figures.hours === 0) return `${expenses}, ${total}`;
  const hours = `${formatHours(figures.hours)} ${figures.hours === 1 ? "hour" : "hours"} of childcare`;
  const withExpenses = figures.expensesPence > NO_PENCE ? ` and ${expenses}` : "";
  const vat = figures.vatMode === "none" ? "" : ", including VAT";
  return `${hours}${withExpenses}, ${total}${vat}`;
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
