import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createInboxMessage, logConnectionEvent } from '@/lib/actions/connection-helpers';
import { sendEmail } from '@/lib/email/resend';
import { getUserEmailInfo } from '@/lib/email/helpers';
import { CONNECTION_STAGE } from '@/lib/position/constants';
import { emailFooter } from "@/lib/email/brand";
import { SITE_URL } from "@/lib/constants";

/**
 * Cron endpoint: expires pending connection requests past their expires_at.
 * Sends INT-005 (parent) and INT-006 (nanny) emails.
 *
 * Called by Vercel Cron every 15 minutes (see vercel.json).
 * Also callable manually: GET /api/cron/expire-connections
 *
 * Note: lazy expiry in getNannyConnectionRequests/getParentConnectionRequests
 * is the primary mechanism. This cron is the safety net for email notifications.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const appUrl = SITE_URL;
  const baseStyle = `font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;`;
  const btnStyle = `background: #8B5CF6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;`;

  // Find all pending/accepted requests past expiry
  const { data: stale } = await supabase
    .from('connection_requests')
    .select('id, parent_id, nanny_id, status')
    .in('status', ['pending', 'accepted'])
    .lt('expires_at', now);

  let expired = 0;

  for (const req of stale ?? []) {
    const wasAccepted = req.status === 'accepted';

    // Update to expired — set both status and connection_stage
    const { error } = await supabase
      .from('connection_requests')
      .update({
        status: 'expired',
        connection_stage: req.status === 'pending'
          ? CONNECTION_STAGE.REQUEST_EXPIRED
          : CONNECTION_STAGE.SCHEDULE_EXPIRED,
        updated_at: now,
      })
      .eq('id', req.id)
      .in('status', ['pending', 'accepted']); // Optimistic lock

    if (error) continue; // Already expired by lazy expiry

    expired++;

    // Log event
    await logConnectionEvent({
      connectionRequestId: req.id,
      parentId: req.parent_id,
      nannyId: req.nanny_id,
      eventType: 'expired',
    });

    // Get user IDs
    const { data: nannyData } = await supabase
      .from('nannies')
      .select('user_id')
      .eq('id', req.nanny_id)
      .single();

    const { data: parentData } = await supabase
      .from('parents')
      .select('user_id')
      .eq('id', req.parent_id)
      .single();

    // Parent inbox + email (INT-005)
    if (parentData) {
      await createInboxMessage({
        userId: parentData.user_id,
        type: 'connection_expired',
        title: 'Connection request expired',
        body: wasAccepted
          ? 'Your accepted connection has expired because a meet and greet was not scheduled in time.'
          : 'Your connection request has expired as the nanny did not respond in time.',
        actionUrl: '/parent/connections',
        referenceId: req.id,
        referenceType: 'connection_request',
      });

      const parentInfo = await getUserEmailInfo(parentData.user_id);
      if (parentInfo) {
        sendEmail({
          to: parentInfo.email,
          subject: 'Connection request expired',
          html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#f8fafc;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;">
  <div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;padding:32px;">
    <div style="margin-bottom:24px;">
      <span style="font-size:20px;font-weight:700;"><span style="color:#0f172a;">Baby</span><span style="color:#8b5cf6;">Bloom</span></span>
    </div>
    <h1 style="font-size:22px;font-weight:700;margin:0 0 16px;">Your connection request has expired</h1>
    <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;">Hi ${parentInfo.firstName}, unfortunately your connection request wasn't responded to in time and has expired.</p>
    <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;">Don't worry — there are plenty of great nannies on Baby Bloom. You can browse available nannies and send a new connection request whenever you're ready.</p>
    <div style="text-align:center;margin-top:24px;">
      <a href="${appUrl}/parent/browse" style="display:inline-block;background:#8b5cf6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Browse Nannies</a>
    </div>
    ${emailFooter({ terms: "client" })}
  </div>
</div>
</body></html>`,
          emailType: 'interview_request',
          recipientUserId: parentData.user_id,
        }).catch(err => console.error('[ExpireCron] INT-005 email error:', err));
      }
    }

    // Nanny inbox + email (INT-006)
    if (nannyData) {
      await createInboxMessage({
        userId: nannyData.user_id,
        type: 'connection_expired',
        title: wasAccepted ? 'Accepted connection expired' : 'Missed connection request',
        body: wasAccepted
          ? 'An accepted connection has expired because the family did not schedule a meet and greet in time.'
          : 'A connection request has expired. Responding promptly helps families find the right nanny.',
        actionUrl: '/nanny/inbox',
        referenceId: req.id,
        referenceType: 'connection_request',
      });

      const nannyInfo = await getUserEmailInfo(nannyData.user_id);
      if (nannyInfo) {
        sendEmail({
          to: nannyInfo.email,
          subject: 'Missed connection request',
          html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#f8fafc;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;">
  <div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;padding:32px;">
    <div style="margin-bottom:24px;">
      <span style="font-size:20px;font-weight:700;"><span style="color:#0f172a;">Baby</span><span style="color:#8b5cf6;">Bloom</span></span>
    </div>
    <h1 style="font-size:22px;font-weight:700;margin:0 0 16px;">You missed a connection request</h1>
    <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;">Hi ${nannyInfo.firstName}, a family's connection request has expired because it wasn't responded to in time.</p>
    <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;">Responding promptly helps families find the right nanny — and means more opportunities for you. Check your inbox regularly so you don't miss the next one.</p>
    <div style="text-align:center;margin-top:24px;">
      <a href="${appUrl}/nanny/inbox" style="display:inline-block;background:#8b5cf6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">View Inbox</a>
    </div>
    ${emailFooter()}
  </div>
</div>
</body></html>`,
          emailType: 'interview_request',
          recipientUserId: nannyData.user_id,
        }).catch(err => console.error('[ExpireCron] INT-006 email error:', err));
      }
    }
  }

  console.log(`[ExpireConnections] Expired: ${expired}`);
  return NextResponse.json({ expired });
}
