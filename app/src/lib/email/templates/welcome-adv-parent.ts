/**
 * Welcome email — advanced-matchmaking parent (T-040 Step 1c).
 *
 * Used when a parent signs up via `signUpAndConvertLead` (the
 * `/matchmaking/signup?lead=<uuid>` form). By the time this email
 * fires, the parent's position has been created from their wizard
 * answers AND `autofireMatchmaking` has activated Advanced DFY on
 * it — so the email frames the product as "we're already reaching
 * out to your best-fit nannies" rather than "now create a position".
 *
 * Mirrors the post-signup "position live" modal copy + the
 * `ConnectModal.JOURNEY_STEPS` connection stepper (Connect → Meet
 * & Greet → Trial Shift → Matched!) so the parent's first three
 * touchpoints (signup screen → email → dashboard) all tell the
 * same story.
 *
 * The standard `welcome-parent.ts` template is suppressed for this
 * audience via the `skip_welcome_email` FormData flag in `signUp`.
 */

import type { EmailTemplate } from "./types";
import { emailFooter } from "@/lib/email/brand";

type WelcomeAdvParentEmailParams = {
  firstName: string;
  appUrl: string;
};

const STEPS = [
  {
    n: 1,
    label: "Connect",
    body: "Your best-matched nannies receive your request and can apply.",
  },
  {
    n: 2,
    label: "Meet & Greet",
    body: "Schedule a quick chat to see if they're the right fit for your family.",
  },
  {
    n: 3,
    label: "Trial Shift",
    body: "Arrange a paid trial so you can see them in action with your kids.",
  },
  {
    n: 4,
    label: "Matched!",
    body: "Confirm the placement and start your ongoing arrangement.",
  },
];

export function buildWelcomeAdvParentEmail(
  params: WelcomeAdvParentEmailParams,
): EmailTemplate {
  const { firstName, appUrl } = params;

  const btnStyle =
    "background: #8B5CF6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;";

  const subject = `${firstName}, your position is live — we're reaching out to your matches`;

  const stepsHtml = STEPS.map(
    (s) => `
        <tr>
          <td style="vertical-align:top;width:36px;padding:6px 12px 6px 0;">
            <div style="width:28px;height:28px;background:#8B5CF6;color:#fff;border-radius:50%;text-align:center;line-height:28px;font-size:13px;font-weight:700;">${s.n}</div>
          </td>
          <td style="padding:6px 0;font-size:14px;color:#475569;line-height:1.6;vertical-align:top;">
            <div style="font-weight:600;color:#1e293b;margin-bottom:2px;">${s.label}</div>
            <div>${s.body}</div>
          </td>
        </tr>`,
  ).join("");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#f8fafc;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;">
  <div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;padding:32px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background:#f5f3ff;border-radius:50%;width:56px;height:56px;line-height:56px;font-size:28px;">&#10024;</div>
    </div>
    <h1 style="font-size:24px;font-weight:700;text-align:center;margin:0 0 8px;">Welcome, ${firstName}!</h1>
    <p style="text-align:center;color:#64748b;margin:0 0 8px;font-size:15px;line-height:1.5;">
      Your position is live &mdash; we're reaching out to your best-fit nannies right now.
    </p>
    <p style="text-align:center;color:#7c3aed;margin:0 0 24px;font-size:13px;font-weight:600;">
      You'll be notified the moment they apply.
    </p>
    <div style="background:#f5f3ff;border-radius:12px;padding:20px;margin:16px 0;">
      <p style="margin:0 0 14px;font-size:13px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:0.04em;">What happens next</p>
      <table role="presentation" style="width:100%;border-collapse:collapse;">
        <tbody>${stepsHtml}
        </tbody>
      </table>
    </div>
    <div style="text-align:center;margin-top:28px;">
      <a href="${appUrl}/parent?t=childcare&amp;s=nannies&amp;v=matches" style="${btnStyle}">View your matches</a>
    </div>
    <p style="font-size:13px;color:#64748b;line-height:1.6;text-align:center;margin:20px 0 0;">
      We've activated Advanced matchmaking on your position. No further action needed &mdash; sit tight while we do the legwork.
    </p>
    ${emailFooter({ terms: "client", termsLabel: "Terms of Service", align: "center" })}
  </div>
</div>
</body></html>`;

  return { subject, html };
}
