import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email/resend';
import { emailHeader } from "@/lib/email/brand";
import { SITE_NAME } from "@/lib/constants";

export async function GET(request: NextRequest) {
  // Dev-only guard
  if (process.env.NEXT_PUBLIC_DEV_MODE !== 'true' && process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }

  const to = request.nextUrl.searchParams.get('to');
  if (!to) {
    return NextResponse.json({ error: 'Missing ?to=email@example.com' }, { status: 400 });
  }

  const result = await sendEmail({
    to,
    subject: 'Baby Bloom — Test Email',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        ${emailHeader()}
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          This is a test email from your Baby Bloom platform.
          If you're reading this, Resend is configured correctly!
        </p>
        <p style="color: #6B7280; font-size: 14px; margin-top: 24px;">
          Sent at: ${new Date().toISOString()}
        </p>
      </div>
    `,
    text: `This is a test email from ${SITE_NAME}. If you are reading this, Resend is configured correctly!`,
    emailType: 'admin_notification',
  });

  return NextResponse.json(result);
}
