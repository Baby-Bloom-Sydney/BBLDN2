import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/resend';
import { getUserEmailInfo } from '@/lib/email/helpers';
import { createInboxMessage } from '@/lib/actions/connection-helpers';
import { emailFooter } from "@/lib/email/brand";
import { BRAND, SENDERS, SITE_NAME, SITE_URL } from "@/lib/constants";

/**
 * Cron endpoint: checks for verification failures older than 10 minutes
 * where the user has NOT taken any further action (updated_at unchanged).
 * Sends VER-002 (identity failed) and VER-003 (WWCC failed) emails.
 *
 * Called by Vercel Cron every 5 minutes (see vercel.json).
 * Also callable manually: GET /api/cron/send-delayed-emails
 */
export async function GET(request: NextRequest) {
  // Optional: protect with a cron secret
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const supabase = createAdminClient();
  const appUrl = SITE_URL;
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const baseStyle = `font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;`;
  const btnStyle = `background: #8B5CF6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;`;

  let sent = 0;
  let skipped = 0;

  // ── VER-002: Identity failed, no action in 10 minutes ──
  const { data: identityFailed } = await supabase
    .from('verifications')
    .select('id, user_id, identity_status_at, updated_at')
    .eq('identity_status', 'failed')
    .lt('identity_status_at', tenMinutesAgo);

  for (const v of identityFailed ?? []) {
    // Check no action taken: updated_at should equal identity_status_at (within 2s tolerance)
    const statusAt = new Date(v.identity_status_at).getTime();
    const updatedAt = new Date(v.updated_at).getTime();
    if (Math.abs(updatedAt - statusAt) > 2000) {
      // User has taken action since the failure — skip
      skipped++;
      continue;
    }

    // Check we haven't already sent this email (deduplicate)
    const { count } = await supabase
      .from('email_logs')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_user_id', v.user_id)
      .eq('email_type', 'verification_rejected')
      .gte('created_at', v.identity_status_at);

    if (count && count > 0) {
      skipped++;
      continue;
    }

    const userInfo = await getUserEmailInfo(v.user_id);
    if (!userInfo) continue;

    await sendEmail({
      to: userInfo.email,
      subject: 'Action needed: Your identity verification',
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#f8fafc;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;">
  <div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;padding:32px;">
    <div style="margin-bottom:24px;">
      <span style="font-size:20px;font-weight:700;"><span style="color:#0f172a;">Baby</span><span style="color:#8b5cf6;">Bloom</span></span>
    </div>
    <h1 style="font-size:22px;font-weight:700;margin:0 0 16px;">Your identity check needs attention</h1>
    <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;">Hi ${userInfo.firstName}, we weren't able to verify your identity documents. This can happen if the photo was unclear, details didn't match, or there was a technical issue.</p>
    <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;">Head to your verification page to see what went wrong and resubmit. It usually only takes a minute.</p>
    <div style="text-align:center;margin-top:24px;">
      <a href="${appUrl}/nanny/verification" style="display:inline-block;background:#8b5cf6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Fix It Now</a>
    </div>
    ${emailFooter()}
  </div>
</div>
</body></html>`,
      emailType: 'verification_rejected',
      recipientUserId: v.user_id,
    });
    sent++;
  }

  // ── VER-003: WWCC failed, no action in 10 minutes ──
  const { data: wwccFailed } = await supabase
    .from('verifications')
    .select('id, user_id, wwcc_status_at, updated_at')
    .eq('wwcc_status', 'failed')
    .lt('wwcc_status_at', tenMinutesAgo);

  for (const v of wwccFailed ?? []) {
    const statusAt = new Date(v.wwcc_status_at).getTime();
    const updatedAt = new Date(v.updated_at).getTime();
    if (Math.abs(updatedAt - statusAt) > 2000) {
      skipped++;
      continue;
    }

    const { count } = await supabase
      .from('email_logs')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_user_id', v.user_id)
      .eq('email_type', 'verification_rejected')
      .gte('created_at', v.wwcc_status_at);

    if (count && count > 0) {
      skipped++;
      continue;
    }

    const userInfo = await getUserEmailInfo(v.user_id);
    if (!userInfo) continue;

    await sendEmail({
      to: userInfo.email,
      subject: 'Action needed: Your WWCC verification',
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#f8fafc;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;">
  <div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;padding:32px;">
    <div style="margin-bottom:24px;">
      <span style="font-size:20px;font-weight:700;"><span style="color:#0f172a;">Baby</span><span style="color:#8b5cf6;">Bloom</span></span>
    </div>
    <h1 style="font-size:22px;font-weight:700;margin:0 0 16px;">Your WWCC check needs attention</h1>
    <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;">Hi ${userInfo.firstName}, we weren't able to verify your Working With Children Check. This can happen if the document was unclear, the details didn't match, or your WWCC number couldn't be confirmed.</p>
    <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;">Visit your verification page to see what needs fixing and resubmit your WWCC details.</p>
    <div style="text-align:center;margin-top:24px;">
      <a href="${appUrl}/nanny/verification" style="display:inline-block;background:#8b5cf6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Fix It Now</a>
    </div>
    ${emailFooter()}
  </div>
</div>
</body></html>`,
      emailType: 'verification_rejected',
      recipientUserId: v.user_id,
    });
    sent++;
  }

  // ── PVER-002: Parent identity failed, no action in 10 minutes ──
  const { data: parentIdentityFailed } = await supabase
    .from('parent_verifications')
    .select('id, user_id, identity_status_at, updated_at')
    .eq('identity_status', 'failed')
    .lt('identity_status_at', tenMinutesAgo);

  for (const pv of parentIdentityFailed ?? []) {
    // Check no action taken: updated_at should equal identity_status_at (within 2s tolerance)
    const statusAt = new Date(pv.identity_status_at).getTime();
    const updatedAt = new Date(pv.updated_at).getTime();
    if (Math.abs(updatedAt - statusAt) > 2000) {
      skipped++;
      continue;
    }

    // Dedup via email_logs
    const { count } = await supabase
      .from('email_logs')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_user_id', pv.user_id)
      .eq('email_type', 'parent_verification_failed')
      .gte('created_at', pv.identity_status_at);

    if (count && count > 0) {
      skipped++;
      continue;
    }

    const userInfo = await getUserEmailInfo(pv.user_id);
    if (!userInfo) continue;

    await sendEmail({
      to: userInfo.email,
      subject: 'Your ID verification needs attention',
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#f8fafc;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;">
  <div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;padding:32px;">
    <div style="margin-bottom:24px;">
      <span style="font-size:20px;font-weight:700;"><span style="color:#0f172a;">Baby</span><span style="color:#FF6B9D;">Bloom</span></span>
    </div>
    <h1 style="font-size:22px;font-weight:700;margin:0 0 16px;">Your identity check needs attention</h1>
    <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;">Hi ${userInfo.firstName}, we weren't able to verify your identity documents. This can happen if the photo was unclear, details didn't match, or there was a technical issue.</p>
    <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;">Head to your verification page to see what went wrong and resubmit. It usually only takes a minute.</p>
    <div style="text-align:center;margin-top:24px;">
      <a href="${appUrl}/parent/verification" style="display:inline-block;background:#FF6B9D;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Fix It Now</a>
    </div>
    ${emailFooter({ terms: "client", linkColor: "#FF6B9D" })}
  </div>
</div>
</body></html>`,
      emailType: 'parent_verification_failed',
      recipientUserId: pv.user_id,
    });
    sent++;
  }

  // ── POST-008: Service follow-up — 48h after AWAITING_RESPONSE, nudge parent ──
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const { data: awaitingConnections } = await supabase
    .from('connection_requests')
    .select('id, parent_id, nanny_id, intro_outcome_reported_at')
    .eq('connection_stage', 30) // AWAITING_RESPONSE
    .lt('intro_outcome_reported_at', fortyEightHoursAgo);

  for (const conn of awaitingConnections ?? []) {
    // Dedup: check if we already sent service_followup for this connection
    const { count: alreadySent } = await supabase
      .from('email_logs')
      .select('id', { count: 'exact', head: true })
      .eq('email_type', 'service_followup')
      .eq('subject', conn.id); // Store connection ID in subject field for dedup — or use metadata

    // Alternative dedup: check by recipient + email type + time window
    const { data: parentData } = await supabase
      .from('parents')
      .select('user_id')
      .eq('id', conn.parent_id)
      .single();

    if (!parentData) continue;

    const { count: dedupCount } = await supabase
      .from('email_logs')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_user_id', parentData.user_id)
      .eq('email_type', 'service_followup')
      .gte('created_at', conn.intro_outcome_reported_at);

    if (dedupCount && dedupCount > 0) {
      skipped++;
      continue;
    }

    // Get nanny name for the email
    const { data: nannyData } = await supabase
      .from('nannies')
      .select('user_id')
      .eq('id', conn.nanny_id)
      .single();

    const parentInfo = await getUserEmailInfo(parentData.user_id);
    const nannyInfo = nannyData ? await getUserEmailInfo(nannyData.user_id) : null;
    if (!parentInfo) continue;

    const nannyName = nannyInfo ? `${nannyInfo.firstName}` : 'your nanny';

    await createInboxMessage({
      userId: parentData.user_id,
      type: 'service_followup',
      title: `How are things going with ${nannyName}?`,
      body: `It's been a couple of days since your meet and greet. Let us know if you'd like to proceed or if we can help you find another nanny.`,
      actionUrl: '/parent/connections',
      referenceId: conn.id,
      referenceType: 'connection_request',
    });

    await sendEmail({
      to: parentInfo.email,
      subject: `How are things going with ${nannyName}?`,
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#f8fafc;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;">
  <div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;padding:32px;">
    <div style="margin-bottom:24px;">
      <span style="font-size:20px;font-weight:700;"><span style="color:#0f172a;">Baby</span><span style="color:#8b5cf6;">Bloom</span></span>
    </div>
    <h1 style="font-size:22px;font-weight:700;margin:0 0 16px;">How are things going with ${nannyName}?</h1>
    <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;">Hi ${parentInfo.firstName}, it's been a couple of days since your meet and greet. We'd love to know how things are going!</p>
    <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;">If you'd like to move forward, you can confirm the arrangement in your dashboard. If it wasn't the right fit, we're here to help you find another nanny.</p>
    <div style="text-align:center;margin-top:24px;">
      <a href="${appUrl}/parent/connections" style="display:inline-block;background:#8b5cf6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">View Connection</a>
    </div>
    ${emailFooter({ terms: "client" })}
  </div>
</div>
</body></html>`,
      emailType: 'service_followup',
      recipientUserId: parentData.user_id,
    });
    sent++;
  }

  // ── POST-010: Stale connection follow-up — 7 days after INTRO_COMPLETE with no outcome ──
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: staleConnections } = await supabase
    .from('connection_requests')
    .select('id, parent_id, nanny_id, updated_at')
    .eq('connection_stage', 21) // INTRO_COMPLETE
    .is('intro_outcome_reported_at', null)
    .lt('updated_at', sevenDaysAgo);

  for (const conn of staleConnections ?? []) {
    const { data: nannyData } = await supabase
      .from('nannies')
      .select('user_id')
      .eq('id', conn.nanny_id)
      .single();

    if (!nannyData) continue;

    // Dedup
    const { count: dedupCount } = await supabase
      .from('email_logs')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_user_id', nannyData.user_id)
      .eq('email_type', 'stale_connection_followup')
      .gte('created_at', conn.updated_at);

    if (dedupCount && dedupCount > 0) {
      skipped++;
      continue;
    }

    const { data: parentData } = await supabase
      .from('parents')
      .select('user_id')
      .eq('id', conn.parent_id)
      .single();

    const nannyInfo = await getUserEmailInfo(nannyData.user_id);
    const parentInfo = parentData ? await getUserEmailInfo(parentData.user_id) : null;
    if (!nannyInfo) continue;

    const parentName = parentInfo ? `${parentInfo.firstName}` : 'the family';

    await createInboxMessage({
      userId: nannyData.user_id,
      type: 'stale_connection_followup',
      title: `How did your meet and greet with ${parentName} go?`,
      body: `We haven't heard from you about your meet and greet. Let us know how it went so we can help with next steps.`,
      actionUrl: '/nanny/positions',
      referenceId: conn.id,
      referenceType: 'connection_request',
    });

    await sendEmail({
      to: nannyInfo.email,
      subject: `How did your meet and greet with ${parentName} go?`,
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#f8fafc;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;">
  <div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;padding:32px;">
    <div style="margin-bottom:24px;">
      <span style="font-size:20px;font-weight:700;"><span style="color:#0f172a;">Baby</span><span style="color:#8b5cf6;">Bloom</span></span>
    </div>
    <h1 style="font-size:22px;font-weight:700;margin:0 0 16px;">How did it go with ${parentName}?</h1>
    <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;">Hi ${nannyInfo.firstName}, we haven't heard from you about your meet and greet. When you have a moment, let us know how it went so we can help with next steps.</p>
    <div style="text-align:center;margin-top:24px;">
      <a href="${appUrl}/nanny/positions" style="display:inline-block;background:#8b5cf6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Update in My Positions</a>
    </div>
    ${emailFooter()}
  </div>
</div>
</body></html>`,
      emailType: 'stale_connection_followup',
      recipientUserId: nannyData.user_id,
    });
    sent++;
  }

  // ── LCY-101 to LCY-104: Verification reminder funnel ──
  // Nudges nannies stuck at various verification stages.
  // 4 emails at 30min, 24h, 48h, 7d — resets when updated_at changes.
  // 3 groups: Complete ID (1), Complete WWCC (2), Fix & Retry (3).

  const LCY_THRESHOLDS = [
    { minElapsedMs: 30 * 60 * 1000,              minSent: 0, emailId: 'LCY-101' },
    { minElapsedMs: 24 * 60 * 60 * 1000,         minSent: 1, emailId: 'LCY-102' },
    { minElapsedMs: 48 * 60 * 60 * 1000,         minSent: 2, emailId: 'LCY-103' },
    { minElapsedMs: 7 * 24 * 60 * 60 * 1000,     minSent: 3, emailId: 'LCY-104' },
  ];

  // Query nannies stuck in verification (level < 3, active account)
  const { data: stuckNannies } = await supabase
    .from('verifications')
    .select('user_id, identity_status, wwcc_status, updated_at, created_at')
    .or(
      'identity_status.in.(not_started,failed,rejected),' +
      'wwcc_status.eq.not_started,' +
      'wwcc_status.in.(failed,rejected,ocg_not_found,expired,closed)'
    );

  for (const v of stuckNannies ?? []) {
    // Check nanny is active and level < 3
    const { data: nanny } = await supabase
      .from('nannies')
      .select('verification_level, status')
      .eq('user_id', v.user_id)
      .single();

    if (!nanny || nanny.verification_level >= 3 || nanny.status !== 'active') {
      continue;
    }

    // Determine group and sub-variant
    let group: 1 | 2 | 3;
    let subVariant: string;

    if (['failed', 'rejected'].includes(v.identity_status)) {
      group = 3; subVariant = 'identity_failed';
    } else if (['failed', 'rejected'].includes(v.wwcc_status)) {
      group = 3; subVariant = 'wwcc_failed';
    } else if (v.wwcc_status === 'ocg_not_found') {
      group = 3; subVariant = 'wwcc_ocg_not_found';
    } else if (['expired', 'closed'].includes(v.wwcc_status)) {
      group = 3; subVariant = 'wwcc_expired';
    } else if (v.identity_status === 'verified' && v.wwcc_status === 'not_started') {
      group = 2; subVariant = 'wwcc_not_started';
    } else if (['not_started'].includes(v.identity_status)) {
      group = 1; subVariant = 'id_not_started';
    } else {
      // Not in a stuck state we handle (e.g. processing, pending, review)
      continue;
    }

    const stuckSince = new Date(v.updated_at || v.created_at).getTime();
    const elapsed = Date.now() - stuckSince;

    // Count reminders already sent since stuckSince
    const { count: reminderCount } = await supabase
      .from('email_logs')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_user_id', v.user_id)
      .eq('email_type', 'verification_reminder')
      .gte('created_at', new Date(stuckSince).toISOString());

    const sentCount = reminderCount ?? 0;

    // Find which email to send (if any)
    const threshold = LCY_THRESHOLDS.find(
      t => sentCount === t.minSent && elapsed >= t.minElapsedMs
    );
    if (!threshold) continue;

    const userInfo = await getUserEmailInfo(v.user_id);
    if (!userInfo) continue;

    // Build group-specific content
    const { subject, heading, bodyParagraphs, ctaText } = getLcyContent(
      threshold.emailId, group, subVariant, userInfo.firstName
    );

    const isLcy104 = threshold.emailId === 'LCY-104';

    await sendEmail({
      to: userInfo.email,
      subject,
      ...(isLcy104 ? { from: `${SITE_NAME} <${SENDERS.hello}>` } : {}),
      html: buildLcyHtml(heading, bodyParagraphs, ctaText, appUrl),
      emailType: 'verification_reminder',
      recipientUserId: v.user_id,
    });
    sent++;
  }

  console.log(`[Delayed Emails] Sent: ${sent}, Skipped: ${skipped}`);
  return NextResponse.json({ sent, skipped });
}

// ── LCY email content by group and email ID ──

function getLcyContent(
  emailId: string,
  group: 1 | 2 | 3,
  subVariant: string,
  firstName: string
): { subject: string; heading: string; bodyParagraphs: string[]; ctaText: string } {

  // Group messages
  const groupMessages: Record<string, string> = {
    // Group 1
    id_not_started: 'To connect you with families, we need to verify your identity. It\u2019s a quick process \u2014 confirm your address, upload your passport, and take a selfie. Most people finish in under 3 minutes.',
    // Group 2
    wwcc_not_started: 'Your identity is verified \u2014 you\u2019re one step away! Upload your Working With Children Check and your profile will be visible to families in your area.',
    // Group 3 sub-variants
    identity_failed: 'Your identity check needs a quick fix \u2014 most people get it right on the second try. Head to your verification page to see what needs adjusting.',
    wwcc_failed: 'Your WWCC check needs a quick fix. If one upload method didn\u2019t work, try another \u2014 the Grant Email PDF is usually the most reliable.',
    wwcc_ocg_not_found: 'The Office of the Children\u2019s Guardian couldn\u2019t find your WWCC with the details provided. This usually means a typo in the WWCC number or a surname mismatch.',
    wwcc_expired: 'Your WWCC needs to be renewed before we can verify you. Once you have a new clearance from the Office of the Children\u2019s Guardian, come back and resubmit.',
  };

  // Group instructions (HTML formatted)
  const groupInstructions: Record<string, string> = {
    id_not_started:
      '1. Go to your Verification page<br/>' +
      '2. Enter your residential address and click \u201cVerify Residence\u201d<br/>' +
      '3. Upload a clear photo of your passport<br/>' +
      '4. Take a quick selfie (good lighting, face visible)<br/>' +
      '5. Click \u201cVerify ID\u201d',
    wwcc_not_started:
      '1. Go to your Verification page<br/>' +
      '2. Choose your WWCC verification method:<br/>' +
      '&nbsp;&nbsp;&bull; <strong>Fastest:</strong> Upload your WWCC Grant Email as a PDF<br/>' +
      '&nbsp;&nbsp;&bull; <strong>Also fast:</strong> Upload a screenshot from the Service NSW app<br/>' +
      '&nbsp;&nbsp;&bull; <strong>Manual:</strong> Enter your WWCC number and expiry date<br/>' +
      '3. Click \u201cVerify WWCC\u201d',
    identity_failed:
      '1. Go to your Verification page<br/>' +
      '2. Review the feedback on what went wrong<br/>' +
      '3. Retake your passport photo or selfie as needed<br/>' +
      '4. Click \u201cVerify ID\u201d to resubmit',
    wwcc_failed:
      '1. Go to your Verification page<br/>' +
      '2. Review the feedback on what went wrong<br/>' +
      '3. Re-upload your WWCC document or try a different method<br/>' +
      '4. Click \u201cVerify WWCC\u201d',
    wwcc_ocg_not_found:
      '1. Double-check your WWCC number (format: WWC1234567E)<br/>' +
      '2. Ensure your surname matches exactly what\u2019s on your WWCC<br/>' +
      '3. Go to your Verification page and resubmit',
    wwcc_expired:
      '1. Apply for a new WWCC at ocg.nsw.gov.au<br/>' +
      '2. Once you receive your new clearance, go to your Verification page<br/>' +
      '3. Upload your new WWCC grant email or enter details manually',
  };

  const message = groupMessages[subVariant] || groupMessages.id_not_started;
  const instructions = groupInstructions[subVariant] || groupInstructions.id_not_started;

  switch (emailId) {
    case 'LCY-101': {
      const subjects: Record<number, string> = {
        1: `${firstName}, let\u2019s get you verified so families can find you`,
        2: `${firstName}, one more step and you\u2019re done`,
        3: `${firstName}, quick fix needed on your verification`,
      };
      return {
        subject: subjects[group],
        heading: group === 3 ? 'Quick fix needed' : 'Almost there!',
        bodyParagraphs: [
          `Hi ${firstName},`,
          `Verify your account to be considered for nanny and babysitting positions with families in ${BRAND.city}.`,
          message,
          `<strong>Here\u2019s what to do:</strong><br/>${instructions}`,
          'It only takes a few minutes to complete.',
        ],
        ctaText: 'Complete Verification',
      };
    }
    case 'LCY-102': {
      const subjects: Record<number, string> = {
        1: `We\u2019d love to help you find work, ${firstName}`,
        2: `You\u2019re so close to being verified, ${firstName}`,
        3: `Let\u2019s get your verification back on track, ${firstName}`,
      };
      return {
        subject: subjects[group],
        heading: 'We want to help you find work',
        bodyParagraphs: [
          `Hi ${firstName},`,
          'We\u2019re unable to put you forward for jobs or connect you with families without first verifying your account. Verification is quick and ensures families can trust the nannies on our platform.',
          message,
          `<strong>Here\u2019s what to do:</strong><br/>${instructions}`,
          'It only takes a few minutes to pick up where you left off.',
        ],
        ctaText: 'Complete Verification',
      };
    }
    case 'LCY-103': {
      const subjects: Record<number, string> = {
        1: `Families in your area are looking for nannies, ${firstName}`,
        2: `You\u2019re one step away from job opportunities, ${firstName}`,
        3: `A quick fix is all that\u2019s standing between you and families, ${firstName}`,
      };
      return {
        subject: subjects[group],
        heading: 'Families are searching for nannies',
        bodyParagraphs: [
          `Hi ${firstName},`,
          'Parents are unable to request you for nanny or babysitting positions because your account has not been verified yet.',
          'Until you\u2019re verified, families can\u2019t:<br/>' +
          '&nbsp;&nbsp;&bull; Request a meet and greet with you<br/>' +
          '&nbsp;&nbsp;&bull; Offer you nanny positions<br/>' +
          '&nbsp;&nbsp;&bull; Book you for babysitting jobs',
          message,
          `<strong>Here\u2019s your next step:</strong><br/>${instructions}`,
          'We built Baby Bloom to help nannies like you find work \u2014 let us do that for you.',
        ],
        ctaText: 'Finish Verification',
      };
    }
    case 'LCY-104': {
      return {
        subject: `Last reminder: Let\u2019s get you verified, ${firstName}`,
        heading: 'Last reminder',
        bodyParagraphs: [
          `Hi ${firstName},`,
          'This is our last reminder \u2014 your Baby Bloom verification is still incomplete, which means we can\u2019t show your profile to families or send any work opportunities your way.',
          message,
          'If you\u2019re having trouble or something isn\u2019t working, just reply to this email and we\u2019ll help you personally. We want to make sure nothing is standing between you and finding great families to work with.',
        ],
        ctaText: 'Complete Verification',
      };
    }
    default:
      return { subject: '', heading: '', bodyParagraphs: [], ctaText: '' };
  }
}

// ── LCY HTML builder (matches existing email template structure) ──

function buildLcyHtml(
  heading: string,
  bodyParagraphs: string[],
  ctaText: string,
  appUrl: string
): string {
  const paragraphs = bodyParagraphs
    .map(p => `    <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;">${p}</p>`)
    .join('\n');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#f8fafc;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;">
  <div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;padding:32px;">
    <div style="margin-bottom:24px;">
      <span style="font-size:20px;font-weight:700;"><span style="color:#0f172a;">Baby</span><span style="color:#8b5cf6;">Bloom</span></span>
    </div>
    <h1 style="font-size:22px;font-weight:700;margin:0 0 16px;">${heading}</h1>
${paragraphs}
    <div style="text-align:center;margin-top:24px;">
      <a href="${appUrl}/nanny/verification" style="display:inline-block;background:#8b5cf6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">${ctaText}</a>
    </div>
    ${emailFooter()}
  </div>
</div>
</body></html>`;
}
