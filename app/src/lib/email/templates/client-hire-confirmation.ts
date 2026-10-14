/**
 * Client (parent) hire confirmation email.
 *
 * Unit 3g (BB-LDN-3g-141026, D-7): London parents are never verified and are never told to link the nanny's check
 * through a state portal, so that section and its link parameter are gone and the sections after it renumbered.
 * The commitment sentence ("…identity verified at onboarding") and the employer-obligations line are LEGAL text, left
 * as written for the legal chat (00-RULINGS #17; LEDGER/3g.md legal section).
 * Input: names, reference, date, EdTech link. Output: `{ subject, html, text }`. Never sends or reads anything.
 */
import { emailFooter } from "@/lib/email/brand";
import { LEGAL_ENTITY } from "@/lib/constants";

interface ClientHireEmailParams {
  clientName: string;
  professionalName: string;
  referenceNumber: string;
  hireDate: string;
  edtechLink: string;
}

export function buildClientHireConfirmationEmail(params: ClientHireEmailParams): {
  subject: string;
  html: string;
  text: string;
} {
  const { clientName, professionalName, referenceNumber, hireDate, edtechLink } = params;

  const subject = `Congratulations! Your hire of ${professionalName} is confirmed — Ref: ${referenceNumber}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#f8fafc;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;">
  <div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;padding:32px;">

    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background:#f5f3ff;border-radius:50%;width:56px;height:56px;line-height:56px;font-size:28px;">&#127881;</div>
    </div>

    <h1 style="font-size:24px;font-weight:700;text-align:center;margin:0 0 8px;">Congratulations, ${clientName}!</h1>
    <p style="text-align:center;color:#64748b;margin:0 0 24px;">Your hire has been mutually confirmed.</p>

    <div style="background:#f5f3ff;border-radius:12px;padding:16px;margin-bottom:24px;">
      <p style="margin:0 0 4px;font-size:14px;color:#64748b;">Reference Number</p>
      <p style="margin:0;font-size:18px;font-weight:600;color:#7c3aed;">${referenceNumber}</p>
    </div>

    <h2 style="font-size:18px;margin:24px 0 12px;">What happens next</h2>

    <h3 style="font-size:15px;margin:16px 0 8px;">1. Your Employer Obligations</h3>
    <p style="font-size:14px;color:#475569;line-height:1.6;">As the employer, you are responsible for ensuring compliance with the Fair Work Act 2009, including correct pay rates, superannuation, and working conditions. Baby Bloom is a facilitator only and is not the employer of your nanny.</p>

    <h3 style="font-size:15px;margin:16px 0 8px;">2. EdTech Tools</h3>
    <p style="font-size:14px;color:#475569;line-height:1.6;">You now have access to Baby Bloom's EdTech developmental logging tools. Your nanny can record developmental milestones, activities, and observations.</p>
    <p style="margin:8px 0;"><a href="${edtechLink}" style="color:#7c3aed;text-decoration:underline;">Explore EdTech Tools</a></p>

    <h3 style="font-size:15px;margin:16px 0 8px;">3. AI Content Notice</h3>
    <p style="font-size:14px;color:#475569;line-height:1.6;">Some content on the Platform, including nanny bios and matching summaries, is generated using AI (OpenAI GPT-4o). AI-generated content is clearly labelled and should be independently verified.</p>

    <h3 style="font-size:15px;margin:16px 0 8px;">4. Baby Bloom's Commitments to You</h3>
    <p style="font-size:14px;color:#475569;line-height:1.6;">We commit to maintaining the Platform, providing support, and ensuring that all professionals on the Platform have been WWCC and identity verified at onboarding.</p>

    ${emailFooter({ terms: "client", termsLabel: "Terms of Service", notice: "This email was sent to you because you confirmed a hire on Baby Bloom.", preferencesPath: "/parent/settings" })}

  </div>
</div>
</body>
</html>`;

  const text = `Congratulations, ${clientName}!

Your hire of ${professionalName} has been mutually confirmed.
Reference: ${referenceNumber}
Date: ${hireDate}

Please check your email for the full Hire Summary PDF attachment.

${LEGAL_ENTITY}`;

  return { subject, html, text };
}