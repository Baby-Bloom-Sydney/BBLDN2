/**
 * Welcome email — parent who signed up via a child-invite link.
 *
 * Frames Baby Bloom as the place to track their child's day with the
 * nanny they're already linked to — NOT as a "find a nanny" funnel.
 * Per amendment A-01 in `system/APP/Ammendments/V 1.1/`.
 *
 * The CTA links to the canonical invite-landing path with `?auto=1`,
 * which the InviteLandingClient consumes to fire `connectChildInvite`
 * on mount (single-tap onboarding for the freshly-authed parent).
 * Token is included so the link still works if the parent opens the
 * email later from a different device.
 */

import type { EmailTemplate } from "./types";
import { emailFooter } from "@/lib/email/brand";

type WelcomeInviteParentEmailParams = {
  firstName: string;
  /** First name of the nanny who sent the invite. Sourced from
   *  `user_profiles.first_name` on the inviter row. May be `null` when
   *  the inviting nanny hasn't filled her profile — the subject + body
   *  degrade to neutral wording in that case. */
  nannyFirstName: string | null;
  /** First name of the child being shared. Sourced from
   *  `child_client.first_name`. May be `null` for a freshly-created
   *  child_client row that hasn't been edited. */
  childFirstName: string | null;
  /** Original invite token, used to deep-link back to /invite/[token]
   *  with `?auto=1` so the connect step fires automatically. */
  inviteToken: string;
  appUrl: string;
};

export function buildWelcomeInviteParentEmail(
  params: WelcomeInviteParentEmailParams,
): EmailTemplate {
  const { firstName, nannyFirstName, childFirstName, inviteToken, appUrl } =
    params;
  const btnStyle =
    "background: #8B5CF6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;";

  // Fallback wording when name fields are missing. Body copy can use the
  // generic phrases inline — they read naturally — but the subject line
  // omits the name entirely rather than printing "you're connected with
  // your nanny" which looks like a mail-merge error. Code-reviewer HIGH
  // 2026-05-06.
  const nannyLabel = nannyFirstName ?? "your nanny";
  const childLabel = childFirstName ?? "your child";
  const childPossessive = childFirstName ? `${childFirstName}'s` : "their";

  const subject = nannyFirstName
    ? `Welcome to Baby Bloom — you're connected with ${nannyFirstName}`
    : `Welcome to Baby Bloom — your child's diary is ready`;

  // Token regex (XXXX-XXXX, Crockford alphabet) is URL-safe today, but
  // encoding here is cheap defence-in-depth and decouples the template
  // from any future token-format change.
  const safeToken = encodeURIComponent(inviteToken);

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#f8fafc;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;">
  <div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;padding:32px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background:#f5f3ff;border-radius:50%;width:56px;height:56px;line-height:56px;font-size:28px;">&#127881;</div>
    </div>
    <h1 style="font-size:24px;font-weight:700;text-align:center;margin:0 0 8px;">Welcome, ${firstName}!</h1>
    <p style="text-align:center;color:#64748b;margin:0 0 24px;">You're connected with ${nannyLabel} on Baby Bloom.</p>
    <p style="font-size:14px;color:#475569;line-height:1.6;">Baby Bloom is where you can follow ${childPossessive} day with ${nannyLabel} &mdash; photos, milestones, food and sleep, and notes from each session.</p>
    <div style="background:#f5f3ff;border-radius:12px;padding:16px;margin:16px 0;">
      <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#7c3aed;">What you can do</p>
      <ul style="margin:0;padding-left:20px;font-size:14px;color:#475569;line-height:1.8;">
        <li>See ${childPossessive} feed updated by ${nannyLabel} throughout the day</li>
        <li>Track milestones and developmental progress over time</li>
        <li>Ask Katie, your AI helper, anything about parenting and ${childPossessive} growth</li>
      </ul>
    </div>
    <div style="text-align:center;margin-top:24px;">
      <a href="${appUrl}/invite/${safeToken}?auto=1" style="${btnStyle}">Open ${childLabel}&apos;s feed</a>
    </div>
    ${emailFooter({ terms: "client", termsLabel: "Terms of Service" })}
  </div>
</div>
</body></html>`;

  return { subject, html };
}
