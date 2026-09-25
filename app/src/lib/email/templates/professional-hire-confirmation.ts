interface ProfessionalHireEmailParams {
  professionalName: string;
  clientName: string;
  referenceNumber: string;
  hireDate: string;
  edtechLink: string;
}

export function buildProfessionalHireConfirmationEmail(params: ProfessionalHireEmailParams): {
  subject: string;
  html: string;
  text: string;
} {
  const { professionalName, clientName, referenceNumber, hireDate, edtechLink } = params;

  const subject = `Congratulations! Your placement with ${clientName} is confirmed — Ref: ${referenceNumber}`;

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

    <h1 style="font-size:24px;font-weight:700;text-align:center;margin:0 0 8px;">Congratulations, ${professionalName}!</h1>
    <p style="text-align:center;color:#64748b;margin:0 0 24px;">Your placement has been mutually confirmed.</p>

    <div style="background:#f5f3ff;border-radius:12px;padding:16px;margin-bottom:24px;">
      <p style="margin:0 0 4px;font-size:14px;color:#64748b;">Reference Number</p>
      <p style="margin:0;font-size:18px;font-weight:600;color:#7c3aed;">${referenceNumber}</p>
    </div>

    <h2 style="font-size:18px;margin:24px 0 12px;">Important reminders</h2>

    <h3 style="font-size:15px;margin:16px 0 8px;">1. Your Contractor Status</h3>
    <p style="font-size:14px;color:#475569;line-height:1.6;">You are an independent contractor, not an employee of Baby Bloom or the family. You are responsible for your own ABN, tax, superannuation, and public liability insurance.</p>

    <h3 style="font-size:15px;margin:16px 0 8px;">2. ABN &amp; Insurance</h3>
    <p style="font-size:14px;color:#475569;line-height:1.6;">Ensure your ABN is registered with the ATO and your public liability insurance is current. You may be asked to provide proof of insurance by the family.</p>

    <h3 style="font-size:15px;margin:16px 0 8px;">3. EdTech Tools</h3>
    <p style="font-size:14px;color:#475569;line-height:1.6;">You can optionally use Baby Bloom's EdTech developmental logging tools to record the child's milestones and activities. The family will have access to this data.</p>
    <p style="margin:8px 0;"><a href="${edtechLink}" style="color:#7c3aed;text-decoration:underline;">Access EdTech Tools</a></p>

    <h3 style="font-size:15px;margin:16px 0 8px;">4. Affiliate Acknowledgment</h3>
    <p style="font-size:14px;color:#475569;line-height:1.6;">Baby Bloom may receive affiliate commissions from third-party products or services recommended on the Platform. These will always be disclosed.</p>

    <h3 style="font-size:15px;margin:16px 0 8px;">5. Confidentiality</h3>
    <p style="font-size:14px;color:#475569;line-height:1.6;">You must keep all information about the family, their children, household, and routines strictly confidential. This obligation survives termination of the arrangement.</p>

    <h3 style="font-size:15px;margin:16px 0 8px;">6. Baby Bloom's Commitments</h3>
    <p style="font-size:14px;color:#475569;line-height:1.6;">We commit to maintaining the Platform, providing support, and ensuring compliance with the Privacy Act 1988 and other applicable legislation.</p>

    <h3 style="font-size:15px;margin:16px 0 8px;">7. Data Retention</h3>
    <p style="font-size:14px;color:#475569;line-height:1.6;">Your placement data will be retained for 5 years after the placement ends, as required for regulatory and dispute resolution purposes. You can request deletion of non-essential data at any time.</p>

    <div style="margin-top:32px;padding-top:24px;border-top:1px solid #e2e8f0;">
      <p style="font-size:12px;color:#94a3b8;line-height:1.6;">
        Baby Bloom Sydney<br/>
        This email was sent because you confirmed a hire on Baby Bloom.<br/>
        <a href="https://babybloomsydney.com.au/legal/privacy-policy" style="color:#7c3aed;">Privacy Policy</a> |
        <a href="https://babybloomsydney.com.au/legal/professional-terms" style="color:#7c3aed;">Terms of Service</a><br/>
        To unsubscribe from non-essential emails, update your <a href="https://babybloomsydney.com.au/nanny/settings" style="color:#7c3aed;">email preferences</a>.
      </p>
    </div>

  </div>
</div>
</body>
</html>`;

  const text = `Congratulations, ${professionalName}!

Your placement with ${clientName} has been mutually confirmed.
Reference: ${referenceNumber}
Date: ${hireDate}

Please check your email for the full Hire Summary PDF attachment.

Baby Bloom Sydney Pty Ltd`;

  return { subject, html, text };
}
