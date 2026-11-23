/**
 * The Friday invoice reminder email (plan 06 §16.7 b5.4; wording §16.9, approved by BAI 2026-11-11; the link §16.0,
 * BAI 2026-11-23). The runner (`reminders.ts`) sends one to each nanny with a running hire she hasn't invoiced for
 * the week.
 *
 * - **One family:** the sentence names it, and "Create invoice" opens the create-invoice form with that family chosen
 *   (`/nanny/invoices/new?placement=<id>`; 06b-4's page takes the parameter). **Several:** the list, one per line, and
 *   the plain form. Never a `week` parameter: the form has none (§16.0).
 * - **No amount and no bank detail:** its inputs are her first name, the week and the families' names.
 * - Names are escaped in the html (text nodes `& < >`, the link's attribute all five); the subject is fixed text
 *   and the week's date. The brand header and the nanny footer (`brand.ts`), as the bank-change email; a button like
 *   the call emails' (`callEmailShell`). "Hi there," for a blank first name.
 * - Pure: builds strings, sends nothing.
 *
 * BB-wave1-041126/06b5-app, 2026-11-23.
 */

import { SITE_NAME, SITE_URL } from "@/lib/constants";
import { emailFooter, emailHeader } from "@/lib/email/brand";
import type { EmailTemplate } from "@/lib/email/templates/types";
import { periodLabel } from "../week";

/** Its `email_logs.email_type`. */
export const INVOICE_REMINDER_EMAIL_TYPE = "invoice_reminder";

/** The create-invoice form (06b-4). */
const FORM_PATH = "/nanny/invoices/new";
const BUTTON_LABEL = "Create invoice";

export interface InvoiceReminderFamily {
  readonly placementId: string;
  readonly familyName: string;
}

export interface InvoiceReminderParams {
  readonly firstName: string;
  /** The London week's Monday, "YYYY-MM-DD". */
  readonly weekStart: string;
  /** The families she hasn't invoiced for the week: at least one. */
  readonly families: readonly InvoiceReminderFamily[];
}

const ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** For a text node: `& < >` (quotes stay readable — "haven't"). */
const escapeText = (value: string): string => value.replace(/[&<>]/g, (c) => ESCAPES[c] ?? c);
/** For an attribute value: all five. */
const escapeAttribute = (value: string): string => value.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

/** One family: the form with it chosen. Several: the plain form. */
function linkOf(families: readonly InvoiceReminderFamily[]): string {
  const [only] = families;
  return families.length === 1 && only ? `${SITE_URL}${FORM_PATH}?placement=${encodeURIComponent(only.placementId)}` : `${SITE_URL}${FORM_PATH}`;
}

/** The lines before the button: the greeting, the sentence, and (several families) the names, one per line. */
function linesOf(params: InvoiceReminderParams, week: string): { readonly greeting: string; readonly sentence: string; readonly names: readonly string[] } {
  const name = params.firstName.trim();
  const greeting = `Hi ${name === "" ? "there" : name},`;
  const [only] = params.families;
  if (params.families.length === 1 && only) {
    return { greeting, sentence: `You haven't sent an invoice to ${only.familyName} for the week of ${week} yet.`, names: [] };
  }
  return { greeting, sentence: `You haven't sent these families an invoice for the week of ${week} yet:`, names: params.families.map((f) => f.familyName) };
}

const PARAGRAPH = "font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;";
const BUTTON =
  "background:#8B5CF6;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;";

export function invoiceReminderEmail(params: InvoiceReminderParams): EmailTemplate & { readonly text: string } {
  if (params.families.length === 0) throw new RangeError("a reminder names at least one family");
  const week = periodLabel(params.weekStart, params.weekStart); // one day: "8 Feb 2027"
  const { greeting, sentence, names } = linesOf(params, week);
  const href = linkOf(params.families);
  const paragraph = (inner: string): string => `<p style="${PARAGRAPH}">${inner}</p>`;
  const body = [
    paragraph(escapeText(greeting)),
    paragraph(escapeText(sentence)),
    ...(names.length > 0 ? [paragraph(names.map(escapeText).join("<br/>"))] : []),
    `<p style="margin:24px 0 0;"><a href="${escapeAttribute(href)}" style="${BUTTON}">${BUTTON_LABEL}</a></p>`,
  ].join("\n    ");
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#f8fafc;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;">
  <div style="background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;padding:32px;">
    ${emailHeader()}
    <h2 style="font-size:20px;font-weight:700;color:#1e293b;margin:0 0 16px;">Invoice reminder</h2>
    ${body}
    ${emailFooter()}
  </div>
</div>
</body></html>`;
  return {
    subject: `Invoice reminder — week of ${week}`,
    html,
    text: [greeting, sentence, ...(names.length > 0 ? [names.join("\n")] : []), `${BUTTON_LABEL}: ${href}`, SITE_NAME].join("\n\n"),
  };
}
