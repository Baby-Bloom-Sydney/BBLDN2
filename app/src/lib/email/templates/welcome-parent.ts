/**
 * Welcome email — standard parent (matchmaking funnel signup).
 *
 * Used when a parent signs up via the public matchmaking flow (no
 * invite token). Frames the product as "find a nanny". For parents
 * who arrive via a child-invite link the variant `welcome-invite-
 * parent.ts` is used instead — that audience already has a nanny.
 *
 * Copy is preserved verbatim from the inline template that lived in
 * `lib/auth/actions.ts` prior to amendment A-01 (extraction only).
 */

import type { EmailTemplate } from "./types";
import { emailFooter } from "@/lib/email/brand";
import { SITE_NAME } from "@/lib/constants";

type WelcomeParentEmailParams = {
  firstName: string;
  appUrl: string;
};

export function buildWelcomeParentEmail(
  params: WelcomeParentEmailParams,
): EmailTemplate {
  const { firstName, appUrl } = params;
  const btnStyle =
    "background: #8B5CF6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;";

  const subject = `Welcome to Baby Bloom, ${firstName}!`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#f8fafc;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;">
  <div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;padding:32px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background:#f5f3ff;border-radius:50%;width:56px;height:56px;line-height:56px;font-size:28px;">&#127881;</div>
    </div>
    <h1 style="font-size:24px;font-weight:700;text-align:center;margin:0 0 8px;">Welcome, ${firstName}!</h1>
    <p style="text-align:center;color:#64748b;margin:0 0 24px;">Your Baby Bloom account has been created.</p>
    <p style="font-size:14px;color:#475569;line-height:1.6;">We're excited to have you join ${SITE_NAME}. Here's how to get started:</p>
    <div style="background:#f5f3ff;border-radius:12px;padding:16px;margin:16px 0;">
      <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#7c3aed;">Next steps</p>
      <ol style="margin:0;padding-left:20px;font-size:14px;color:#475569;line-height:1.8;">
        <li>Browse our verified, education-focused nannies</li>
        <li>Create a position to start matching with the right nanny</li>
        <li>Request a meet and greet when you find a great fit</li>
      </ol>
    </div>
    <div style="text-align:center;margin-top:24px;">
      <a href="${appUrl}/parent/dashboard" style="${btnStyle}">Go to Your Dashboard</a>
    </div>
    ${emailFooter({ terms: "client", termsLabel: "Terms of Service" })}
  </div>
</div>
</body></html>`;

  return { subject, html };
}
