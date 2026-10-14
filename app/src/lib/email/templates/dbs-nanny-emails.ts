/**
 * DBS nanny emails — the final copy for the five DBS emails sent to a nanny (unit 3g, BB-LDN-3g-141026).
 *
 * Purpose: one builder per email; the senders in `lib/email/dbs-emails.ts` call them (README "DBS emails": 3c owns the
 * senders, 3g the nanny copy). Wording is pasted from the copy deck (`06-build-drafts/02-copy-deck.md`), never re-written:
 *   - VER-004-DBS manual review submitted — deck §6.4; "24–48 hours" kept as the original string (00-RULINGS #18).
 *   - VER-010 barred — deck §6.5; three `[LEGAL]` paragraphs (00-RULINGS #17, #23). README P-14: a bar drops every
 *     connection, hired ones too, so this email never says families or hired positions stay.
 *   - DBS rejected — README P-4 (proposed words, BAI P-11: drafts fine for now). Status 22 offers Edit & Resubmit only
 *     (orchestrator ruling 2026-10-06, addendum 2026-10-14), so no manual review is offered.
 *   - Re-check failed, NEW_INFO (23) / NO_MATCH (26) — deck §6.6 (00-RULINGS #12) plus the README P-3 line (proposed):
 *     she keeps the families she already works with; her other requests and introductions were closed. Says "won't be
 *     matched / can't accept", never "hidden" (deck accuracy note: browse can still show a level-2 profile).
 *
 * Inputs: `{ firstName, appUrl }` (+ `reason` for the rejected email). Output: `{ subject, html }`.
 * Links come only from `DBS_LINKS` (00-RULINGS #14) or `appUrl`.
 * Never: sends, reads or writes anything; interpolates user text unescaped (`escapeHtml` on `firstName` and `reason`);
 * mentions the old regulator, the old check name or "hidden".
 */
import type { EmailTemplate } from "./types";
import { emailFooter } from "@/lib/email/brand";
import { DBS_LINKS } from "@/lib/constants";

export interface DbsNannyEmailParams {
  firstName: string;
  appUrl: string;
}

export interface DbsRejectedEmailParams extends DbsNannyEmailParams {
  /** The admin's chip or free text (README P-4). Escaped here. */
  reason: string;
}

/** HTML-escapes user-supplied text (same helper shape as the other templates in this folder). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const P = "font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;";
const LINK = "color:#7c3aed;text-decoration:underline;";

function para(text: string): string {
  return `    <p style="${P}">${text}</p>`;
}

/** "What to do" heading + numbered steps (trusted strings). */
function steps(items: string[]): string {
  const li = items.map((s) => `<li>${s}</li>`).join("");
  return `    <p style="${P}font-weight:600;color:#1e293b;margin-bottom:4px;">What to do</p>
    <ol style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;padding-left:20px;">${li}</ol>`;
}

function link(label: string, href: string): string {
  return `    <p style="${P}"><a href="${href}" style="${LINK}">${label}</a></p>`;
}

/**
 * The card shell the delayed verification emails (VER-002/003) use: wordmark, H1, paragraphs, an optional CTA button
 * and the shared footer (`emailFooter`). Every argument is TRUSTED markup — escape user text before passing it.
 */
function shell(heading: string, body: string, cta?: { label: string; href: string }): string {
  const button = cta
    ? `
    <div style="text-align:center;margin-top:24px;">
      <a href="${cta.href}" style="display:inline-block;background:#8b5cf6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">${cta.label}</a>
    </div>`
    : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#f8fafc;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;">
  <div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;padding:32px;">
    <div style="margin-bottom:24px;">
      <span style="font-size:20px;font-weight:700;"><span style="color:#0f172a;">Baby</span><span style="color:#8b5cf6;">Bloom</span></span>
    </div>
    <h1 style="font-size:22px;font-weight:700;margin:0 0 16px;">${heading}</h1>
${body}${button}
    ${emailFooter()}
  </div>
</div>
</body></html>`;
}

const verificationUrl = (appUrl: string) => `${appUrl}/nanny/verification`;

/** VER-004-DBS — she asked for a manual review (deck §6.4). */
export function buildDbsManualReviewEmail({ firstName, appUrl }: DbsNannyEmailParams): EmailTemplate {
  return {
    subject: "We're reviewing your DBS certificate",
    html: shell(
      "We've received your certificate",
      [
        para(`Hi ${escapeHtml(firstName)}, your DBS certificate has been sent to our team for a manual review.`),
        // #18: the original turnaround string, kept as it is.
        para("We'll review everything and get back to you within 24–48 hours. No further action is needed from you right now."),
        para("You can check the status of your verification at any time from your dashboard."),
      ].join("\n"),
      { label: "View Status", href: verificationUrl(appUrl) },
    ),
  };
}

/** VER-010 — barred (deck §6.5, status 27). Subject and H1 KEEP; three `[LEGAL]` paragraphs; no CTA. */
export function buildDbsBarredEmail({ firstName }: DbsNannyEmailParams): EmailTemplate {
  return {
    subject: "Important: Your Baby Bloom account has been restricted",
    html: shell(
      "Your account has been restricted",
      [
        // [LEGAL]
        para(`Hi ${escapeHtml(firstName)}, following a review of your DBS certificate, we've suspended your Baby Bloom account.`),
        // [LEGAL — whether/how she can challenge it]
        para("Your profile is no longer visible to families."),
        // [LEGAL]
        para("If you have questions, reply to this email and our team will get back to you."),
      ].join("\n"),
    ),
  };
}

/** The admin's reason as one sentence: trimmed, escaped, without a trailing full stop (the template adds one). */
function reasonSentence(reason: string): string {
  return escapeHtml(reason.trim().replace(/\.+$/, ""));
}

/** DBS rejected — status 22 (README P-4, proposed words). Edit & Resubmit only: no manual review offered. */
export function buildDbsRejectedEmail({ firstName, appUrl, reason }: DbsRejectedEmailParams): EmailTemplate {
  return {
    subject: "Action needed: your DBS certificate wasn't approved",
    html: shell(
      "We couldn't approve your DBS certificate",
      [
        para(
          `Hi ${escapeHtml(firstName)}, our team reviewed your DBS certificate and couldn't approve it. ` +
            `The reason: ${reasonSentence(reason)}.`,
        ),
        para("To be approved, upload page 1 of your enhanced DBS certificate again — a clear, unedited photo or the PDF."),
      ].join("\n"),
      { label: "Fix it now", href: verificationUrl(appUrl) },
    ),
  };
}

/** README P-3 (proposed): true because 3i keeps her CONFIRMED / ACTIVE connections and closes the rest. */
const P3_LINE =
  "Families you're already working with aren't affected. Any other requests and introductions you had in progress have been closed.";

/** Deck §6.6 close (both re-check emails). 23 and 26 offer both buttons, so a manual review is right here. */
const RECHECK_CLOSE =
  "If you think this is a mistake, reply to this email or request a manual review from your verification page.";

/** Re-check failed, `NEW_INFO` → 23 (deck §6.6). */
export function buildDbsRecheckNewInfoEmail({ firstName, appUrl }: DbsNannyEmailParams): EmailTemplate {
  return {
    subject: "Action needed: you'll need a new DBS certificate",
    html: shell(
      "Your DBS certificate needs updating",
      [
        para(
          `Hi ${escapeHtml(firstName)}, we check every nanny's certificate with the DBS Update Service. ` +
            "Today's check shows there's new information since your certificate was issued, so we can't use it any more. " +
            "It doesn't tell us what the information is.",
        ),
        para("Until you upload a new certificate, you won't be matched with new families and you can't accept requests."),
        para(P3_LINE),
        steps([
          "Apply for a new enhanced DBS.",
          "Join the Update Service when it arrives (within 30 days).",
          "Upload page 1 on your verification page.",
        ]),
        link("Get an enhanced DBS →", DBS_LINKS.getEnhanced),
        para(RECHECK_CLOSE),
      ].join("\n"),
      { label: "Upload new certificate", href: verificationUrl(appUrl) },
    ),
  };
}

/** Re-check failed, `NO_MATCH` → 26 (deck §6.6). */
export function buildDbsRecheckNoMatchEmail({ firstName, appUrl }: DbsNannyEmailParams): EmailTemplate {
  return {
    subject: "Action needed: we couldn't confirm your DBS certificate",
    html: shell(
      "We couldn't find your certificate on the Update Service",
      [
        para(
          `Hi ${escapeHtml(firstName)}, we check every nanny's certificate with the DBS Update Service. ` +
            "Today it didn't find a match for yours. This usually means your Update Service subscription has ended.",
        ),
        para("Until this is sorted, you won't be matched with new families and you can't accept requests."),
        para(P3_LINE),
        steps([
          "Check your Update Service subscription is active (it renews yearly).",
          "If it has ended, you'll need a new enhanced DBS and to join again.",
          "Then upload page 1 on your verification page.",
        ]),
        link("Join the Update Service →", DBS_LINKS.joinUpdateService),
        para(RECHECK_CLOSE),
      ].join("\n"),
      { label: "Check my verification", href: verificationUrl(appUrl) },
    ),
  };
}
