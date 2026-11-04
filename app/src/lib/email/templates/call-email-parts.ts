/**
 * Shared parts of the call emails (brief 04 §5 email types; plan B1): the seven email types, the two links, the
 * caller line, escaping, and one shell for every call email.
 *
 * The shell takes **plain text** and escapes all of it, so no builder can forget to escape a name: text nodes get
 * `& < >` (quotes stay readable — "We'll"), attributes get all five. Subjects are plain text too, never HTML, and
 * pass through `oneLine` so a name can never add a line to a mail header.
 *
 * Parent emails close with the client footer; admin emails (internal, to `ADMIN_EMAIL`) carry no legal footer, as
 * the existing admin emails don't (`api/cron/payment-due-sweep/route.ts`).
 *
 * BB-wave1-041126/04b-build, 2026-11-04.
 */

import { SITE_URL } from "@/lib/constants";
import { emailFooter, emailHeader } from "@/lib/email/brand";
import { formatUkMobile } from "@/lib/uk-contact";

/** The `email_logs.email_type` of each call email (brief §5). */
export const CALL_EMAIL_TYPES = Object.freeze({
  confirmation: "call_booking_confirmation",
  changed: "call_booking_changed",
  cancelled: "call_booking_cancelled",
  reminder: "call_reminder",
  notBooked: "call_not_booked",
  adminBooked: "admin_call_booked",
  adminReminder: "admin_call_reminder",
} as const);

export const CALL_PAGE_URL = `${SITE_URL}/parent/call`;
export const ADMIN_CALLS_URL = `${SITE_URL}/admin/calls`;

const ATTRIBUTE_ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** For an attribute value: all five HTML characters. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ATTRIBUTE_ESCAPES[c] ?? c);
}

/** For a text node: `& < >`. */
export function escapeText(value: string): string {
  return value.replace(/[&<>]/g, (c) => ATTRIBUTE_ESCAPES[c] ?? c);
}

/** One line, single-spaced: for a subject. */
export function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** "We'll call you from +44 (0) 7700 900 123." — null while the caller-number setting is empty (brief §5.1). */
export function callerLine(callerNumber: string | null): string | null {
  if (callerNumber === null || callerNumber.trim() === "") return null;
  return `We'll call you from ${formatUkMobile(callerNumber)}.`;
}

/** What every parent call email takes: her first name, and the caller-number setting (null → no caller line). */
export interface ParentCallEmailParams {
  readonly firstName: string;
  readonly callerNumber: string | null;
}

/** "Hi Jane,", the email's own lines, then the caller line when the setting is set. */
export function parentParagraphs(params: ParentCallEmailParams, lines: readonly string[]): readonly string[] {
  const caller = callerLine(params.callerNumber);
  return [`Hi ${params.firstName},`, ...lines, ...(caller === null ? [] : [caller])];
}

export interface CallEmailBody {
  readonly heading: string;
  readonly paragraphs: readonly string[];
  readonly button?: { readonly label: string; readonly href: string };
  readonly audience: "parent" | "admin";
}

const PARAGRAPH = "font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;";
const BUTTON =
  "background:#8B5CF6;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;";

/** The whole email: brand header, heading, paragraphs, an optional button, the client footer for parents. */
export function callEmailShell(body: CallEmailBody): string {
  const paragraphs = body.paragraphs.map((p) => `<p style="${PARAGRAPH}">${escapeText(p)}</p>`).join("\n    ");
  const button = body.button
    ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(body.button.href)}" style="${BUTTON}">${escapeText(body.button.label)}</a></p>`
    : "";
  const footer = body.audience === "parent" ? emailFooter({ terms: "client", termsLabel: "Terms of Service" }) : "";
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#f8fafc;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;">
  <div style="background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;padding:32px;">
    ${emailHeader()}
    <h2 style="font-size:20px;font-weight:700;color:#1e293b;margin:0 0 16px;">${escapeText(body.heading)}</h2>
    ${paragraphs}
    ${button}
    ${footer}
  </div>
</div>
</body></html>`;
}
