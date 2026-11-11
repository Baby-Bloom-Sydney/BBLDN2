/**
 * The call offer inside the family's connection-expiry email (INT-005, sent by `api/cron/expire-connections`): one
 * paragraph and its own centred "Pick a time" button to the call page, inserted just above that email's "Browse
 * Nannies" button. The inline styles are that email's own. The cron adds it only when the call page would take her
 * (`callOfferForExpiredFamily`).
 */

import { CALL_NAME } from "@/lib/calls/copy";
import { CALL_PAGE_URL, escapeHtml, escapeText } from "./call-email-parts";

const PARAGRAPH = "font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;";
const BUTTON =
  "display:inline-block;background:#8b5cf6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;";

const OFFER_LINE = `Would some help with your search be useful? Book your ${CALL_NAME} with one of our expert matchmakers, who'll introduce you to your top nannies.`;
const BUTTON_LABEL = "Pick a time";

/** The HTML fragment; it starts on a new line, indented as the email's other blocks are. */
export function connectionExpiredCallOfferHtml(): string {
  return `
    <p style="${PARAGRAPH}">${escapeText(OFFER_LINE)}</p>
    <div style="text-align:center;margin-top:24px;">
      <a href="${escapeHtml(CALL_PAGE_URL)}" style="${BUTTON}">${escapeText(BUTTON_LABEL)}</a>
    </div>`;
}
