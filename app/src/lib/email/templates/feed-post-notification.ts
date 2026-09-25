/**
 * Email template — sent to the linked parent when a nanny (or Katie) posts
 * a new tile to their child's feed.
 *
 * Subject + body degrade to neutral wording when either name is missing,
 * mirroring the NULL-fallback pattern in `welcome-invite-parent.ts`.
 *
 * Names are user-supplied (`user_profiles.first_name`) and MUST be escaped
 * before HTML embedding. The plain-text fallback uses the raw characters
 * directly (it's never rendered as HTML).
 *
 * See `system/APP/Notifications/FeedPosts/01-spec.md` § 4 for the full
 * copy + NULL-fallback table.
 */

import type { EmailTemplate } from "./types";
import { emailFooter } from "@/lib/email/brand";

export type FeedPostNotificationParams = {
  /** First name of the nanny / author. Sourced from `user_profiles.first_name`.
   *  May be `null` when the author hasn't filled their profile — copy degrades
   *  to neutral wording. */
  nannyFirstName: string | null;
  /** First name of the child whose feed received the tile. Sourced from
   *  `child_client.first_name`. May be `null` for a freshly-created child_client
   *  row that hasn't been edited. */
  childFirstName: string | null;
  /** `child_client.id` — the UUID of the child. Embedded in the CTA URL. */
  childId: string;
  /** Absolute base URL of the deployed app (e.g. `https://app.example.com`).
   *  Caller resolves from `process.env.NEXT_PUBLIC_APP_URL`. */
  appUrl: string;
};

/** Return shape extends the shared template type with a plain-text fallback
 *  for the `text` field on `sendEmail`. */
export type FeedPostNotificationEmail = EmailTemplate & {
  text: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildFeedPostNotificationEmail(
  params: FeedPostNotificationParams,
): FeedPostNotificationEmail {
  const { nannyFirstName, childFirstName, childId, appUrl } = params;

  // ── Subject — 4 NULL-fallback variants (raw, no escaping — subject is plain text)
  let subject: string;
  if (nannyFirstName && childFirstName) {
    subject = `${nannyFirstName} posted to ${childFirstName}'s feed`;
  } else if (childFirstName) {
    subject = `New post on ${childFirstName}'s feed`;
  } else if (nannyFirstName) {
    subject = `${nannyFirstName} posted a new update`;
  } else {
    subject = `New post on your child's feed`;
  }

  // ── Plain-text body (raw — used by `sendEmail`'s `text` field; never HTML-rendered)
  let textSentence: string;
  if (nannyFirstName && childFirstName) {
    textSentence = `${nannyFirstName} has just posted to ${childFirstName}'s feed on Baby Bloom — check it out!`;
  } else if (childFirstName) {
    textSentence = `There's a new post on ${childFirstName}'s feed on Baby Bloom — check it out!`;
  } else if (nannyFirstName) {
    textSentence = `${nannyFirstName} has just posted a new update on Baby Bloom — check it out!`;
  } else {
    textSentence = `There's a new post on your child's feed on Baby Bloom — check it out!`;
  }

  const feedUrl = `${appUrl}/parent/development/${encodeURIComponent(childId)}`;
  const text = `${textSentence}\n\n${feedUrl}\n`;

  // ── HTML body — escape user-supplied names before interpolation
  const safeNanny = nannyFirstName ? escapeHtml(nannyFirstName) : null;
  const safeChild = childFirstName ? escapeHtml(childFirstName) : null;

  const headingChildSegment = safeChild
    ? `${safeChild}&#39;s`
    : "your child&#39;s";
  const heading = `New post on ${headingChildSegment} feed`;

  let bodySentenceHtml: string;
  if (safeNanny && safeChild) {
    bodySentenceHtml = `${safeNanny} has just posted to ${safeChild}&#39;s feed on Baby Bloom &mdash; check it out!`;
  } else if (safeChild) {
    bodySentenceHtml = `There&#39;s a new post on ${safeChild}&#39;s feed on Baby Bloom &mdash; check it out!`;
  } else if (safeNanny) {
    bodySentenceHtml = `${safeNanny} has just posted a new update on Baby Bloom &mdash; check it out!`;
  } else {
    bodySentenceHtml = `There&#39;s a new post on your child&#39;s feed on Baby Bloom &mdash; check it out!`;
  }

  const ctaText = safeChild ? `Open ${safeChild}&#39;s feed` : `Open the feed`;

  const btnStyle =
    "background:#8B5CF6;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;";

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#f8fafc;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;">
  <div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;padding:32px;">
    <div style="text-align:center;margin-bottom:24px;font-size:20px;font-weight:700;letter-spacing:-0.5px;">
      <span style="color:#0f172a;">Baby</span><span style="color:#8b5cf6;">Bloom</span>
    </div>
    <h1 style="font-size:22px;font-weight:700;text-align:center;margin:0 0 16px;color:#0f172a;">${heading}</h1>
    <p style="font-size:15px;color:#475569;line-height:1.6;text-align:center;margin:0 0 24px;">${bodySentenceHtml}</p>
    <div style="text-align:center;margin-top:8px;">
      <a href="${feedUrl}" style="${btnStyle}">${ctaText}</a>
    </div>
    ${emailFooter({ terms: "client", termsLabel: "Terms of Service", align: "center" })}
  </div>
</div>
</body></html>`;

  return { subject, html, text };
}
