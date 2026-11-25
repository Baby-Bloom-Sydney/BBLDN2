/**
 * deposit_link — the family's deposit link, emailed by BAI from her "Done for you" panel (plan 03 row B1; brief 03
 * §0.1, §3 Admin 3). Sent by `src/app/admin/users/[userId]/subscription/deposit-actions.ts` → `sendEmail`
 * (`email_type` `deposit_link`).
 *
 * - **Placeholder copy**: BAI edits the wording before switch-on (brief Q4, default accepted).
 * - One button to the given URL (`depositLinkUrl(code)`, `<SITE_URL>/deposit/<code>`); no other link but the client
 *   footer's legal links. The brand is `SITE_NAME` (in the subject and `emailHeader()`), never written out.
 * - Her first name and the URL are escaped with all five HTML characters (`escapeHtml`), so neither can open a tag
 *   or leave the `href` attribute. The subject carries no name, so nothing she typed reaches a mail header.
 * - No amount: the deposit page shows it (formatted from `PRICES` at run time).
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */

import { SITE_NAME } from "@/lib/constants";
import { emailFooter, emailHeader } from "@/lib/email/brand";
import { escapeHtml, escapeText, oneLine } from "./call-email-parts";
import type { EmailTemplate } from "./types";

export interface DepositLinkEmailParams {
  /** Her `user_profiles.first_name`; null or blank → a plain greeting. */
  readonly firstName: string | null;
  /** The family's deposit page, `depositLinkUrl(code)`. */
  readonly url: string;
}

/** The words (placeholders, brief Q4). */
const COPY = Object.freeze({
  subject: `Your ${SITE_NAME} deposit link`,
  heading: "Your deposit link",
  lines: [
    "Here is your link to pay your deposit and confirm your place in the cohort.",
    "You don't need to log in. The link is just for you, so please don't forward it.",
  ],
  button: "Pay your deposit",
} as const);

const PARAGRAPH = "font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;";
const BUTTON =
  "background:#8B5CF6;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;";

/** "Hi Sarah," (escaped), or "Hello," with no name. */
function greeting(firstName: string | null): string {
  const name = firstName?.trim() ?? "";
  return name === "" ? "Hello," : `Hi ${escapeHtml(name)},`;
}

export function depositLinkEmail(params: DepositLinkEmailParams): EmailTemplate {
  const paragraphs = [greeting(params.firstName), ...COPY.lines.map(escapeText)]
    .map((p) => `<p style="${PARAGRAPH}">${p}</p>`)
    .join("\n    ");
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#f8fafc;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;">
  <div style="background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;padding:32px;">
    ${emailHeader()}
    <h2 style="font-size:20px;font-weight:700;color:#1e293b;margin:0 0 16px;">${escapeText(COPY.heading)}</h2>
    ${paragraphs}
    <p style="margin:24px 0 0;"><a href="${escapeHtml(params.url)}" style="${BUTTON}">${escapeText(COPY.button)}</a></p>
    ${emailFooter({ terms: "client", termsLabel: "Terms of Service" })}
  </div>
</div>
</body></html>`;
  return { subject: oneLine(COPY.subject), html };
}
