/**
 * Trial-expiry T-5 reminder email (S17).
 *
 * Sent 5 days before the parent's trial ends. Per Bailey's Q11
 * decision: in-app trial-countdown banners are rejected; emails are
 * the urgency channel. Single email at T-5 only (T-1 reminder
 * deferred until conversion-data justifies adding it).
 *
 * Spec: `system/APP/PAYMENTS/FRONTEND/03-build-spec.md` §S17.
 *
 * Locked-in copy levers:
 * - Specificity ("you've been with us 25 days") — availability heuristic
 * - Reciprocity ("A$100 of every payment supports your nanny")
 * - No "track" / "tracking" terminology
 */

import type { EmailTemplate } from "./types";

interface TrialExpiryReminderParams {
  firstName: string;
  childFirstName: string;
  trialEndsAt: string; // ISO
  appUrl: string;
  childId: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function buildTrialExpiryReminderEmail(
  params: TrialExpiryReminderParams,
): EmailTemplate {
  const { firstName, childFirstName, trialEndsAt, appUrl, childId } = params;
  const formattedDate = formatDate(trialEndsAt);
  const subscribeUrl = `${appUrl}/parent/subscribe?childId=${encodeURIComponent(
    childId,
  )}`;

  const subject = `Your Baby Bloom trial ends in 5 days`;

  const btnStyle =
    "background: #8B5CF6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;";

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0f172a; max-width: 560px; margin: 0 auto; padding: 24px;">
  <h1 style="font-size: 22px; font-weight: 700; margin: 0 0 16px;">
    ${escapeHtml(firstName)}, your free trial ends in 5 days
  </h1>
  <p style="font-size: 16px; line-height: 1.5; color: #475569; margin: 0 0 16px;">
    Your Baby Bloom trial ends on <strong>${escapeHtml(formattedDate)}</strong>.
    Subscribe before then to keep following ${escapeHtml(childFirstName)}'s development with your nanny.
  </p>
  <p style="margin: 24px 0;">
    <a href="${escapeHtml(subscribeUrl)}" style="${btnStyle}">Subscribe now</a>
  </p>
  <p style="font-size: 14px; color: #475569; margin: 16px 0;">
    A$100 of every payment supports your nanny's work.
  </p>
  <p style="font-size: 12px; color: #94a3b8; margin: 32px 0 0;">
    Baby Bloom Sydney
  </p>
</body>
</html>`;

  // Plain-text payload kept for downstream tracing; the EmailTemplate
  // type only carries html + subject, but the cron passes both
  // through sendEmail directly. The text string is unused here —
  // remove the build step entirely.
  void firstName;
  void formattedDate;
  void subscribeUrl;
  void childFirstName;
  return { subject, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
